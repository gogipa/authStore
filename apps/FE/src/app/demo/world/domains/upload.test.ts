import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@/shared/api/client';
import type { DemoApi } from '../../demoApi';
import { reachThumbnailDone, startDemoKit } from '../testkit';

/** ⑧ 이미지 업로드(D-32): 눌러서 실행 → 지연 뒤 COMPLETED. 시작 조건(⑤·⑥-3 완료, G3 유효)은 엔진이 막는다. */
let demo: DemoApi;
let off: () => void;

beforeEach(() => {
  ({ demo, off } = startDemoKit());
});

afterEach(() => {
  off();
  expect(demo.serverErrors).toEqual([]);
  expect(demo.unknownRequests).toEqual([]);
});

const candidateId = 1;
const path = { params: { path: { candidateId } } };

const rail = async () => {
  const res = await api.GET('/candidates/{candidateId}/steps', path);
  return Object.fromEntries(res.data!.items.map((item) => [item.stepCode, item]));
};
const run = (stepCode: 'COPY' | 'TAGS' | 'UPLOAD', body: object = {}) =>
  api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
    params: { path: { candidateId, stepCode } },
    body,
  });
const uploadResult = (query: { stepRunId?: number } = {}) =>
  api.GET('/candidates/{candidateId}/upload-result', {
    params: { path: { candidateId }, query },
  });

/** ⑥ 묶음 + ⑦까지(⑧ 앞) */
async function reachTagsDone() {
  await reachThumbnailDone(demo);
  await run('COPY', { throughStepCode: 'NOTICE_HTML' });
  demo.world.flush();
  await run('TAGS');
  demo.world.flush();
}

describe('⑧ 이미지 업로드', () => {
  it('실행 전: 산출물 404, ⑥-3 전에는 [실행]이 막힌다(빠진 입력 이름)', async () => {
    await reachThumbnailDone(demo);
    const res = await uploadResult();
    expect(res.response.status).toBe(404);
    expect(res.error).toMatchObject({
      code: 'STEP_OUTPUT_NOT_FOUND',
      message: '아직 ⑧ 이미지 업로드를 실행하지 않았습니다.',
      details: { stepCode: 'UPLOAD' },
    });
    const blocked = await run('UPLOAD');
    expect(blocked.response.status).toBe(409);
    expect(blocked.error).toMatchObject({
      code: 'STEP_START_CONDITION_UNMET',
      message: '시작에 필요한 값이 없습니다: ⑥-3 HTML.',
    });
    expect((await rail()).UPLOAD!.actions.run).toMatchObject({
      enabled: false,
      disabledReason: { code: 'STEP_START_CONDITION_UNMET' },
    });
  });

  it('G3가 무효이면 409 GATE_NOT_PASSED(문구 그대로)', async () => {
    await reachTagsDone();
    demo.world.s.gates.G3 = null;
    const res = await run('UPLOAD');
    expect(res.error).toMatchObject({
      code: 'GATE_NOT_PASSED',
      message: 'G3 썸네일 선택을 먼저 통과해 주세요.',
    });
  });

  it('[실행] 202 → 실행중(404) → 완료: 업로드 이미지 2장, 레일 현재 실행과 같은 stepRunId, 여정은 승인대기', async () => {
    await reachTagsDone();
    expect((await api.GET('/candidates/{candidateId}', path)).data!.status).toBe('WORKING');
    const started = await run('UPLOAD');
    expect(started.response.status).toBe(202);
    expect(started.data).toMatchObject({ stepCode: 'UPLOAD', version: 1, status: 'RUNNING' });
    expect((await uploadResult()).error).toMatchObject({ code: 'STEP_OUTPUT_NOT_FOUND' });

    demo.world.flush();
    const item = (await rail()).UPLOAD!;
    expect(item.status).toBe('COMPLETED');
    const out = (await uploadResult()).data!;
    expect(out).toMatchObject({
      stepRunId: item.currentStepRunId,
      version: 1,
      stepRunStatus: 'COMPLETED',
      isCurrent: true,
      uploadResultId: 1,
    });
    expect(out.images.map((image) => [image.role, image.sortOrder, image.imageAssetId])).toEqual([
      ['REPRESENTATIVE', 0, 31],
      ['ADDITIONAL', 1, 32],
    ]);
    expect(out.images.every((image) => image.reused === false)).toBe(true);
    expect(out.detailContent).toContain(out.images[0]!.url);
    expect(out.detailContentSha256).toMatch(/^[0-9a-f]{64}$/);
    // 필수 9단계가 모두 완료 → 승인대기
    const detail = await api.GET('/candidates/{candidateId}', path);
    expect(detail.data!.status).toBe('AWAITING_APPROVAL');
  });

  it('다시 실행하면 새 버전(uploadResultId +1)이고 같은 주소를 다시 쓴다(reused)', async () => {
    await reachTagsDone();
    const first = await run('UPLOAD');
    demo.world.flush();
    const before = (await uploadResult()).data!;
    // 승인대기 여정에서 ⑧을 다시 시작하면 여정은 작업중으로 내려간다(⑧이 최신이 아니다)
    const second = await run('UPLOAD');
    expect(second.data!.version).toBe(2);
    expect((await api.GET('/candidates/{candidateId}', path)).data!.status).toBe('WORKING');
    expect((await uploadResult()).error).toMatchObject({ code: 'STEP_OUTPUT_NOT_FOUND' });
    demo.world.flush();
    const after = (await uploadResult()).data!;
    expect(after).toMatchObject({ version: 2, uploadResultId: 2, isCurrent: true });
    expect(after.images.map((image) => image.url)).toEqual(before.images.map((i) => i.url));
    expect(after.images.every((image) => image.reused)).toBe(true);
    expect((await uploadResult({ stepRunId: first.data!.stepRunId })).data).toMatchObject({
      version: 1,
      isCurrent: false,
    });
    expect((await api.GET('/candidates/{candidateId}', path)).data!.status).toBe(
      'AWAITING_APPROVAL',
    );
  });

  it('쿼리 오류는 422 INVALID_QUERY_PARAMETER, 다른 단계 실행 번호는 404 STEP_RUN_NOT_FOUND', async () => {
    await reachTagsDone();
    await run('UPLOAD');
    demo.world.flush();
    const bad = await uploadResult({ stepRunId: -1 });
    expect(bad.error).toMatchObject({
      code: 'INVALID_QUERY_PARAMETER',
      fieldErrors: [{ field: 'stepRunId', message: '1 이상의 정수여야 합니다.' }],
    });
    const tagsRun = (await rail()).TAGS!.currentStepRunId!;
    expect((await uploadResult({ stepRunId: tagsRun })).error).toMatchObject({
      code: 'STEP_RUN_NOT_FOUND',
    });
  });
});

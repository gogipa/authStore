import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DEMO_TEXT } from '@/features/guide';
import { api, imageAssetFileUrl, installApiRuntime } from '@/shared/api/client';
import { createDemoApi, DEMO_CANDIDATE_ID, type DemoApi } from './demoApi';

/**
 * 체험 API(D-31·D-32) — 전송 계층: 앱의 `api`(openapi-fetch) 전송을 메모리 모델로 바꾼 채 부른다. 네트워크(전역 fetch)를 부르지
 * 않고, 표에 없는 조회는 404, 따라 하기에 없는 변경은 403 체험 글로 답한다. 단계 규칙·상태 변화는 world/*.test.ts가 본다.
 */
let demo: DemoApi;
let uninstall: () => void;
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  demo = createDemoApi({ delays: { short: 0, medium: 0, long: 0 } });
  uninstall = installApiRuntime(demo);
});

afterEach(() => {
  uninstall();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(demo.serverErrors).toEqual([]);
});

describe('체험 API — 시작 상태(D-32)', () => {
  it('예시 여정 번호는 1이고 처음에는 여정이 없다', async () => {
    expect(DEMO_CANDIDATE_ID).toBe(1);
    const detail = await api.GET('/candidates/{candidateId}', {
      params: { path: { candidateId: DEMO_CANDIDATE_ID } },
    });
    expect(detail.response.status).toBe(404);
    expect(detail.error).toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
    expect(demo.unknownRequests).toEqual([]);
  });

  it('시작 준비에 쓰는 조회가 모두 완료 값이다(키 6개 저장·프로필 빈칸 없음·연결 테스트 통과·차단 켬)', async () => {
    const secrets = await api.GET('/secrets');
    expect(secrets.data?.items.every((s) => s.configured)).toBe(true);
    const profile = await api.GET('/purchase-agency-profile');
    expect(profile.data?.missingFields).toEqual([]);
    const latest = await api.GET('/ai-cli-checks/latest');
    const smoke = latest.data?.items.map((i) => [i.engineCode, i.latest?.smokeStatus]);
    expect(smoke).toEqual(
      expect.arrayContaining([
        ['CLAUDE', 'PASSED'],
        ['AGY', 'PASSED'],
      ]),
    );
    const fx = await api.GET('/fx-rates/latest');
    expect(fx.data?.items).toHaveLength(3);
  });

  it('예시 가게 값이 채워져 있다(fixture 자리표시자 [내 상호]·[수입자]가 보이지 않는다)', async () => {
    const profile = await api.GET('/purchase-agency-profile');
    expect(JSON.stringify(profile.data)).not.toMatch(/\[(내 상호|수입자|A\/S 연락처|A\/S 안내)\]/);
    expect(profile.data?.businessName).toBe('정복상회(예시)');
  });
});

describe('체험 API — 따라 하기 밖·없는 것', () => {
  it('따라 하기에 없는 변경은 403 DEMO_READ_ONLY와 체험 글(요청을 모델에 반영하지 않는다)', async () => {
    const save = await api.PUT('/settings/ai-engine', {
      body: { engineCode: 'CLAUDE' } as never,
    });
    expect(save.response.status).toBe(403);
    expect(save.error).toMatchObject({ code: 'DEMO_READ_ONLY', message: DEMO_TEXT.readOnly });
    const sync = await api.POST('/commerce-meta-sync-runs' as never, { body: {} } as never);
    expect(sync.response.status).toBe(403);
    expect(demo.readOnlyRequests).toEqual([
      'PUT /settings/ai-engine',
      'POST /commerce-meta-sync-runs',
    ]);
    expect(demo.unknownRequests).toEqual([]);
  });

  it('표에 없는 조회는 404 DEMO_NOT_AVAILABLE로 답하고 남긴다', async () => {
    const missing = await api.GET('/registration-switch-history' as never);
    expect(missing.response.status).toBe(404);
    expect(missing.error).toMatchObject({
      code: 'DEMO_NOT_AVAILABLE',
      message: DEMO_TEXT.notAvailable,
    });
    expect(demo.unknownRequests).toEqual(['GET /registration-switch-history']);
    (demo.unknownRequests as string[]).length = 0;
  });

  it('AI 엔진 감지(POST /ai-cli-checks, smokeTest false — 화면을 열 때 보낸다)는 202 접수로 답한다', async () => {
    const detect = await api.POST('/ai-cli-checks', {
      body: { smokeTest: false, trigger: 'MANUAL' },
    });
    expect(detect.response.status).toBe(202);
    expect(detect.data).toMatchObject({
      engineCodes: ['CLAUDE', 'AGY', 'CODEX'],
      smokeTest: false,
      trigger: 'MANUAL',
      status: 'RUNNING',
    });
    // 결과는 보내지 않는다 — 예시의 최신 점검(연결 테스트 통과)이 그대로다
    const latest = await api.GET('/ai-cli-checks/latest');
    expect(latest.data?.items.find((i) => i.engineCode === 'CLAUDE')?.latest?.smokeStatus).toBe(
      'PASSED',
    );
    expect(demo.readOnlyRequests).toEqual([]);
  });

  it('AI 엔진 연결 테스트(smokeTest true — 사용자가 누르는 실행)는 403 체험 글', async () => {
    const smoke = await api.POST('/ai-cli-checks', {
      body: { engineCodes: ['CLAUDE'], smokeTest: true, trigger: 'BEFORE_SAVE' },
    });
    expect(smoke.response.status).toBe(403);
    expect(smoke.error).toMatchObject({ code: 'DEMO_READ_ONLY', message: DEMO_TEXT.readOnly });
    expect(demo.readOnlyRequests).toEqual(['POST /ai-cli-checks']);
  });

  it('화면이 조회처럼 부르는 계산 POST(라쿠텐 검색어 검사)는 모델과 상관없이 답한다', async () => {
    const check = await api.POST('/rakuten-query-validations', {
      body: { rakutenQuery: 'アシックス ゲルカヤノ14 1201A019' },
    });
    expect(check.response.status).toBe(200);
    expect(check.data?.valid).toBe(true);
  });
});

describe('체험 이미지 — /api를 부르지 않는다', () => {
  it('이미지 주소는 앱에 묶은 예시 그림(같은 출처 경로, data: 아님)', () => {
    for (const id of [1, 2, 3, 31, 32, 901, 902, 12345]) {
      const url = imageAssetFileUrl(id);
      expect(url, String(id)).not.toMatch(/^\/api\//);
      expect(url, String(id)).not.toMatch(/^data:/);
      expect(url, String(id)).toMatch(/\.svg/);
    }
  });

  it('보통 앱으로 되돌리면 이미지 주소는 다시 BE 파일 경로', () => {
    uninstall();
    expect(imageAssetFileUrl(7)).toBe('/api/v1/image-assets/7/file');
    uninstall = installApiRuntime(demo);
  });
});

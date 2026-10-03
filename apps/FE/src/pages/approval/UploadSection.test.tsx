import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import { uploadResultImage, uploadResultOutput } from '@/test/fixtures/registration';
import { candidateDetail, disabled, gateList, stepRail } from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';

const CANDIDATE_ID = 1;
type Rail = Parameters<typeof stepRail>[0];

function setup(rail: Rail, output = uploadResultOutput()) {
  return stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList(38)),
    [`GET /candidates/${CANDIDATE_ID}`]: () =>
      jsonResponse(candidateDetail({ id: CANDIDATE_ID, resumeStepCode: null })),
    [`GET /candidates/${CANDIDATE_ID}/steps`]: () => jsonResponse(stepRail(rail)),
    [`GET /candidates/${CANDIDATE_ID}/gates`]: () => jsonResponse(gateList({ G2: true, G3: true })),
    [`GET /candidates/${CANDIDATE_ID}/upload-result`]: () => jsonResponse(output),
    [`POST /candidates/${CANDIDATE_ID}/steps/UPLOAD/runs`]: () =>
      jsonResponse(
        {
          stepRunId: 109,
          stepRunIds: [109],
          candidateId: CANDIDATE_ID,
          stepCode: 'UPLOAD',
          version: 2,
          executionMode: 'STEP',
          aiEngine: null,
          aiModel: null,
          aiCliVersion: null,
          status: 'RUNNING',
          warnings: [],
        },
        202,
      ),
  });
}

const completed: Rail = { UPLOAD: { status: 'COMPLETED', currentStepRunId: 108 } };

describe('⑧ 이미지 업로드 영역(SCR-08 UploadSection, P4-01)', () => {
  it("완료면 칩 '완료'·'버전 v1'·입력 출처 문구가 보인다(시안 문구)", async () => {
    setup(completed);
    renderRoute(`/candidates/${CANDIDATE_ID}/approval`);
    expect(await screen.findByRole('heading', { level: 1, name: '최종 승인' })).toBeInTheDocument();
    const section = within(screen.getByRole('region', { name: '⑧ 이미지 업로드' }));
    expect(await section.findByText('완료')).toBeInTheDocument();
    expect(section.getByText(/버전 v1/)).toBeInTheDocument();
    expect(section.getByText('입력 출처: ⑤ 선택본 · ⑥-3 상세 HTML')).toBeInTheDocument();
    expect(section.queryByText('SCR-08')).not.toBeInTheDocument(); // 화면 ID 칩 없음(D-27)
    expect(await section.findByText('2장 · 1000×1000 JPEG')).toBeInTheDocument();
  });

  it("재실행 필요면 '재실행 필요'와 바뀐 입력 이름이 보인다", async () => {
    setup({
      UPLOAD: {
        status: 'RERUN_REQUIRED',
        currentStepRunId: 108,
        staleInputs: ['noticeHtml.html'],
      },
    });
    renderRoute(`/candidates/${CANDIDATE_ID}/approval`);
    const section = within(await screen.findByRole('region', { name: '⑧ 이미지 업로드' }));
    expect(await section.findByText('재실행 필요')).toBeInTheDocument();
    expect(section.getByText('바뀐 입력: ⑥-3 HTML')).toBeInTheDocument();
  });

  it("'다시 실행'을 누르면 POST …/steps/UPLOAD/runs가 한 번 불린다", async () => {
    const stub = setup(completed);
    renderRoute(`/candidates/${CANDIDATE_ID}/approval`);
    const section = within(await screen.findByRole('region', { name: '⑧ 이미지 업로드' }));
    const button = await section.findByRole('button', { name: '다시 실행' });
    await userEvent.click(button);
    await waitFor(() =>
      expect(
        stub.requests.filter(
          (r) =>
            r.method === 'POST' && r.url.endsWith(`/candidates/${CANDIDATE_ID}/steps/UPLOAD/runs`),
        ),
      ).toHaveLength(1),
    );
  });

  it('이미지 src는 모두 /api/v1/image-assets/…/file이다(외부 URL 없음). 다시 쓴 주소는 칩', async () => {
    setup(
      completed,
      uploadResultOutput({
        images: [
          uploadResultImage({ sortOrder: 0, reused: true }),
          uploadResultImage({ sortOrder: 1 }),
        ],
      }),
    );
    renderRoute(`/candidates/${CANDIDATE_ID}/approval`);
    const list = await screen.findByRole('list', { name: '업로드한 이미지' });
    const images = within(list).getAllByRole('img');
    expect(images.map((img) => img.getAttribute('alt'))).toEqual(['대표 이미지', '추가 이미지 1']);
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      '/api/v1/image-assets/31/file',
      '/api/v1/image-assets/32/file',
    ]);
    for (const img of images) expect(img.getAttribute('src')).not.toMatch(/^https?:/);
    expect(within(list).getByText('다시 씀')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('shop-phinf');
  });

  it('G3이 없으면 다시 실행이 꺼지고 꺼진 이유가 보인다. 실행 전이면 빈 안내', async () => {
    setup({
      UPLOAD: {
        status: 'NOT_RUN',
        actions: {
          run: disabled('GATE_NOT_PASSED', 'G3 썸네일 선택을 먼저 통과해 주세요.'),
          continuousRun: disabled('GATE_NOT_PASSED', 'G3 썸네일 선택을 먼저 통과해 주세요.'),
          edit: disabled('INVALID_STEP_CODE', '이 단계는 값을 직접 고칠 수 없습니다.'),
        },
      },
    });
    renderRoute(`/candidates/${CANDIDATE_ID}/approval`);
    const section = within(await screen.findByRole('region', { name: '⑧ 이미지 업로드' }));
    expect(await section.findByRole('button', { name: '실행' })).toBeDisabled();
    expect(section.getByText('G3 썸네일 선택을 먼저 통과해 주세요.')).toBeInTheDocument();
    expect(
      section.getByText(
        '아직 올린 이미지가 없습니다. ⑧을 실행하면 고른 썸네일을 1000×1000 JPEG로 올립니다.',
      ),
    ).toBeInTheDocument();
  });
});

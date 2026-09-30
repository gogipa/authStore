import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import { candidateDetail, gateList, stepRail } from '@/test/fixtures/stepEngine';
import { promptPreview, referencesResult, sourceImageList } from '@/test/fixtures/thumbnails';
import { renderRoute } from '@/test/renderRoute';

const CANDIDATE_ID = 1;
/** stepRail fixture의 ⑤ 현재 실행 id(100 + 흐름 순서 3) */
const RUN_ID = 103;

function setup(thumbnailStatus: 'WAITING_INPUT' | 'NOT_RUN' | 'COMPLETED' = 'WAITING_INPUT') {
  let saved = false;
  const api = stubApi({
    'GET /call-usage': () => jsonResponse(callUsageList(38)),
    [`GET /candidates/${CANDIDATE_ID}`]: () =>
      jsonResponse(
        candidateDetail({
          id: CANDIDATE_ID,
          itemCode: 'shop-a:10000123',
          resumeStepCode: 'THUMBNAIL',
          gender: 'MALE',
        }),
      ),
    [`GET /candidates/${CANDIDATE_ID}/steps`]: () =>
      jsonResponse(
        stepRail({
          SOURCING: { status: 'COMPLETED' },
          PRICING: { status: 'COMPLETED' },
          CATEGORY: { status: 'COMPLETED' },
          THUMBNAIL: { status: thumbnailStatus },
        }),
      ),
    [`GET /candidates/${CANDIDATE_ID}/gates`]: () => jsonResponse(gateList({ G2: true })),
    [`GET /candidates/${CANDIDATE_ID}/source-images`]: () => jsonResponse(sourceImageList(6)),
    'POST /thumbnail-prompt-previews': () =>
      jsonResponse(promptPreview({ generationAllowed: saved })),
    [`PUT /step-runs/${RUN_ID}/thumbnail-references`]: () => {
      saved = true;
      return jsonResponse(referencesResult(RUN_ID, [2]));
    },
    [`POST /candidates/${CANDIDATE_ID}/steps/THUMBNAIL/runs`]: () =>
      jsonResponse({ stepRunId: 300, candidateId: CANDIDATE_ID }, 202),
  });
  return api;
}

async function renderThumbnail() {
  const view = renderRoute(`/candidates/${CANDIDATE_ID}/thumbnail`);
  await screen.findByRole('heading', { level: 1, name: '썸네일 스튜디오' });
  return view;
}

const requestsTo = (api: ReturnType<typeof stubApi>, method: string, path: string) =>
  api.requests.filter((r) => r.method === method && new URL(r.url).pathname === `/api/v1${path}`);

describe('⑤ 썸네일 화면(SCR-05, P3-01)', () => {
  it('자리표시 대신 ⑤ 상태 줄·원본 이미지·생성 옵션을 그린다. M2 패널(생성 순서와 비용)은 없다', async () => {
    setup();
    await renderThumbnail();
    expect(screen.getByRole('heading', { level: 2, name: '⑤ 썸네일' })).toBeInTheDocument();
    expect(await screen.findByText('입력 출처: ② 원본 이미지 · 레퍼런스 선택')).toBeInTheDocument();
    const original = await screen.findByRole('region', { name: '원본 이미지' });
    expect(await within(original).findAllByText('참조 전용')).toHaveLength(6);
    expect(screen.getByRole('region', { name: '생성 옵션' })).toBeInTheDocument();
    expect(screen.queryByText('생성 순서와 비용')).not.toBeInTheDocument();
    expect(screen.queryByText(/SCR-05 화면은 준비 중/)).not.toBeInTheDocument();
  });

  it("레퍼런스 1~3장 + '사람·얼굴 없음' 체크 + generationAllowed 전에는 생성 버튼이 꺼지고 이유 글. 체크하면 저장 → 다시 검사 → 켜진다", async () => {
    const api = setup();
    await renderThumbnail();
    const button = screen.getByRole('button', { name: '만들기' });
    await screen.findByText('실존 인물 이름 없음');
    expect(button).toBeDisabled();
    expect(
      screen.getByText("레퍼런스 1~3장을 고르고 '레퍼런스에 사람·얼굴 없음'을 체크해 주세요."),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: '원본 2 레퍼런스' }));
    expect(button).toBeDisabled();
    expect(requestsTo(api, 'PUT', `/step-runs/${RUN_ID}/thumbnail-references`)).toHaveLength(0);
    await user.click(screen.getByRole('checkbox', { name: '레퍼런스에 사람·얼굴 없음' }));
    await waitFor(() =>
      expect(requestsTo(api, 'PUT', `/step-runs/${RUN_ID}/thumbnail-references`)).toHaveLength(1),
    );
    await waitFor(() => expect(button).toBeEnabled());
    // 저장 뒤 미리보기를 다시 불렀다(generationAllowed)
    expect(requestsTo(api, 'POST', '/thumbnail-prompt-previews').length).toBeGreaterThanOrEqual(2);
  });

  it('⑤ 미실행이면 레퍼런스를 고를 수 없고 생성 버튼 이유 글, 실행 단추는 ⑤ 실행을 부른다', async () => {
    const api = setup('NOT_RUN');
    await renderThumbnail();
    expect(
      await screen.findByText('⑤를 실행해 원본 이미지를 받은 뒤 만들 수 있습니다.'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: '원본 1 레퍼런스' })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button', { name: '실행' }));
    await waitFor(() =>
      expect(
        requestsTo(api, 'POST', `/candidates/${CANDIDATE_ID}/steps/THUMBNAIL/runs`),
      ).toHaveLength(1),
    );
    expect(requestsTo(api, 'POST', '/thumbnail-prompt-previews')).toHaveLength(0);
  });
});

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import { candidateDetail, disabled, gateList, stepRail } from '@/test/fixtures/stepEngine';
import {
  generationSummary,
  promptPreview,
  referencesResult,
  sourceImageList,
  thumbnailOutput,
} from '@/test/fixtures/thumbnails';
import { renderRoute } from '@/test/renderRoute';

const CANDIDATE_ID = 1;
/** stepRail fixture의 ⑤ 현재 실행 id(100 + 흐름 순서 3) */
const RUN_ID = 103;

function setup(
  thumbnailStatus: 'WAITING_INPUT' | 'NOT_RUN' | 'COMPLETED' = 'WAITING_INPUT',
  // P3-01 테스트: 아직 레퍼런스를 저장하지 않은 ⑤(체크가 비어 시작한다)
  output = thumbnailOutput({ references: [], referencesConfirmed: false }),
) {
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
    [`GET /candidates/${CANDIDATE_ID}/thumbnail`]: () => jsonResponse(output),
    [`POST /step-runs/${RUN_ID}/generation-runs`]: () =>
      jsonResponse(
        {
          stepRunId: RUN_ID,
          candidateId: CANDIDATE_ID,
          generationRuns: [
            {
              generationRunId: 801,
              slotNo: 1,
              attemptNo: 2,
              triggerType: 'OWNER_RETRY',
              status: 'RUNNING',
            },
          ],
        },
        202,
      ),
    [`POST /candidates/${CANDIDATE_ID}/gates/G3/pass`]: () =>
      jsonResponse(
        {
          gatePassId: 5,
          gate: 'G3',
          fingerprint: 'f'.repeat(64),
          basisStepRunId: RUN_ID,
          passedAt: '2026-09-28T05:24:00.000Z',
          candidateStatus: 'WORKING',
          statusChanged: false,
          thumbnailSelectionId: 9,
          thumbnailStepRunId: RUN_ID,
          warnings: [],
        },
        201,
      ),
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

async function renderThumbnail(options: { demo?: boolean } = {}) {
  const view = renderRoute(`/candidates/${CANDIDATE_ID}/thumbnail`, options);
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

  it('P3-02: 저장된 레퍼런스를 미리 체크해 보이고, 확인하면 다시 만들기 → 번호 1..N 생성 요청', async () => {
    const api = setup(
      'WAITING_INPUT',
      thumbnailOutput({
        generationRuns: [generationSummary({ slotNo: 1 }), generationSummary({ slotNo: 2 })],
      }),
    );
    await renderThumbnail();
    const user = userEvent.setup();
    // 서버에 저장된 레퍼런스(원본 2번)가 미리 체크되어 있다('사람·얼굴 없음'은 미리 켜지 않는다)
    const saved = await screen.findByRole('checkbox', { name: '원본 2 레퍼런스' });
    await waitFor(() => expect(saved).toBeChecked());
    const noPerson = screen.getByRole('checkbox', { name: '레퍼런스에 사람·얼굴 없음' });
    expect(noPerson).not.toBeChecked();
    const regenerate = screen.getByRole('button', { name: '다시 만들기' });
    await user.click(noPerson);
    await waitFor(() => expect(regenerate).toBeEnabled());
    await user.click(regenerate);
    await waitFor(() =>
      expect(requestsTo(api, 'POST', `/step-runs/${RUN_ID}/generation-runs`)).toHaveLength(1),
    );
    expect(
      await requestsTo(api, 'POST', `/step-runs/${RUN_ID}/generation-runs`)[0]!.clone().json(),
    ).toEqual({ slotNos: [1, 2], faceOption: 'FULL_FACE', promptAdjustment: null });
  });

  it('P3-02: 대표를 고르고 7개를 체크하면 G3 통과를 부른다(나란히 보기에 선택본)', async () => {
    const api = setup(
      'WAITING_INPUT',
      thumbnailOutput({
        generationRuns: [generationSummary({ slotNo: 1 }), generationSummary({ slotNo: 2 })],
      }),
    );
    await renderThumbnail();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: '후보 2 대표' }));
    await user.click(screen.getByRole('checkbox', { name: '후보 1 추가' }));
    const compare = screen.getByRole('region', { name: '레퍼런스와 나란히 보기' });
    expect(within(compare).getByText('후보 2')).toBeInTheDocument();
    expect(within(compare).getByText('원본 2번 · 참조 전용')).toBeInTheDocument();
    const checklist = screen.getByRole('region', { name: '선택 전 확인' });
    for (const box of within(checklist).getAllByRole('checkbox')) await user.click(box);
    await user.click(within(checklist).getByRole('button', { name: '썸네일 선택(G3)' }));
    await waitFor(() =>
      expect(requestsTo(api, 'POST', `/candidates/${CANDIDATE_ID}/gates/G3/pass`)).toHaveLength(1),
    );
    const body = (await requestsTo(api, 'POST', `/candidates/${CANDIDATE_ID}/gates/G3/pass`)[0]!
      .clone()
      .json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      basisStepRunId: RUN_ID,
      representativeImageAssetId: 902,
      additionalImageAssetIds: [901],
    });
    expect(Object.values(body.checklist as Record<string, boolean>).every(Boolean)).toBe(true);
  });
});

/** '지금 여기' 이름표가 붙은 칸(NowMark 껍데기) 목록 */
async function nowMarks() {
  const marks = await screen.findAllByText('지금 여기');
  return marks.map((mark) => mark.parentElement!);
}

describe('⑤ 맨 위 안내(D-41): 하는 일 · 지금 할 일 · 낯선 말 풀이', () => {
  it('하는 일 한 문장과 지금 할 일이 보이고, 풀이는 접혀 있다가 펼치면 용어가 나온다', async () => {
    setup();
    await renderThumbnail({ demo: true });
    const intro = within(await screen.findByRole('region', { name: '⑤ 썸네일 안내' }));
    expect(
      intro.getByText(
        '라쿠텐 상품 이미지를 견본(레퍼런스)으로 삼아 AI가 썸네일 후보를 만들고, 그중 쓸 이미지를 골라 확인하는 단계입니다.',
      ),
    ).toBeInTheDocument();
    // 레퍼런스를 아직 안 골랐으면 그것부터 말한다
    await waitFor(() =>
      expect(intro.getByRole('status')).toHaveTextContent(
        /^지금 할 일 '원본 이미지' 칸에서 신발만 나온 이미지를 1~3장 골라 '레퍼런스'를 체크하고/,
      ),
    );
    const toggle = intro.getByRole('button', { name: /펼치기/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const term of [
      '실행 · 다시 실행',
      '여기부터 연속 실행',
      '레퍼런스 · 참조 전용',
      '레퍼런스에 사람·얼굴 없음',
      '얼굴 노출 · 생성 거부',
      '프롬프트 · 실존 인물 이름 없음',
      '만들기 · 다시 만들기',
      '대표 · 추가',
      '선택 전 확인 · 썸네일 선택(G3)',
    ]) {
      expect(intro.getByText(term)).toBeVisible();
    }
  });

  it('⑤ 미실행이면 [실행]을 누르라고 하고 표시는 [실행] 버튼에만 붙는다', async () => {
    setup('NOT_RUN');
    await renderThumbnail({ demo: true });
    const intro = within(await screen.findByRole('region', { name: '⑤ 썸네일 안내' }));
    expect(intro.getByRole('status')).toHaveTextContent(/^지금 할 일 \[실행\]을 누르세요\./);
    const marks = await nowMarks();
    expect(marks).toHaveLength(1);
    expect(within(marks[0]!).getByRole('button', { name: '실행' })).toBeInTheDocument();
    expect(within(marks[0]!).queryByRole('region')).toBeNull();
  });

  it('실행 버튼이 꺼져 있으면 버튼 아래 이유를 먼저 보라고 말한다', async () => {
    const api = setup('NOT_RUN');
    const reason = disabled('STEP_START_CONDITION_UNMET', '② 소싱을 먼저 마쳐 주세요.');
    api.on(`GET /candidates/${CANDIDATE_ID}/steps`, () =>
      jsonResponse(
        stepRail({
          THUMBNAIL: {
            status: 'NOT_RUN',
            actions: { run: reason, continuousRun: reason, edit: reason },
          },
        }),
      ),
    );
    await renderThumbnail({ demo: true });
    const intro = within(await screen.findByRole('region', { name: '⑤ 썸네일 안내' }));
    await waitFor(() =>
      expect(intro.getByRole('status')).toHaveTextContent(
        /^지금 할 일 지금은 실행할 수 없습니다\./,
      ),
    );
    expect((await screen.findAllByText('② 소싱을 먼저 마쳐 주세요.')).length).toBeGreaterThan(0);
    const marks = await nowMarks();
    expect(marks).toHaveLength(1);
    expect(within(marks[0]!).getByRole('button', { name: '실행' })).toBeDisabled();
  });

  it("'지금 여기'가 레퍼런스 고르기 → 만들기 순서로 옮겨 간다", async () => {
    setup();
    await renderThumbnail({ demo: true });
    const user = userEvent.setup();
    const intro = within(await screen.findByRole('region', { name: '⑤ 썸네일 안내' }));
    // 레퍼런스를 고르기 전: 표시는 '원본 이미지' 칸 하나
    const first = await nowMarks();
    expect(first).toHaveLength(1);
    expect(within(first[0]!).getByRole('region', { name: '원본 이미지' })).toBeInTheDocument();
    // 레퍼런스 + '사람·얼굴 없음'을 저장하면 [만들기] 차례: 표시는 '생성 옵션' 칸
    await user.click(await screen.findByRole('checkbox', { name: '원본 2 레퍼런스' }));
    await user.click(screen.getByRole('checkbox', { name: '레퍼런스에 사람·얼굴 없음' }));
    await waitFor(() =>
      expect(intro.getByRole('status')).toHaveTextContent(/^지금 할 일 \[만들기\]를 누르세요\./),
    );
    const second = await nowMarks();
    expect(second).toHaveLength(1);
    expect(within(second[0]!).getByRole('region', { name: '생성 옵션' })).toBeInTheDocument();
    expect(within(second[0]!).getByRole('button', { name: '만들기' })).toBeEnabled();
  });

  it("후보가 생기면 표시가 '썸네일 후보' → '선택 전 확인'으로 옮겨 간다", async () => {
    setup(
      'WAITING_INPUT',
      thumbnailOutput({
        generationRuns: [generationSummary({ slotNo: 1 }), generationSummary({ slotNo: 2 })],
      }),
    );
    await renderThumbnail({ demo: true });
    const user = userEvent.setup();
    const intro = within(await screen.findByRole('region', { name: '⑤ 썸네일 안내' }));
    await waitFor(() =>
      expect(intro.getByRole('status')).toHaveTextContent(/^지금 할 일 후보 중 대표로 쓸 이미지를/),
    );
    const first = await nowMarks();
    expect(first).toHaveLength(1);
    expect(within(first[0]!).getByRole('region', { name: '썸네일 후보' })).toBeInTheDocument();
    expect(within(first[0]!).queryByRole('region', { name: '선택 전 확인' })).toBeNull();

    await user.click(await screen.findByRole('radio', { name: '후보 2 대표' }));
    await waitFor(() =>
      expect(intro.getByRole('status')).toHaveTextContent(
        /^지금 할 일 '레퍼런스와 나란히 보기'로 대표 후보를/,
      ),
    );
    const second = await nowMarks();
    expect(second).toHaveLength(1);
    expect(within(second[0]!).getByRole('region', { name: '선택 전 확인' })).toBeInTheDocument();
  });

  it('생성이 모두 거부됐으면 다시 만들라고 말하고 표시는 후보 칸에 붙는다', async () => {
    setup(
      'WAITING_INPUT',
      thumbnailOutput({
        generationRuns: [
          generationSummary({ slotNo: 1, status: 'REFUSED', refusalReason: '인물 생성 제한' }),
          generationSummary({ slotNo: 2, status: 'REFUSED', refusalReason: '인물 생성 제한' }),
        ],
      }),
    );
    await renderThumbnail({ demo: true });
    const user = userEvent.setup();
    const intro = within(await screen.findByRole('region', { name: '⑤ 썸네일 안내' }));
    // 이 화면에서 레퍼런스를 다시 확인하기 전에는 그것부터
    await user.click(await screen.findByRole('checkbox', { name: '레퍼런스에 사람·얼굴 없음' }));
    await waitFor(() =>
      expect(intro.getByRole('status')).toHaveTextContent(
        /^지금 할 일 쓸 수 있는 후보가 없습니다\./,
      ),
    );
    const marks = await nowMarks();
    expect(marks).toHaveLength(1);
    expect(within(marks[0]!).getByRole('region', { name: '썸네일 후보' })).toBeInTheDocument();
  });

  it("G3 통과 뒤에는 끝났다고 알리고 아래 [다음: ⑥ 상세 콘텐츠]에 '지금 여기'를 붙인다", async () => {
    setup(
      'COMPLETED',
      thumbnailOutput({
        stepRunStatus: 'COMPLETED',
        generationRuns: [generationSummary({ slotNo: 1 }), generationSummary({ slotNo: 2 })],
        selection: {
          thumbnailSelectionId: 9,
          selectedAt: '2026-09-28T05:24:00.000Z',
          checklist: {
            version: '1',
            shoeRatioOver70: true,
            detailMatch: true,
            colorMatchesSelectedColor: true,
            referenceNoPerson: true,
            noRealPersonResemblance: true,
            noTextOrPrice: true,
            singleProductSingleModel: true,
          },
          images: [
            { imageAssetId: 901, role: 'REPRESENTATIVE', sortOrder: 1, fileUrl: '' },
            { imageAssetId: 902, role: 'ADDITIONAL', sortOrder: 2, fileUrl: '' },
          ],
        },
        g3: {
          gatePassId: 5,
          passedAt: '2026-09-28T05:24:00.000Z',
          basisStepRunId: RUN_ID,
          valid: true,
          changedBasisKeys: [],
        },
      }),
    );
    await renderThumbnail({ demo: true });
    const intro = within(await screen.findByRole('region', { name: '⑤ 썸네일 안내' }));
    await waitFor(() =>
      expect(intro.getByRole('status')).toHaveTextContent(
        '⑤ 썸네일을 마쳤습니다. [다음: ⑥ 상세 콘텐츠]를 눌러 상품 카피와 상세 설명을 만들러 가세요.',
      ),
    );
    // 맨 위에는 이동 링크를 두지 않고, '선택 전 확인' 패널의 [다음: ⑥ 상세 콘텐츠]에 표시가 붙는다(D-42)
    expect(intro.queryByRole('link')).toBeNull();
    const marks = screen.getAllByText('지금 여기');
    expect(marks).toHaveLength(1);
    expect(
      within(marks[0]!.parentElement!).getByRole('link', { name: /다음: ⑥ 상세 콘텐츠/ }),
    ).toHaveAttribute('href', `/candidates/${CANDIDATE_ID}/content`);
  });
});

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { referencesResult, sourceImageList } from '@/test/fixtures/thumbnails';
import { createTestQueryClient } from '@/test/renderRoute';
import { SourceImagesPanel } from './SourceImagesPanel';

const RUN_ID = 104;

function renderPanel(stepRunId: number | null = RUN_ID, onConfirmedChange = vi.fn()) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <SourceImagesPanel
        candidateId={1}
        stepRunId={stepRunId}
        onConfirmedChange={onConfirmedChange}
      />
    </QueryClientProvider>,
  );
  return onConfirmedChange;
}

const puts = (api: ReturnType<typeof stubApi>) =>
  api.requests.filter(
    (r) =>
      r.method === 'PUT' &&
      new URL(r.url).pathname === `/api/v1/step-runs/${RUN_ID}/thumbnail-references`,
  );

const referenceBox = (n: number) => screen.getByRole('checkbox', { name: `원본 ${n} 레퍼런스` });
const noPersonBox = () => screen.getByRole('checkbox', { name: '레퍼런스에 사람·얼굴 없음' });

describe('SourceImagesPanel(SCR-05 원본 이미지, P3-01)', () => {
  it("이미지마다 '참조 전용' 칩·번호·해상도가 보이고, 출처 줄과 안내 문구가 보인다", async () => {
    stubApi({ 'GET /candidates/1/source-images': () => jsonResponse(sourceImageList(6)) });
    renderPanel();
    const list = await screen.findByRole('list', { name: '라쿠텐 원본 이미지' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(6);
    for (const card of cards) expect(within(card).getByText('참조 전용')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('1 · 1200×1200')).toBeInTheDocument();
    expect(within(cards[0]!).getByRole('img', { name: '원본 1' })).toHaveAttribute(
      'src',
      '/api/v1/image-assets/1/file',
    );
    expect(screen.getByText('라쿠텐 shop-a 상품 페이지 · 14:02 받음 · 6장')).toBeInTheDocument();
    expect(screen.getByText('체크해야 생성할 수 있습니다')).toBeInTheDocument();
    expect(
      screen.getByText(
        '신발만 나온 컷 1~3장을 고릅니다 · 참조 전용 원본은 업로드하지 않습니다 · 레퍼런스를 바꾸면 ⑤를 다시 실행해야 합니다',
      ),
    ).toBeInTheDocument();
  });

  it('4번째 레퍼런스는 고를 수 없다(3장이면 나머지 체크가 꺼지고 이유 글)', async () => {
    stubApi({ 'GET /candidates/1/source-images': () => jsonResponse(sourceImageList(6)) });
    renderPanel();
    await screen.findByRole('list', { name: '라쿠텐 원본 이미지' });
    const user = userEvent.setup();
    await user.click(referenceBox(1));
    await user.click(referenceBox(3));
    await user.click(referenceBox(5));
    expect(referenceBox(1)).toBeChecked();
    expect(referenceBox(4)).toBeDisabled();
    expect(referenceBox(6)).toBeDisabled();
    expect(referenceBox(3)).toBeEnabled();
    expect(screen.getByText('레퍼런스는 3장까지 고를 수 있습니다.')).toBeInTheDocument();
    // 하나를 빼면 다시 고를 수 있다
    await user.click(referenceBox(3));
    expect(referenceBox(4)).toBeEnabled();
  });

  it("'사람·얼굴 없음'은 미리 켜 두지 않고, 오너가 체크할 때만 PUT(noPersonConfirmed=true)을 보낸다. 고른 것을 바꾸면 체크가 풀린다", async () => {
    const api = stubApi({
      'GET /candidates/1/source-images': () => jsonResponse(sourceImageList(6)),
      [`PUT /step-runs/${RUN_ID}/thumbnail-references`]: () =>
        jsonResponse(referencesResult(RUN_ID, [2, 1])),
    });
    const onConfirmed = renderPanel();
    await screen.findByRole('list', { name: '라쿠텐 원본 이미지' });
    expect(noPersonBox()).not.toBeChecked();
    expect(noPersonBox()).toBeDisabled(); // 고르기 전
    const user = userEvent.setup();
    await user.click(referenceBox(2));
    await user.click(referenceBox(1));
    expect(puts(api)).toHaveLength(0);
    await user.click(noPersonBox());
    await waitFor(() => expect(puts(api)).toHaveLength(1));
    expect(await puts(api)[0]!.clone().json()).toEqual({
      references: [
        { imageAssetId: 2, sortOrder: 1 },
        { imageAssetId: 1, sortOrder: 2 },
      ],
      noPersonConfirmed: true,
    });
    await waitFor(() =>
      expect(onConfirmed).toHaveBeenLastCalledWith(true, referencesResult(RUN_ID, [2, 1])),
    );
    expect(noPersonBox()).toBeChecked();
    await user.click(referenceBox(3));
    expect(noPersonBox()).not.toBeChecked();
    expect(onConfirmed).toHaveBeenLastCalledWith(false, null);
    expect(puts(api)).toHaveLength(1);
  });

  it('저장 오류는 05-3 문구를 막힘 띠로 보이고 체크를 푼다', async () => {
    stubApi({
      'GET /candidates/1/source-images': () => jsonResponse(sourceImageList(2)),
      [`PUT /step-runs/${RUN_ID}/thumbnail-references`]: () =>
        errorResponse(
          409,
          'STEP_RUN_NOT_WAITING_INPUT',
          '이 실행은 입력을 기다리고 있지 않습니다. 바꾸려면 다시 실행하거나 수정해 주세요.',
        ),
    });
    renderPanel();
    await screen.findByRole('list', { name: '라쿠텐 원본 이미지' });
    const user = userEvent.setup();
    await user.click(referenceBox(1));
    await user.click(noPersonBox());
    expect(
      await screen.findByText(
        '이 실행은 입력을 기다리고 있지 않습니다. 바꾸려면 다시 실행하거나 수정해 주세요.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(noPersonBox()).not.toBeChecked());
  });

  it('⑤가 입력 대기가 아니면 고를 수 없고 이유 글, ② 선택 전이면 409 문구', async () => {
    stubApi({ 'GET /candidates/1/source-images': () => jsonResponse(sourceImageList(2)) });
    renderPanel(null);
    await screen.findByRole('list', { name: '라쿠텐 원본 이미지' });
    expect(referenceBox(1)).toBeDisabled();
    expect(noPersonBox()).toBeDisabled();
    expect(
      screen.getByText(
        '⑤가 입력 대기일 때 레퍼런스를 고를 수 있습니다. 레퍼런스를 바꾸려면 ⑤를 다시 실행해 주세요.',
      ),
    ).toBeInTheDocument();
  });

  it('② 선택 전(409 SOURCING_SELECTION_REQUIRED)이면 그 문구, 원본이 없으면 빈 상태 문구', async () => {
    stubApi({
      'GET /candidates/1/source-images': () =>
        errorResponse(409, 'SOURCING_SELECTION_REQUIRED', '② 소싱에서 상품을 먼저 골라 주세요.'),
    });
    renderPanel(null);
    expect(await screen.findByText('② 소싱에서 상품을 먼저 골라 주세요.')).toBeInTheDocument();
  });

  it('원본이 아직 없으면 빈 상태 문구', async () => {
    stubApi({
      'GET /candidates/1/source-images': () =>
        jsonResponse({ itemCode: 'shop-a:10000123', items: [] }),
    });
    renderPanel(null);
    expect(
      await screen.findByText('⑤를 실행하면 라쿠텐 원본 이미지를 받아 여기에 보입니다.'),
    ).toBeInTheDocument();
  });
});

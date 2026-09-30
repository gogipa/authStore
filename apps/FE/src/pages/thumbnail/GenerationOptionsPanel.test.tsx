import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { promptPreview } from '@/test/fixtures/thumbnails';
import { createTestQueryClient } from '@/test/renderRoute';
import { GenerationOptionsPanel, type GenerationOptionsPanelProps } from './GenerationOptionsPanel';

const RUN_ID = 104;

function renderPanel(props: Partial<GenerationOptionsPanelProps> = {}) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <GenerationOptionsPanel
        stepRunId={RUN_ID}
        waiting
        referencesConfirmed={false}
        referencesVersion={0}
        {...props}
      />
    </QueryClientProvider>,
  );
}

const previews = (api: ReturnType<typeof stubApi>) =>
  api.requests.filter(
    (r) => r.method === 'POST' && new URL(r.url).pathname === '/api/v1/thumbnail-prompt-previews',
  );

const generateButton = () => screen.getByRole('button', { name: '만들기' });

describe('GenerationOptionsPanel(SCR-05 생성 옵션, P3-01)', () => {
  it("기본 선택이 '전체'이고 미리보기를 FULL_FACE로 부른다. 차단어가 없으면 '실존 인물 이름 없음'", async () => {
    const api = stubApi({ 'POST /thumbnail-prompt-previews': () => jsonResponse(promptPreview()) });
    renderPanel();
    const group = screen.getByRole('radiogroup', { name: '얼굴 노출 · 기본 전체' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '전체' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '턱 아래 크롭' })).not.toBeChecked();
    expect(await screen.findByText('실존 인물 이름 없음')).toBeInTheDocument();
    expect(await previews(api)[0]!.clone().json()).toEqual({
      stepRunId: RUN_ID,
      faceOption: 'FULL_FACE',
      promptAdjustment: null,
    });
    expect(screen.getByText('기본 골격 사용')).toBeInTheDocument();
    // M2 '생성 순서와 비용'은 그리지 않는다
    expect(screen.queryByText('생성 순서와 비용')).not.toBeInTheDocument();
  });

  it('얼굴 노출을 바꾸면 미리보기를 그 값으로 다시 부른다', async () => {
    const api = stubApi({
      'POST /thumbnail-prompt-previews': async (req) =>
        jsonResponse(
          promptPreview({
            faceOption: ((await req.clone().json()) as { faceOption: 'CHIN_CROP' }).faceOption,
          }),
        ),
    });
    renderPanel();
    await screen.findByText('실존 인물 이름 없음');
    await userEvent.setup().click(screen.getByText('턱 아래 크롭'));
    await waitFor(() => expect(previews(api)).toHaveLength(2));
    expect(await previews(api)[1]!.clone().json()).toMatchObject({ faceOption: 'CHIN_CROP' });
    expect(screen.getByRole('radio', { name: '턱 아래 크롭' })).toBeChecked();
  });

  it('조정 문구에 차단어가 있으면 걸린 단어와 이유를 보이고 생성 버튼이 꺼진다', async () => {
    stubApi({
      'POST /thumbnail-prompt-previews': async (req) => {
        const body = (await req.clone().json()) as { promptAdjustment: string | null };
        return jsonResponse(
          body.promptAdjustment?.includes('BTS')
            ? promptPreview({
                promptAdjusted: true,
                realPersonNameDetected: true,
                blockedTerms: ['BTS'],
                generationAllowed: false,
              })
            : promptPreview({ generationAllowed: true }),
        );
      },
    });
    renderPanel({ referencesConfirmed: true });
    await waitFor(() => expect(generateButton()).toBeEnabled());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /펼치기/ }));
    await user.type(screen.getByRole('textbox', { name: /프롬프트 조정/ }), 'like BTS');
    expect(await screen.findByText('실존 인물 이름: BTS')).toBeInTheDocument();
    expect(
      screen.getByText('프롬프트에 실존 인물 이름(BTS)이 있어 만들 수 없습니다.'),
    ).toBeInTheDocument();
    expect(generateButton()).toBeDisabled();
    expect(screen.getByText('조정 문구 사용')).toBeInTheDocument();
  });

  it('레퍼런스 확인 전에는 생성 버튼이 꺼지고 이유 글이 보인다. 확인 + generationAllowed면 켜진다', async () => {
    stubApi({
      'POST /thumbnail-prompt-previews': () =>
        jsonResponse(promptPreview({ generationAllowed: true })),
    });
    renderPanel({ referencesConfirmed: false });
    await screen.findByText('실존 인물 이름 없음');
    expect(generateButton()).toBeDisabled();
    expect(
      screen.getByText("레퍼런스 1~3장을 고르고 '레퍼런스에 사람·얼굴 없음'을 체크해 주세요."),
    ).toBeInTheDocument();
  });

  it('⑤ 실행이 없으면 미리보기를 부르지 않고 이유 글', () => {
    const api = stubApi();
    renderPanel({ stepRunId: null, waiting: false });
    expect(generateButton()).toBeDisabled();
    expect(
      screen.getByText('⑤를 실행해 원본 이미지를 받은 뒤 만들 수 있습니다.'),
    ).toBeInTheDocument();
    expect(previews(api)).toHaveLength(0);
  });
});

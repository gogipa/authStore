import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import { candidateDetail, gateList, stepRail } from '@/test/fixtures/stepEngine';
import { competitorInput, tagSetOutput } from '@/test/fixtures/tags';
import { createTestQueryClient, renderRoute } from '@/test/renderRoute';
import { CompetitorInputPanel } from './CompetitorInputPanel';

const BLOCK_418 =
  '브라우저 확장이나 F12로 응답을 복사하면 네이버쇼핑 접속이 차단(418)될 수 있습니다.';

function renderPanel(running = false) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <CompetitorInputPanel
        candidateId={1}
        inputs={[competitorInput({ id: 31 })]}
        running={running}
      />
    </QueryClientProvider>,
  );
}

describe('CompetitorInputPanel(SCR-07 경쟁 태그 입력, P3-05)', () => {
  it("'원본은 저장하지 않습니다', 고급 영역을 펼치면 418 안내가 보인다", async () => {
    stubApi();
    renderPanel();
    expect(screen.getByRole('heading', { level: 2, name: '경쟁 태그 입력' })).toBeInTheDocument();
    expect(screen.getByText('원본은 저장하지 않습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /엑셀 파일 올리기/ })).toBeInTheDocument();
    expect(screen.getByText("셀라파인더 '키워드정보'의 manu태그")).toBeInTheDocument();
    // 접혀 있을 때는 보이지 않는다(Disclosure는 hidden 영역)
    expect(screen.getByText(BLOCK_418)).not.toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /펼치기/ }));
    expect(screen.getByText(BLOCK_418)).toBeVisible();
    expect(screen.getByLabelText('검색 응답(JSON·HAR)')).toBeVisible();
    expect(screen.getByText('14:38 · 13개 읽음 · 빈도순')).toBeInTheDocument();
  });

  it('자유 텍스트 더하기 → POST(JSON). 오류는 위치(행·열)만 붙여 보인다', async () => {
    const stub = stubApi({
      'POST /candidates/1/tag-competitor-inputs': () =>
        errorResponse(
          422,
          'IMPORT_PARSE_FAILED',
          '파일(또는 붙여 넣은 글)에서 필요한 열이나 형식을 찾지 못했습니다.',
          {
            fieldErrors: [{ field: 'text[2]', message: '태그는 100자까지입니다.' }],
          },
        ),
    });
    renderPanel();
    await userEvent.type(screen.getByLabelText('자유 텍스트'), '데일리운동화, 레트로운동화');
    await userEvent.click(screen.getByRole('button', { name: '더하기' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('(text[2])');
    const sent = stub.requests.find((r) => r.method === 'POST')!;
    expect(await sent.clone().json()).toEqual({
      sourceType: 'FREE_TEXT',
      text: '데일리운동화, 레트로운동화',
    });
  });

  it('⑦이 실행 중이면 입력을 바꿀 수 없다', () => {
    stubApi();
    renderPanel(true);
    expect(screen.getByText('⑦이 실행 중입니다. 끝난 뒤 바꿀 수 있습니다.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '셀라파인더 입력 빼기' })).toBeDisabled();
  });

  it('입력을 빼면(DELETE 204) 목록에서 사라진다', async () => {
    let items = [
      competitorInput({ id: 31 }),
      competitorInput({ id: 32, sourceType: 'FREE_TEXT', hasFrequency: false, itemCount: 4 }),
    ];
    stubApi({
      'GET /call-usage': () => jsonResponse(callUsageList(38)),
      'GET /candidates/1': () => jsonResponse(candidateDetail({ id: 1, resumeStepCode: 'TAGS' })),
      'GET /candidates/1/steps': () =>
        jsonResponse(
          stepRail({
            SOURCING: { status: 'COMPLETED' },
            TAGS: { status: 'COMPLETED', currentStepRunId: 120 },
          }),
        ),
      'GET /candidates/1/gates': () => jsonResponse(gateList({ G2: true })),
      'GET /candidates/1/tag-set': () => jsonResponse(tagSetOutput()),
      'GET /candidates/1/tag-competitor-inputs': () => jsonResponse({ items }),
      'DELETE /tag-competitor-inputs/32': () => {
        items = items.filter((i) => i.id !== 32);
        return new Response(null, { status: 204 });
      },
    });
    renderRoute('/candidates/1/tags');
    const list = await screen.findByRole('list', { name: '읽은 입력' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.click(within(list).getByRole('button', { name: '자유 텍스트 입력 빼기' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: '읽은 입력' })).getAllByRole('listitem'),
      ).toHaveLength(1),
    );
    expect(screen.queryByRole('button', { name: '자유 텍스트 입력 빼기' })).not.toBeInTheDocument();
  });
});

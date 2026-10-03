import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { storageUsage, storageUsageItem } from '@/test/fixtures/storageUsage';
import { createTestQueryClient } from '@/test/renderRoute';
import { StorageUsagePanel } from './StorageUsagePanel';

function renderPanel() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <StorageUsagePanel />
    </QueryClientProvider>,
  );
}

const panel = () => screen.getByRole('region', { name: '저장 공간' });
const rowTexts = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    );

describe("SCR-13 '저장 공간'(D-25, F-ST-33)", () => {
  it('행 3개(agy 기록·앱 이미지·디스크 남은 공간)와 측정 시각·도움말', async () => {
    stubApi({ 'GET /storage-usage': () => jsonResponse(storageUsage()) });
    renderPanel();
    const table = await screen.findByRole('table', { name: '저장 공간' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['항목', '위치', '크기', '파일 수', '안내']);
    expect(rowTexts(table)).toEqual([
      [
        'agy 기록',
        '~/.gemini/antigravity-cli',
        '1.2GB',
        '3,412개',
        '앱은 지우지 않습니다. 필요하면 직접 정리하세요.',
      ],
      [
        '앱 이미지',
        '~/Library/Application Support/autoStore/images',
        '85.3MB',
        '412개',
        '라쿠텐 원본·생성 후보 등 앱이 쓰는 파일입니다. 직접 지우지 마세요.',
      ],
      ['디스크 남은 공간', '앱 데이터 폴더가 있는 디스크', '120.5GB 남음', '—', '전체 494.4GB'],
    ]);
    expect(within(panel()).getByText('14:20')).toBeInTheDocument();
    expect(
      within(panel()).getByText(/앱은 크기만 재고 파일을 지우거나 고치지 않습니다/),
    ).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: '다시 재기' })).toBeEnabled();
  });

  it("일부만 잼·폴더 없음·디스크 못 읽음 상태: 칩과 문장, ' 이상'·'—'", async () => {
    stubApi({
      'GET /storage-usage': () =>
        jsonResponse(
          storageUsage({
            items: [
              storageUsageItem({ status: 'PARTIAL' }),
              storageUsageItem({
                key: 'APP_IMAGES',
                displayPath: '<데이터 폴더>/images',
                status: 'NOT_FOUND',
                bytes: null,
                fileCount: null,
              }),
            ],
            disk: { freeBytes: null, totalBytes: null },
          }),
        ),
    });
    renderPanel();
    const table = await screen.findByRole('table', { name: '저장 공간' });
    const [agy, images, disk] = rowTexts(table);
    expect(agy!.slice(2, 4)).toEqual(['1.2GB 이상', '3,412개 이상']);
    expect(agy![4]).toContain('일부만 잼');
    expect(agy![4]).toContain('5초 안에 다 세지 못했거나');
    expect(images!.slice(1, 4)).toEqual(['<데이터 폴더>/images', '—', '—']);
    expect(images![4]).toContain('폴더 없음');
    expect(images![4]).toContain('아직 저장한 이미지가 없습니다.');
    expect(disk!.slice(2)).toEqual(['—', '—', '읽지 못함디스크 정보를 읽지 못했습니다.']);
  });

  it('처음 재는 동안: 안내 글, 캡션 재는 중…, 버튼이 꺼진다', async () => {
    stubApi({ 'GET /storage-usage': () => new Promise<Response>(() => {}) });
    renderPanel();
    expect(await screen.findByText('재는 중입니다. 최대 5초 걸립니다.')).toBeInTheDocument();
    const button = within(panel()).getByRole('button', { name: '재는 중…' });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('[다시 재기] → refresh=true로 새로 재고 표가 바뀐다(처음 요청에는 refresh가 없다)', async () => {
    let calls = 0;
    const api = stubApi({
      'GET /storage-usage': () => {
        calls += 1;
        return jsonResponse(
          calls === 1
            ? storageUsage()
            : storageUsage({
                items: [storageUsageItem({ bytes: 2_500_000_000, fileCount: 5000 })],
                measuredAt: '2026-10-03T05:31:00.000Z',
              }),
        );
      },
    });
    renderPanel();
    await screen.findByRole('table', { name: '저장 공간' });
    await userEvent.click(within(panel()).getByRole('button', { name: '다시 재기' }));
    expect(await within(panel()).findByText('2.5GB')).toBeInTheDocument();
    expect(within(panel()).getByText('14:31')).toBeInTheDocument();
    const queries = api.requests.map((r) => new URL(r.url).searchParams.get('refresh'));
    expect(queries).toEqual([null, 'true']);
  });

  it('실패하면 warning 띠에 봉투 message', async () => {
    stubApi({
      'GET /storage-usage': () =>
        errorResponse(500, 'INTERNAL_ERROR', '서버 안에서 오류가 났습니다.'),
    });
    renderPanel();
    expect(await within(panel()).findByText('서버 안에서 오류가 났습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

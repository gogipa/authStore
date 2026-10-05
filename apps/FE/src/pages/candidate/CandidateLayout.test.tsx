import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { errorResponse, jsonResponse, stubApi } from '@/test/apiStub';
import { callUsageList } from '@/test/fixtures/callUsage';
import { candidateDetail, stepRail } from '@/test/fixtures/stepEngine';
import { renderRoute } from '@/test/renderRoute';

describe('여정 틀(/candidates/:candidateId, P1-04)', () => {
  it('/candidates/12 → 이어 할 단계 화면으로 replace 이동(resumeStepCode = PRICING → judgement)', async () => {
    stubApi({
      'GET /call-usage': () => jsonResponse(callUsageList()),
      'GET /candidates/12': () =>
        jsonResponse(candidateDetail({ id: 12, resumeStepCode: 'PRICING' })),
    });
    const { router } = renderRoute('/candidates/12');
    expect(
      await screen.findByRole('heading', { level: 1, name: '판정 · 소싱 확정 · 카테고리' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/candidates/12/judgement');
    expect(router.state.historyAction).toBe('REPLACE');
    const header = within(screen.getByRole('region', { name: '여정 정보' }));
    expect(header.getByText('뉴발란스 530 · 화이트/실버')).toBeInTheDocument();
    expect(header.getByRole('link', { name: '여정 목록' })).toHaveAttribute('href', '/candidates');
  });

  it('이어 할 단계가 없으면(모두 완료) 최종 승인 화면', async () => {
    stubApi({
      'GET /call-usage': () => jsonResponse(callUsageList()),
      'GET /candidates/12': () => jsonResponse(candidateDetail({ id: 12, resumeStepCode: null })),
    });
    const { router } = renderRoute('/candidates/12');
    expect(await screen.findByRole('heading', { level: 1, name: '최종 승인' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/candidates/12/approval');
  });

  it("404면 '여정을 찾을 수 없습니다' + '여정 목록'", async () => {
    stubApi({
      'GET /call-usage': () => jsonResponse(callUsageList()),
      'GET /candidates/999': () =>
        errorResponse(404, 'CANDIDATE_NOT_FOUND', '여정을 찾을 수 없습니다.'),
    });
    renderRoute('/candidates/999/sourcing');
    expect(
      await screen.findByRole('heading', { level: 1, name: '여정을 찾을 수 없습니다' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '여정 목록' })).toHaveAttribute('href', '/candidates');
    expect(screen.queryByRole('navigation', { name: '단계' })).toBeNull();
  });

  it('정수가 아닌 id는 부르지 않고 없는 여정으로 본다', async () => {
    const api = stubApi({ 'GET /call-usage': () => jsonResponse(callUsageList()) });
    renderRoute('/candidates/abc');
    expect(
      await screen.findByRole('heading', { level: 1, name: '여정을 찾을 수 없습니다' }),
    ).toBeInTheDocument();
    expect(api.requests.some((r) => r.url.includes('/candidates/abc'))).toBe(false);
  });

  it('제외된 여정은 단계 화면 맨 위에 제외된 까닭과 다시 하는 곳을 말한다(재고 부족 등)', async () => {
    stubApi({
      'GET /call-usage': () => jsonResponse(callUsageList()),
      'GET /candidates/12': () =>
        jsonResponse(
          candidateDetail({
            id: 12,
            resumeStepCode: 'SOURCING',
            status: 'EXCLUDED',
            excludedReason: 'INSUFFICIENT_STOCK',
          }),
        ),
    });
    renderRoute('/candidates/12/sourcing');
    const banner = within(await screen.findByRole('status'));
    expect(
      await banner.findByText(
        /재고가 모자라 제외된 여정입니다\. 기준 상품의 목표 사이즈 중 재고 있는 사이즈가 기준 개수에 못 미쳤습니다\./,
      ),
    ).toBeInTheDocument();
    expect(banner.getByText(/여정 목록에서 \[다시 작업\]을 누르세요\./)).toBeInTheDocument();
    expect(banner.getByRole('link', { name: '여정 목록에서 다시 작업' })).toHaveAttribute(
      'href',
      '/candidates?status=EXCLUDED&candidateId=12',
    );
  });

  it('제외되지 않은 여정에는 제외 안내가 없다', async () => {
    stubApi({
      'GET /call-usage': () => jsonResponse(callUsageList()),
      'GET /candidates/12': () =>
        jsonResponse(candidateDetail({ id: 12, resumeStepCode: 'PRICING' })),
    });
    renderRoute('/candidates/12/judgement');
    await screen.findByRole('region', { name: '여정 정보' });
    expect(screen.queryByRole('link', { name: '여정 목록에서 다시 작업' })).not.toBeInTheDocument();
  });

  it('레일: 단계 상태·실패(중단됨)·재실행 사유·⑥ 묶음·URL 여정 배지(listCandidateSteps, P1-05)', async () => {
    stubApi({
      'GET /call-usage': () => jsonResponse(callUsageList()),
      'GET /candidates/12': () =>
        jsonResponse(
          candidateDetail({ id: 12, resumeStepCode: 'PRICING', creationPath: 'RAKUTEN_URL' }),
        ),
      'GET /candidates/12/steps': () =>
        jsonResponse(
          stepRail({
            SOURCING: { status: 'FAILED' },
            THUMBNAIL: { status: 'RERUN_REQUIRED', staleInputs: ['owner.referenceSelection'] },
            COPY: { status: 'COMPLETED' },
          }),
        ),
    });
    renderRoute('/candidates/12/judgement');
    const rail = within(await screen.findByRole('navigation', { name: '단계' }));
    expect(await rail.findByText('바뀐 입력: 레퍼런스 선택')).toBeInTheDocument();
    expect(rail.getByRole('link', { name: /② ?소싱/ })).toHaveTextContent('실패');
    // ⑥ 묶음: 완료 + 미실행 → 미실행
    expect(rail.getByRole('link', { name: /상세 콘텐츠/ })).toHaveTextContent('미실행');
    expect(rail.getByText('수동')).toBeInTheDocument();
    expect(rail.getByText('비교 안 함')).toBeInTheDocument();
    // 재실행 필요 단계(⑤)가 있으면 레일 아래 '재실행 필요 단계 모두 실행'(RERUN_STALE, P1-06)이 켜진다
    expect(rail.getByRole('button', { name: '재실행 필요 단계 모두 실행' })).toBeEnabled();
  });
});

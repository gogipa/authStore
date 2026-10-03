import { EMPTY_STATE, ScreenHelp } from '@/features/guide';
import { ButtonLink, EmptyState, PageHeader, Panel } from '@/shared/ui';

/**
 * SCR-09 등록 상품(Products.dc.html)은 M2다. M1은 화면 머리와 빈 상태 안내(F-GD-03, D-29)만 둔다:
 * 등록 결과는 최종 승인 화면에서 보고, 전시 켜기·판매 관리는 스마트스토어센터에서 한다(PRD §5.1 G5 M1).
 */
export function ProductsPage() {
  return (
    <>
      <PageHeader
        title="등록 상품"
        description="앱으로 등록한 상품의 상태·검수·마진과 동기화 결과입니다. (M2)"
        help={<ScreenHelp screen="products" />}
      />
      <Panel aria-label="준비 중">
        <EmptyState
          title={EMPTY_STATE.products.title}
          actions={
            <ButtonLink to={EMPTY_STATE.products.primary.to} size="sm">
              {EMPTY_STATE.products.primary.label}
            </ButtonLink>
          }
        >
          {EMPTY_STATE.products.text}
        </EmptyState>
      </Panel>
    </>
  );
}

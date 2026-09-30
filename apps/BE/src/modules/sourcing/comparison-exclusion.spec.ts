import { type ExclusionRow, exclusionAfterFetch } from './comparison-exclusion.js';

const row = (patch: Partial<ExclusionRow> = {}): ExclusionRow => ({
  anchorMatch: 'MATCH',
  ownerMatchDecision: null,
  isVerified: false,
  stockPass: null,
  ...patch,
});

describe('제외 판단(F-SO-21, P2-03 규칙 7)', () => {
  it('같은 상품일 수 있는 행이 없으면 ANCHOR_NO_MATCH(행이 없어도)', () => {
    expect(exclusionAfterFetch('NO_MORE_ROWS', [])).toBe('ANCHOR_NO_MATCH');
    expect(exclusionAfterFetch('NO_MORE_ROWS', [row({ anchorMatch: 'NO_MATCH' })])).toBe(
      'ANCHOR_NO_MATCH',
    );
    // 오너가 '다른 상품'으로 판단한 일치 행은 세지 않는다
    expect(exclusionAfterFetch('NO_MORE_ROWS', [row({ ownerMatchDecision: 'NO_MATCH' })])).toBe(
      'ANCHOR_NO_MATCH',
    );
  });

  it("'확인 필요' 행이나 오너 '같은 상품' 행이 있으면 제외하지 않는다(오너가 이어 간다)", () => {
    expect(exclusionAfterFetch('NO_MORE_ROWS', [row({ anchorMatch: 'NEEDS_REVIEW' })])).toBeNull();
    expect(
      exclusionAfterFetch('NO_MORE_ROWS', [
        row({ anchorMatch: 'NO_MATCH', ownerMatchDecision: 'MATCH' }),
      ]),
    ).toBeNull();
  });

  it('재고 통과 0 + 재고 부족 검증 행 → INSUFFICIENT_STOCK, 통과 행이 하나라도 있거나 읽은 행이 없으면 아님', () => {
    const failed = row({ isVerified: true, stockPass: false });
    expect(exclusionAfterFetch('PAGE_CAP', [failed, row()])).toBe('INSUFFICIENT_STOCK');
    expect(
      exclusionAfterFetch('NO_MORE_ROWS', [failed, row({ isVerified: true, stockPass: true })]),
    ).toBeNull();
    // 성별을 몰라 재고를 판정하지 못한 검증 행(stockPass null)만 있으면 판단하지 않는다
    expect(exclusionAfterFetch('NO_MORE_ROWS', [row({ isVerified: true })])).toBeNull();
  });

  it('끝까지 보지 못한 멈춤(DAILY_LIMIT·BLOCKED)과 ENOUGH_CANDIDATES는 판단하지 않는다', () => {
    for (const reason of ['DAILY_LIMIT', 'BLOCKED', 'ENOUGH_CANDIDATES'] as const) {
      expect(exclusionAfterFetch(reason, [])).toBeNull();
    }
  });
});

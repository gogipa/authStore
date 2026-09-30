import {
  classifyRow,
  colorCodeAfterModel,
  effectiveMatch,
  extractModelCode,
  isSameSeries,
  isUncertain,
  itemNameMarks,
  normalizeModelCode,
  recheckWithPage,
} from './anchor-match.js';

const ANCHOR = { modelCodeNorm: '1201A019', colorCode: '108', itemCode: 'shop-a:10000123' };
const row = (itemName: string, extra: { itemCode?: string; modelCode?: string } = {}) => ({
  itemCode: extra.itemCode ?? 'shop-x:1',
  itemName,
  modelCode: extra.modelCode ?? null,
});

describe('anchor-match 型番 정규화·분류(RK-03, F-SO-09)', () => {
  it("'１２０１Ａ０１９－１０８'·'1201a019 108' → '1201A019108'", () => {
    expect(normalizeModelCode('１２０１Ａ０１９－１０８')).toBe('1201A019108');
    expect(normalizeModelCode('1201a019 108')).toBe('1201A019108');
    expect(normalizeModelCode('  ')).toBeNull();
  });

  it('상품명에서 型番·색상 코드를 뽑는다(Proposed)', () => {
    expect(extractModelCode('アシックス ゲルカヤノ 14 1201A019-108 クリーム×ブラック')).toEqual({
      modelCodeNorm: '1201A019',
      colorCode: '108',
    });
    expect(extractModelCode('ASICS GEL-KAYANO 14 1201A019-108 CREAM/BLACK')?.modelCodeNorm).toBe(
      '1201A019',
    );
    expect(extractModelCode('ナイキ コルテッツ DN1791-100')).toEqual({
      modelCodeNorm: 'DN1791',
      colorCode: '100',
    });
    expect(extractModelCode('アシックス 26.5cm 限定')).toBeNull();
    expect(colorCodeAfterModel('1201A019 26.5cm', '1201A019')).toBeNull();
    expect(colorCodeAfterModel('１２０１Ａ０１９－１０８', '1201A019')).toBe('108');
    expect(colorCodeAfterModel('ゲルカヤノ', '1201A019')).toBeUndefined();
  });

  it('같은 모델+색상 → MATCH, 색상 코드 없음 → NEEDS_REVIEW, 다른 모델 → NO_MATCH', () => {
    expect(classifyRow(ANCHOR, row('アシックス ゲルカヤノ 14 1201A019-108 メンズ'))).toEqual({
      anchorMatch: 'MATCH',
      modelCodeNorm: '1201A019',
      colorCode: '108',
    });
    expect(
      classifyRow(ANCHOR, row('ASICS GEL-KAYANO 14 １２０１Ａ０１９－１０８')).anchorMatch,
    ).toBe('MATCH');
    expect(classifyRow(ANCHOR, row('アシックス ゲルカヤノ 14 1201A019 クリーム×ブラック'))).toEqual(
      {
        anchorMatch: 'NEEDS_REVIEW',
        modelCodeNorm: '1201A019',
        colorCode: null,
      },
    );
    expect(classifyRow(ANCHOR, row('アシックス ゲルカヤノ 30 1011B548-001')).anchorMatch).toBe(
      'NO_MATCH',
    );
    // 같은 모델·다른 색상은 다른 상품
    expect(
      classifyRow(ANCHOR, row('アシックス ゲルカヤノ 14 1201A019-020 ブラック')).anchorMatch,
    ).toBe('NO_MATCH');
    // 型番이 없는 상품명
    expect(classifyRow(ANCHOR, row('アシックス スニーカー メンズ')).anchorMatch).toBe('NO_MATCH');
  });

  it("'시리즈만 같음'(Proposed: 앞 max(4, 길이 − 2)자) → NEEDS_REVIEW", () => {
    expect(isSameSeries('1201A019', '1201A018')).toBe(true);
    expect(isSameSeries('1201A019', '1201A789')).toBe(false);
    expect(isSameSeries('1201A019', '1201A019')).toBe(false);
    expect(classifyRow(ANCHOR, row('アシックス 1201A018-108')).anchorMatch).toBe('NEEDS_REVIEW');
  });

  it('알고 있는 型番(페이지 メーカー型番)을 먼저 쓴다, 앵커 색상 코드를 모르면 NEEDS_REVIEW', () => {
    expect(
      classifyRow(ANCHOR, row('アシックス スニーカー', { modelCode: '1201A019-108' })).anchorMatch,
    ).toBe('MATCH');
    expect(
      classifyRow({ ...ANCHOR, colorCode: null }, row('アシックス 1201A019-108')).anchorMatch,
    ).toBe('NEEDS_REVIEW');
  });

  it('앵커 型番을 모르면 앵커 itemCode 행만 MATCH, 나머지는 NEEDS_REVIEW(Proposed)', () => {
    const anchor = { modelCodeNorm: null, colorCode: '108', itemCode: 'shop-a:10000123' };
    expect(
      classifyRow(anchor, row('ノーブランド スニーカー', { itemCode: 'shop-a:10000123' }))
        .anchorMatch,
    ).toBe('MATCH');
    expect(classifyRow(anchor, row('ノーブランド スニーカー')).anchorMatch).toBe('NEEDS_REVIEW');
  });
});

describe('anchor-match JAN·メーカー型番 재대조(F-SO-10)', () => {
  it('JAN 집합이 겹치면 true, 다르면 false, 한쪽이 없으면 NULL(확인 안 함)', () => {
    const base = { anchor: ANCHOR, pageModelCodeNorm: null };
    expect(
      recheckWithPage({ ...base, anchorJans: ['4550456000250'], rowJans: ['4550456000250'] })
        .janMatch,
    ).toBe(true);
    expect(
      recheckWithPage({ ...base, anchorJans: ['4550456000250'], rowJans: ['4900000000001'] })
        .janMatch,
    ).toBe(false);
    expect(
      recheckWithPage({ ...base, anchorJans: null, rowJans: ['4550456000250'] }).janMatch,
    ).toBeNull();
    expect(
      recheckWithPage({ ...base, anchorJans: ['4550456000250'], rowJans: [] }).janMatch,
    ).toBeNull();
  });

  it('メーカー型番: 앵커 型番(+색상)이면 true, 다른 색상·다른 型番이면 false', () => {
    const check = (page: string | null) =>
      recheckWithPage({ anchor: ANCHOR, anchorJans: null, rowJans: [], pageModelCodeNorm: page })
        .makerModelMatch;
    expect(check('1201A019108')).toBe(true);
    expect(check('1201A019')).toBe(true);
    expect(check('1201A019001')).toBe(false);
    expect(check('1011B548')).toBe(false);
    expect(check(null)).toBeNull();
  });

  it('선택 가능한 같은 상품: 오너 판단이 최종, 없으면 MATCH이고 재대조가 어긋나지 않아야(NULL은 통과)', () => {
    const r = {
      anchorMatch: 'MATCH',
      janMatch: null,
      makerModelMatch: true,
      ownerMatchDecision: null,
    };
    expect(effectiveMatch(r)).toBe(true);
    expect(effectiveMatch({ ...r, janMatch: false })).toBe(false);
    expect(effectiveMatch({ ...r, janMatch: false, ownerMatchDecision: 'MATCH' })).toBe(true);
    expect(effectiveMatch({ ...r, anchorMatch: 'NEEDS_REVIEW' })).toBe(false);
    expect(effectiveMatch({ ...r, anchorMatch: 'NEEDS_REVIEW', ownerMatchDecision: 'MATCH' })).toBe(
      true,
    );
    expect(effectiveMatch({ ...r, ownerMatchDecision: 'NO_MATCH' })).toBe(false);
  });

  it('AI 보조 대상(Proposed): NEEDS_REVIEW, 또는 MATCH인데 재대조가 어긋남. 오너가 판단했으면 부르지 않는다', () => {
    const r = {
      anchorMatch: 'NEEDS_REVIEW',
      janMatch: null,
      makerModelMatch: null,
      ownerMatchDecision: null,
    };
    expect(isUncertain(r)).toBe(true);
    expect(isUncertain({ ...r, ownerMatchDecision: 'MATCH' })).toBe(false);
    expect(isUncertain({ ...r, anchorMatch: 'MATCH' })).toBe(false);
    expect(isUncertain({ ...r, anchorMatch: 'MATCH', janMatch: false })).toBe(true);
    expect(isUncertain({ ...r, anchorMatch: 'NO_MATCH' })).toBe(false);
  });

  it('상품명 표시(並行輸入品·アウトレット)', () => {
    expect(itemNameMarks('アシックス 1201A019-108 並行輸入品')).toEqual(['並行輸入品']);
    expect(itemNameMarks('アシックス アウトレット 並行輸入')).toEqual([
      '並行輸入品',
      'アウトレット',
    ]);
    expect(itemNameMarks('アシックス')).toEqual([]);
  });
});

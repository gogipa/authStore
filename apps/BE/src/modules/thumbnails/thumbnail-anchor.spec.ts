import { isSameAnchor, normalizeAnchorCode } from './thumbnail-anchor.js';

const anchor = { anchorModelCode: '1201A019108', anchorItemCode: null, anchorColorCode: '108' };

describe('isSameAnchor(P3-01 Proposed — 型番·색상 코드와 앵커 키 비교)', () => {
  it('型番이 같고 색상이 같거나 모르면 같다', () => {
    const image = { sourceItemCode: 'shop-a:1', sourceModelCodeNorm: '1201A019108' };
    expect(isSameAnchor(anchor, { ...image, sourceColorCode: '108' })).toBe(true);
    expect(isSameAnchor(anchor, { ...image, sourceColorCode: null })).toBe(true);
    // 표기 차이(하이픈·전각·소문자)는 정규화로 맞춘다
    expect(
      isSameAnchor(anchor, {
        ...image,
        sourceModelCodeNorm: '１２０１a019-108',
        sourceColorCode: null,
      }),
    ).toBe(true);
  });

  it('型番이나 색상이 다르면 다르다', () => {
    expect(
      isSameAnchor(anchor, {
        sourceItemCode: 'shop-a:1',
        sourceModelCodeNorm: '1201A019001',
        sourceColorCode: null,
      }),
    ).toBe(false);
    expect(
      isSameAnchor(anchor, {
        sourceItemCode: 'shop-a:1',
        sourceModelCodeNorm: '1201A019108',
        sourceColorCode: '001',
      }),
    ).toBe(false);
  });

  it('型番이 없으면 앵커 itemCode로 비교하고, 비교할 값이 없으면 다르다', () => {
    const urlAnchor = { anchorModelCode: null, anchorItemCode: 'shop-c:3', anchorColorCode: '108' };
    const base = { sourceModelCodeNorm: null, sourceColorCode: null };
    expect(isSameAnchor(urlAnchor, { ...base, sourceItemCode: 'shop-c:3' })).toBe(true);
    expect(isSameAnchor(urlAnchor, { ...base, sourceItemCode: 'shop-d:4' })).toBe(false);
    expect(isSameAnchor(anchor, { ...base, sourceItemCode: 'shop-c:3' })).toBe(false);
    expect(
      isSameAnchor(
        { anchorModelCode: null, anchorItemCode: null, anchorColorCode: null },
        { ...base, sourceItemCode: 'shop-c:3' },
      ),
    ).toBe(false);
    expect(normalizeAnchorCode('  ')).toBeNull();
  });
});

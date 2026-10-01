import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import type { FieldDraft } from '../fields/content-field.store.js';
import { buildFactDrafts, pendingFactInputs } from './fact-drafts.js';
import { countryFromDictionary, koreanMaterial, resolveOrigin } from './fact-values.js';
import { carryOwnerFacts, originSettled, recheckReasonFor, resolveRecheck } from './recheck.js';
import { specImageUrlsOf } from './spec-image.collector.js';

const CONTENT = DEFAULT_SETTINGS.content;
const NOW = new Date('2026-09-28T01:00:00Z');

function ownerOrigin(overrides: Partial<FieldDraft> = {}): FieldDraft {
  return {
    fieldKey: 'fact.origin',
    value: ['베트남'],
    generatedValue: null,
    valueSource: 'OWNER_INPUT',
    extractionMethod: 'NONE',
    evidenceQuote: null,
    evidenceUrl: 'https://item.rakuten.co.jp/shop-a/1/',
    evidenceImageAssetId: null,
    basisItemCode: 'shop-a:1',
    basisSha256: null,
    ownerConfirmedAt: NOW,
    choicePending: false,
    recheckReason: null,
    recheckResolvedAt: null,
    ...overrides,
  };
}

describe('⑥-2 값의 한국어 정리(P3-03 규칙 10 — 설정 사전, Proposed)', () => {
  it('원산지 여러 나라도 확정: ベトナム、インドネシア、中国 → 베트남·인도네시아·중국', () => {
    expect(resolveOrigin('ベトナム、インドネシア、中国', CONTENT.originCountries)).toEqual({
      countries: ['베트남', '인도네시아', '중국'],
      unresolved: [],
    });
    expect(resolveOrigin('VIETNAM', CONTENT.originCountries).countries).toEqual(['베트남']);
    expect(resolveOrigin('中国製', CONTENT.originCountries).countries).toEqual(['중국']);
  });

  it('사전에 없는 나라는 원문 그대로 두고 unresolved로 알린다', () => {
    expect(resolveOrigin('ナルニア', CONTENT.originCountries)).toEqual({
      countries: ['ナルニア'],
      unresolved: ['ナルニア'],
    });
  });

  it('M0 S7: 괄호 설명·영문 약칭 마침표를 떼고 사전에서 찾는다(나라 이름이 섞인 괄호는 확정하지 않는다)', () => {
    const dict = CONTENT.originCountries;
    expect(resolveOrigin('日本（福岡県久留米市の自社工場）', dict)).toEqual({
      countries: ['일본'],
      unresolved: [],
    });
    expect(resolveOrigin('タイ (태국)', dict)).toEqual({ countries: ['태국'], unresolved: [] });
    expect(resolveOrigin('U.S.A.', dict)).toEqual({ countries: ['미국'], unresolved: [] });
    expect(resolveOrigin('MADE IN U.S.A', dict).countries).toEqual(['미국']);
    expect(resolveOrigin('（中国）', dict)).toEqual({ countries: ['중국'], unresolved: [] });
    // 괄호 안에 다른 나라가 섞이면 버리지 않고 오너 확인으로 남긴다
    expect(resolveOrigin('中国製（一部ベトナム製）', dict)).toEqual({
      countries: ['중국', '一部ベトナム'],
      unresolved: ['一部ベトナム'],
    });
    // 영문 이름은 낱말 경계로만 본다(FUKUOKA 속 UK는 영국이 아니다)
    expect(resolveOrigin('JAPAN (FUKUOKA FACTORY)', dict)).toEqual({
      countries: ['일본'],
      unresolved: [],
    });
  });

  it('원산지 입력 비교: 원문·"대륙 > 국가"·한국어 나라 이름 모두 받는다', () => {
    for (const input of ['ベトナム', '베트남', '아시아 > 베트남', '아시아>베트남', ' vietnam ']) {
      expect(countryFromDictionary(input, CONTENT.originCountries)).toBe('베트남');
    }
    expect(countryFromDictionary('나니아', CONTENT.originCountries)).toBeNull();
  });

  it('소재: 合成繊維・合成皮革 → 합성섬유·합성가죽, 모르는 말은 원문', () => {
    expect(koreanMaterial('合成繊維・合成皮革', CONTENT.materialTerms)).toBe('합성섬유·합성가죽');
    expect(koreanMaterial('ゴム', CONTENT.materialTerms)).toBe('고무');
    expect(koreanMaterial('コルク', CONTENT.materialTerms)).toBe('コルク');
  });
});

describe('사실 필드 행(규칙 10·11·12)', () => {
  it('버전마다 다섯 행. 못 찾은 필드는 value=NULL·NONE, 찾은 필드는 값·발췌·출처·방법·basis itemCode', () => {
    const { drafts, unresolvedOrigins } = buildFactDrafts({
      extraction: {
        origin: {
          raw: 'ベトナム',
          height: null,
          evidenceQuote: '原産国: ベトナム',
          method: 'DESCRIPTION_PATTERN',
          evidenceImageIndex: null,
        },
        material_lining: {
          raw: '合成繊維',
          height: null,
          evidenceQuote: 'ライニング：合成繊維',
          method: 'AI',
          evidenceImageIndex: 0,
        },
      },
      settings: CONTENT,
      itemCode: 'shop-b:2',
      itemUrl: 'https://item.rakuten.co.jp/shop-b/2/',
      imageAssetIds: [77],
    });
    expect(drafts.map((d) => d.fieldKey)).toEqual([
      'fact.origin',
      'fact.material_upper',
      'fact.material_lining',
      'fact.material_sole',
      'fact.heel_height',
    ]);
    expect(drafts[0]).toMatchObject({
      value: ['베트남'],
      extractionMethod: 'DESCRIPTION_PATTERN',
      evidenceQuote: '原産国: ベトナム',
      evidenceUrl: 'https://item.rakuten.co.jp/shop-b/2/',
      basisItemCode: 'shop-b:2',
      valueSource: 'GENERATED',
    });
    expect(drafts[1]).toMatchObject({ value: null, extractionMethod: 'NONE', evidenceUrl: null });
    expect(drafts[2]).toMatchObject({
      value: '합성섬유',
      extractionMethod: 'AI',
      evidenceImageAssetId: 77,
    });
    expect(unresolvedOrigins).toEqual([]);
    expect(pendingFactInputs(drafts, unresolvedOrigins)).toEqual([]);
  });

  it('원산지 근거 없음(NONE)이거나 사전에 없는 나라가 섞이면 입력 대기(fact.origin)', () => {
    const none = buildFactDrafts({
      extraction: {},
      settings: CONTENT,
      itemCode: 'x:1',
      itemUrl: 'https://item.rakuten.co.jp/x/1/',
      imageAssetIds: [],
    });
    expect(pendingFactInputs(none.drafts, none.unresolvedOrigins)).toEqual(['fact.origin']);
    const unknown = buildFactDrafts({
      extraction: {
        origin: {
          raw: 'ナルニア',
          height: null,
          evidenceQuote: '原産国: ナルニア',
          method: 'SKU_ATTRIBUTE',
          evidenceImageIndex: null,
        },
      },
      settings: CONTENT,
      itemCode: 'x:1',
      itemUrl: 'https://item.rakuten.co.jp/x/1/',
      imageAssetIds: [],
    });
    expect(pendingFactInputs(unknown.drafts, unknown.unresolvedOrigins)).toEqual(['fact.origin']);
  });
});

describe('재확인 필요(P3-03 규칙 14, F-CT-15)', () => {
  it('오너 원산지 basis_item_code=A, 현재 B → ITEM_CODE_CHANGED', () => {
    expect(recheckReasonFor('shop-a:1', 'shop-b:2')).toBe('ITEM_CODE_CHANGED');
    expect(recheckReasonFor('shop-a:1', 'shop-a:1')).toBeNull();
    const fresh = buildFactDrafts({
      extraction: {},
      settings: CONTENT,
      itemCode: 'shop-b:2',
      itemUrl: 'https://item.rakuten.co.jp/shop-b/2/',
      imageAssetIds: [],
    }).drafts;
    const { drafts, flagged } = carryOwnerFacts([ownerOrigin()], fresh, 'shop-b:2');
    expect(flagged).toEqual(['fact.origin']);
    expect(drafts[0]).toMatchObject({
      value: ['베트남'],
      valueSource: 'OWNER_INPUT',
      basisItemCode: 'shop-a:1',
      recheckReason: 'ITEM_CODE_CHANGED',
      recheckResolvedAt: null,
      generatedValue: null,
      extractionMethod: 'NONE',
    });
    expect(originSettled(drafts[0])).toBe(false);
    expect(pendingFactInputs(drafts, [])).toEqual(['fact.origin']);
  });

  it('같은 itemCode면 오너 값을 덮어쓰지 않고 표시도 붙이지 않는다(새 추출 값은 generated_value)', () => {
    const fresh = buildFactDrafts({
      extraction: {
        origin: {
          raw: '中国',
          height: null,
          evidenceQuote: '原産国：中国',
          method: 'DESCRIPTION_PATTERN',
          evidenceImageIndex: null,
        },
      },
      settings: CONTENT,
      itemCode: 'shop-a:1',
      itemUrl: 'https://item.rakuten.co.jp/shop-a/1/',
      imageAssetIds: [],
    }).drafts;
    const { drafts, flagged } = carryOwnerFacts([ownerOrigin()], fresh, 'shop-a:1');
    expect(flagged).toEqual([]);
    expect(drafts[0]).toMatchObject({
      value: ['베트남'],
      generatedValue: ['중국'],
      recheckReason: null,
      choicePending: false,
    });
    expect(originSettled(drafts[0])).toBe(true);
  });

  it('오너가 현재 근거로 확인하면 recheck_resolved_at·basis itemCode를 채운다', () => {
    const resolved = resolveRecheck(
      ownerOrigin({ recheckReason: 'ITEM_CODE_CHANGED' }),
      NOW,
      'shop-b:2',
    );
    expect(resolved).toMatchObject({ basisItemCode: 'shop-b:2', recheckResolvedAt: NOW });
    expect(originSettled(resolved)).toBe(true);
  });
});

describe('스펙 이미지 주소 고르기(P3-03 규칙 15 — 설정값, Proposed)', () => {
  it('<img src> 순서대로 라쿠텐 이미지 호스트만, 같은 주소는 한 번, 최대 장수까지(http → https)', () => {
    const html =
      '<img src="http://image.rakuten.co.jp/s/a.png"><img src="https://example.com/x.png">' +
      "<img alt='b' src='https://image.rakuten.co.jp/s/b.jpg'><img src=\"https://image.rakuten.co.jp/s/a.png\">" +
      '<img src="https://tshop.r10s.jp/s/c.jpg">';
    expect(specImageUrlsOf(html, 2)).toEqual([
      'https://image.rakuten.co.jp/s/a.png',
      'https://image.rakuten.co.jp/s/b.jpg',
    ]);
    expect(specImageUrlsOf(html, 0)).toEqual([]);
    expect(specImageUrlsOf(null, 4)).toEqual([]);
  });
});

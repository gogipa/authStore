import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import type { FieldDraft } from '../fields/content-field.store.js';
import { cautionDraft, cautionFromTemplates } from './caution.supplement.js';
import { colorKoDraft, colorKoFromDictionary } from './color-ko.resolver.js';
import {
  buildFactPrompt,
  factAiSchema,
  interpretAiExtras,
} from './extractors/ai-fact.extractor.js';
import { carryOwnerFacts } from './recheck.js';

const COLORS = DEFAULT_SETTINGS.content.colorTerms;
const CAUTION = DEFAULT_SETTINGS.content.cautionTemplates;
const PAGE = 'https://item.rakuten.co.jp/shop-a/10000123/';

describe('⑥-2 색상 한국어 표기(P3-04 규칙 6, F-CT-17)', () => {
  it('사전으로 조각마다 바꾸고 구분자는 그대로(クリーム/ブラック → 크림/블랙), 색상 코드는 둔다', () => {
    expect(colorKoFromDictionary('クリーム/ブラック', COLORS)).toBe('크림/블랙');
    expect(colorKoFromDictionary('ホワイト×ネイビー(108)', COLORS)).toBe('화이트×네이비(108)');
    expect(colorKoFromDictionary('WHITE', COLORS)).toBe('화이트');
  });

  it('한 조각이라도 사전에 없거나 원문이 비면 null(AI 보조로 넘긴다)', () => {
    expect(colorKoFromDictionary('クリーム/サンドベージュ', COLORS)).toBeNull();
    expect(colorKoFromDictionary('', COLORS)).toBeNull();
    expect(colorKoFromDictionary(null, COLORS)).toBeNull();
    expect(colorKoFromDictionary('108', COLORS)).toBeNull();
  });

  it('행: 사전이면 DICTIONARY, AI면 AI(발췌), 둘 다 없으면 NONE', () => {
    const base = { selectedColorRaw: 'クリーム/ブラック', itemCode: 'shop-a:1', itemUrl: PAGE };
    expect(colorKoDraft({ ...base, dictionaryValue: '크림/블랙', ai: null })).toMatchObject({
      fieldKey: 'fact.color_ko',
      value: '크림/블랙',
      extractionMethod: 'DICTIONARY',
      evidenceQuote: 'クリーム/ブラック',
    });
    expect(
      colorKoDraft({
        ...base,
        dictionaryValue: null,
        ai: { value: '크림/샌드', quote: 'クリーム' },
      }),
    ).toMatchObject({ value: '크림/샌드', extractionMethod: 'AI', evidenceQuote: 'クリーム' });
    expect(colorKoDraft({ ...base, dictionaryValue: null, ai: null })).toMatchObject({
      value: null,
      extractionMethod: 'NONE',
    });
  });

  it('AI 보조: 선택 색상 원문 블록을 넣고, 발췌가 자료에 없으면 버린다', () => {
    const prompt = buildFactPrompt({
      names: ['color_ko', 'caution'],
      itemName: 'アシックス',
      descriptionText: null,
      attributes: [],
      imageCount: 0,
      selectedColorRaw: 'クリーム/サンドベージュ',
    });
    expect(prompt.blocks.map((b) => b.label)).toContain('선택 색상 원문');
    expect(prompt.instruction).toContain('color_ko·caution');
    expect(factAiSchema(['color_ko', 'caution']).required).toEqual(['color_ko', 'caution']);
    const extras = interpretAiExtras(
      {
        color_ko: {
          value: '크림/샌드베이지',
          evidence_quote: 'クリーム/サンドベージュ',
          method: 'TEXT',
          image_index: null,
        },
        caution: {
          value: '가죽 손질에 주의',
          evidence_quote: '本革',
          method: 'TEXT',
          image_index: null,
        },
      },
      { names: ['color_ko', 'caution'], knownText: 'クリーム/サンドベージュ', imageCount: 0 },
    );
    expect(extras).toEqual({
      color_ko: { value: '크림/샌드베이지', quote: 'クリーム/サンドベージュ' },
    });
  });
});

describe('⑥-2 소재별 주의 문구(P3-04 규칙 6, F-CT-21)', () => {
  it('기본 문장 + 소재 말이 든 문장(가죽·고무), 같은 문장은 한 번', () => {
    const text = cautionFromTemplates(['합성섬유·합성가죽', null, '고무'], CAUTION);
    expect(text.startsWith(CAUTION.default)).toBe(true);
    expect(text).toContain('가죽 소재는');
    expect(text).toContain('고무 밑창은');
    expect(text).toContain('섬유 소재는');
    expect(cautionFromTemplates([null, null, null], CAUTION)).toBe(CAUTION.default);
  });

  it('보완이 있으면 붙이고 방법 AI, 없으면 TEMPLATE', () => {
    const base = { templateText: '기본.', itemCode: 'shop-a:1', itemUrl: PAGE };
    expect(cautionDraft({ ...base, supplement: null })).toMatchObject({
      fieldKey: 'fact.caution',
      value: '기본.',
      extractionMethod: 'TEMPLATE',
      evidenceQuote: null,
    });
    expect(
      cautionDraft({ ...base, supplement: { value: '보완.', quote: '合成皮革' } }),
    ).toMatchObject({
      value: '기본. 보완.',
      extractionMethod: 'AI',
      evidenceQuote: '合成皮革',
    });
  });
});

describe('⑥-2 다시 실행 — 색상·주의 문구 오너 값(P3-04)', () => {
  it('오너 값을 지키되 itemCode가 바뀌어도 재확인 표시는 붙이지 않는다(ck_cdfield_recheck_target 밖)', () => {
    const row = (
      fieldKey: string,
      value: string,
      source: 'GENERATED' | 'OWNER_INPUT',
    ): FieldDraft => ({
      fieldKey,
      value,
      generatedValue: value,
      valueSource: source,
      extractionMethod: source === 'GENERATED' ? 'DICTIONARY' : null,
      evidenceQuote: null,
      evidenceUrl: null,
      evidenceImageAssetId: null,
      basisItemCode: 'shop-a:1',
      basisSha256: null,
      ownerConfirmedAt: source === 'OWNER_INPUT' ? new Date() : null,
      choicePending: false,
      recheckReason: null,
      recheckResolvedAt: null,
    });
    const out = carryOwnerFacts(
      [row('fact.color_ko', '크림', 'OWNER_INPUT')],
      [row('fact.color_ko', '크림/블랙', 'GENERATED')],
      'shop-b:2',
    );
    expect(out.flagged).toEqual([]);
    expect(out.drafts[0]).toMatchObject({
      value: '크림',
      generatedValue: '크림/블랙',
      valueSource: 'OWNER_INPUT',
      recheckReason: null,
    });
  });
});

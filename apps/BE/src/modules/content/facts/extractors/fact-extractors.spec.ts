import { DEFAULT_SETTINGS } from '../../../settings/defaults/default-settings.js';
import { flattenAttributes, htmlToRawText } from '../../content-sources.js';
import { mergeFacts, missingFacts } from '../fact.schema.js';
import { mapNfkc, rawSlice } from '../fact-text.js';
import { extractFromDescription } from './description-pattern.extractor.js';
import { extractFromAttributes } from './sku-attribute.extractor.js';

const LABELS = DEFAULT_SETTINGS.content.factLabels;

describe('1순위 SKU 속성 추출기(P3-03 규칙 9-1, F-CT-09)', () => {
  it('原産国／製造国: ベトナム、インドネシア、中国 → 원산지(원문 3개국)·SKU_ATTRIBUTE, 발췌는 원문 표기 그대로', () => {
    const facts = extractFromAttributes(
      flattenAttributes([{ name: '原産国／製造国', value: 'ベトナム、インドネシア、中国' }], []),
      LABELS,
    );
    expect(facts.origin).toMatchObject({
      raw: 'ベトナム、インドネシア、中国',
      method: 'SKU_ATTRIBUTE',
      evidenceQuote: '原産国／製造国: ベトナム、インドネシア、中国',
      evidenceImageIndex: null,
    });
  });

  it('ヒール高 {"value":"3.5","unit":"cm"} → {value: 3.5, unit: "cm"}', () => {
    const facts = extractFromAttributes(
      flattenAttributes([{ name: 'ヒール高', value: { value: '3.5', unit: 'cm' } }], []),
      LABELS,
    );
    expect(facts.heel_height?.height).toEqual({ value: 3.5, unit: 'cm' });
    expect(facts.heel_height?.method).toBe('SKU_ATTRIBUTE');
  });

  it('素材（生地・毛糸）은 겉감, 種類（アウトソール）은 밑창. 素材 값 안에 항목이 있으면 그것을 쓴다', () => {
    const plain = extractFromAttributes(
      flattenAttributes(
        [
          { name: '素材（生地・毛糸）', value: '合成皮革' },
          { name: '種類（アウトソール）', value: 'ラバー' },
        ],
        [],
      ),
      LABELS,
    );
    expect(plain.material_upper?.raw).toBe('合成皮革');
    expect(plain.material_sole?.raw).toBe('ラバー');
    const nested = extractFromAttributes(
      flattenAttributes([{ name: '素材', value: 'アッパー:メッシュ ソール:ゴム' }], []),
      LABELS,
    );
    expect(nested.material_upper?.raw).toBe('メッシュ');
    expect(nested.material_sole?.raw).toBe('ゴム');
  });

  it('SKU 속성(선택 색상 SKU)도 읽고, 상품 속성이 앞선다', () => {
    const facts = extractFromAttributes(
      flattenAttributes(
        [{ name: '原産国', value: 'ベトナム' }],
        [
          [
            { name: '原産国', value: '中国' },
            { name: '裏地', value: '合成繊維' },
          ],
        ],
      ),
      LABELS,
    );
    expect(facts.origin?.raw).toBe('ベトナム');
    expect(facts.material_lining?.raw).toBe('合成繊維');
  });
});

describe('2순위 설명문 패턴 추출기(P3-03 규칙 9-2)', () => {
  it('MADE IN VIETNAM → 원산지', () => {
    const facts = extractFromDescription('Style: running\nMADE IN VIETNAM', LABELS);
    expect(facts.origin).toMatchObject({
      raw: 'VIETNAM',
      method: 'DESCRIPTION_PATTERN',
      evidenceQuote: 'MADE IN VIETNAM',
    });
  });

  it('アッパー:合成繊維・合成皮革 / ソール:ゴム → 겉감·밑창, 안감은 없음', () => {
    const facts = extractFromDescription('アッパー:合成繊維・合成皮革 / ソール:ゴム', LABELS);
    expect(facts.material_upper).toMatchObject({
      raw: '合成繊維・合成皮革',
      evidenceQuote: 'アッパー:合成繊維・合成皮革',
    });
    expect(facts.material_sole).toMatchObject({ raw: 'ゴム', evidenceQuote: 'ソール:ゴム' });
    expect(facts.material_lining).toBeUndefined();
    expect(missingFacts(facts)).toEqual(['origin', 'material_lining', 'heel_height']);
  });

  it('NFKC 뒤 글자(／→/, ：→:, 전각 영숫자)에서도 맞고, 발췌는 원문(전각) 표기 그대로다', () => {
    const raw =
      'アッパー：合成繊維・合成皮革 ／ ソール：ゴム\n原産国：ベトナム\nヒール高さ：約３ｃｍ';
    const facts = extractFromDescription(raw, LABELS);
    expect(facts.material_upper?.raw).toBe('合成繊維・合成皮革');
    expect(facts.material_upper?.evidenceQuote).toBe('アッパー：合成繊維・合成皮革');
    expect(facts.material_sole?.evidenceQuote).toBe('ソール：ゴム');
    expect(facts.origin).toMatchObject({ raw: 'ベトナム', evidenceQuote: '原産国：ベトナム' });
    expect(facts.heel_height?.height).toEqual({ value: 3, unit: 'cm' });
    expect(facts.heel_height?.evidenceQuote).toBe('ヒール高さ：約３ｃｍ');
  });

  it("'インソール'은 밑창으로 잡지 않는다(낱말 경계). 【原産国】ベトナム·厚底 約4cm도 읽는다", () => {
    const facts = extractFromDescription(
      'インソール：EVA\n【原産国】ベトナム製\n厚底 約4cm',
      LABELS,
    );
    expect(facts.material_sole).toBeUndefined();
    expect(facts.origin?.raw).toBe('ベトナム製');
    expect(facts.heel_height?.height).toEqual({ value: 4, unit: 'cm' });
  });

  it('구분자 없는 문장(原産国は各ページ参照)은 값으로 보지 않는다', () => {
    expect(
      extractFromDescription('原産国は商品ページを参照してください', LABELS).origin,
    ).toBeUndefined();
  });

  it('설명 HTML → 원문 글(줄 구조 유지, NFKC 안 함)', () => {
    expect(htmlToRawText('<p>原産国：ベトナム</p><p>ソール：ゴム&amp;EVA</p>')).toBe(
      '原産国：ベトナム\nソール：ゴム&EVA',
    );
  });

  it('NFKC 위치 표: 반각 가타카나 탁점도 한 덩어리로 바꾸고 원문 조각을 돌려준다', () => {
    const mapped = mapNfkc('ｿｰﾙ：ｺﾞﾑ');
    expect(mapped.text).toBe('ソール:ゴム');
    expect(rawSlice(mapped, 4, 6)).toBe('ｺﾞﾑ');
  });
});

describe('순위(P3-03 규칙 9 — 앞 순위를 뒤가 덮지 않는다)', () => {
  it('속성과 설명문이 다르면 속성 값이 이긴다', () => {
    const attrs = extractFromAttributes(
      flattenAttributes([{ name: '原産国／製造国', value: 'ベトナム、インドネシア、中国' }], []),
      LABELS,
    );
    const desc = extractFromDescription('原産国：日本\nソール：ゴム', LABELS);
    const merged = mergeFacts(attrs, desc);
    expect(merged.origin).toMatchObject({
      raw: 'ベトナム、インドネシア、中国',
      method: 'SKU_ATTRIBUTE',
    });
    expect(merged.material_sole).toMatchObject({ raw: 'ゴム', method: 'DESCRIPTION_PATTERN' });
  });
});

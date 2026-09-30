import {
  copyFixture,
  disclosureTemplateFixture,
  factsFixture,
  originAreasFixture,
  parallelItemFixture,
  profileFixture,
  saleSizesFixture,
} from '../../../../test/fixtures/content/assembly/assembly-fixtures.js';
import {
  extractDisclosureBlocks,
  renderedBlockSha256,
  renderedMatchesTemplate,
} from '../../../common/rules/detail-html.js';
import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import { activeConditions, needsLeatherNotice } from './disclosure/conditional-blocks.js';
import {
  DisclosureTemplateError,
  renderDisclosure,
  requiredBlockProblems,
  type DisclosureValues,
} from './disclosure/disclosure-renderer.js';
import { buildDetailHtml } from './html/detail-html.builder.js';
import { sanitizeHtml } from './html/html-sanitizer.js';
import {
  hasActualCountry,
  planOriginArea,
  resolveOwnerOriginArea,
  specOriginLabelOf,
  type OriginAreaRow,
} from './notice/origin-code.resolver.js';
import {
  includesHeight,
  mapShoesNotice,
  REFER_TO_DETAIL_KEYS,
  type ShoesNoticeInput,
} from './notice/shoes-notice.mapper.js';
import { formatSaleSizes } from './notice/size-format.js';
import {
  buildProductName,
  isParallelImport,
  PRODUCT_NAME_MAX,
} from './product-name/product-name.builder.js';
import { productNameWarnings } from './product-name/product-name.warnings.js';
import { brandAttributeOf, modelInfoOf } from './assembly-sources.js';

const DICTIONARY = DEFAULT_SETTINGS.content.originCountries;
const BANNED = DEFAULT_SETTINGS.content.productNameBannedWords;

const cacheLookup = (rows: OriginAreaRow[]) => (area: string) =>
  Promise.resolve(
    rows.filter((row) => {
      const key = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
      return key(row.name) === key(area) || key(row.name).split('>').at(-1) === key(area);
    }),
  );
const CACHE: OriginAreaRow[] = originAreasFixture().map(({ originAreaCode, name }) => ({
  originAreaCode,
  name,
}));

function noticeInput(patch: Partial<ShoesNoticeInput> = {}): ShoesNoticeInput {
  const profile = profileFixture('profile-complete');
  return {
    facts: factsFixture('facts-leather'),
    sizes: saleSizesFixture('sale-sizes-gapped'),
    gender: 'MALE',
    brand: '아식스',
    importer: profile.importer!,
    cautionFallback: DEFAULT_SETTINGS.content.cautionTemplates.default,
    profile: {
      businessName: profile.businessName!,
      afterServicePhone: profile.afterServicePhone!,
      noticeFixedTexts: profile.noticeFixedTexts,
    },
    ...patch,
  };
}

const VALUES: DisclosureValues = {
  businessName: '[내 상호]',
  deliveryDaysMin: 10,
  deliveryDaysMax: 20,
  maxPurchaseQuantityPerOrder: 1,
  returnFeeKrw: 30000,
  exchangePolicy: DEFAULT_SETTINGS.notice.values.exchangePolicy,
  afterServiceGuide: '[A/S 안내]',
  basisDate: '2026-09-24',
};

describe('고시 사이즈 표기(F-CT-18, 규칙 5)', () => {
  it('끊긴 판매 사이즈 → 250~265·275mm (JP 25.0~26.5·27.5cm)', () => {
    expect(formatSaleSizes(saleSizesFixture('sale-sizes-gapped'))).toBe(
      '250~265·275mm (JP 25.0~26.5·27.5cm)',
    );
  });

  it('이어진 범위 → 250~280mm (JP 25.0~28.0cm), 한 사이즈 → 255mm (JP 25.5cm)', () => {
    expect(formatSaleSizes(saleSizesFixture('sale-sizes-contiguous'))).toBe(
      '250~280mm (JP 25.0~28.0cm)',
    );
    expect(formatSaleSizes([255])).toBe('255mm (JP 25.5cm)');
    expect(formatSaleSizes([260, 250, 250, 255])).toBe('250~260mm (JP 25.0~26.0cm)');
  });
});

describe('SHOES 고시 매핑(F-CT-16~22, 규칙 5)', () => {
  it('남성 운동화: height 키 자체가 없다(null이 아니다)', () => {
    const notice = mapShoesNotice(noticeInput());
    expect(Object.hasOwn(notice, 'height')).toBe(false);
    expect(Object.keys(notice)).not.toContain('height');
  });

  it('여성 굽 신발 + 근거(ヒール高さ) → height 있음, 근거가 밑창 높이(ソール高)면 뺀다', () => {
    const facts = factsFixture('facts-multi-origin');
    expect(mapShoesNotice(noticeInput({ facts, gender: 'FEMALE' })).height).toBe('약 5cm');
    const sole = { ...facts, heel: { ...facts.heel!, quote: 'ソール高 約5cm' } };
    expect(includesHeight('FEMALE', sole.heel)).toBe(false);
    expect(includesHeight('FEMALE', { ...facts.heel!, quote: null, ownerInput: true })).toBe(true);
    expect(includesHeight('FEMALE', null)).toBe(false);
  });

  it('manufacturer에 수입자가 들어가고, 고정 문구 5개는 상품상세 참조, 보증은 소비자분쟁해결기준', () => {
    const notice = mapShoesNotice(noticeInput());
    expect(notice.manufacturer).toBe('제조자: 아식스 / 수입자: [수입자]');
    for (const key of REFER_TO_DETAIL_KEYS) expect(notice[key]).toBe('상품상세 참조');
    expect(notice.warrantyPolicy).toBe('소비자분쟁해결기준에 따름');
    expect(notice.afterServiceDirector).toBe('[내 상호] / [A/S 연락처]');
  });

  it('material은 겉감·안감·밑창(근거 없는 칸은 정보 없음), color·size·caution', () => {
    const notice = mapShoesNotice(noticeInput());
    expect(notice.material).toBe('겉감 합성섬유·합성가죽 / 안감 정보 없음 / 밑창 고무');
    expect(notice.color).toBe('크림/블랙');
    expect(notice.size).toBe('250~265·275mm (JP 25.0~26.5·27.5cm)');
    expect(notice.caution).toContain('가죽 소재');
    const noCaution = mapShoesNotice(
      noticeInput({ facts: factsFixture('facts-textile-no-lining') }),
    );
    expect(noCaution.caution).toBe(DEFAULT_SETTINGS.content.cautionTemplates.default);
  });

  it('프로필 고정 문구가 있으면 그 글을 쓴다', () => {
    const input = noticeInput();
    input.profile = {
      ...input.profile,
      noticeFixedTexts: { returnCostReason: '반품비 별도 안내' },
    };
    expect(mapShoesNotice(input).returnCostReason).toBe('반품비 별도 안내');
  });
});

describe('조건부 고지(F-CT-01·03, 규칙 4)', () => {
  const terms = DEFAULT_SETTINGS.notice.leatherTerms;

  it("겉감 '합성가죽' → 안전관리 문장, 소재 전부 정보 없음 → 있음, 섬유만(안감 없음) → 없음", () => {
    expect(needsLeatherNotice(factsFixture('facts-leather').materials, terms)).toBe(true);
    expect(needsLeatherNotice({ upper: null, lining: null, sole: null }, terms)).toBe(true);
    expect(needsLeatherNotice(factsFixture('facts-textile-no-lining').materials, terms)).toBe(
      false,
    );
    expect(needsLeatherNotice({ upper: '合成皮革', lining: null, sole: null }, terms)).toBe(true);
  });

  it('AI 표시 켬(기본) → AI 한 줄 조건, 끄면 없음', () => {
    const materials = factsFixture('facts-textile-no-lining').materials;
    expect(
      activeConditions({ materials, notice: DEFAULT_SETTINGS.notice }).has('AI_IMAGE_LABEL'),
    ).toBe(true);
    expect(
      activeConditions({ materials, notice: { ...DEFAULT_SETTINGS.notice, aiImageLabel: false } }),
    ).toEqual(new Set());
  });
});

describe('구매대행 고지 렌더러(F-CT-02·04, 규칙 3)', () => {
  const template = disclosureTemplateFixture();
  const all = new Set(['LEATHER_OR_UNKNOWN_MATERIAL', 'AI_IMAGE_LABEL'] as const);

  it('상호·반품비·주문당 수량·배송기간·기준일을 채우고, 블록마다 data-block-id와 채운 글 해시를 남긴다', () => {
    const out = renderDisclosure(template, VALUES, all);
    expect(out.html.startsWith('<div data-autostore-section="DISCLOSURE">')).toBe(true);
    const text = out.texts.map((t) => t.text).join('\n');
    expect(text).toContain('이 상품은 [내 상호]가 일본 판매처에서');
    expect(text).toContain('약 10~20영업일');
    expect(text).toContain('주문당 구매 수량을 1켤레로');
    expect(text).toContain('반송비(약 30,000원)');
    expect(text).toContain('(기준일: 2026-09-24)');
    expect(text).not.toMatch(/\{[^{}]+\}/);
    expect(out.blockIds).toContain('LEATHER_SAFETY');
    expect(out.blockIds).toContain('AI_IMAGE');
    expect(out.blockIds).not.toContain('PRICE_BREAKDOWN');
    expect(out.blocks.find((b) => b.block_id === 'AI_IMAGE')).toMatchObject({ conditional: true });
    expect(out.blocks.find((b) => b.block_id === 'AGENCY')).toMatchObject({ conditional: false });
    for (const block of extractDisclosureBlocks(out.html)) {
      const record = out.blocks.find((b) => b.block_id === block.blockId)!;
      expect(renderedBlockSha256(block.text)).toBe(record.sha256);
      const tmpl = template.blocks.find((b) => b.id === block.blockId)!;
      expect(renderedMatchesTemplate(tmpl.text, block.text)).toBe(true);
    }
    expect(out.templateVersion).toBe(template.templateVersion);
    expect(out.templateDate).toBe('2026-09-24');
  });

  it('같은 입력이면 같은 해시, 상호가 바뀌면 AGENCY 해시가 바뀐다', () => {
    const a = renderDisclosure(template, VALUES, all);
    const b = renderDisclosure(template, VALUES, all);
    expect(b.blocks).toEqual(a.blocks);
    const c = renderDisclosure(template, { ...VALUES, businessName: '다른 상호' }, all);
    const agency = (x: typeof a) => x.blocks.find((blk) => blk.block_id === 'AGENCY')!.sha256;
    expect(agency(c)).not.toBe(agency(a));
  });

  it('조건이 없으면 조건부 블록을 넣지 않는다', () => {
    const out = renderDisclosure(template, VALUES, new Set());
    expect(out.blockIds).not.toContain('LEATHER_SAFETY');
    expect(out.blockIds).not.toContain('AI_IMAGE');
  });

  it('필수 블록 문장이 앱 내장 해시와 다르면 렌더하지 않는다', () => {
    const edited = structuredClone(template);
    edited.blocks = edited.blocks.map((b) =>
      b.id === 'WITHDRAWAL' ? { ...b, text: b.text.replace('7일', '8일') } : b,
    );
    expect(requiredBlockProblems(edited.blocks)).toEqual(['WITHDRAWAL: 문장이 다름']);
    expect(() => renderDisclosure(edited, VALUES, all)).toThrow(DisclosureTemplateError);
  });

  it('채울 값이 비면 던진다(배송기간 null은 시작 전 검사가 먼저 막는다)', () => {
    expect(() => renderDisclosure(template, { ...VALUES, businessName: '' }, all)).toThrow(/상호/);
  });
});

describe('원산지 코드(F-CT-25~27, 규칙 7~9)', () => {
  it('ベトナム → 아시아 > 베트남 → 캐시 02 계열 코드(fixture), 표기는 베트남', async () => {
    const result = await planOriginArea(
      ['베트남'],
      { originCountries: DICTIONARY, multiOriginMode: 'FIRST_COUNTRY_PLURAL' },
      cacheLookup(CACHE),
    );
    expect(result).toEqual({
      ok: true,
      plan: {
        code: '0200036',
        plural: false,
        content: null,
        name: '아시아>베트남',
        specOriginLabel: '베트남',
        countries: ['베트남'],
      },
    });
  });

  it('여러 나라 → 설정 방식: 첫 나라 코드 + plural, 또는 03 + 상세 표기. 사양 블록에 입고 시기에 따라 다름', async () => {
    const countries = factsFixture('facts-multi-origin').origin;
    const plural = await planOriginArea(
      countries,
      { originCountries: DICTIONARY, multiOriginMode: 'FIRST_COUNTRY_PLURAL' },
      cacheLookup(CACHE),
    );
    expect(plural).toMatchObject({
      ok: true,
      plan: { code: '0200036', plural: true, content: null },
    });
    const code03 = await planOriginArea(
      countries,
      { originCountries: DICTIONARY, multiOriginMode: 'CODE_03_CONTENT' },
      cacheLookup(CACHE),
    );
    expect(code03).toMatchObject({
      ok: true,
      plan: {
        code: '03',
        plural: false,
        content: '베트남·인도네시아·중국(입고 시기에 따라 다름)',
        specOriginLabel: '베트남·인도네시아·중국(입고 시기에 따라 다름)',
      },
    });
    expect(specOriginLabelOf(['베트남'])).toBe('베트남');
  });

  it('캐시에 없는 나라면 실패(메타 동기화 필요)', async () => {
    expect(
      await planOriginArea(
        ['캄보디아'],
        { originCountries: DICTIONARY, multiOriginMode: 'FIRST_COUNTRY_PLURAL' },
        cacheLookup(CACHE),
      ),
    ).toEqual({ ok: false, country: '캄보디아' });
  });

  it('사양 블록에 나라 표기 없이 03 → ORIGIN_CODE_NOT_ALLOWED, 나라가 있으면 03 + 상세 표기', async () => {
    const context = {
      field: 'fields[0].value',
      countries: ['베트남'],
      dictionary: DICTIONARY,
      findCode: (code: string) =>
        Promise.resolve(CACHE.find((row) => row.originAreaCode === code) ?? null),
    };
    await expect(
      resolveOwnerOriginArea(
        { code: '03', content: null, plural: null },
        { ...context, specOriginLabel: '상세설명 참조' },
      ),
    ).rejects.toMatchObject({ code: 'ORIGIN_CODE_NOT_ALLOWED' });
    expect(hasActualCountry('상세설명 참조', DICTIONARY)).toBe(false);
    await expect(
      resolveOwnerOriginArea(
        { code: '03', content: null, plural: null },
        { ...context, specOriginLabel: '베트남' },
      ),
    ).resolves.toEqual({ code: '03', plural: false, content: '베트남', name: null });
    await expect(
      resolveOwnerOriginArea(
        { code: '00', content: null, plural: null },
        { ...context, specOriginLabel: '베트남' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      resolveOwnerOriginArea(
        { code: '0209999', content: null, plural: null },
        { ...context, specOriginLabel: '베트남' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('HTML 위험 요소 제거(F-CT-30, 규칙 11)', () => {
  it('script·style·data: URI 이미지·외부 링크·on* 속성이 모두 빠진다', () => {
    const dirty = [
      '<p>안녕<script>alert(1)</script></p>',
      '<style>p{color:red}</style>',
      '<img src="data:image/png;base64,AAAA" onerror="alert(2)">',
      '<a href="https://evil.example/">링크 글</a>',
      '<p onclick="x()" style="color:red">문단</p>',
      '<IFRAME src="https://x"></IFRAME><!-- 주석 -->',
      '<img src="autostore-image:selection/0" alt="대표" onerror="y()">',
    ].join('');
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/script|style|data:|href|https:|onerror|onclick|iframe|alert|주석/i);
    expect(clean).toContain('링크 글');
    expect(clean).toContain('<p>문단</p>');
    expect(clean).toContain('<img src="autostore-image:selection/0" alt="대표">');
  });

  it('카피에 든 <b>는 이스케이프되고, 조립 결과는 다시 정리해도 그대로다', () => {
    const facts = factsFixture('facts-leather');
    const disclosure = renderDisclosure(disclosureTemplateFixture(), VALUES, new Set());
    const { html, htmlSha256 } = buildDetailHtml({
      disclosureHtml: disclosure.html,
      copy: copyFixture(),
      specBlockHtml: `<div data-autostore-section="SPEC"><ul><li data-spec-row="ORIGIN">· 제조국(원산지): ${facts.origin[0]!}</li></ul></div>`,
    });
    expect(html).toContain('크림 바탕에 &lt;b&gt;블랙&lt;/b&gt; 라인 포인트');
    expect(html).not.toContain('<b>');
    expect(sanitizeHtml(html)).toBe(html);
    expect(htmlSha256).toMatch(/^[0-9a-f]{64}$/);
    const order = ['DISCLOSURE', 'IMAGES', 'COPY', 'SPEC'].map((s) =>
      html.indexOf(`data-autostore-section="${s}"`),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order[0]).toBeGreaterThan(0);
  });
});

describe('상품명 제안·경고(F-CT-32·33, 규칙 13)', () => {
  it('화면시안_명세 §4 입력 → 아식스 젤카야노14 1201A019-108 러닝화 크림 남성(33자)', () => {
    const name = buildProductName({
      brand: '아식스',
      series: '젤카야노14',
      modelName: '1201A019-108',
      productType: '러닝화',
      color: '크림',
      gender: 'MALE',
      parallelImport: false,
    });
    expect(name).toBe('아식스 젤카야노14 1201A019-108 러닝화 크림 남성');
    expect([...name].length).toBe(33);
    expect(productNameWarnings(name, BANNED)).toEqual([]);
  });

  it("並行輸入品 → '병행' 포함(맨 뒤), 속성 브랜드·모델명", () => {
    const item = parallelItemFixture();
    expect(isParallelImport(item.itemName)).toBe(true);
    expect(isParallelImport('アシックス ゲルカヤノ14')).toBe(false);
    const view = {
      sourcingStepRunId: 1,
      rakutenItemId: 1,
      itemCode: 'shop-a:1',
      itemUrl: 'https://item.rakuten.co.jp/shop-a/1/',
      itemName: item.itemName,
      modelCode: item.modelCode,
      descriptionText: null,
      descriptionHtml: null,
      itemAttributes: item.attributes,
      skuAttributes: [],
      selectedColorRaw: 'クリーム/ブラック',
      collectedAt: new Date(),
    };
    expect(brandAttributeOf(view)).toBe('ASICS');
    const info = modelInfoOf(view);
    expect(info).toEqual({
      modelCode: '1201A019-108',
      parallelImport: true,
      brandAttribute: 'ASICS',
    });
    const name = buildProductName({
      brand: info.brandAttribute,
      series: null,
      modelName: info.modelCode,
      productType: null,
      color: '크림',
      gender: 'MALE',
      parallelImport: info.parallelImport,
    });
    expect(name).toBe('ASICS 1201A019-108 크림 남성 병행');
  });

  it('101자 → 100자 경고, 금지 수식어(무료배송) → 경고, 같은 단어 두 번 → 경고', () => {
    const long = `${'가'.repeat(PRODUCT_NAME_MAX - 2)} 나다`;
    expect([...long].length).toBe(101);
    expect(productNameWarnings(long, BANNED).map((w) => w.code)).toEqual(['PRODUCT_NAME_TOO_LONG']);
    expect(productNameWarnings('아식스 러닝화 무료배송', BANNED).map((w) => w.code)).toEqual([
      'PRODUCT_NAME_BANNED_WORD',
    ]);
    expect(productNameWarnings('아식스 러닝화 아식스', BANNED)).toEqual([
      { code: 'PRODUCT_NAME_REPEATED_WORD', message: "같은 낱말 '아식스'가 2번 나옵니다." },
    ]);
  });

  it('제안은 100자를 넘지 않고, 반복 낱말은 한 번만', () => {
    const name = buildProductName({
      brand: '아식스',
      series: `아식스 ${'젤'.repeat(120)}`,
      modelName: '1201A019-108',
      productType: '러닝화',
      color: '크림',
      gender: 'MALE',
      parallelImport: true,
    });
    expect([...name].length).toBeLessThanOrEqual(PRODUCT_NAME_MAX);
    expect(name.startsWith('아식스 ')).toBe(true);
    expect(name).toContain('1201A019-108');
    expect(name.split(' ').filter((w) => w === '아식스')).toHaveLength(1);
  });
});

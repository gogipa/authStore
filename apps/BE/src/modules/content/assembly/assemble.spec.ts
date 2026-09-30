import { writeFileSync } from 'node:fs';
import {
  copyFixture,
  disclosureTemplateFixture,
  expectedDetailHtml,
  factsFixture,
  profileFixture,
  saleSizesFixture,
} from '../../../../test/fixtures/content/assembly/assembly-fixtures.js';
import {
  countImagePlaceholders,
  fillImagePlaceholders,
  IMAGE_SLOT_COUNT,
} from '../../../common/rules/detail-html.js';
import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import type { FieldDraft } from '../fields/content-field.store.js';
import { assemblyProfileOf } from './assembly-sources.js';
import {
  materialBasisSha256,
  originBasisSha256,
  sizeBasisSha256,
  type AssemblyFacts,
} from './assembly-facts.js';
import { carryAssemblyFields, overridesOf } from './assembly-fields.js';
import { applyEditToRow, assemble, type AssembleInput } from './assemble.js';
import { sanitizeHtml } from './html/html-sanitizer.js';
import { parseSpecRows } from './spec-block.renderer.js';

const PLAN_VN = {
  code: '0200036',
  plural: false,
  content: null,
  name: '아시아>베트남',
  specOriginLabel: '베트남',
  countries: ['베트남'],
};

function input(facts: AssemblyFacts = factsFixture('facts-leather')): AssembleInput {
  const notice = disclosureTemplateFixture();
  return {
    copy: copyFixture(),
    facts,
    sizes: saleSizesFixture('sale-sizes-gapped'),
    gender: 'MALE',
    profile: assemblyProfileOf(profileFixture('profile-complete'))!,
    notice: {
      ...notice,
      values: {
        deliveryDaysMin: 10,
        deliveryDaysMax: 20,
        exchangePolicy: notice.values.exchangePolicy,
      },
    },
    cautionFallback: DEFAULT_SETTINGS.content.cautionTemplates.default,
    origin: PLAN_VN,
    naming: {
      keyword: '아식스 젤카야노14',
      brandAttribute: null,
      modelCode: '1201A019-108',
      wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
      parallelImport: false,
    },
  };
}

function owner(
  fieldKey: string,
  value: FieldDraft['value'],
  basisSha256: string | null = null,
): FieldDraft {
  return {
    fieldKey,
    value,
    generatedValue: null,
    valueSource: 'OWNER_INPUT',
    extractionMethod: null,
    evidenceQuote: null,
    evidenceUrl: null,
    evidenceImageAssetId: null,
    basisItemCode: 'shop-a:10000123',
    basisSha256,
    ownerConfirmedAt: new Date('2026-09-28T05:30:00Z'),
    choicePending: false,
    recheckReason: null,
    recheckResolvedAt: null,
  };
}

describe('⑥-3 조립(assemble — 규칙 3~13)', () => {
  it('상세 HTML 스냅샷(expected/detail.html): 고지 → 이미지 자리표시자 → 카피 → 사양 블록', () => {
    const { row } = assemble(input(), { notice: {} });
    if (process.env.UPDATE_ASSEMBLY_SNAPSHOT === '1') {
      writeFileSync(
        new URL('../../../../test/fixtures/content/assembly/expected/detail.html', import.meta.url),
        `${row.html}\n`,
      );
    }
    expect(row.html).toBe(expectedDetailHtml());
    expect(countImagePlaceholders(row.html)).toBe(IMAGE_SLOT_COUNT);
    expect(row.html).toContain(row.specBlockHtml);
    expect(sanitizeHtml(row.html)).toBe(row.html);
  });

  it('행 값: 상품명 제안·고시·원산지·수입자·사양 블록 제조국·고지 블록 ID·기준일', () => {
    const { row, generated } = assemble(input(), { notice: {} });
    expect(row.productName).toBe('아식스 젤카야노14 1201A019-108 러닝화 크림 남성');
    expect(generated.productName).toBe(row.productName);
    expect(row.noticeSizesMm).toEqual([250, 255, 260, 265, 275]);
    expect(row.originAreaCode).toBe('0200036');
    expect(row.importer).toBe('[수입자]');
    expect(row.specOriginLabel).toBe('베트남');
    expect(row.disclosureBlockIds[0]).toBe('HEADER');
    expect(row.disclosureBlockIds).toEqual(expect.arrayContaining(['LEATHER_SAFETY', 'AI_IMAGE']));
    expect(row.disclosureTemplateDate).toBe('2026-09-24');
    expect(Object.hasOwn(row.noticeFields, 'height')).toBe(false);
  });

  it('사양 블록 원산지·소재 = 고시 원산지·소재(US-15 AC4), 근거 없는 칸·행은 뺀다(US-15 AC3)', () => {
    const { row } = assemble(input(factsFixture('facts-textile-no-lining')), { notice: {} });
    const rows = parseSpecRows(row.specBlockHtml);
    expect(rows.map((r) => r.key)).toEqual(['ORIGIN', 'MATERIAL', 'SIZE']);
    expect(rows[0]!.value).toBe('베트남');
    expect(rows[1]!.value).toBe('겉감 메쉬·합성섬유 / 밑창 고무');
    const notice = row.noticeFields.material;
    for (const part of rows[1]!.value.split(' / ')) expect(notice).toContain(part);
    expect(row.disclosureBlockIds).not.toContain('LEATHER_SAFETY');
  });

  it('고시에서 height를 뺀 남성화도 근거가 있으면 사양 블록에 굽·밑창 높이를 적는다(F-CT-28)', () => {
    const { row } = assemble(input(), { notice: {} });
    expect(Object.hasOwn(row.noticeFields, 'height')).toBe(false);
    expect(parseSpecRows(row.specBlockHtml).find((r) => r.key === 'HEIGHT')?.value).toBe(
      '약 3.5cm',
    );
  });

  it('오너 값(상품명·고시 material·size·원산지 03)은 생성 값 위에 덮고, 사양 블록 같은 행도 바꾼다', () => {
    const overrides = overridesOf([
      owner('product_name', '직접 고친 상품명'),
      owner('notice.material', '겉감 소가죽 / 안감 섬유 / 밑창 고무'),
      owner('notice.size', '250~275mm'),
      owner('notice.height', '약 3cm'),
      owner('notice.origin_area', { code: '03', content: '베트남', plural: false }),
    ]);
    const { row } = assemble(input(), overrides);
    expect(row.productName).toBe('직접 고친 상품명');
    expect(row.noticeFields.material).toBe('겉감 소가죽 / 안감 섬유 / 밑창 고무');
    expect(row.noticeFields.height).toBe('약 3cm');
    expect(row).toMatchObject({ originAreaCode: '03', originAreaContent: '베트남' });
    const rows = parseSpecRows(row.specBlockHtml);
    expect(rows.find((r) => r.key === 'MATERIAL')?.value).toBe(
      '겉감 소가죽 / 안감 섬유 / 밑창 고무',
    );
    expect(rows.find((r) => r.key === 'SIZE')?.value).toBe('250~275mm');
  });

  it('오너 수정(EDIT)은 저장 행의 사양 블록만 바꾸고 HTML을 다시 해시한다(고지·카피 그대로)', () => {
    const { row } = assemble(input(), { notice: {} });
    const next = applyEditToRow(row, { notice: { size: '250~275mm' } });
    expect(next.htmlSha256).not.toBe(row.htmlSha256);
    expect(next.html).toContain(next.specBlockHtml);
    expect(next.html.slice(0, next.html.indexOf('data-autostore-section="SPEC"'))).toBe(
      row.html.slice(0, row.html.indexOf('data-autostore-section="SPEC"')),
    );
    const same = applyEditToRow(row, { notice: {}, productName: '새 이름' });
    expect(same.htmlSha256).toBe(row.htmlSha256);
    expect(same.productName).toBe('새 이름');
    const removed = applyEditToRow(
      { ...row, noticeFields: { ...row.noticeFields, height: '약 3cm' } },
      { notice: { height: null } },
    );
    expect(Object.hasOwn(removed.noticeFields, 'height')).toBe(false);
  });
});

describe('⑥-3 오너 입력 가져오기·재확인 필요(규칙 15)', () => {
  const facts = factsFixture('facts-leather');
  const basis = {
    size: sizeBasisSha256([250, 255, 260, 265, 275]),
    material: materialBasisSha256(facts),
    origin: originBasisSha256(facts),
  };
  const generated = {
    productName: '제안',
    notice: { size: '새 사이즈' },
    origin: { code: '0200036', content: null, plural: false },
  };

  it('판매 사이즈가 바뀌면 notice.size에 SALE_SIZES_CHANGED, 같으면 없음', () => {
    const size = owner('notice.size', '250~275mm', sizeBasisSha256([250, 255, 260]));
    const changed = carryAssemblyFields([size], generated, basis);
    expect(changed.drafts[0]).toMatchObject({
      recheckReason: 'SALE_SIZES_CHANGED',
      recheckResolvedAt: null,
      generatedValue: '새 사이즈',
      value: '250~275mm',
    });
    expect(changed.flagged).toEqual({ SALE_SIZES_CHANGED: ['notice.size'] });
    const same = carryAssemblyFields([owner('notice.size', 'x', basis.size)], generated, basis);
    expect(same.drafts[0]!.recheckReason).toBeNull();
    expect(same.flagged).toEqual({});
  });

  it('⑥-2 결과가 바뀌면 notice.material·origin_area에 NOTICE_RAW_CHANGED, 상품명은 표시하지 않는다', () => {
    const other = { ...facts, materials: { ...facts.materials, upper: '천연가죽' } };
    const rows = [
      owner('notice.material', 'm', materialBasisSha256(other)),
      owner(
        'notice.origin_area',
        { code: '03', content: '베트남', plural: false },
        originBasisSha256({ origin: ['중국'] }),
      ),
      owner('product_name', '직접'),
    ];
    const out = carryAssemblyFields(rows, generated, basis);
    expect(out.flagged).toEqual({ NOTICE_RAW_CHANGED: ['notice.material', 'notice.origin_area'] });
    expect(out.drafts.find((d) => d.fieldKey === 'product_name')!.recheckReason).toBeNull();
  });

  it('완료 전 생성 행·목록 밖 키는 가져오지 않는다', () => {
    const generatedRow = { ...owner('notice.color', 'x'), valueSource: 'GENERATED' as const };
    expect(
      carryAssemblyFields([generatedRow, owner('copy.headline', 'y')], generated, basis).drafts,
    ).toEqual([]);
  });
});

describe('자리표시자 채우기(common/rules/detail-html — P4-01 공유)', () => {
  it('선택본이 있는 칸은 로컬 이미지 주소, 없는 칸은 뺀다', () => {
    const { row } = assemble(input(), { notice: {} });
    const filled = fillImagePlaceholders(row.html, (slot) =>
      slot === 0
        ? '/api/v1/image-assets/7/file'
        : slot === 1
          ? '/api/v1/image-assets/8/file'
          : null,
    );
    expect(filled).toContain('<img src="/api/v1/image-assets/7/file" alt="대표 이미지">');
    expect(filled).toContain('<img src="/api/v1/image-assets/8/file" alt="추가 이미지 1">');
    expect(countImagePlaceholders(filled)).toBe(0);
    expect(filled.match(/data-autostore-image-slot/g)).toHaveLength(2);
  });
});

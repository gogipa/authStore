import {
  APPROVAL_SAMPLE,
  approvalContext,
  baseApprovalInputs,
  mergePatch,
  standardOptionsInput,
} from '../../../../test/fixtures/registration/approval/approval-fixtures.js';
import { liveRegistrationCountOf } from './approval-inputs.js';
import {
  buildRegistrationDraft,
  displayStatusTypeOf,
  sellerManagementCodeOf,
  sizeOptionsOf,
  standardOptionSupportOf,
} from './registration-draft.builder.js';

describe('요청 초안 빌더(P4-02 §5 — P4-03 §4 규칙 1~4 값)', () => {
  it('판매 가능·재고 있는 사이즈 5개, 상한 2 → 옵션 5개, stockQuantity 10(시안 각 2개, 합 10개)', () => {
    const { draft } = approvalContext();
    expect(draft.options.map((o) => [o.sizeMm, o.stockQuantity])).toEqual([
      [250, 2],
      [255, 2],
      [260, 2],
      [265, 2],
      [275, 2],
    ]);
    expect(draft.stockQuantity).toBe(10);
    expect(draft.requestJson.originProduct.stockQuantity).toBe(10);
    expect(
      draft.requestJson.originProduct.detailAttribute.optionInfo.optionCombinations,
    ).toHaveLength(5);
    expect(
      draft.requestJson.originProduct.detailAttribute.optionInfo.optionCombinationGroupNames,
    ).toEqual({ optionGroupName1: '사이즈' });
  });

  it('수량 {250:5, 255:1, 260:0, 265:3}, 265는 과세 → 옵션 250(2)·255(1), stockQuantity 3', () => {
    const inputs = mergePatch(baseApprovalInputs(), {
      sourcing: {
        sizes: [
          { sizeMm: 250, status: 'IN_STOCK', quantity: 5 },
          { sizeMm: 255, status: 'IN_STOCK', quantity: 1 },
          { sizeMm: 260, status: 'IN_STOCK', quantity: 0 },
          { sizeMm: 265, status: 'IN_STOCK', quantity: 3 },
        ],
      },
      judgement: {
        sizes: {
          3: { isDutyFree: false, isSellable: false, unsellableReason: 'TAXABLE', cTaxKrw: 9000 },
        },
      },
    });
    const options = sizeOptionsOf(inputs, 2);
    expect(options.map((o) => [o.sizeMm, o.stockQuantity])).toEqual([
      [250, 2],
      [255, 1],
    ]);
    expect(buildRegistrationDraft(inputs, { optionType: 'COMBINATION' }).stockQuantity).toBe(3);
  });

  it('라쿠텐 수량을 모르면(무제한 재고) 상한을 쓴다', () => {
    const inputs = mergePatch(baseApprovalInputs(), {
      sourcing: { sizes: { 0: { quantity: null } } },
    });
    expect(sizeOptionsOf(inputs, 2)[0]).toMatchObject({ sizeMm: 250, stockQuantity: 2 });
  });

  it("판매자관리코드 itemCode 'shop-a:10000123', colorCode '108' → 'RKT:shop-a:10000123:108'(시안 값)", () => {
    expect(sellerManagementCodeOf('shop-a:10000123', '108')).toBe('RKT:shop-a:10000123:108');
    expect(sellerManagementCodeOf(null, '108')).toBeNull();
    expect(approvalContext().draft.sellerManagementCode).toBe(
      `RKT:${APPROVAL_SAMPLE.itemCode}:108`,
    );
  });

  it('전시 모드: 진행 중·등록됨 9건 SUSPENSION / 10건 ON', () => {
    expect(displayStatusTypeOf(9, 10)).toBe('SUSPENSION');
    expect(displayStatusTypeOf(10, 10)).toBe('ON');
  });

  it('전시 모드(P4-03 규칙 4): 등록됨 9 + VALIDATED 5 + 4xx 종결 3 → 9건 → SUSPENSION(드라이런·종결 제외)', () => {
    const rows = [
      ...Array.from({ length: 9 }, () => ({ status: 'REGISTERED', failedAt: null })),
      ...Array.from({ length: 5 }, () => ({ status: 'VALIDATED', failedAt: null })),
      ...Array.from({ length: 3 }, () => ({
        status: 'REGISTERING',
        failedAt: '2026-10-01T00:00:00.000Z',
      })),
      { status: 'RESULT_CHECK_REQUIRED', failedAt: '2026-10-01T00:00:00.000Z' },
    ];
    expect(liveRegistrationCountOf(rows)).toBe(9);
    expect(displayStatusTypeOf(liveRegistrationCountOf(rows), 10)).toBe('SUSPENSION');
    expect(
      liveRegistrationCountOf([...rows, { status: 'RESULT_CHECK_REQUIRED', failedAt: null }]),
    ).toBe(10);
  });

  it('표준형(F-AP-41): 지원 카테고리면 standardOptionGroups·optionStandards(옵션가 칸 없음), 아니면 조합형 모양 + 이유', () => {
    const inputs = { ...baseApprovalInputs(), standardOptions: standardOptionsInput() };
    const standard = buildRegistrationDraft(inputs, { optionType: 'STANDARD' });
    const info = standard.requestJson.originProduct.detailAttribute.optionInfo;
    expect(standard.standardOption.supported).toBe(true);
    expect(info.optionCombinations).toBeUndefined();
    expect(info.standardOptionGroups?.[0]?.groupName).toBe('사이즈');
    expect(
      info.standardOptionGroups?.[0]?.standardOptionAttributes.map((a) => a.attributeValueName),
    ).toEqual(['250', '255', '260', '265', '275']);
    expect(info.optionStandards).toEqual(
      [250, 255, 260, 265, 275].map((mm) => ({
        optionName1: String(mm),
        stockQuantity: 2,
        usable: true,
      })),
    );
    expect(standard.stockQuantity).toBe(10);
    // 조합형을 고르면 문서가 있어도 조합형
    expect(
      buildRegistrationDraft(inputs, { optionType: 'COMBINATION' }).requestJson.originProduct
        .detailAttribute.optionInfo.optionCombinations,
    ).toHaveLength(5);
    // 사이즈 목록에 없는 mm·옵션가가 있으면 못 쓴다
    expect(
      standardOptionSupportOf(
        { standardOptions: standardOptionsInput([250, 255]) },
        standard.options,
      ).reason,
    ).toContain('260, 265, 275mm');
    const priced = standard.options.map((o, i) => (i === 0 ? { ...o, optionPriceKrw: 3000 } : o));
    expect(
      standardOptionSupportOf({ standardOptions: standardOptionsInput() }, priced).reason,
    ).toContain('옵션가');
    const unsupported = buildRegistrationDraft(baseApprovalInputs(), { optionType: 'STANDARD' });
    expect(unsupported.standardOption.supported).toBe(false);
    expect(
      unsupported.requestJson.originProduct.detailAttribute.optionInfo.optionCombinations,
    ).toHaveLength(5);
  });

  it('요청 본문: SALE·INCLUDED·false·true·SHOES, 태그 ≤ 10, deliveryInfo 있음, 본문 글자에 token·secret 없음', () => {
    const { draft } = approvalContext();
    const body = draft.requestJson;
    const attr = body.originProduct.detailAttribute;
    expect(body.originProduct.statusType).toBe('SALE');
    expect(attr.customsTaxType).toBe('INCLUDED');
    expect(body.originProduct.deliveryInfo?.businessCustomsClearanceSaleYn).toBe(false);
    expect(attr.minorPurchasable).toBe(true);
    expect(attr.productInfoProvidedNotice?.productInfoProvidedNoticeType).toBe('SHOES');
    expect(attr.seoInfo.sellerTags.length).toBeLessThanOrEqual(10);
    expect(attr.seoInfo.sellerTags[0]).toEqual({ code: '7000001', text: '젤카야노14' });
    expect(attr.seoInfo.sellerTags[4]).toEqual({ text: '데일리운동화' });
    expect(body.originProduct.deliveryInfo?.deliveryFee.deliveryFeeType).toBe('FREE');
    expect(body.originProduct.deliveryInfo?.claimDeliveryInfo.shippingAddressId).toBe(100000001);
    expect(attr.sellerCodeInfo?.sellerManagementCode).toBe('RKT:shop-a:10000123:108');
    expect(body.smartstoreChannelProduct).toEqual({
      naverShoppingRegistration: true,
      channelProductDisplayStatusType: 'SUSPENSION',
    });
    expect(body.originProduct.images.representativeImage?.url).toBe(APPROVAL_SAMPLE.uploadUrls[0]);
    expect(body.originProduct.images.optionalImages).toEqual([
      { url: APPROVAL_SAMPLE.uploadUrls[1] },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/token|secret|authorization/i);
  });

  it('KC 면제면 certificationTargetExcludeContent를 넣고, 입력이 없으면 빈칸은 null(던지지 않는다)', () => {
    const kc = {
      kcCertifiedProductExclusionYn: 'KC_EXEMPTION_OBJECT',
      kcExemptionType: 'OVERSEAS',
    };
    const withKc = buildRegistrationDraft(
      mergePatch(baseApprovalInputs(), {
        category: { exceptionDecision: 'KC_EXEMPT', certificationExcludeContent: kc },
      }),
      { optionType: 'COMBINATION' },
    );
    expect(
      withKc.requestJson.originProduct.detailAttribute.certificationTargetExcludeContent,
    ).toEqual(kc);
    const empty = buildRegistrationDraft(
      { ...baseApprovalInputs(), judgement: null, assembly: null, upload: null, tags: null },
      { optionType: 'COMBINATION' },
    );
    expect(empty.requestJson.originProduct.name).toBeNull();
    expect(empty.requestJson.originProduct.salePrice).toBeNull();
    expect(empty.options).toEqual([]);
  });
});

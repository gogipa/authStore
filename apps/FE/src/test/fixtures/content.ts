import type {
  ContentAssemblyOutput,
  ContentCopyOutput,
  ContentDraftFieldItem,
  ContentFactOutput,
} from '@/features/content';

/**
 * ⑥ 상세 콘텐츠 화면 테스트 fixture(P3-03). 화면시안_명세 §4 후보 A의 예시 값(아식스 젤카야노 14 · 크림/블랙). 주소는 스킴 없이
 * 둔다(소스 규칙 15 — https 글자 금지).
 */
const AT = '2026-09-28T05:21:00.000Z';

export const COPY_DOC = {
  headline: '뒤꿈치 GEL 쿠션, 크림/블랙 젤카야노 14',
  selling_points: [
    '충격 흡수가 뛰어난 GEL 쿠션',
    '2008년 모델을 되살린 복각판',
    '크림 바탕에 블랙 라인 포인트',
  ],
  body: '러닝화 모양을 그대로 살린 복각 모델입니다. 크림 톤에 블랙 라인이 들어가 데님·슬랙스 어디에나 어울립니다.',
  fit_and_styling: '발등을 편하게 감싸는 착화감입니다.',
  size_guide: '평소 신는 운동화 사이즈를 고르세요.',
  source_facts_used: [
    'かかとにGEL搭載、衝撃緩衝性に優れる',
    '2008年発売モデルを復刻',
    'カラー：クリーム/ブラック',
  ],
};

export function contentField(
  patch: Partial<ContentDraftFieldItem> & { fieldKey: string },
): ContentDraftFieldItem {
  return {
    id: 1,
    stepRunId: 104,
    value: null,
    generatedValue: null,
    valueSource: 'GENERATED',
    extractionMethod: null,
    evidenceQuote: null,
    evidenceUrl: null,
    evidenceImageAssetId: null,
    basisItemCode: 'shop-a:10000123',
    ownerConfirmedAt: null,
    choicePending: false,
    recheckReason: null,
    recheckResolvedAt: null,
    recheckRequired: false,
    createdAt: AT,
    updatedAt: AT,
    ...patch,
  };
}

/** ⑥-1 산출물(stepRail fixture의 ⑥-1 현재 실행 id 104) */
export function contentCopyOutput(patch: Partial<ContentCopyOutput> = {}): ContentCopyOutput {
  return {
    stepRunId: 104,
    candidateId: 1,
    version: 1,
    stepRunStatus: 'COMPLETED',
    isCurrent: true,
    contentDraftCopyId: 1,
    generatedCopy: { ...COPY_DOC },
    copy: { ...COPY_DOC },
    createdAt: AT,
    fields: [],
    keepAsIsAllowed: false,
    ...patch,
  };
}

const PAGE = 'item.rakuten.co.jp/shop-a/10000123/';

/** ⑥-2 사실 필드 다섯 행(보드 예: 원산지 설명문·소재 설명문·굽높이 속성·안감 없음) */
export function factFields(): ContentDraftFieldItem[] {
  return [
    contentField({
      id: 11,
      stepRunId: 105,
      fieldKey: 'fact.origin',
      value: ['베트남'],
      generatedValue: ['베트남'],
      extractionMethod: 'DESCRIPTION_PATTERN',
      evidenceQuote: '原産国: ベトナム',
      evidenceUrl: PAGE,
    }),
    contentField({
      id: 12,
      stepRunId: 105,
      fieldKey: 'fact.material_upper',
      value: '합성섬유·합성가죽',
      extractionMethod: 'DESCRIPTION_PATTERN',
      evidenceQuote: 'アッパー:合成繊維・合成皮革',
      evidenceUrl: PAGE,
    }),
    contentField({
      id: 13,
      stepRunId: 105,
      fieldKey: 'fact.material_lining',
      value: '합성섬유',
      extractionMethod: 'AI',
      evidenceQuote: 'ライニング：合成繊維',
      evidenceUrl: PAGE,
      evidenceImageAssetId: 7,
    }),
    contentField({
      id: 14,
      stepRunId: 105,
      fieldKey: 'fact.material_sole',
      value: null,
      extractionMethod: 'NONE',
    }),
    contentField({
      id: 15,
      stepRunId: 105,
      fieldKey: 'fact.heel_height',
      value: { value: 3, unit: 'cm' },
      extractionMethod: 'SKU_ATTRIBUTE',
      evidenceQuote: 'ヒール高: 3cm',
      evidenceUrl: PAGE,
    }),
  ];
}

/** ⑥-2 산출물(stepRail fixture의 ⑥-2 현재 실행 id 105) */
export function contentFactOutput(patch: Partial<ContentFactOutput> = {}): ContentFactOutput {
  return {
    stepRunId: 105,
    candidateId: 1,
    version: 1,
    stepRunStatus: 'COMPLETED',
    isCurrent: true,
    contentDraftFactId: 1,
    sourceItemCode: 'shop-a:10000123',
    sourcePageUrl: PAGE,
    selectedColorRaw: 'クリーム/ブラック',
    createdAt: '2026-09-28T05:24:00.000Z',
    fields: factFields(),
    pendingInputs: [],
    ...patch,
  };
}

/** 구매대행 고지 블록 글(설정 템플릿을 자리표시자 값으로 채운 모양 — 화면시안_명세 §4) */
const DISCLOSURE_TEXTS: readonly [string, string, boolean][] = [
  ['HEADER', '[해외구매대행 상품 안내]', false],
  [
    'AGENCY',
    '· 이 상품은 [내 상호]가 일본 판매처에서 구매해 고객님께 보내 드리는 해외구매대행 상품입니다.',
    false,
  ],
  [
    'DELIVERY',
    '· 배송: 주문 후 약 10~20영업일이 걸립니다(현지 사정·통관에 따라 늦어질 수 있습니다).',
    false,
  ],
  ['COMBINED_TAX', '· …주문당 구매 수량을 1켤레로 제한합니다.', false],
  [
    'WITHDRAWAL',
    '· 취소·반품: …단순 변심일 때는 실제 드는 반송비(약 30,000원)를 고객님이 부담하고…',
    false,
  ],
  ['ORIGIN', '· 원산지: 제조국은 판매처 국가(일본)와 다를 수 있습니다.', false],
  [
    'LEATHER_SAFETY',
    '· 이 상품은 구매대행으로 유통되는 제품이며, 안전관리대상제품(안전기준준수대상)에 해당할 수 있습니다.',
    true,
  ],
  ['AI_IMAGE', '· 대표이미지는 AI를 기반으로 생성된 가상인물이 포함된 이미지입니다.', true],
  ['BASIS_DATE', '(기준일: 2026-09-24)', false],
];

/** ⑥-3 산출물(stepRail fixture의 ⑥-3 현재 실행 id 106, 화면시안_명세 §4 후보 A) */
export function contentAssemblyOutput(
  patch: Partial<ContentAssemblyOutput> = {},
): ContentAssemblyOutput {
  return {
    stepRunId: 106,
    candidateId: 1,
    version: 1,
    stepRunStatus: 'COMPLETED',
    isCurrent: true,
    contentDraftAssemblyId: 1,
    productName: '아식스 젤카야노14 1201A019-108 러닝화 크림 남성',
    productNameSuggestion: '아식스 젤카야노14 1201A019-108 러닝화 크림 남성',
    productNameWarnings: [],
    parallelImport: false,
    noticeFields: {
      material: '겉감 합성섬유·합성가죽 / 안감 정보 없음 / 밑창 고무',
      color: '크림/블랙',
      size: '250~265·275mm (JP 25.0~26.5·27.5cm)',
      manufacturer: '제조자: 아식스 / 수입자: [수입자]',
      caution:
        '가죽 소재는 물에 젖으면 얼룩·변색이 생길 수 있으니 젖었을 때는 그늘에서 말려 주세요.',
      warrantyPolicy: '소비자분쟁해결기준에 따름',
      afterServiceDirector: '[내 상호] / [A/S 연락처]',
      returnCostReason: '상품상세 참조',
      noRefundReason: '상품상세 참조',
      qualityAssuranceStandard: '상품상세 참조',
      compensationProcedure: '상품상세 참조',
      troubleShootingContents: '상품상세 참조',
    },
    noticeSizesMm: [250, 255, 260, 265, 275],
    originAreaCode: '0200036',
    originAreaName: '아시아>베트남',
    originAreaPlural: false,
    originAreaContent: null,
    importer: '[수입자]',
    specBlockHtml:
      '<div data-autostore-section="SPEC"><p><strong>[상품 사양]</strong></p><ul><li data-spec-row="ORIGIN">· 제조국(원산지): 베트남</li><li data-spec-row="MATERIAL">· 소재: 겉감 합성섬유·합성가죽 / 밑창 고무</li><li data-spec-row="HEIGHT">· 굽·밑창 높이: 약 3cm</li><li data-spec-row="SIZE">· 사이즈: 250~265·275mm (JP 25.0~26.5·27.5cm)</li></ul></div>',
    specOriginLabel: '베트남',
    disclosureTemplateVersion: 'M1-2026-09-24',
    disclosureTemplateDate: '2026-09-24',
    disclosureBlockIds: DISCLOSURE_TEXTS.map(([id]) => id),
    disclosureBlocks: DISCLOSURE_TEXTS.map(([blockId, text, conditional]) => ({
      blockId,
      sha256: 'a'.repeat(64),
      conditional,
      text,
    })),
    disclosureTemplateMatched: true,
    htmlSha256: 'b'.repeat(64),
    previewUrl: '/api/v1/candidates/1/content-assembly/preview?stepRunId=106',
    createdAt: '2026-09-28T05:32:00.000Z',
    fields: [],
    linterResult: null,
    linterBlockingCount: null,
    ...patch,
  };
}

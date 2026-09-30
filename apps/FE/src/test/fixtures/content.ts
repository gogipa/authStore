import type {
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

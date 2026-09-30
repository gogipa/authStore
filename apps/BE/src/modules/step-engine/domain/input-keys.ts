import { PROFILE_INPUT_KEY_LABEL } from '../../settings/purchase-agency-profile/profile-input-keys.js';

/**
 * 입력 키(step_run_input.input_key, candidate_step.stale_inputs)와 화면 이름. ERD step_run_input '코드 상수로 관리'.
 *
 * 이름 규칙(P1-05 Proposed):
 * - `candidate.*`: 후보 필드(성별·검색어·URL·앵커 키·시드 키워드)
 * - `<단계>.*`: 앞 단계 산출물(`sourcing.*`=②, `pricing.*`=③, `category.*`=④, `thumbnail.*`=⑤, `copy.*`=⑥-1,
 *   `noticeRaw.*`=⑥-2, `noticeHtml.*`=⑥-3, `tags.*`=⑦, `upload.*`=⑧)
 * - `owner.*`: 오너 입력(실행 중 입력과, URL 후보 ③ 쿠폰·⑦ 경쟁 태그처럼 오너가 넣는 시작 조건)
 * - `settings.<설정 키 경로>`: 설정 파일 값(예 `settings.costs`, `settings.sourcing.minSizeCount`). 설정 변경 전파가
 *   바뀐 키(`costs.targetMarginPct`)와 이 경로를 앞부분 일치로 맞춘다
 * - `profile.<필드>`: 구매대행 프로필 값(P1-09, 예 `profile.importer`, source_type SETTINGS). 이름과 읽는 단계는
 *   settings/purchase-agency-profile/profile-input-keys.ts가 정하고, 프로필 저장 전파는 이름을 정확히 맞춘다
 * - `fx.*`·`forwarder.rateTable`: ③이 읽는 판정 기준 데이터(P2-04, source_type SETTINGS). 환율 3종(pricing
 *   `FX_INPUT_KEYS`)과 활성 요금표(settings `RATE_TABLE_INPUT_KEY`). 새 최신 환율·활성 요금표 교체 전파는 이름과
 *   **값 해시**를 함께 맞춘다(같은 값이면 재실행 필요가 되지 않는다)
 * 64자 이하(varchar(64)). FE `features/step-engine/model/inputLabels.ts`가 같은 표를 쓴다.
 */
export const INPUT_KEYS = {
  // 후보 필드
  candidateGender: 'candidate.gender',
  candidateRakutenQuery: 'candidate.rakutenQuery',
  candidateSourceUrl: 'candidate.sourceUrl',
  candidateAnchorKey: 'candidate.anchorKey',
  candidateSeedKeyword: 'candidate.seedKeyword',
  // ② 소싱 산출물
  sourcingTargetSkus: 'sourcing.targetSkus',
  sourcingGenre: 'sourcing.genre',
  sourcingImages: 'sourcing.images',
  sourcingItemText: 'sourcing.itemText',
  sourcingSkuAttributes: 'sourcing.skuAttributes',
  sourcingSelection: 'sourcing.selection',
  sourcingAttributes: 'sourcing.attributes',
  sourcingSelectedColor: 'sourcing.selectedColor',
  sourcingModelInfo: 'sourcing.modelInfo',
  // ③~⑧ 산출물
  pricingSaleSizes: 'pricing.saleSizes',
  pricingJudgement: 'pricing.judgement',
  categoryLeafPath: 'category.leafPath',
  thumbnailSelection: 'thumbnail.selection',
  copyDraft: 'copy.draft',
  noticeRawFacts: 'noticeRaw.facts',
  noticeHtmlHtml: 'noticeHtml.html',
  tagsFinal: 'tags.final',
  uploadResult: 'upload.result',
  // 오너 입력
  ownerDomesticPrice: 'owner.domesticPrice',
  ownerCoupon: 'owner.coupon',
  ownerReferenceSelection: 'owner.referenceSelection',
  ownerSearchKeyword: 'owner.searchKeyword',
  ownerFaceOption: 'owner.faceOption',
  ownerPromptAdjustment: 'owner.promptAdjustment',
  ownerCompetitorTags: 'owner.competitorTags',
  // 설정(그 단계가 읽는 키만)
  settingsCosts: 'settings.costs',
  settingsPricing: 'settings.pricing',
  settingsNotice: 'settings.notice',
  settingsTargetSizeMm: 'settings.sourcing.targetSizeMm',
  settingsMinSizeCount: 'settings.sourcing.minSizeCount',
  settingsDefaultWidth: 'settings.sourcing.defaultWidth',
  settingsExcludeBackOrder: 'settings.sourcing.excludeBackOrder',
  settingsDefaultShippingYen: 'settings.sourcing.defaultShippingYen',
  // 판정 기준 데이터(P2-04)
  fxCostJpy: 'fx.costJpy',
  fxCustomsJpy: 'fx.customsJpy',
  fxCustomsUsd: 'fx.customsUsd',
  forwarderRateTable: 'forwarder.rateTable',
} as const;

export type InputKey = (typeof INPUT_KEYS)[keyof typeof INPUT_KEYS];

/** 설정 입력 키 접두사 */
export const SETTINGS_INPUT_PREFIX = 'settings.';

/** 입력 키 → 화면 이름('재실행 필요' 사유·시작 조건 오류 문구·레일 입력 출처) */
export const INPUT_KEY_LABEL: Readonly<Record<string, string>> = {
  'candidate.gender': '성별',
  'candidate.rakutenQuery': '검색어',
  'candidate.sourceUrl': '상품 URL',
  'candidate.anchorKey': '앵커 키',
  'candidate.seedKeyword': '시드 키워드',
  'sourcing.targetSkus': '② 목표 사이즈 SKU가·재고',
  'sourcing.genre': '② 장르·상품유형',
  'sourcing.images': '② 원본 이미지',
  'sourcing.itemText': '② 상품명·설명',
  'sourcing.skuAttributes': '② SKU 속성',
  'sourcing.selection': '② 소싱 선택',
  'sourcing.attributes': '② 속성·스펙 이미지',
  'sourcing.selectedColor': '② 선택 색상',
  'sourcing.modelInfo': '② 모델명·상품유형',
  'pricing.saleSizes': '③ 판매 사이즈',
  'pricing.judgement': '③ 판정 결과',
  'category.leafPath': '④ 리프 카테고리',
  'thumbnail.selection': '⑤ 선택본',
  'copy.draft': '⑥-1 카피',
  'noticeRaw.facts': '⑥-2 원산지·소재',
  'noticeHtml.html': '⑥-3 HTML',
  'tags.final': '⑦ 최종 태그',
  'upload.result': '⑧ 업로드 결과',
  'owner.domesticPrice': '국내 기준가',
  'owner.coupon': '쿠폰',
  'owner.referenceSelection': '레퍼런스 선택',
  'owner.searchKeyword': '검색어 직접 입력',
  'owner.faceOption': '얼굴 옵션',
  'owner.promptAdjustment': '프롬프트 조정',
  'owner.competitorTags': '경쟁 태그',
  'settings.costs': '비용 설정',
  'settings.pricing': '가격 설정',
  'settings.notice': '고시 설정',
  'settings.sourcing.targetSizeMm': '목표 사이즈 범위 설정',
  'settings.sourcing.minSizeCount': '최소 사이즈 수 설정',
  'settings.sourcing.defaultWidth': '기본 폭 설정',
  'settings.sourcing.excludeBackOrder': '取り寄せ 제외 설정',
  'settings.sourcing.defaultShippingYen': '기본 송료 설정',
  // 판정 기준 데이터(P2-04)
  'fx.costJpy': '원가 환율',
  'fx.customsJpy': '과세환율(엔)',
  'fx.customsUsd': '과세환율(달러)',
  'forwarder.rateTable': '배대지 요금표',
  // 구매대행 프로필(P1-09)
  ...PROFILE_INPUT_KEY_LABEL,
};

/** 입력 키의 화면 이름. 표에 없는 설정 키는 '설정 {경로}', 그 밖에는 키 그대로 */
export function inputKeyLabel(key: string): string {
  const label = INPUT_KEY_LABEL[key];
  if (label) return label;
  if (key.startsWith(SETTINGS_INPUT_PREFIX))
    return `설정 ${key.slice(SETTINGS_INPUT_PREFIX.length)}`;
  return key;
}

/** 설정 입력 키(`settings.a.b`) → 설정 키 경로(`a.b`). 설정 키가 아니면 null */
export function settingsPathOf(inputKey: string): string | null {
  return inputKey.startsWith(SETTINGS_INPUT_PREFIX)
    ? inputKey.slice(SETTINGS_INPUT_PREFIX.length)
    : null;
}

/**
 * 바뀐 설정 키(`costs.targetMarginPct`, P1-03 `diffSettingsKeys`)가 이 설정 입력 키의 값을 바꾸는가.
 * 입력이 섹션 전체(`settings.costs`)를 읽으면 그 아래 키가 바뀌어도, 입력이 한 키를 읽는데 섹션이 통째로 바뀌어도 맞다.
 */
export function settingsKeyAffects(changedKey: string, inputKey: string): boolean {
  const path = settingsPathOf(inputKey);
  if (path === null) return false;
  return (
    path === changedKey || path.startsWith(`${changedKey}.`) || changedKey.startsWith(`${path}.`)
  );
}

/** 설정 파일 값 읽기(점 경로). 없으면 undefined */
export function readSettingsPath(settings: unknown, path: string): unknown {
  let value: unknown = settings;
  for (const part of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

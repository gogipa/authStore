/**
 * 입력 키(step_run_input.input_key·candidate_step.stale_inputs) → 화면 이름. BE `domain/input-keys.ts`와 같은 표다(P1-05).
 * '재실행 필요' 사유('바뀐 입력: 레퍼런스 선택')·시작 조건·입력 출처에 쓴다. 모르는 설정 키는 '설정 {경로}', 그 밖은 키 그대로.
 */
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
  // 판정 기준 데이터(P2-04, BE step-engine/domain/input-keys.ts와 같은 표) — 새 최신 환율·활성 요금표 교체
  'fx.costJpy': '원가 환율',
  'fx.customsJpy': '과세환율(엔)',
  'fx.customsUsd': '과세환율(달러)',
  'forwarder.rateTable': '배대지 요금표',
  // 구매대행 프로필(P1-09, BE settings/purchase-agency-profile/profile-input-keys.ts와 같은 표)
  'profile.overseasShippingCommerceAddressbookId': '프로필 해외 출고지',
  'profile.returnCommerceAddressbookId': '프로필 반품·교환지',
  'profile.dispatchDeliveryCompanyCode': '프로필 발송 택배사',
  'profile.commerceReturnDeliveryCompanyId': '프로필 반품 택배사',
  'profile.returnFeeKrw': '프로필 반품비',
  'profile.exchangeFeeKrw': '프로필 교환비',
  'profile.businessName': '프로필 상호',
  'profile.afterServicePhone': '프로필 A/S 연락처',
  'profile.afterServiceGuide': '프로필 A/S 안내',
  'profile.importer': '프로필 수입자',
  'profile.noticeFixedTexts': '프로필 고시 고정 문구',
  'profile.maxPurchaseQuantityPerOrder': '프로필 주문당 최대 구매수량',
};

const SETTINGS_PREFIX = 'settings.';

export function inputKeyLabel(key: string): string {
  const label = INPUT_KEY_LABEL[key];
  if (label) return label;
  if (key.startsWith(SETTINGS_PREFIX)) return `설정 ${key.slice(SETTINGS_PREFIX.length)}`;
  return key;
}

/** 바뀐 입력 이름 목록 → '레퍼런스 선택, 국내 기준가' */
export function inputKeyLabels(keys: readonly string[]): string {
  return keys.map(inputKeyLabel).join(', ');
}

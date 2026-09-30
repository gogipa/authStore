/**
 * 레퍼런스 이미지와 후보 앵커 키 비교(05-2 `ThumbnailSourceImage.isSameAnchor`·`ThumbnailReferenceItem.isSameAnchor`,
 * F-TH-15 '같은 상품·색상' 확인의 근거) — 순수 함수. P3-02 `sameProductColorRequired`·G3도 같은 함수를 쓴다.
 *
 * 규칙(P3-01 Proposed — 문서에 '型番·색상 코드와 앵커 키를 비교'만 있다, 오너 검토):
 * - 상품: 후보 앵커 型番이 있고 이미지 출처 型番(`source_model_code_norm`)이 있으면 둘을 정규화해(NFKC·대문자·공백·하이픈 제거)
 *   비교한다. 아니면 앵커 itemCode와 이미지 출처 itemCode를 비교한다. 비교할 값이 없으면 같지 않다(false)
 * - 색상: 앵커 색상 코드와 이미지 색상 코드(`source_color_code`)가 **둘 다 있을 때만** 비교한다. 이미지 색상을 모르면(한
 *   상품에 색상이 여럿) 상품 비교로만 정한다 — 색상은 G3 체크리스트 '색상이 선택 색상과 같음'이 따로 본다
 * - 앵커가 아직 없으면(확정 전) false
 */

export interface AnchorKeyFields {
  anchorModelCode: string | null;
  anchorItemCode: string | null;
  anchorColorCode: string | null;
}

export interface ImageAnchorFields {
  sourceItemCode: string | null;
  sourceModelCodeNorm: string | null;
  sourceColorCode: string | null;
}

/** 型番·색상 코드 비교용 정규화: NFKC → 대문자 → 공백·하이픈 제거. 비면 null */
export function normalizeAnchorCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const norm = code
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-‐‑‒–—―]/g, '');
  return norm === '' ? null : norm;
}

export function isSameAnchor(anchor: AnchorKeyFields, image: ImageAnchorFields): boolean {
  const anchorModel = normalizeAnchorCode(anchor.anchorModelCode);
  const imageModel = normalizeAnchorCode(image.sourceModelCodeNorm);
  let sameProduct: boolean;
  if (anchorModel && imageModel) {
    sameProduct = anchorModel === imageModel;
  } else if (anchor.anchorItemCode && image.sourceItemCode) {
    sameProduct = anchor.anchorItemCode === image.sourceItemCode;
  } else {
    return false;
  }
  if (!sameProduct) return false;
  const anchorColor = normalizeAnchorCode(anchor.anchorColorCode);
  const imageColor = normalizeAnchorCode(image.sourceColorCode);
  return anchorColor && imageColor ? anchorColor === imageColor : true;
}

/**
 * G3 '같은 상품·색상' 확인이 필요한 레퍼런스인가(F-TH-15, P3-02 규칙 10, ERD `image_asset.source_color_code` '모르면 G3
 * 확인으로 대신한다'): 후보 앵커 키와 다르거나(`isSameAnchor` = false) 이미지의 색상 코드를 모르면 true. `isSameAnchor`는 그대로
 * 둔다(색상을 모르면 상품만 본다 — 원본 목록의 '같은 앵커' 표시). 레퍼런스 저장 응답·⑤ 산출물·G3 검사가 이 함수 하나를 쓴다.
 */
export function needsSameProductColorConfirmation(
  anchor: AnchorKeyFields,
  image: ImageAnchorFields,
): boolean {
  return !isSameAnchor(anchor, image) || normalizeAnchorCode(image.sourceColorCode) === null;
}

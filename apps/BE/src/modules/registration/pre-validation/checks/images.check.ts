import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { imageSourcesOf, resultOf, type CheckProblem } from './check-helpers.js';

/** 업로드본 크기(F-AP-12 — ⑧이 1000×1000 JPEG로 정규화한다) */
export const UPLOAD_IMAGE_SIZE_PX = 1000;
/** 추가이미지 최대 장수(G3 규칙·R04 §2.11 optionalImages 최대 9) */
export const ADDITIONAL_IMAGE_MAX = 9;

/**
 * `IMAGES`(F-AP-12, PRD §8.7 이미지 행, P4-02 규칙 4): 요청 초안과 최종 `detailContent`의 모든 이미지 URL이 `uploaded_image.url`에
 * 있다(UNIQUE url 역조회 — `knownUploadUrls`). 대표 정확히 1장, 추가 9장 이하, 업로드본은 1000×1000, 업로드본과 그 원천 사슬에
 * '참조 전용'(REFERENCE_ONLY) 파일이 없다.
 */
export function imagesCheck(ctx: PreValidationContext): PreValidationCheck {
  const upload = ctx.inputs.upload;
  if (!upload) {
    return resultOf('IMAGES', [{ message: '⑧ 업로드 결과가 없습니다', stepCode: 'UPLOAD' }]);
  }
  const problems: CheckProblem[] = [];
  const representatives = upload.images.filter((image) => image.role === 'REPRESENTATIVE').length;
  const additional = upload.images.filter((image) => image.role === 'ADDITIONAL').length;
  if (representatives !== 1) {
    problems.push({
      message: `대표이미지가 ${representatives}장입니다(정확히 1장)`,
      stepCode: 'THUMBNAIL',
      gateCode: 'G3',
    });
  }
  if (additional > ADDITIONAL_IMAGE_MAX) {
    problems.push({
      message: `추가이미지가 ${additional}장입니다(${ADDITIONAL_IMAGE_MAX}장 이하)`,
      stepCode: 'THUMBNAIL',
      gateCode: 'G3',
    });
  }
  const product = ctx.draft.requestJson.originProduct;
  const urls = [
    ...(product.images.representativeImage ? [product.images.representativeImage.url] : []),
    ...product.images.optionalImages.map((image) => image.url),
    ...imageSourcesOf(product.detailContent),
  ];
  const known = new Set(ctx.inputs.knownUploadUrls);
  const unknown = [...new Set(urls.filter((url) => !known.has(url)))];
  if (unknown.length > 0) {
    problems.push({
      message: `업로드 API가 준 주소가 아닌 이미지가 ${unknown.length}개 있습니다`,
      stepCode: 'UPLOAD',
    });
  }
  const wrongSize = upload.images.filter(
    (image) => image.width !== UPLOAD_IMAGE_SIZE_PX || image.height !== UPLOAD_IMAGE_SIZE_PX,
  );
  if (wrongSize.length > 0) {
    problems.push({
      message: `1000×1000이 아닌 업로드본이 있습니다(${wrongSize
        .map((image) => `${image.width}×${image.height}`)
        .join(', ')})`,
      stepCode: 'UPLOAD',
    });
  }
  if (upload.images.some((image) => image.referenceOnlyInChain)) {
    problems.push({
      message: "'참조 전용' 원본·레퍼런스에서 나온 이미지가 있습니다",
      stepCode: 'THUMBNAIL',
      gateCode: 'G3',
    });
  }
  return resultOf('IMAGES', problems);
}

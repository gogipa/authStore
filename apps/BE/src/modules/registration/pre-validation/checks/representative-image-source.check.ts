import { needsSameProductColorConfirmation } from '../../../../common/rules/anchor-key.js';
import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { resultOf, type CheckProblem } from './check-helpers.js';

/**
 * `REPRESENTATIVE_IMAGE_SOURCE`(F-AP-22, PRD §5.1 G3·§8.7 대표이미지 행, IM-06, P4-02 규칙 12): ⑤ 현재 버전 `thumbnail_selection`의
 * 체크리스트가 모두 true다(색상 일치 포함 — 해석은 thumbnails `uncheckedKeys`). 레퍼런스 가운데 출처 앵커 키(`image_asset`
 * `source_model_code_norm`·`source_color_code`)가 후보 앵커 키와 다르거나 색상 코드를 모르는 것이 있으면(공용
 * `needsSameProductColorConfirmation` — G3 검사와 같은 함수) `same_product_color_confirmed_at`이 있어야 한다.
 */
export function representativeImageSourceCheck(ctx: PreValidationContext): PreValidationCheck {
  const thumbnail = ctx.inputs.thumbnail;
  if (!thumbnail) {
    return resultOf('REPRESENTATIVE_IMAGE_SOURCE', [
      { message: '⑤ 썸네일 선택(G3) 기록이 없습니다', stepCode: 'THUMBNAIL', gateCode: 'G3' },
    ]);
  }
  const problems: CheckProblem[] = [];
  if (thumbnail.uncheckedChecklistKeys.length > 0) {
    problems.push({
      message: `G3 체크리스트가 끝나지 않았습니다(${thumbnail.uncheckedChecklistKeys.length}개 미확인)`,
      stepCode: 'THUMBNAIL',
      gateCode: 'G3',
    });
  }
  const { candidate } = ctx.inputs;
  const anchor = {
    anchorModelCode: candidate.anchorModelCode,
    anchorItemCode: candidate.anchorItemCode,
    anchorColorCode: candidate.anchorColorCode,
  };
  const other = thumbnail.references.filter((ref) =>
    needsSameProductColorConfirmation(anchor, ref),
  );
  if (other.length > 0 && !thumbnail.sameProductColorConfirmedAt) {
    problems.push({
      message: `다른 상품·색상(또는 색상을 모르는) 레퍼런스 ${other.length}장을 썼는데 '같은 상품·색상' 확인이 없습니다`,
      stepCode: 'THUMBNAIL',
      gateCode: 'G3',
    });
  }
  return resultOf('REPRESENTATIVE_IMAGE_SOURCE', problems);
}

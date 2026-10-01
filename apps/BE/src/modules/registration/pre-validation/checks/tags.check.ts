import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { quoted, resultOf, type CheckProblem } from './check-helpers.js';

/** 최종 태그 최대 개수(F-AP-14, `seoInfo.sellerTags` 10개 이하) */
export const FINAL_TAG_MAX = 10;

/**
 * `TAGS`(F-AP-14, US-20 AC1·AC2, P4-02 규칙 6): 최종 태그(⑦ 현재 버전)가 10개 이하이고, 승인 화면을 열 때와 승인 직전에 커머스API
 * `restricted-tags`로 다시 확인해 제한 태그가 없다. 조회가 실패하면 이 항목만 실패(사유에 원인)로 두고 전체는 200이다
 * (05-2 x-decision §7.5-37). 외부 조회 결과는 `ctx.restrictedTags`로 받는다(미리보기는 null — 개수만 본다).
 */
export function tagsCheck(ctx: PreValidationContext): PreValidationCheck {
  const tags = ctx.inputs.tags;
  if (!tags) {
    return resultOf('TAGS', [{ message: '⑦ 최종 태그를 읽지 못했습니다', stepCode: 'TAGS' }]);
  }
  const problems: CheckProblem[] = [];
  if (tags.tags.length > FINAL_TAG_MAX) {
    problems.push({
      message: `최종 태그가 ${tags.tags.length}개입니다(${FINAL_TAG_MAX}개 이하)`,
      stepCode: 'TAGS',
    });
  }
  const lookup = ctx.restrictedTags;
  if (lookup && !lookup.ok) {
    problems.push({
      message: `제한 태그를 확인하지 못했습니다(${lookup.reason})`,
      stepCode: 'TAGS',
    });
  } else if (lookup?.ok) {
    const restricted = new Set(lookup.restrictedTags);
    const hit = tags.tags.map((tag) => tag.text).filter((text) => restricted.has(text));
    if (hit.length > 0) {
      problems.push({ message: `제한 태그가 있습니다(${quoted(hit)})`, stepCode: 'TAGS' });
    }
  }
  return resultOf('TAGS', problems);
}

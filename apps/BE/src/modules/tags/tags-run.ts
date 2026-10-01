import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import type { AppSettings } from '../settings/schema/settings.types.js';
import type { StepOutcome } from '../step-engine/contracts/step-runner.js';
import type { TagRuleContext } from './pipeline/rule-filter.js';
import type { TagSetDraft } from './tag-set.store.js';
import { productTypeOf, type TagsRunInputs } from './tags-sources.js';

/** ⑦ 실행 결과(엔진은 해석하지 않고 `persist`에 넘긴다) */
export interface TagsOutput {
  kind: 'TAG_SET';
  draft: TagSetDraft;
}

export function isTagsOutput(value: unknown): value is TagsOutput {
  return (value as { kind?: unknown } | null)?.kind === 'TAG_SET';
}

/** 규칙 필터 문맥(입력 값 + 설정 사전) */
export function ruleContextOf(
  inputs: TagsRunInputs,
  settings: Readonly<AppSettings>,
): TagRuleContext {
  const productType = productTypeOf(inputs.modelInfo, inputs.leaf);
  return {
    categoryPath: inputs.leaf?.wholeCategoryName ?? null,
    gender: inputs.gender,
    ownBrand: inputs.modelInfo?.brand ?? null,
    productContext: [inputs.seed, productType, inputs.leaf?.wholeCategoryName]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' '),
    rules: settings.tags.rules,
  };
}

/** ⑦ 외부 호출 실패 → 실행 실패(EXTERNAL_API, 오류 코드·문구 그대로 — 키 없음·인증 실패·관문 오류 포함) */
export function externalFailure(error: unknown): StepOutcome | null {
  if (!(error instanceof ApiException)) return null;
  return {
    kind: 'FAILED',
    failureKind: 'EXTERNAL_API',
    errorCode: error.code,
    errorMessage: error.message,
  };
}

export function inputFailure(errorCode: string, errorMessage: string): StepOutcome {
  return { kind: 'FAILED', failureKind: 'INPUT_VALIDATION', errorCode, errorMessage };
}

/** 커머스API 키 확인(P3-05 — P4-01이 common으로 옮겼다. 이 이름 그대로 다시 내보낸다) */
export { assertCommerceKeys } from '../../common/secrets/assert-commerce-keys.js';

/** 아직 ⑦을 실행하지 않았다(조회·편집 바탕) */
export function tagsOutputNotFound(): ApiException {
  return new ApiException('STEP_OUTPUT_NOT_FOUND', {
    message: formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: '⑦ 태그' }),
    details: { stepCode: 'TAGS' },
  });
}

import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import {
  COMMERCE_SECRET_KEYS,
  secretKeysLabel,
  type CommerceSecretKey,
} from '../../common/secrets/secret-keys.js';
import type { SecretStore } from '../../common/secrets/secret-store.port.js';
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

/**
 * 커머스API 키(client_id·client_secret)가 키체인에 있는지(값은 쓰지 않는다). 없으면 409 SECRET_NOT_CONFIGURED
 * (`details.secretKeys`) — ⑦ 시작 전·태그 편집 받기 전에 본다(P3-05 Proposed: 실행 실패가 아니라 409로 막는다).
 * 키체인 오류는 저장소가 503 KEYCHAIN_UNAVAILABLE로 던진다
 */
export async function assertCommerceKeys(secrets: SecretStore): Promise<void> {
  const values = await Promise.all(COMMERCE_SECRET_KEYS.map((key) => secrets.get(key)));
  const missing: CommerceSecretKey[] = COMMERCE_SECRET_KEYS.filter((_, i) => !values[i]);
  if (missing.length === 0) return;
  throw new ApiException('SECRET_NOT_CONFIGURED', {
    message: formatErrorMessage('SECRET_NOT_CONFIGURED', { '키 이름': secretKeysLabel(missing) }),
    details: { secretKeys: missing },
  });
}

/** 아직 ⑦을 실행하지 않았다(조회·편집 바탕) */
export function tagsOutputNotFound(): ApiException {
  return new ApiException('STEP_OUTPUT_NOT_FOUND', {
    message: formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: '⑦ 태그' }),
    details: { stepCode: 'TAGS' },
  });
}

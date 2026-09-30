import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import { AI_ENGINE_LABEL } from '../../integrations/ai-engine/ai-engine.constants.js';
import { AI_ENGINE_CODES, type AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';
import type { AiEngineModelPair, AiSettings } from '../schema/settings.types.js';
import {
  AI_ENGINE_ALLOW_CUSTOM_MODEL,
  AI_MODEL_MAX_LENGTH,
  modelOptionsOf,
} from './ai-engine-options.js';

/** 비어 있는 모델의 `{모델}` 자리(Proposed P1-11) */
export const EMPTY_MODEL_TEXT = '(비어 있음)';

/** 직접 입력 모델(CODEX): 공백 없는 1~100자(Proposed P1-11 — `--model` 값 하나) */
const CUSTOM_MODEL = new RegExp(`^\\S{1,${AI_MODEL_MAX_LENGTH}}$`);

export type AiModelKind = keyof AiEngineModelPair;
const MODEL_KINDS: readonly AiModelKind[] = ['text', 'vision'];

/** 모델 값 하나가 그 엔진에서 쓸 수 있는가(규칙 3). CLAUDE 별칭 3개, AGY 목록 안, CODEX 직접 입력 */
export function isAllowedAiModel(
  engine: AiEngineCode,
  value: string,
  agyListed: readonly string[] | null,
): boolean {
  if (AI_ENGINE_ALLOW_CUSTOM_MODEL[engine]) return CUSTOM_MODEL.test(value);
  return modelOptionsOf(engine, agyListed).includes(value);
}

/** 422 AI_MODEL_INVALID 한 칸(05-3 문구) */
export function aiModelFieldError(
  field: string,
  engine: AiEngineCode,
  value: string | null,
): FieldError {
  return {
    field,
    message: formatErrorMessage('AI_MODEL_INVALID', {
      엔진: AI_ENGINE_LABEL[engine],
      모델: value ?? EMPTY_MODEL_TEXT,
    }),
  };
}

export interface ValidateAiModelsInput {
  selectedEngine: AiEngineCode;
  models: Readonly<Record<AiEngineCode, AiEngineModelPair>>;
  /** 현재 설정의 ai 섹션. 여기 값과 같은 칸은 목록 검사를 건너뛴다(없으면 모두 검사) */
  current: Readonly<AiSettings> | null;
  /** `agy models` 캐시(없으면 null — 기본 모델로 검사) */
  agyListed: readonly string[] | null;
}

/**
 * PUT /settings/ai-engine 모델 검사(P1-11 규칙 3, F-ST-30, R12). 어긋난 칸마다 `models.{엔진}.text|vision`.
 * - 선택 엔진의 텍스트·비전 모델이 null이면 오류(연결 테스트·단계 실행에 `--model`이 필요하다)
 * - 다른 엔진의 null은 받는다(아직 정하지 않음)
 * - 값이 현재 설정과 같으면 목록 검사를 건너뛴다(Proposed: `agy models` 목록이 바뀌어도 다른 엔진 저장이 막히지 않게)
 * - 그 밖은 `isAllowedAiModel`
 */
export function validateAiModels(input: ValidateAiModelsInput): FieldError[] {
  const errors: FieldError[] = [];
  for (const engine of AI_ENGINE_CODES) {
    for (const kind of MODEL_KINDS) {
      const value = input.models[engine][kind];
      const field = `models.${engine}.${kind}`;
      if (value === null) {
        if (engine === input.selectedEngine) errors.push(aiModelFieldError(field, engine, null));
        continue;
      }
      if (input.current?.models[engine]?.[kind] === value) continue;
      if (!isAllowedAiModel(engine, value, input.agyListed)) {
        errors.push(aiModelFieldError(field, engine, value));
      }
    }
  }
  return errors;
}

/** 422 AI_MODEL_INVALID(message = 첫 칸 문구, fieldErrors = 모든 칸) */
export function aiModelInvalidException(errors: readonly FieldError[]): ApiException {
  return new ApiException('AI_MODEL_INVALID', {
    message: errors[0]?.message,
    fieldErrors: [...errors],
  });
}

import type { components } from '@/shared/api/schema';
import { AI_ENGINE_LABEL } from '@/shared/lib/aiEngine';

export type SettingsView = components['schemas']['SettingsView'];
export type SettingsReloadResult = components['schemas']['SettingsReloadResult'];
export type SettingsFieldError = components['schemas']['FieldError'];
export type AiEngineCode = components['schemas']['AiEngineCode'];

/**
 * 05-2는 `content`를 열린 객체로 둔다. 화면이 읽는 칸만 여기서 안전하게 꺼낸다(없거나 모양이 다르면 null).
 * 키 이름·표기는 BE 설정 스키마(apps/BE/src/modules/settings/schema)와 같다: 비율은 퍼센트 수(2.5 = 2.5%).
 */
type Content = SettingsView['content'] | undefined;

function pick(content: Content, path: readonly string[]): unknown {
  let node: unknown = content;
  for (const key of path) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function numberAt(content: Content, path: readonly string[]): number | null {
  const value = pick(content, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringAt(content: Content, path: readonly string[]): string | null {
  const value = pick(content, path);
  return typeof value === 'string' ? value : null;
}

/** 셀러 부가세 모드 표시(Settings 보드 'A 대행수수료 과세'). B·C 문구는 Proposed. */
export const VAT_MODE_LABEL: Readonly<Record<string, string>> = {
  A: 'A 대행수수료 과세',
  B: 'B 총액 과세',
  C: 'C 부가세 없음',
};

/** '적용 중인 기본값' 비용 칸(Settings 보드). 값이 없으면 null(화면은 '—'). */
export interface AppliedCostDefaults {
  cardSurchargePct: number | null;
  saleFeePct: number | null;
  npayFeePct: number | null;
  miscCostKrw: number | null;
  targetMarginPct: number | null;
  minProfitKrw: number | null;
  vatMode: string | null;
}

export function readAppliedCostDefaults(content: Content): AppliedCostDefaults {
  const grade = stringAt(content, ['costs', 'npayFeeGrade']);
  return {
    cardSurchargePct: numberAt(content, ['costs', 'cardSurchargePct']),
    saleFeePct: numberAt(content, ['costs', 'saleFeePct']),
    npayFeePct: grade === null ? null : numberAt(content, ['costs', 'npayFeePctByGrade', grade]),
    miscCostKrw: numberAt(content, ['costs', 'miscCostKrw']),
    targetMarginPct: numberAt(content, ['costs', 'targetMarginPct']),
    minProfitKrw: numberAt(content, ['costs', 'minProfitKrw']),
    vatMode: stringAt(content, ['costs', 'vatMode']),
  };
}

/** 과세 사이즈 판매(F-ST-02). 모르면 null. */
export function readSellTaxableSizes(content: Content): boolean | null {
  const value = pick(content, ['pricing', 'sellTaxableSizes']);
  return typeof value === 'boolean' ? value : null;
}

/** 엔진 화면 이름(05-2 AiEngineOption.displayName). 원본은 shared/lib/aiEngine(P1-10)의 AI_ENGINE_LABEL */
export const AI_ENGINE_DISPLAY_NAME: Readonly<Record<AiEngineCode, string>> = AI_ENGINE_LABEL;

function isAiEngineCode(value: unknown): value is AiEngineCode {
  return typeof value === 'string' && value in AI_ENGINE_DISPLAY_NAME;
}

/** 선택 엔진과 그 텍스트 모델(`content.ai`, D-16). 'AI 엔진' 링크 카드가 쓴다. */
export interface SelectedAiEngine {
  engine: AiEngineCode;
  displayName: string;
  textModel: string | null;
}

export function readSelectedAiEngine(content: Content): SelectedAiEngine | null {
  const engine = pick(content, ['ai', 'engine']);
  if (!isAiEngineCode(engine)) return null;
  return {
    engine,
    displayName: AI_ENGINE_DISPLAY_NAME[engine],
    textModel: stringAt(content, ['ai', 'models', engine, 'text']),
  };
}

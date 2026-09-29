import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AppSettings } from '../schema/settings.types.js';

/**
 * 기본 템플릿 파일(settings.default.json). 첫 실행에 설정 파일이 없으면 이 파일을 그대로 복사해 만든다(Proposed).
 * 일반 기본값(비용·소싱·안전 기준)과 개인 값 자리표시자만 둔다(F-BS-03, US-37 AC3).
 * 빌드(dist)에는 nest-cli.json assets로 같은 상대 위치에 복사된다.
 */
export const DEFAULT_SETTINGS_FILE = fileURLToPath(
  new URL('./settings.default.json', import.meta.url),
);

/** 기본 템플릿 원문(파일 그대로) */
export function readDefaultSettingsText(): string {
  return readFileSync(DEFAULT_SETTINGS_FILE, 'utf8');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** 기본 템플릿 값(읽기 전용). 스키마의 `default`도 여기서 온다(settings.schema.ts) */
export const DEFAULT_SETTINGS: Readonly<AppSettings> = deepFreeze(
  JSON.parse(readDefaultSettingsText()) as AppSettings,
);

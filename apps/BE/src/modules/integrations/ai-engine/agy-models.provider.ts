import { Inject, Injectable, Logger } from '@nestjs/common';
import { AI_ENGINE_ADAPTERS, type AiEngineAdapter } from './ai-engine.port.js';

/**
 * `agy models` 결과 → 모델 ID 목록(P1-11, F-ST-30, PRD §8.9 R12). 녹화본이 없어(M0 S7) 모양을 넓게 받는다:
 * - JSON: 글자 배열, `{ id | name | model }` 객체 배열, 또는 그런 배열을 `models`에 담은 객체
 * - 글: 한 줄에 모델 하나. 앞 글머리표(-·*·•)와 뒤 설명('(default)' 등)은 버린다. ':'로 끝나는 머리 줄과
 *   숫자·하이픈이 없는 낱말(표 머리 'MODEL' 등)은 모델로 보지 않는다
 * 모델 ID는 영문·숫자로 시작하는 영문·숫자·`.`·`_`·`:`·`/`·`-` 100자까지(05-2 AiEngineModelPair). 겹치면 한 번만, 순서는 그대로.
 */
export const AGY_MODELS_ARGS: readonly string[] = ['models'];

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
// 터미널 색 코드(ESC [ … m)를 지운다
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

function looksLikeModelId(token: string): boolean {
  return MODEL_ID.test(token) && /[0-9-]/.test(token);
}

function fromJson(value: unknown): string[] | null {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { models?: unknown }).models)
      ? (value as { models: unknown[] }).models
      : null;
  if (!list) return null;
  const out: string[] = [];
  for (const item of list) {
    const id =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? ['id', 'name', 'model']
              .map((k) => (item as Record<string, unknown>)[k])
              .find((v): v is string => typeof v === 'string')
          : undefined;
    if (id && MODEL_ID.test(id.trim())) out.push(id.trim());
  }
  return out;
}

export function parseAgyModels(stdout: string): string[] {
  const text = stdout.replace(ANSI_ESCAPE, '').trim();
  let found: string[] | null = null;
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      found = fromJson(JSON.parse(text));
    } catch {
      found = null;
    }
  }
  if (!found) {
    found = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim().replace(/^[-*•·]\s*/, '');
      if (line === '' || line.endsWith(':')) continue;
      const token = (line.split(/\s+/)[0] ?? '').replace(/[,;]+$/, '');
      if (looksLikeModelId(token)) found.push(token);
    }
  }
  return [...new Set(found)];
}

/**
 * AGY 모델 목록 캐시(P1-11 Proposed, 06-2 §9). `agy models`는 CLI 호출이라 화면 입력마다 부르지 않는다.
 * - 목록은 AGY 어댑터(`listModels`, IsolatedCliRunner로 `agy models`를 probe 모드로 부른다)에서 받는다
 * - AGY를 감지할 때마다(설치됨) `refresh()`로 다시 받는다(AiCliCheckRecorder — 앱 시작·[다시 감지])
 * - 한 번도 받아 보지 않았으면 처음 필요할 때(`list()`) 한 번 받는다. 받는 중이면 그 결과를 같이 쓴다
 * - 받지 못하면(미설치·실패·빈 목록) 전에 받은 목록을 그대로 둔다. 한 번도 받지 못했으면 null —
 *   쓰는 쪽(settings/ai-engine)이 기본 모델로 대신한다
 * 프로세스 메모리에만 둔다(앱을 다시 켜면 비어 있다).
 */
@Injectable()
export class AgyModelsProvider {
  private readonly logger = new Logger(AgyModelsProvider.name);
  private readonly adapter: AiEngineAdapter | undefined;
  private cache: readonly string[] | null = null;
  private tried = false;
  private inflight: Promise<readonly string[] | null> | null = null;

  constructor(@Inject(AI_ENGINE_ADAPTERS) adapters: readonly AiEngineAdapter[]) {
    this.adapter = adapters.find((a) => a.code === 'AGY');
  }

  /** 지금 캐시(부르지 않는다). 받은 적이 없으면 null */
  current(): readonly string[] | null {
    return this.cache;
  }

  /** 캐시. 한 번도 받아 보지 않았으면 한 번 받는다 */
  async list(): Promise<readonly string[] | null> {
    if (this.tried) return this.cache;
    return this.refresh();
  }

  /** 다시 받는다. 받는 중이면 그 결과를 같이 쓴다. 실패해도 던지지 않는다 */
  refresh(): Promise<readonly string[] | null> {
    this.inflight ??= this.fetch().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetch(): Promise<readonly string[] | null> {
    try {
      const models = this.adapter?.listModels ? await this.adapter.listModels() : null;
      if (models && models.length > 0) this.cache = [...models];
    } catch (error) {
      this.logger.warn({ err: error }, 'agy 모델 목록을 받지 못했습니다(전에 받은 목록을 씁니다)');
    } finally {
      this.tried = true;
    }
    return this.cache;
  }
}

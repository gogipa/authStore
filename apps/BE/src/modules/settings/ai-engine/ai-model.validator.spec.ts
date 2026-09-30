import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BE_ROOT } from '../../../common/config/paths.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import type { AiEngineModelPair, AiSettings } from '../schema/settings.types.js';
import {
  agyModelOptions,
  AI_ENGINE_DEFAULT_MODELS,
  buildAiEngineOptions,
} from './ai-engine-options.js';
import {
  aiModelInvalidException,
  isAllowedAiModel,
  validateAiModels,
} from './ai-model.validator.js';

const aiFixture = (name: string): AiSettings =>
  JSON.parse(
    readFileSync(join(BE_ROOT, 'test', 'fixtures', 'settings', 'ai-section', name), 'utf8'),
  ) as AiSettings;

const AGY_LISTED = [
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'gemini-3.1-pro-high',
  'gemini-3.1-pro-low',
];

type Models = Record<'CLAUDE' | 'AGY' | 'CODEX', AiEngineModelPair>;

function models(patch: Partial<Models> = {}): Models {
  return {
    CLAUDE: { text: 'sonnet', vision: 'sonnet' },
    AGY: { text: null, vision: null },
    CODEX: { text: null, vision: null },
    ...patch,
  };
}

const fields = (errors: { field: string }[]) => errors.map((e) => e.field);

describe('엔진 안내 상수(P1-11 규칙 2)', () => {
  it('엔진 순서·표시 이름·실행 파일·모델 목록·기본 모델·로그인·약관·실험적', () => {
    const engines = buildAiEngineOptions(AGY_LISTED);
    expect(engines.map((e) => [e.engineCode, e.displayName, e.binName])).toEqual([
      ['CLAUDE', 'Claude Code', 'claude'],
      ['AGY', 'Antigravity CLI', 'agy'],
      ['CODEX', 'Codex', 'codex'],
    ]);
    expect(engines[0]!.modelOptions).toEqual(['sonnet', 'opus', 'haiku']);
    expect(engines[1]!.modelOptions).toEqual(AGY_LISTED);
    expect(engines[2]).toMatchObject({ modelOptions: [], allowCustomModel: true });
    expect(engines.map((e) => e.defaultModels)).toEqual([
      { text: 'sonnet', vision: 'sonnet' },
      { text: 'gemini-3.8-flash-medium', vision: 'gemini-3.8-flash-high' },
      { text: null, vision: null },
    ]);
    expect(engines.map((e) => e.termsNote)).toEqual([
      'Claude 구독의 약관·쿼터 책임은 사용자에게 있습니다.',
      'Google 구독의 약관·쿼터 책임은 사용자에게 있습니다.',
      'ChatGPT 구독의 약관·쿼터 책임은 사용자에게 있습니다.',
    ]);
    expect(engines.map((e) => e.experimental)).toEqual([false, false, true]);
    // 비밀처럼 보이는 값이 없다(앱 상수)
    expect(JSON.stringify(engines)).not.toMatch(/api[_-]?key|token|secret/i);
  });

  it('AGY 목록을 받은 적이 없으면(미설치·실패) 기본 텍스트·비전 모델을 목록으로 쓴다(Proposed)', () => {
    expect(agyModelOptions(null)).toEqual(['gemini-3.8-flash-medium', 'gemini-3.8-flash-high']);
    expect(agyModelOptions([])).toEqual(agyModelOptions(null));
    expect(AI_ENGINE_DEFAULT_MODELS.CODEX).toEqual({ text: null, vision: null });
  });
});

describe('validateAiModels(P1-11 규칙 3)', () => {
  const current = aiFixture('default.json');

  it("CLAUDE 'gpt-5' → models.CLAUDE.text 오류(05-3 문구)", () => {
    const errors = validateAiModels({
      selectedEngine: 'CLAUDE',
      models: models({ CLAUDE: { text: 'gpt-5', vision: 'sonnet' } }),
      current,
      agyListed: AGY_LISTED,
    });
    expect(errors).toEqual([
      { field: 'models.CLAUDE.text', message: 'Claude Code에서 쓸 수 없는 모델입니다: gpt-5.' },
    ]);
  });

  it('AGY 목록 밖 값 → 오류, 목록 안 값 → 통과', () => {
    const bad = validateAiModels({
      selectedEngine: 'CLAUDE',
      models: models({ AGY: { text: 'gemini-9', vision: 'gemini-3.8-flash-high' } }),
      current,
      agyListed: AGY_LISTED,
    });
    expect(fields(bad)).toEqual(['models.AGY.text']);
    const ok = validateAiModels({
      selectedEngine: 'AGY',
      models: models({ AGY: { text: 'gemini-3.1-pro-low', vision: 'gemini-3.8-flash-high' } }),
      current,
      agyListed: AGY_LISTED,
    });
    expect(ok).toEqual([]);
  });

  it("CODEX 'my-model' → 통과(직접 입력). 공백·101자는 오류", () => {
    expect(
      validateAiModels({
        selectedEngine: 'CODEX',
        models: models({ CODEX: { text: 'my-model', vision: 'my-model' } }),
        current,
        agyListed: AGY_LISTED,
      }),
    ).toEqual([]);
    expect(isAllowedAiModel('CODEX', 'a b', null)).toBe(false);
    expect(isAllowedAiModel('CODEX', 'x'.repeat(101), null)).toBe(false);
    expect(isAllowedAiModel('CODEX', 'x'.repeat(100), null)).toBe(true);
  });

  it('선택 엔진 CODEX인데 text: null → 오류. 선택하지 않은 엔진의 null은 받는다', () => {
    const errors = validateAiModels({
      selectedEngine: 'CODEX',
      models: models({ CODEX: { text: null, vision: 'my-model' } }),
      current,
      agyListed: AGY_LISTED,
    });
    expect(errors).toEqual([
      { field: 'models.CODEX.text', message: 'Codex에서 쓸 수 없는 모델입니다: (비어 있음).' },
    ]);
  });

  it('현재 설정과 같은 값은 목록 검사를 건너뛴다(Proposed — agy models 목록이 바뀌어도)', () => {
    const agyNow: AiSettings = {
      ...current,
      models: { ...current.models, AGY: { text: 'gemini-old', vision: 'gemini-old' } },
    };
    expect(
      validateAiModels({
        selectedEngine: 'CLAUDE',
        models: models({
          CLAUDE: { text: 'opus', vision: 'sonnet' },
          AGY: { text: 'gemini-old', vision: 'gemini-old' },
        }),
        current: agyNow,
        agyListed: AGY_LISTED,
      }),
    ).toEqual([]);
  });

  it('AGY 목록을 받은 적이 없으면 기본 모델만 받는다', () => {
    expect(isAllowedAiModel('AGY', 'gemini-3.8-flash-medium', null)).toBe(true);
    expect(isAllowedAiModel('AGY', 'gemini-3.1-pro-low', null)).toBe(false);
  });

  it('422 AI_MODEL_INVALID: message = 첫 칸 문구, fieldErrors = 모든 칸', () => {
    const errors = validateAiModels({
      selectedEngine: 'CLAUDE',
      models: models({ CLAUDE: { text: 'gpt-5', vision: 'gpt-4o' } }),
      current,
      agyListed: AGY_LISTED,
    });
    const e = aiModelInvalidException(errors);
    expect(e).toBeInstanceOf(ApiException);
    expect(e.getStatus()).toBe(422);
    expect(e.code).toBe('AI_MODEL_INVALID');
    expect(e.message).toBe('Claude Code에서 쓸 수 없는 모델입니다: gpt-5.');
    expect(fields(e.fieldErrors ?? [])).toEqual(['models.CLAUDE.text', 'models.CLAUDE.vision']);
  });
});

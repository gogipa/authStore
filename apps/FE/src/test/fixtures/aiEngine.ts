import type { components } from '@/shared/api/schema';

type AiEngineCode = components['schemas']['AiEngineCode'];
type AiCliCheck = components['schemas']['AiCliCheck'];
type AiCliCheckLatestList = components['schemas']['AiCliCheckLatestList'];
type AiCliCheckPage = components['schemas']['AiCliCheckPage'];
type AiEngineSettings = components['schemas']['AiEngineSettings'];
type AiEngineModels = components['schemas']['AiEngineModels'];

/** 보드 시각: 2026-09-27 14:00 KST */
export const BOARD_CHECKED_AT = '2026-09-27T05:00:00.000Z';

export const AGY_MODELS = [
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'gemini-3.1-pro-high',
  'gemini-3.1-pro-low',
];

let nextId = 100;

/** ai_cli_check 한 행(기본: Claude Code 2.1.269 로그인·연결 테스트 통과 sonnet 12.7초 — 보드 값) */
export function aiCliCheck(overrides: Partial<AiCliCheck> = {}): AiCliCheck {
  const engineCode = overrides.engineCode ?? 'CLAUDE';
  const installed = overrides.installed ?? true;
  return {
    id: (nextId += 1),
    engineCode,
    trigger: 'STARTUP',
    installed,
    binPath: installed ? `~/.local/bin/${engineCode.toLowerCase()}` : null,
    cliVersion: installed ? '2.1.269' : null,
    versionSupported: installed ? true : null,
    authStatus: 'OK',
    smokeStatus: 'PASSED',
    model: 'sonnet',
    latencyMs: 12_700,
    errorCode: null,
    errorMessage: null,
    checkedAt: BOARD_CHECKED_AT,
    ...overrides,
  };
}

/** 감지만 한 행(SKIPPED) */
export function detectedOnly(engineCode: AiEngineCode, overrides: Partial<AiCliCheck> = {}) {
  return aiCliCheck({
    engineCode,
    smokeStatus: 'SKIPPED',
    model: null,
    latencyMs: null,
    ...overrides,
  });
}

/** 보드 상태: CLAUDE 통과(선택), AGY 1.2.9 감지만(UNKNOWN), CODEX 미설치 */
export function boardChecks(): Record<AiEngineCode, AiCliCheck> {
  return {
    CLAUDE: aiCliCheck(),
    AGY: detectedOnly('AGY', { cliVersion: '1.2.9', authStatus: 'UNKNOWN' }),
    CODEX: detectedOnly('CODEX', {
      installed: false,
      binPath: null,
      cliVersion: null,
      versionSupported: null,
      authStatus: 'UNKNOWN',
      errorCode: 'NOT_INSTALLED',
    }),
  };
}

/** GET /ai-cli-checks/latest 응답 */
export function aiCliCheckLatestList(
  rows: Partial<Record<AiEngineCode, AiCliCheck | null>> = boardChecks(),
  selectedEngine: AiEngineCode = 'CLAUDE',
): AiCliCheckLatestList {
  return {
    selectedEngine,
    items: (['CLAUDE', 'AGY', 'CODEX'] as const).map((engineCode) => ({
      engineCode,
      selected: engineCode === selectedEngine,
      latest: rows[engineCode] ?? null,
    })),
  };
}

/** GET /ai-cli-checks 응답(한 쪽) */
export function aiCliCheckPage(content: AiCliCheck[] = []): AiCliCheckPage {
  return {
    content,
    page: {
      number: 0,
      size: 100,
      totalElements: content.length,
      totalPages: content.length === 0 ? 0 : 1,
    },
  };
}

/** GET /settings/ai-engine 응답(기본 템플릿: CLAUDE sonnet/sonnet, AGY·CODEX null) */
export function aiEngineSettings(
  overrides: { selectedEngine?: AiEngineCode; models?: Partial<AiEngineModels> } = {},
): AiEngineSettings {
  return {
    selectedEngine: overrides.selectedEngine ?? 'CLAUDE',
    models: {
      CLAUDE: { text: 'sonnet', vision: 'sonnet' },
      AGY: { text: null, vision: null },
      CODEX: { text: null, vision: null },
      ...overrides.models,
    },
    engines: [
      {
        engineCode: 'CLAUDE',
        displayName: 'Claude Code',
        binName: 'claude',
        modelOptions: ['sonnet', 'opus', 'haiku'],
        allowCustomModel: false,
        defaultModels: { text: 'sonnet', vision: 'sonnet' },
        loginCommand: 'claude 실행 후 /login',
        termsNote:
          '본인 Claude 구독 한도를 씁니다. 대량·상시 사용은 Anthropic 약관상 제한될 수 있고, 계정 책임은 본인에게 있습니다.',
        experimental: false,
      },
      {
        engineCode: 'AGY',
        displayName: 'Antigravity CLI',
        binName: 'agy',
        modelOptions: AGY_MODELS,
        allowCustomModel: false,
        defaultModels: { text: 'gemini-3.8-flash-medium', vision: 'gemini-3.8-flash-high' },
        loginCommand: '처음 실행할 때 로그인 창이 뜹니다',
        termsNote:
          'Google 약관은 다른 프로그램과 함께 쓰는 것을 막을 수 있어 Google 계정이 정지될 위험이 있습니다. 사용자 MCP·규칙·플러그인도 함께 켜집니다(끌 수 없음).',
        experimental: true,
      },
      {
        engineCode: 'CODEX',
        displayName: 'Codex',
        binName: 'codex',
        modelOptions: [],
        allowCustomModel: true,
        defaultModels: { text: null, vision: null },
        loginCommand: 'npm install -g @openai/codex 다음 codex login',
        termsNote: '본인 ChatGPT 플랜 한도를 씁니다. OpenAI 약관과 계정 책임은 본인에게 있습니다.',
        experimental: true,
      },
    ],
    settingsSnapshotId: 3,
    updatedAt: '2026-09-30T00:10:00.000Z',
  };
}

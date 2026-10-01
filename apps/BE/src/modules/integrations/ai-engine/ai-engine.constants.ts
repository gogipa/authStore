import type { CallLogTarget } from '../http/external-targets.js';
import type { AiEngineCode } from './ai-engine.port.js';
import { CLAUDE_GLOBAL_SETTINGS_BLOCKERS, type AiCliBinary } from './cli-isolation.js';

/**
 * AI 실행기 상수(P1-10, PRD §8.9). 격리 플래그·시간 제한·이름은 여기 한 곳에만 둔다.
 * M0 S6·S7 결과(2026-10-01, docs/dev/07_M0스파이크) 반영: claude 격리 3개 플래그, agy `--disable-slash-commands`.
 * codex `~/.codex` 격리는 미설치라 재지 못했다(빈 배열 유지).
 */

/** 화면 이름(05-2 AiEngineOption.displayName, 'AI 생성 · Claude Code' 표시, R11) */
export const AI_ENGINE_LABEL: Readonly<Record<AiEngineCode, string>> = {
  CLAUDE: 'Claude Code',
  AGY: 'Antigravity CLI',
  CODEX: 'Codex',
};

/** 엔진 → 실행 파일 이름(규칙 1: 이 3개만 부른다) */
export const AI_ENGINE_BINARY: Readonly<Record<AiEngineCode, AiCliBinary>> = {
  CLAUDE: 'claude',
  AGY: 'agy',
  CODEX: 'codex',
};

/** 엔진 → call_log.target(규칙 15, ck_call_log_target) */
export const AI_ENGINE_CALL_TARGET: Readonly<Record<AiEngineCode, CallLogTarget>> = {
  CLAUDE: 'AI_CLAUDE_CLI',
  AGY: 'AI_AGY_CLI',
  CODEX: 'AI_CODEX_CLI',
};

/** 텍스트 호출 시간 제한(PRD §8.9 AI-03: 120s) */
export const AI_TEXT_TIMEOUT_MS = 120_000;
/** 비전 호출 시간 제한(PRD §8.9 AI-03: 180s) */
export const AI_VISION_TIMEOUT_MS = 180_000;
/**
 * 감지 호출(`--version`·`auth status`·`login status`) 시간 제한. 문서에 없다 — Proposed(06-2 §9): 15초.
 * 넘으면 설치 안 됨(버전)·UNKNOWN(로그인)으로 본다.
 */
export const AI_PROBE_TIMEOUT_MS = 15_000;
/**
 * 시간 제한을 넘긴 자식 종료(Proposed, M1): CLI에 준 시간 + 이 여유가 지나면 SIGTERM, 그래도 살아 있으면 이만큼 뒤 SIGKILL.
 * 단계적 종료(SIGINT → SIGTERM)·재시도는 M2(F-BS-59~64)다. agy는 `--print-timeout`으로 스스로 먼저 끝낸다.
 */
export const AI_PROCESS_KILL_GRACE_MS = 5_000;
/** 자식 표준 출력·오류를 모으는 상한(바이트, Proposed). 넘는 부분은 버리고 결과를 '부분 출력'으로 본다 */
export const AI_OUTPUT_MAX_BYTES = 8 * 1024 * 1024;

/** 호출마다 만드는 빈 작업 폴더 이름 앞부분(os.tmpdir() 아래, 저장소 밖 — §8 주의) */
export const AI_WORK_DIR_PREFIX = 'autostore-ai-';
/** 비전 호출의 이미지 전용 폴더(이번 호출의 이미지만 복사한다, 규칙 9) */
export const AI_IMAGE_DIR_PREFIX = 'autostore-ai-img-';
/** codex `--output-schema` 파일을 두는 폴더(작업 폴더는 spawn 때 비어 있어야 해서 따로 둔다, Proposed) */
export const AI_IO_DIR_PREFIX = 'autostore-ai-io-';

/**
 * claude 전역 설정 차단 플래그(규칙 4, F-BS-28, M0 S6 §4.4 실측).
 * - `--safe-mode`: 사용자 훅·CLAUDE.md·MCP·플러그인·스킬·자동 메모리를 막는다(구독 인증은 그대로)
 * - `--setting-sources ""`: 사용자 전역 설정 파일(`~/.claude/` 아래 — 허용 규칙·효과 수준 등)도 읽지 않는다(`--safe-mode`만으로는 읽는다)
 * - `--strict-mcp-config`: `--mcp-config`로 준 MCP만 쓴다(주지 않으므로 0개)
 * 토큰·지연 비용은 없다(프롬프트 토큰 5,394~5,396 그대로). 빈 문자열 값은 인자 배열의 빈 원소로 넘긴다(셸 없음).
 * `--bare`는 구독 인증(OAuth·키체인)을 읽지 않아 쓸 수 없다('Not logged in').
 * 격리 검사기(`CLAUDE_GLOBAL_SETTINGS_BLOCKERS`)의 조합을 만족해야 한다(모듈을 읽을 때 확인).
 */
export const CLAUDE_ISOLATION_ARGS: readonly string[] = [
  '--safe-mode',
  '--setting-sources',
  '',
  '--strict-mcp-config',
];
/**
 * agy 격리 플래그(M0 S6 §6.1). 사용자 MCP·규칙(GEMINI.md)·플러그인 스킬을 끄는 플래그는 **없다**(`agy --help`에 없음,
 * `HOME`을 바꾸면 인증이 깨진다). `--disable-slash-commands`는 컨텍스트·토큰 차이는 없지만 비용이 없어 넣는다
 * (라쿠텐 글의 `/` 확장 방어). 선택 엔진이 agy면 앱 시작 때 경고를 남기고 SCR-13 카드에 알린다(규칙 13).
 */
export const AGY_ISOLATION_ARGS: readonly string[] = ['--disable-slash-commands'];
/** agy 사용자 MCP를 끄는 방법을 확인했는가 — M0 S6에서 '없음'으로 확인(false 유지) */
export const AGY_USER_MCP_DISABLE_KNOWN = false;
/** codex 사용자 설정(`~/.codex` AGENTS.md·MCP) 격리 플래그. codex 미설치로 M0 S7에서 재지 못했다 — 빈 배열 */
export const CODEX_ISOLATION_ARGS: readonly string[] = [];

/**
 * M0 S6·S7에서 실제로 검증한 CLI 버전(2026-10-01, P-13 기록용). 지원 범위(`AI_SUPPORTED_VERSION_RANGE`)는 오너 결정 뒤에 넣는다.
 * agy는 측정 중 1.2.9 → 1.2.14로 스스로 업데이트됐다(호출 사이에 버전이 바뀔 수 있다).
 */
export const AI_VERIFIED_CLI_VERSIONS: Readonly<Record<AiEngineCode, string | null>> = {
  CLAUDE: '2.1.269',
  AGY: '1.2.14',
  CODEX: null,
};

/**
 * 지원 CLI 버전 범위(P-13). 오너가 정하지 않아 모두 null(판단하지 못함 → `version_supported` NULL). 검증한 버전은 위 상수.
 * 범위가 정해져도 M1은 거절하지 않고 경고만 한다(P1-10 Proposed, PRD §8.9 '버전'·F-SY-13 쪽을 따른다).
 */
export const AI_SUPPORTED_VERSION_RANGE: Readonly<
  Record<AiEngineCode, { min: string; max: string | null } | null>
> = { CLAUDE: null, AGY: null, CODEX: null };

/** 'AI 엔진' 설정 화면 경로(409 AI_ENGINE_UNAVAILABLE details.settingsPath, SCR-13) */
export const AI_ENGINE_SETTINGS_PATH = '/settings/ai-engine';

/** 계약·연결 테스트 작업 이름(call_log·로그용, AI-07) */
export const AI_SMOKE_TASK = 'AI-07';
/** 계약 테스트 프롬프트: 'OK' 한 단어를 스키마로 받는다(R7) */
export const AI_SMOKE_PROMPT = '[연결 테스트] answer 필드에 OK 한 단어만 넣어 JSON으로 답하라.';
/** 계약 테스트 스키마(규칙 7을 지킨다) */
export const AI_SMOKE_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  properties: { answer: { type: 'string', enum: ['OK'] } },
  required: ['answer'],
  additionalProperties: false,
};

/** 비전 결과의 이미지 확인 필드(규칙 9). 형식은 읽은 파일 이름 목록(Proposed) */
export const IMAGES_SEEN_FIELD = 'images_seen';

// claude 격리 플래그가 검사기의 한 조합을 만족하는지(상수를 잘못 고치면 모듈을 읽을 때 멈춘다)
if (
  !CLAUDE_GLOBAL_SETTINGS_BLOCKERS.some((set) =>
    set.every((flag) => CLAUDE_ISOLATION_ARGS.includes(flag)),
  )
) {
  throw new Error(
    'CLAUDE_ISOLATION_ARGS가 CLAUDE_GLOBAL_SETTINGS_BLOCKERS의 어느 조합도 갖추지 않았다',
  );
}

import type { CallLogTarget } from '../http/external-targets.js';
import type { AiEngineCode } from './ai-engine.port.js';
import { CLAUDE_GLOBAL_SETTINGS_BLOCKERS, type AiCliBinary } from './cli-isolation.js';

/**
 * AI 실행기 상수(P1-10, PRD §8.9). 격리 플래그·시간 제한·이름은 여기 한 곳에만 둔다.
 * M0 S6·S7 결과가 오면(claude 전역 설정 차단 조합, agy 사용자 MCP 끄기, codex `~/.codex` 격리) 이 파일만 고친다.
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
 * claude 전역 설정 차단 플래그(규칙 4, F-BS-28). `--safe-mode` 하나로 사용자 훅·CLAUDE.md·MCP·플러그인을 읽지 않게 한다.
 * M0 S6 결과에 따라 `['--setting-sources', '<값>', '--strict-mcp-config']`로 바뀔 수 있다 — 여기만 고친다.
 * 격리 검사기(`CLAUDE_GLOBAL_SETTINGS_BLOCKERS`)의 한 조합을 만족해야 한다(모듈을 읽을 때 확인).
 */
export const CLAUDE_ISOLATION_ARGS: readonly string[] = ['--safe-mode'];
/**
 * agy 사용자 MCP 끄기 플래그. 방법이 아직 확인되지 않았다(M0 S6) — 빈 배열이고, 선택 엔진이 agy면 앱 시작 때
 * 경고를 남긴다(규칙 13, `AGY_USER_MCP_DISABLE_KNOWN`).
 */
export const AGY_ISOLATION_ARGS: readonly string[] = [];
/** agy 사용자 MCP를 끄는 방법을 확인했는가(M0 S6 전 false) */
export const AGY_USER_MCP_DISABLE_KNOWN = false;
/** codex 사용자 설정(`~/.codex` AGENTS.md·MCP) 격리 플래그. M0 S7에서 확인한다 — 그 전에는 빈 배열 */
export const CODEX_ISOLATION_ARGS: readonly string[] = [];

/**
 * 지원 CLI 버전 범위(P-13). 아직 정해지지 않아 모두 null(판단하지 못함 → `version_supported` NULL).
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

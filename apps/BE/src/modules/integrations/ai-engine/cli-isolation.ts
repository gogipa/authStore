import { readdirSync, statSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { REPO_ROOT } from '../../../common/config/paths.js';

/**
 * AI CLI 실행 인자 검사기(F-BS-07, PRD §8.9 '필수 실행 규약'). AI CLI는 HTTP가 아니라 하위 프로세스라
 * 외부 호출 관문을 거치지 않는다. 대신 spawn 직전에 이 검사를 통과해야 한다(P1-10 실행기·어댑터).
 */

/** 부를 수 있는 실행 파일 이름(P1-10 규칙 1) */
export const AI_CLI_BINARIES = ['claude', 'agy', 'codex'] as const;
export type AiCliBinary = (typeof AI_CLI_BINARIES)[number];

/**
 * 자식 프로세스에 넘겨도 되는 환경변수(화이트리스트). Proposed(06-2 §9) — P1-10이 이 목록으로 env를 만든다.
 * CLI가 사용자 본인 로그인(키체인·~/.codex 등)을 찾는 데 필요한 최소한과 로캘·임시 폴더만 둔다.
 */
export const AI_CLI_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TZ',
  'TERM',
  'NO_COLOR',
  // claude 자동 업데이트 끄기(PRD §8.9 '버전')
  'DISABLE_AUTOUPDATER',
] as const;

/** 있으면 구독 대신 API로 과금되므로 절대 넘기지 않는다(PRD §8.9 R14) */
export const AI_CLI_FORBIDDEN_ENV = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const;

/**
 * claude가 사용자 전역 설정(훅·CLAUDE.md·MCP·플러그인)을 읽지 않게 하는 옵션 조합. 어느 하나를 모두 갖추면 된다.
 * 정확한 조합은 M0 S6에서 정한다(F-BS-28). 바뀌면 여기만 고친다.
 */
export const CLAUDE_GLOBAL_SETTINGS_BLOCKERS: readonly (readonly string[])[] = [
  ['--safe-mode'],
  ['--setting-sources', '--strict-mcp-config'],
];

export interface CliInvocation {
  /** 실행 파일 이름 또는 경로 */
  bin: string;
  /** 인자 배열(셸 문자열이 아니다) */
  args: readonly string[];
  /** 작업 폴더 */
  cwd: string;
  /** 자식에게 넘길 환경변수 전부 */
  env: Readonly<Record<string, string | undefined>>;
  /** spawn의 shell 옵션. false여야 한다 */
  shell: boolean | string | undefined;
}

/**
 * 검사 방식. `invoke` = 구조화 호출(모든 규약), `probe` = 비용 없는 감지 호출(`--version`·`auth status`·`login status`).
 * 감지 호출은 모델을 쓰지 않고 claude 전역 설정 차단 옵션을 받지 않는 하위 명령이라 그 두 검사만 뺀다(P1-10 Proposed).
 * 실행 파일 이름·셸 없음·빈 작업 폴더(저장소 밖)·환경변수 허용 목록은 감지 호출에도 그대로 본다.
 */
export type CliInvocationMode = 'invoke' | 'probe';

export class CliIsolationError extends Error {
  constructor(readonly violations: string[]) {
    super(`AI CLI 격리 규약 위반: ${violations.join(' / ')}`);
  }
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.some((a) => a === flag || a.startsWith(`${flag}=`));
}

/** `--model x` 또는 `--model=x`에서 값(비었으면 null) */
function modelValue(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === '--model') {
      const v = args[i + 1];
      return v && !v.startsWith('-') ? v : null;
    }
    if (a.startsWith('--model=')) return a.slice('--model='.length) || null;
  }
  return null;
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** 위반 목록(없으면 빈 배열) */
export function checkIsolatedCliInvocation(
  inv: CliInvocation,
  mode: CliInvocationMode = 'invoke',
): string[] {
  const v: string[] = [];
  const name = basename(inv.bin);
  if (!(AI_CLI_BINARIES as readonly string[]).includes(name)) {
    v.push(`실행 파일은 ${AI_CLI_BINARIES.join('·')}만`);
  }

  // 셸 없이 인자 배열로
  if (inv.shell !== false) v.push('shell: false여야 한다');
  if (!Array.isArray(inv.args) || !inv.args.every((a) => typeof a === 'string')) {
    v.push('인자는 문자열 배열이어야 한다');
  }
  const args = Array.isArray(inv.args) ? inv.args : [];

  // 전용 빈 작업 폴더(저장소 밖)
  if (!isAbsolute(inv.cwd)) {
    v.push('cwd는 절대 경로여야 한다');
  } else {
    try {
      if (!statSync(inv.cwd).isDirectory()) v.push('cwd가 폴더가 아니다');
      else if (readdirSync(inv.cwd).length > 0) v.push('cwd가 비어 있지 않다');
    } catch {
      v.push('cwd가 없다');
    }
    if (isInside(REPO_ROOT, inv.cwd))
      v.push('cwd가 앱 저장소 안에 있다(상위 .claude·CLAUDE.md를 읽을 수 있다)');
  }

  // --model 명시
  if (mode === 'invoke' && modelValue(args) === null) v.push('--model을 적어야 한다');

  // 환경변수 화이트리스트
  for (const key of Object.keys(inv.env)) {
    if ((AI_CLI_FORBIDDEN_ENV as readonly string[]).includes(key)) {
      v.push(`env에 ${key}를 넘기면 안 된다`);
    } else if (!(AI_CLI_ENV_ALLOWLIST as readonly string[]).includes(key)) {
      v.push(`env ${key}는 허용 목록에 없다`);
    }
  }

  // claude 전역 설정 차단
  if (mode === 'invoke' && name === 'claude') {
    const blocked = CLAUDE_GLOBAL_SETTINGS_BLOCKERS.some((set) =>
      set.every((f) => hasFlag(args, f)),
    );
    if (!blocked) {
      v.push(
        `claude는 전역 설정 차단 옵션(${CLAUDE_GLOBAL_SETTINGS_BLOCKERS.map((s) => s.join(' + ')).join(' 또는 ')})이 필요하다`,
      );
    }
  }
  return v;
}

/** 격리 규약을 어기면 CliIsolationError. P1-10 실행기(IsolatedCliRunner)가 spawn 직전에 부른다 */
export function assertIsolatedCliInvocation(
  inv: CliInvocation,
  mode: CliInvocationMode = 'invoke',
): void {
  const violations = checkIsolatedCliInvocation(inv, mode);
  if (violations.length > 0) throw new CliIsolationError(violations);
}

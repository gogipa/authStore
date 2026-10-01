import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** fixture 폴더(test/fixtures/ai-engine) */
export const AI_FIXTURE_ROOT = join(import.meta.dirname, '..', 'fixtures', 'ai-engine');
const FAKE_CLI = join(AI_FIXTURE_ROOT, 'bin', 'fake-ai-cli.mjs');

export type FakeCliEngine = 'claude' | 'agy' | 'codex';

/** fixture 경로(이 폴더 기준) 또는 글 */
export type FakeText = string | { text: string } | null;

export interface FakeCliScenario {
  version?: FakeText;
  auth?: { stdout: FakeText; exit?: number };
  /** agy: `agy models`(P1-11) */
  models?: { stdout: FakeText; exit?: number };
  run?: {
    stdout?: FakeText;
    stderr?: FakeText;
    /** codex: --output-last-message 파일 내용(null이면 파일을 만들지 않는다) */
    lastMessage?: FakeText;
    exit?: number;
    sleepMs?: number;
  };
}

/** 가짜 CLI 호출 기록 한 줄 */
export interface FakeCliRecord {
  engine: FakeCliEngine;
  kind: 'version' | 'auth' | 'models' | 'run';
  argv: string[];
  cwd: string;
  cwdEntries: string[] | null;
  envNames: string[];
  disableAutoupdater: string | null;
  /** claude 부가 트래픽 끄기 값(M0 S6) */
  disableNonessentialTraffic: string | null;
  stdin: string;
  addDir: string | null;
  addDirEntries: string[] | null;
  images: { path: string; exists: boolean }[];
  pid: number;
}

export interface FakeCliWorld {
  /** 가짜 실행 파일이 있는 임시 폴더(os.tmpdir() 아래) */
  dir: string;
  /**
   * 러너에 넘길 부모 환경변수: PATH = 이 폴더와 시스템 기본 폴더만(사용자 PC의 진짜 CLI가 잡히지 않게) +
   * 허용 목록 밖·금지 변수(ANTHROPIC_API_KEY 등 — 걸러지는지 본다)
   */
  env: Record<string, string>;
  setScenario(scenario: Partial<Record<FakeCliEngine, FakeCliScenario>>): void;
  records(): FakeCliRecord[];
  clearRecords(): void;
  cleanup(): void;
}

/**
 * 가짜 AI CLI 세계(P1-10 단위 테스트). 임시 폴더에 `claude`·`agy`·`codex`(주면 그것만) 실행 파일을 만든다 — 노드 절대 경로
 * shebang으로 `fake-ai-cli.mjs`를 불러 PATH에 노드가 없어도 된다. 없는 엔진은 '미설치'다.
 */
export function createFakeCliWorld(
  engines: readonly FakeCliEngine[] = ['claude', 'agy', 'codex'],
): FakeCliWorld {
  const dir = mkdtempSync(join(tmpdir(), 'autostore-fake-cli-'));
  for (const engine of engines) {
    const file = join(dir, engine);
    writeFileSync(
      file,
      `#!${process.execPath}\n// 가짜 ${engine}(P1-10 테스트)\nimport(${JSON.stringify(FAKE_CLI)});\n`,
    );
    chmodSync(file, 0o755);
  }
  const recordsFile = join(dir, 'records', 'calls.jsonl');
  return {
    dir,
    env: {
      PATH: [dir, '/usr/bin', '/bin'].join(':'),
      HOME: process.env.HOME ?? '/tmp',
      LANG: 'ko_KR.UTF-8',
      TMPDIR: tmpdir(),
      ANTHROPIC_API_KEY: 'x',
      OPENAI_API_KEY: 'y',
      NODE_OPTIONS: '--max-old-space-size=64',
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0',
      GEMINI_API_KEY: 'z',
    },
    setScenario(scenario) {
      writeFileSync(join(dir, 'scenario.json'), JSON.stringify(scenario));
    },
    records() {
      if (!existsSync(recordsFile)) return [];
      return readFileSync(recordsFile, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as FakeCliRecord);
    },
    clearRecords() {
      rmSync(join(dir, 'records'), { recursive: true, force: true });
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

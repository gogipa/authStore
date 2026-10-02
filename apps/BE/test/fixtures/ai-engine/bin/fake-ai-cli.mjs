#!/usr/bin/env node
// 가짜 AI CLI(P1-10 테스트 fixture). 실제 claude·agy·codex를 부르지 않고 녹화·합성 출력을 내보낸다.
// - 엔진 = 실행한 파일 이름(process.argv[1]의 basename: claude·agy·codex)
// - 세계 폴더 = 실행한 파일이 있는 폴더. 그 안의 scenario.json이 고른 출력을 내보내고 records/에 호출 기록을 쓴다
//   (앱이 환경변수를 허용 목록으로 거르므로 시나리오를 환경변수로 넘기지 않는다)
// - 기록: argv, cwd, 시작 때 cwd 안 파일, 환경변수 이름 목록, stdin 상태, --add-dir·--image 폴더 내용
// - agy 이미지 생성(M0 S1): run.brain이 있으면 $HOME/.gemini/antigravity-cli/brain/<conversationId>/에 결과 파일을 복사하고,
//   출력 글의 <HOME>·<RUN_DIR>(녹화본 자리표시자)을 이 호출의 HOME·--add-dir 상위 폴더로 바꾼다.
//   HOME이 임시 폴더(os.tmpdir() 아래)가 아니면 쓰지 않고 실패한다 — 사용자 홈(~/.gemini)에 파일을 남기지 않게
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  fstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const invokedAs = process.argv[1] ?? '';
const engine = basename(invokedAs);
const worldDir = dirname(resolve(invokedAs));
const args = process.argv.slice(2);

function stdinKind() {
  try {
    const st = fstatSync(0);
    if (st.isFIFO()) return 'pipe';
    if (st.isCharacterDevice()) return 'null-device';
    if (st.isFile()) return 'file';
    if (st.isSocket()) return 'socket';
    return 'other';
  } catch {
    return 'closed';
  }
}

function valueAfter(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

function valuesAfter(flag) {
  const out = [];
  args.forEach((a, i) => {
    if (a === flag && i + 1 < args.length) out.push(args[i + 1]);
  });
  return out;
}

function listDir(dir) {
  try {
    return readdirSync(dir).sort();
  } catch {
    return null;
  }
}

function loadScenario() {
  const file = join(worldDir, 'scenario.json');
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8'));
}

function fixturePath(ref) {
  return isAbsolute(ref) ? ref : join(FIXTURE_ROOT, ref);
}

function fixtureText(ref) {
  if (ref === null || ref === undefined) return '';
  if (typeof ref === 'object' && 'text' in ref) return String(ref.text);
  return readFileSync(fixturePath(ref), 'utf8');
}

/** 녹화본 자리표시자(<HOME>·<RUN_DIR>)를 이 호출 값으로 바꾼다(M0 S1 fixture) */
function expandPlaceholders(text) {
  const addDir = valueAfter('--add-dir');
  return text
    .split('<HOME>')
    .join(process.env.HOME ?? '')
    .split('<RUN_DIR>')
    .join(addDir ? dirname(addDir) : '');
}

/** HOME이 임시 폴더 아래이고 실제 사용자 홈이 아닌가(가짜 agy가 brain 파일을 써도 되는가) */
function isTempHome(home) {
  try {
    const real = realpathSync(home);
    const inTmp = relative(realpathSync(tmpdir()), real);
    const underTmp = inTmp !== '' && !inTmp.startsWith('..') && !isAbsolute(inTmp);
    return underTmp && real !== realpathSync(userInfo().homedir);
  } catch {
    return false;
  }
}

/**
 * agy 이미지 생성 결과 파일을 $HOME/.gemini/antigravity-cli/brain/<conversationId>/에 둔다(M0 S1 위치). HOME이 임시 폴더가
 * 아니면(테스트가 HOME을 바꾸지 않음) 쓰지 않고 실패한다
 */
function writeBrain(brain) {
  if (!brain) return;
  const home = process.env.HOME ?? '';
  if (!isTempHome(home)) {
    process.stderr.write('fake-ai-cli: run.brain은 HOME이 임시 폴더일 때만 쓴다(사용자 홈 보호)\n');
    process.exit(97);
  }
  const dir = join(home, '.gemini', 'antigravity-cli', 'brain', brain.conversationId);
  mkdirSync(dir, { recursive: true });
  for (const file of brain.files ?? []) copyFileSync(fixturePath(file.from), join(dir, file.name));
}

const DEFAULTS = {
  claude: {
    version: 'claude/version.txt',
    auth: { stdout: 'claude/auth-status-ok.txt', exit: 0 },
    run: { stdout: 'claude/text-success.json', exit: 0 },
  },
  agy: {
    version: 'agy/version.txt',
    models: { stdout: 'agy/models.txt', exit: 0 },
    run: { stdout: 'agy/success.json', exit: 0 },
  },
  codex: {
    version: 'codex/version.txt',
    auth: { stdout: 'codex/login-status-ok.txt', exit: 0 },
    run: { stdout: 'codex/events.jsonl', lastMessage: 'codex/last-message-success.json', exit: 0 },
  },
};

function record(kind) {
  const recordsDir = join(worldDir, 'records');
  mkdirSync(recordsDir, { recursive: true });
  const addDir = valueAfter('--add-dir');
  const entry = {
    engine,
    kind,
    argv: args,
    cwd: process.cwd(),
    cwdEntries: listDir(process.cwd()),
    envNames: Object.keys(process.env).sort(),
    disableAutoupdater: process.env.DISABLE_AUTOUPDATER ?? null,
    disableNonessentialTraffic: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ?? null,
    agyDisableAutoUpdate: process.env.AGY_CLI_DISABLE_AUTO_UPDATE ?? null,
    stdin: stdinKind(),
    addDir,
    addDirEntries: addDir ? listDir(addDir) : null,
    images: valuesAfter('--image').map((p) => ({ path: p, exists: existsSync(p) })),
    pid: process.pid,
  };
  appendFileSync(join(recordsDir, 'calls.jsonl'), `${JSON.stringify(entry)}\n`);
}

async function main() {
  const scenario = { ...(DEFAULTS[engine] ?? {}), ...(loadScenario()[engine] ?? {}) };
  if (args.includes('--version')) {
    record('version');
    if (scenario.version === null) {
      process.stderr.write('command failed\n');
      process.exit(1);
    }
    process.stdout.write(fixtureText(scenario.version));
    process.exit(0);
  }
  const isAuth =
    (engine === 'claude' && args[0] === 'auth' && args[1] === 'status') ||
    (engine === 'codex' && args[0] === 'login' && args[1] === 'status');
  if (isAuth) {
    record('auth');
    const auth = scenario.auth ?? { stdout: { text: '' }, exit: 0 };
    process.stdout.write(fixtureText(auth.stdout));
    process.exit(auth.exit ?? 0);
  }
  if (engine === 'agy' && args[0] === 'models') {
    // P1-11: `agy models`(모델 목록, 호출 비용 없음)
    record('models');
    const models = scenario.models ?? { stdout: { text: '' }, exit: 0 };
    process.stdout.write(fixtureText(models.stdout));
    process.exit(models.exit ?? 0);
  }
  record('run');
  const run = scenario.run ?? {};
  if (run.sleepMs) await new Promise((r) => setTimeout(r, run.sleepMs));
  if (engine === 'codex') {
    const lastMessageFile = valueAfter('--output-last-message');
    if (lastMessageFile && run.lastMessage !== null && run.lastMessage !== undefined) {
      writeFileSync(lastMessageFile, fixtureText(run.lastMessage));
    }
  }
  if (engine === 'agy') writeBrain(run.brain);
  if (run.stdout !== undefined) process.stdout.write(expandPlaceholders(fixtureText(run.stdout)));
  if (run.stderr !== undefined) process.stderr.write(expandPlaceholders(fixtureText(run.stderr)));
  process.exit(run.exit ?? 0);
}

main().catch((error) => {
  process.stderr.write(`fake-ai-cli 오류: ${String(error)}\n`);
  process.exit(70);
});

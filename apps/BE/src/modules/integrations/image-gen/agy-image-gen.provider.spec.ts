import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  AI_FIXTURE_ROOT,
  createFakeCliWorld,
  type FakeCliScenario,
  type FakeCliWorld,
} from '../../../../test/support/fake-ai-cli.js';
import { normalizeForUpload } from '../../registration/upload/image-normalizer.js';
import { AI_RUN_ERROR_CODES } from '../ai-engine/ai-engine.errors.js';
import { IsolatedCliRunner } from '../ai-engine/process/isolated-cli-runner.js';
import type { CallLogResult, CallLogStart } from '../http/call-log.service.js';
import type { Clock } from '../http/clock.token.js';
import {
  AGY_IMAGE_AGENT_MODEL,
  AGY_IMAGE_MESSAGES,
  AGY_IMAGE_RESULT_SCHEMA,
  AgyImageGenProvider,
  agyImagePrintTimeoutMs,
  buildAgyImagePrompt,
  classifyAgyImageError,
  IMAGE_GEN_REFUSED_CODE,
  scrubAgyMessage,
} from './agy-image-gen.provider.js';
import { ImageGenError, type ImageGenRequest, type ImageGenResult } from './image-gen.port.js';

/**
 * agy 이미지 생성 공급자(M0 S1) — 가짜 agy(test/fixtures/ai-engine/bin)와 S1 녹화본(test/fixtures/image-gen)으로 본다.
 * 진짜 agy·사용자 홈(~/.gemini)은 쓰지 않는다: 자식 HOME을 임시 폴더로 바꾸고 가짜 agy가 그 아래 brain 폴더에 결과를 둔다.
 */
const IMAGE_FIXTURES = join(import.meta.dirname, '../../../../test/fixtures/image-gen');
const fixture = (name: string) => join(IMAGE_FIXTURES, name);

/** 녹화본(agy-edit-success-json)의 대화 id·결과 파일 이름 */
const SUCCESS_CONV = '00000000-0000-4000-8000-000000000002';
const SUCCESS_FILE = 'thumbnail_1790895914530.jpg';
const PROMPT =
  'Photorealistic studio product photo, square 1:1, 1024 pixels.\nModel framing: full face.';
const HARD_TIMEOUT_MS = 900_000;
/** 가짜 agy 프로세스를 띄우는 테스트의 시간 제한(전체 실행 중 부하로 5초 기본값을 넘을 수 있다) */
const SPAWN_TIMEOUT_MS = 20_000;

interface LogRow {
  start: CallLogStart;
  result: CallLogResult | null;
}

function memoryCallLog() {
  const rows: LogRow[] = [];
  return {
    rows,
    start(input: CallLogStart) {
      rows.push({ start: input, result: null });
      return Promise.resolve({ id: rows.length } as never);
    },
    finish(id: number, result: CallLogResult) {
      rows[id - 1]!.result = result;
      return Promise.resolve(true);
    },
  };
}

const clock: Clock = {
  now: () => new Date('2026-10-02T01:00:00Z'),
  sleep: () => Promise.resolve(),
};

async function errorOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

describe('AgyImageGenProvider(M0 S1 — agy generate_image, D-19)', () => {
  let world: FakeCliWorld;
  let home: string;
  let refDir: string;
  let refPath: string;
  let generatedPath: string;
  let generated: Buffer;
  let callLog: ReturnType<typeof memoryCallLog>;
  let provider: AgyImageGenProvider;

  const brainDir = (conv: string) => join(home, '.gemini', 'antigravity-cli', 'brain', conv);

  function request(patch: Partial<ImageGenRequest> = {}): ImageGenRequest {
    return {
      identity: { provider: 'AGY', model: AGY_IMAGE_AGENT_MODEL, providerVersion: null },
      prompt: PROMPT,
      referenceImagePaths: [refPath],
      sizePx: 1024,
      timeoutMs: HARD_TIMEOUT_MS,
      signal: new AbortController().signal,
      stepRunId: 9,
      candidateId: 3,
      ...patch,
    };
  }

  function scenario(run: NonNullable<FakeCliScenario['run']>): void {
    world.setScenario({ agy: { run } });
  }

  const successRun = (): NonNullable<FakeCliScenario['run']> => ({
    stdout: fixture('agy-edit-success-json.stdout.jsonl'),
    brain: { conversationId: SUCCESS_CONV, files: [{ name: SUCCESS_FILE, from: generatedPath }] },
  });

  beforeAll(async () => {
    refDir = mkdtempSync(join(tmpdir(), 'autostore-agy-ref-'));
    refPath = join(refDir, 'ref-original.jpg');
    writeFileSync(
      refPath,
      await sharp({ create: { width: 64, height: 48, channels: 3, background: '#335' } })
        .jpeg()
        .toBuffer(),
    );
    // agy는 2048을 요청해도 늘 1024×1024 JPEG를 낸다(S1 12/12). 요청 기본도 1024다(D-21)
    generatedPath = join(refDir, 'generated-1024.jpg');
    generated = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: '#ddd' },
    })
      .jpeg({ quality: 80 })
      .toBuffer();
    writeFileSync(generatedPath, generated);
  });

  afterAll(() => {
    rmSync(refDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    world = createFakeCliWorld(['agy']);
    home = mkdtempSync(join(tmpdir(), 'autostore-agy-home-'));
    world.env.HOME = home;
    callLog = memoryCallLog();
    provider = new AgyImageGenProvider(
      new IsolatedCliRunner({ env: world.env, killGraceMs: 50 }),
      callLog,
      clock,
      {
        brainRoot: join(home, '.gemini', 'antigravity-cli', 'brain'),
      },
    );
  });

  afterEach(() => {
    world.cleanup();
    rmSync(home, { recursive: true, force: true });
  });

  it(
    '성공(녹화본 json): brain/<대화 id>/ 아래 결과 파일을 읽는다. 요청 2048 → 실제 1024여도 실패가 아니다',
    async () => {
      scenario(successRun());
      // 오너가 설정 파일에 2048을 둔 경우(전 기본값): 요청과 실제 크기가 달라도 성공이다
      const result = await provider.generate(request({ sizePx: 2048 }));
      if (result.kind !== 'IMAGE') throw new Error('이미지가 아닙니다');
      expect(result.fileName).toBe(SUCCESS_FILE);
      expect(result.bytes.equals(generated)).toBe(true);
      await expect(sharp(result.bytes).metadata()).resolves.toMatchObject({
        format: 'jpeg',
        width: 1024,
        height: 1024,
      });
      // 버전은 부르기 전 감지(--version, 비용 없음)로 읽고 다음 identify에 쓴다
      expect(provider.identify()).toEqual({
        provider: 'AGY',
        model: AGY_IMAGE_AGENT_MODEL,
        providerVersion: '1.2.9',
      });
      expect(callLog.rows).toEqual([
        {
          start: {
            target: 'AI_AGY_CLI',
            calledAt: clock.now(),
            candidateId: 3,
            stepRunId: 9,
          },
          result: expect.objectContaining({ succeeded: true, errorCode: null }) as CallLogResult,
        },
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '크기 후처리(D-21): 기본 요청 1024 → agy 1024 결과는 ⑧ 업로드 정규화가 1000×1000 JPEG로 바꾼다(공급자는 바이트를 바꾸지 않는다)',
    async () => {
      scenario(successRun());
      const result = await provider.generate(request());
      if (result.kind !== 'IMAGE') throw new Error('이미지가 아닙니다');
      const normalized = await normalizeForUpload(result.bytes);
      expect(normalized).toMatchObject({
        mimeType: 'image/jpeg',
        width: 1000,
        height: 1000,
        detectedMime: 'image/jpeg',
        sourceWidth: 1024,
        sourceHeight: 1024,
      });
      await expect(sharp(normalized.buffer).metadata()).resolves.toMatchObject({
        format: 'jpeg',
        width: 1000,
        height: 1000,
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '최소 권한 호출(S1): 권한 플래그 없음, 레퍼런스 복사본만, 빈 cwd, 자동 업데이트 끔, 끝나면 작업 폴더 삭제',
    async () => {
      scenario(successRun());
      await provider.generate(request());
      const records = world.records();
      expect(records.map((r) => r.kind)).toEqual(['version', 'run']);
      const run = records[1]!;
      const args = run.argv;
      const value = (flag: string) => args[args.indexOf(flag) + 1];
      expect(args.slice(0, 1)).toEqual(['-p']);
      expect(value('--model')).toBe(AGY_IMAGE_AGENT_MODEL);
      expect(value('--output-format')).toBe('json');
      expect(value('--json-schema')).toBe(JSON.stringify(AGY_IMAGE_RESULT_SCHEMA));
      // 하드 900초 - 20초
      expect(value('--print-timeout')).toBe('880s');
      expect(args.at(-1)).toBe('--disable-slash-commands');
      for (const flag of ['--dangerously-skip-permissions', '--mode', '--yolo']) {
        expect(args).not.toContain(flag);
      }
      // 레퍼런스는 이번 호출 이미지 폴더의 복사본(image-1.jpg)만 넘긴다 — 원본 경로는 프롬프트에 없다
      expect(run.addDirEntries).toEqual(['image-1.jpg']);
      const copy = join(run.addDir!, 'image-1.jpg');
      const prompt = value('-p')!;
      expect(prompt).toBe(buildAgyImagePrompt(PROMPT, [copy]));
      expect(prompt).toContain(`<thumbnail_prompt>\n${PROMPT}\n</thumbnail_prompt>`);
      expect(prompt).not.toContain(refPath);
      expect(run.cwdEntries).toEqual([]);
      expect(run.stdin).not.toBe('pipe');
      expect(run.agyDisableAutoUpdate).toBe('true');
      expect(run.envNames).not.toContain('GEMINI_API_KEY');
      expect(run.envNames).not.toContain('ANTHROPIC_API_KEY');
      expect(existsSync(run.cwd)).toBe(false);
      expect(existsSync(run.addDir!)).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '테스트 도구 보호: 가짜 agy는 HOME이 임시 폴더가 아니면 brain 파일을 쓰지 않고 실패한다(사용자 홈 보호)',
    async () => {
      // 없는 최상위 폴더 — 보호가 깨져도 만들 수 없는 곳이다
      world.env.HOME = '/nonexistent-autostore-fake-home';
      scenario(successRun());
      const err = await errorOf(provider.generate(request()));
      expect(err).toMatchObject({ code: AI_RUN_ERROR_CODES.CLI_FAILED });
      expect(existsSync('/nonexistent-autostore-fake-home')).toBe(false);
      // 세계의 기본 HOME은 세계 폴더 안 임시 홈이다
      const fresh = createFakeCliWorld([]);
      try {
        expect(fresh.env.HOME).toBe(join(fresh.dir, 'home'));
      } finally {
        fresh.cleanup();
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '버전 감지(--version)는 버전을 모를 때만 한다 — 두 번째 생성은 바로 부른다',
    async () => {
      scenario(successRun());
      await provider.generate(request());
      await provider.generate(request());
      expect(world.records().map((r) => r.kind)).toEqual(['version', 'run', 'run']);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    'image_path가 brain 폴더 밖이면 믿지 않고, 그 폴더 맨 위 이미지가 1개면 그것을 쓴다',
    async () => {
      const envelope = JSON.parse(
        readFileSync(fixture('agy-edit-success-json.stdout.jsonl'), 'utf8'),
      ) as Record<string, unknown>;
      envelope.structured_output = { error: null, image_path: generatedPath };
      scenario({
        stdout: { text: JSON.stringify(envelope) },
        brain: {
          conversationId: SUCCESS_CONV,
          files: [{ name: 'thumbnail_1.jpg', from: generatedPath }],
        },
      });
      const result = await provider.generate(request());
      expect(result).toMatchObject({ kind: 'IMAGE', fileName: 'thumbnail_1.jpg' });
    },
    SPAWN_TIMEOUT_MS,
  );

  it.each([
    ['결과 파일이 없다(brain 폴더 없음)', undefined],
    ['brain 폴더에 이미지가 2개라 고를 수 없다', ['a.jpg', 'b.png']],
  ])(
    '출력 없음 — %s → ImageGenError(AI_OUTPUT_INVALID), call_log 실패',
    async (_name, files) => {
      const envelope = JSON.parse(
        readFileSync(fixture('agy-edit-success-json.stdout.jsonl'), 'utf8'),
      ) as Record<string, unknown>;
      // brain 밖의 실제 파일을 가리켜도 읽지 않는다
      envelope.structured_output = { error: null, image_path: generatedPath };
      scenario({
        stdout: { text: JSON.stringify(envelope) },
        ...(files
          ? {
              brain: {
                conversationId: SUCCESS_CONV,
                files: files.map((name) => ({ name, from: generatedPath })),
              },
            }
          : {}),
      });
      const err = await errorOf(provider.generate(request()));
      expect(err).toBeInstanceOf(ImageGenError);
      expect(err).toMatchObject({
        code: AI_RUN_ERROR_CODES.OUTPUT_INVALID,
        userMessage: AGY_IMAGE_MESSAGES.noImage,
      });
      expect(callLog.rows[0]!.result).toMatchObject({
        succeeded: false,
        errorCode: AI_RUN_ERROR_CODES.OUTPUT_INVALID,
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '녹화본 경로의 파일이 brain에 없으면(녹화본 그대로, 파일 안 만듦) 빈 결과로 실패한다',
    async () => {
      scenario({ stdout: fixture('agy-edit-success-json.stdout.jsonl') });
      mkdirSync(brainDir(SUCCESS_CONV), { recursive: true });
      const err = await errorOf(provider.generate(request()));
      expect(err).toMatchObject({ code: AI_RUN_ERROR_CODES.OUTPUT_INVALID });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '거부(합성본: structured_output.error IMAGE_SAFETY) → REFUSED + 사유, call_log IMAGE_GEN_REFUSED',
    async () => {
      scenario({ stdout: fixture('agy-synthetic-refused.json') });
      const result: ImageGenResult = await provider.generate(request());
      expect(result.kind).toBe('REFUSED');
      if (result.kind !== 'REFUSED') return;
      expect(result.reason).toMatch(/^이미지 모델이 생성을 거부했습니다: IMAGE_SAFETY/);
      expect(callLog.rows[0]!.result).toMatchObject({
        succeeded: false,
        errorCode: IMAGE_GEN_REFUSED_CODE,
        errorMessage: result.reason,
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '빈 SUCCESS(합성본: image_path "", error null) → ImageGenError(AI_OUTPUT_INVALID)',
    async () => {
      scenario({ stdout: fixture('agy-synthetic-empty-success.json') });
      const err = await errorOf(provider.generate(request()));
      expect(err).toMatchObject({
        code: AI_RUN_ERROR_CODES.OUTPUT_INVALID,
        userMessage: AGY_IMAGE_MESSAGES.noImage,
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '도구 오류(녹화본: 레퍼런스를 읽지 못함, SUCCESS·exit 0) → ImageGenError(AI_CLI_FAILED), 문구에 로컬 경로 없음',
    async () => {
      scenario({ stdout: fixture('agy-edit-tool-error-missing-ref.result.json') });
      const err = await errorOf(provider.generate(request()));
      expect(err).toBeInstanceOf(ImageGenError);
      const message = (err as ImageGenError).userMessage;
      expect((err as ImageGenError).code).toBe(AI_RUN_ERROR_CODES.CLI_FAILED);
      expect(message).toContain('레퍼런스 이미지를 읽지 못했습니다');
      expect(message).toContain('<경로>');
      expect(message).not.toMatch(/\/(?:private|var|tmp|Users)\//);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '시간 초과(녹화본: stderr print timeout, SUCCESS·exit 0, structured_output 없음) → ImageGenError(AI_TIMEOUT)',
    async () => {
      scenario({
        stdout: fixture('agy-edit-print-timeout.result.json'),
        stderr: fixture('agy-edit-print-timeout.stderr.txt'),
      });
      const err = await errorOf(provider.generate(request()));
      expect(err).toMatchObject({
        code: AI_RUN_ERROR_CODES.TIMEOUT,
        userMessage: AGY_IMAGE_MESSAGES.timeout(880),
      });
      expect(callLog.rows[0]!.result).toMatchObject({
        succeeded: false,
        errorCode: AI_RUN_ERROR_CODES.TIMEOUT,
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '하드 타임아웃(signal) → 자식을 끝내고 signal 이유로 거절, 작업 폴더 삭제, call_log ABORTED',
    async () => {
      scenario({ ...successRun(), sleepMs: 10_000 });
      const controller = new AbortController();
      const started = Date.now();
      const pending = errorOf(provider.generate(request({ signal: controller.signal })));
      // 가짜 agy가 실행 기록을 남길 때까지 기록 파일을 본다(조건 대기)
      while (!world.records().some((r) => r.kind === 'run')) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      controller.abort(new Error('image generation timeout'));
      const err = await pending;
      expect(Date.now() - started).toBeLessThan(5000);
      expect(err).toEqual(new Error('image generation timeout'));
      const run = world.records().find((r) => r.kind === 'run')!;
      expect(existsSync(run.cwd)).toBe(false);
      expect(callLog.rows[0]!.result).toMatchObject({ succeeded: false, errorCode: 'ABORTED' });
      // 끝나기 전에 끊겨 결과 파일을 만들지 않았다
      expect(existsSync(brainDir(SUCCESS_CONV))).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '이미 끊긴 signal이면 감지도 spawn도 하지 않는다',
    async () => {
      const controller = new AbortController();
      controller.abort(new Error('cancelled'));
      await expect(provider.generate(request({ signal: controller.signal }))).rejects.toThrow(
        'cancelled',
      );
      expect(world.records()).toEqual([]);
      expect(callLog.rows).toEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    '기록 모델이 Google 모델(gemini-*)이 아니면 감지·spawn·call_log 없이 ImageGenError(AI_ENGINE_UNAVAILABLE) — R12',
    async () => {
      scenario(successRun());
      for (const model of ['claude-sonnet-4-5', 'gpt-oss-120b', 'fake-image-gen']) {
        const err = await errorOf(
          provider.generate(
            request({ identity: { provider: 'AGY', model, providerVersion: null } }),
          ),
        );
        expect(err).toBeInstanceOf(ImageGenError);
        expect(err).toMatchObject({
          code: AI_RUN_ERROR_CODES.ENGINE_UNAVAILABLE,
          userMessage: AGY_IMAGE_MESSAGES.modelNotAllowed(model),
        });
      }
      expect(world.records()).toEqual([]);
      expect(callLog.rows).toEqual([]);
      // 비어 있으면 기본 에이전트 모델로 부른다
      await provider.generate(
        request({ identity: { provider: 'AGY', model: ' ', providerVersion: null } }),
      );
      const run = world.records().find((r) => r.kind === 'run')!;
      expect(run.argv[run.argv.indexOf('--model') + 1]).toBe(AGY_IMAGE_AGENT_MODEL);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    'agy가 없으면 ImageGenError(AI_ENGINE_UNAVAILABLE) — call_log·spawn 없음',
    async () => {
      const empty = createFakeCliWorld([]);
      try {
        const p = new AgyImageGenProvider(
          new IsolatedCliRunner({ env: empty.env }),
          callLog,
          clock,
          {
            brainRoot: join(home, 'brain'),
          },
        );
        const err = await errorOf(p.generate(request()));
        expect(err).toMatchObject({
          code: AI_RUN_ERROR_CODES.ENGINE_UNAVAILABLE,
          userMessage: AGY_IMAGE_MESSAGES.notInstalled,
        });
        expect(callLog.rows).toEqual([]);
        expect(p.identify().providerVersion).toBeNull();
      } finally {
        empty.cleanup();
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it.each([
    [
      'stderr AGY_ERROR + exit 3(쿼터·서비스 오류)',
      {
        stdout: { text: '' },
        stderr: join(AI_FIXTURE_ROOT, 'agy/agy-error.stderr.txt'),
        exit: 3,
      },
      AI_RUN_ERROR_CODES.AGY_ERROR,
      AGY_IMAGE_MESSAGES.agyError,
    ],
    [
      '도구 권한 거부(denied_actions, SUCCESS)',
      { stdout: join(AI_FIXTURE_ROOT, 'agy/denied-command.json') },
      AI_RUN_ERROR_CODES.CLI_FAILED,
      AGY_IMAGE_MESSAGES.cliFailed('도구 권한 거부 1건'),
    ],
    [
      '로그인 풀림(status ≠ SUCCESS)',
      {
        stdout: {
          text: '{"conversation_id":"","status":"ERROR","response":"You are not logged into Antigravity"}',
        },
      },
      AI_RUN_ERROR_CODES.ENGINE_UNAVAILABLE,
      AGY_IMAGE_MESSAGES.notLoggedIn,
    ],
    [
      'JSON 봉투가 아님',
      { stdout: { text: 'not json' } },
      AI_RUN_ERROR_CODES.OUTPUT_INVALID,
      AGY_IMAGE_MESSAGES.noImage,
    ],
  ])(
    '실패 매핑 — %s',
    async (_name, run, code, message) => {
      scenario(run);
      const err = await errorOf(provider.generate(request()));
      expect(err).toBeInstanceOf(ImageGenError);
      expect(err).toMatchObject({ code, userMessage: message });
      expect(callLog.rows[0]!.result).toMatchObject({ succeeded: false, errorCode: code });
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe('agy 이미지 생성 순수 함수(M0 S1)', () => {
  it('--print-timeout = 하드 - min(20초, 하드/2). 0·음수·NaN은 오류(무제한 금지)', () => {
    expect(agyImagePrintTimeoutMs(900_000)).toBe(880_000);
    expect(agyImagePrintTimeoutMs(300_000)).toBe(280_000);
    expect(agyImagePrintTimeoutMs(10_000)).toBe(5_000);
    for (const ms of [0, -1, Number.NaN]) {
      expect(() => agyImagePrintTimeoutMs(ms)).toThrow(/무제한/);
    }
  });

  it('감싸는 지시문: S1 문구 그대로, ImagePaths는 JSON 문자열, 프롬프트는 태그 안에 글자 그대로', () => {
    const text = buildAgyImagePrompt('A\nB', ['/tmp/x/image-1.jpg', '/tmp/x/image-2.png']);
    expect(text).toContain(
      '   - ImagePaths: ["/tmp/x/image-1.jpg", "/tmp/x/image-2.png"] (reference photo of the product;',
    );
    expect(text).toContain('   - ImageName: "thumbnail"');
    expect(text).toContain('no shell commands, no directory listing, no file viewing');
    expect(text.endsWith('<thumbnail_prompt>\nA\nB\n</thumbnail_prompt>')).toBe(true);
  });

  it('오류 분류: 종료 사유 이름·거부 문구는 거부, 레퍼런스 읽기·파일·권한·쿼터 오류는 거부가 아니다', () => {
    for (const text of [
      'IMAGE_SAFETY',
      'IMAGE_PROHIBITED_CONTENT',
      'finish reason NO_IMAGE',
      'failed to generate image: finish reason IMAGE_SAFETY',
      'blocked by policy',
      'Image generation was blocked by our safety policy',
      'The model refused',
      'The request violates our content policy',
    ]) {
      expect([text, classifyAgyImageError(text)]).toEqual([text, 'REFUSED']);
    }
    expect(classifyAgyImageError('failed to read image file: /tmp/a.jpg')).toBe(
      'REFERENCE_UNREADABLE',
    );
    // 넓은 낱말(policy·blocked·safety)이 섞인 도구·시스템 오류는 거부로 보지 않는다
    for (const text of [
      'failed to read image file: /tmp/policy/a.jpg: open: permission denied',
      'open /tmp/blocked/safety.jpg: no such file or directory',
      'write output: permission denied (blocked by sandbox policy)',
      'RESOURCE_EXHAUSTED: quota exceeded for this policy window',
      'upstream request blocked: connection reset',
      'image tool crashed',
    ]) {
      expect([text, classifyAgyImageError(text)]).not.toEqual([text, 'REFUSED']);
    }
  });

  it('공급자 글 정리: 로컬 경로를 지우고 300자로 줄인다', () => {
    expect(
      scrubAgyMessage(
        'failed to read image file: /private/var/folders/x/T/autostore-ai-img-1/image-1.jpg: open /Users/a/b.jpg: no such file',
      ),
    ).toBe('failed to read image file: <경로>: open <경로>: no such file');
    expect(scrubAgyMessage('x'.repeat(400))).toHaveLength(301);
  });
});

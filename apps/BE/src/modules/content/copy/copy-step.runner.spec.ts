import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createFakeAiEngines,
  type FakeAiEngines,
} from '../../../../test/support/fake-ai-engines.js';
import {
  AI_RUN_ERROR_CODES,
  AiCallFailedError,
  AiEngineUnavailableError,
  AiOutputInvalidError,
} from '../../integrations/ai-engine/ai-engine.errors.js';
import { AI_ENGINE_ADAPTERS } from '../../integrations/ai-engine/ai-engine.port.js';
import { AiExecutor } from '../../integrations/ai-engine/ai-executor.service.js';
import type { PinnedAiContext } from '../../integrations/ai-engine/ai-executor.types.js';
import {
  CallLogService,
  type CallLogResult,
  type CallLogStart,
} from '../../integrations/http/call-log.service.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import type { StepRunContext } from '../../step-engine/contracts/step-runner.js';
import type { SourcingItemContentView } from '../../step-engine/ports/sourcing-selection.port.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import { CopyOwnerEditHandler } from './copy-owner-edit.handler.js';
import { COPY_AI_MAX_ATTEMPTS, CopyStepRunner, isCopyGeneratedOutput } from './copy-step.runner.js';
import type { CopyDraft } from './copy.schema.js';

/**
 * D-17(`F-CT-41`, AI-04 일부): ⑥-1 카피 AI 결과가 앱 검증에서 떨어지면(`AI_OUTPUT_INVALID`) 같은 엔진·모델로 1회 바로 다시 부른다.
 * 실제 `AiExecutor`(재검증·call_log)를 DI로 넣고, 어댑터·call_log·② 창구만 가짜로 바꾼다(진짜 CLI·DB 없음).
 */

const AI_DIR = join(import.meta.dirname, '../../../../test/fixtures/content/ai');
const load = (name: string) =>
  JSON.parse(readFileSync(join(AI_DIR, `${name}.json`), 'utf8')) as Record<string, unknown>;
const COPY_OK = load('copy-ok') as unknown as CopyDraft;

/** call_log 메모리 가짜(행 = start 인자 + finish 결과) */
class FakeCallLog {
  readonly rows: { id: number; start: CallLogStart; result: CallLogResult | null }[] = [];
  start(input: CallLogStart) {
    const row = { id: this.rows.length + 1, start: input, result: null };
    this.rows.push(row);
    return Promise.resolve({ id: row.id });
  }
  finish(id: number, result: CallLogResult) {
    this.rows[id - 1]!.result = result;
    return Promise.resolve(true);
  }
}

const clock: Clock = {
  now: () => new Date('2026-10-02T00:00:00Z'),
  sleep: () => Promise.resolve(),
};

const CONTENT: SourcingItemContentView = {
  sourcingStepRunId: 11,
  rakutenItemId: 5,
  itemCode: 'shop-a:10000123',
  itemUrl: 'https://item.rakuten.co.jp/shop-a/10000123/',
  itemName: 'アシックス ゲルカヤノ14 クリーム/ブラック',
  modelCode: '1201A019-108',
  descriptionText: 'かかとにGEL搭載、衝撃緩衝性に優れる。2008年発売モデルを復刻。',
  descriptionHtml: null,
  itemAttributes: [{ name: 'カラー', value: 'クリーム/ブラック' }],
  skuAttributes: [],
  selectedColorRaw: 'クリーム/ブラック',
  collectedAt: new Date('2026-09-28T00:00:00Z'),
};

const pinned = (patch: Partial<PinnedAiContext> = {}): PinnedAiContext => ({
  engine: 'CLAUDE',
  textModel: 'sonnet',
  visionModel: 'sonnet',
  cliVersion: '2.1.269',
  settingsSnapshotId: 1,
  stepRunId: 90,
  candidateId: 3,
  ...patch,
});

function runCtx(ai: PinnedAiContext = pinned()): StepRunContext {
  return {
    stepRunId: 90,
    candidateId: 3,
    stepCode: 'COPY',
    version: 1,
    executionMode: 'STEP',
    stepChainId: null,
    settingsSnapshotId: 1,
    settings: DEFAULT_SETTINGS,
    inputs: [],
    ownerInputs: {},
    previous: null,
    resume: null,
    ownerEdit: null,
    aiEngine: { aiEngine: ai.engine, aiModel: ai.textModel ?? '', aiCliVersion: ai.cliVersion },
    pinnedAi: ai,
  };
}

/** 가짜 결과 하나: 녹화 이름(`ai/<name>.json`) 또는 던질 오류 */
type Scripted = string | Error;

describe('⑥-1 CopyStepRunner — D-17 결과 검증 실패 때 1회 다시 부르기(F-CT-41)', () => {
  const originalWarn = Logger.prototype.warn;
  let ai: FakeAiEngines;
  let callLog: FakeCallLog;
  let runner: CopyStepRunner;
  /** 앱 로그 warn 호출(인자 그대로) */
  let warns: unknown[][];

  /** 고른 엔진의 가짜 어댑터가 부른 순서대로 답한다(다 쓰면 마지막 것을 되풀이) */
  const script = (engine: 'claude' | 'agy', ...outputs: Scripted[]) => {
    let n = 0;
    ai[engine].runImpl = () => {
      const next = outputs[Math.min(n, outputs.length - 1)]!;
      n += 1;
      if (next instanceof Error) throw next;
      return load(next);
    };
  };
  const failureOf = async (ctx: StepRunContext): Promise<unknown> => {
    try {
      await runner.run(ctx);
    } catch (error) {
      return error;
    }
    throw new Error('실행기가 던지지 않았다');
  };

  beforeEach(async () => {
    ai = createFakeAiEngines();
    callLog = new FakeCallLog();
    warns = [];
    Logger.prototype.warn = (...args: unknown[]) => {
      warns.push(args);
    };
    const api = {
      currentCompletedRun: () => Promise.resolve({ id: CONTENT.sourcingStepRunId }),
      readSourcingItemContent: () => Promise.resolve(CONTENT),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CopyStepRunner,
        AiExecutor,
        { provide: AI_ENGINE_ADAPTERS, useValue: ai.adapters },
        { provide: CallLogService, useValue: callLog },
        { provide: CLOCK, useValue: clock },
        { provide: StepEngineApi, useValue: api },
        { provide: CopyOwnerEditHandler, useValue: {} },
      ],
    }).compile();
    runner = moduleRef.get(CopyStepRunner);
  });

  afterEach(() => {
    Logger.prototype.warn = originalWarn;
  });

  it('첫 결과가 맞으면 1회만 부른다(call_log 1행, 다시 부르기 로그 없음)', async () => {
    script('claude', 'copy-ok');
    const outcome = await runner.run(runCtx());
    expect(outcome.kind).toBe('COMPLETED');
    const output = outcome.kind === 'COMPLETED' ? outcome.output : null;
    expect(isCopyGeneratedOutput(output) && output.generatedCopy).toEqual(COPY_OK);
    expect(ai.claude.calls.runStructured).toHaveLength(1);
    expect(callLog.rows.map((r) => r.result?.succeeded)).toEqual([true]);
    expect(warns).toHaveLength(0);
  });

  it.each([
    [
      '모양 깨짐 — body에 결과 JSON(S7 C03 모양)',
      'copy-body-json',
      '모양 깨짐: /body에 결과 JSON이 들어감',
    ],
    [
      '모양 깨짐 — placeholder(S7 C08 모양)',
      'copy-placeholder',
      '모양 깨짐: /headline가 자리 표시 글',
    ],
    ['스키마 불일치 — 헤드라인 41자', 'copy-headline-41', '스키마 불일치: /headline maxLength'],
    ['스키마 불일치 — 추가 필드', 'copy-extra-field', '스키마 불일치: / additionalProperties'],
  ])(
    '첫 결과가 검증에서 떨어지면(%s) 같은 엔진·모델·입력으로 1회 다시 불러 두 번째 결과로 완료한다',
    async (_label, fixture, detail) => {
      script('claude', fixture, 'copy-ok');
      const outcome = await runner.run(runCtx());

      expect(outcome.kind).toBe('COMPLETED');
      const output = outcome.kind === 'COMPLETED' ? outcome.output : null;
      expect(isCopyGeneratedOutput(output) && output.generatedCopy).toEqual(COPY_OK);

      // 정확히 2회, 같은 고정 엔진(CLAUDE)·모델·작업·시간 제한·스키마·프롬프트
      const calls = ai.claude.calls.runStructured;
      expect(calls).toHaveLength(COPY_AI_MAX_ATTEMPTS);
      expect(COPY_AI_MAX_ATTEMPTS).toBe(2);
      for (const call of calls) {
        expect(call).toMatchObject({ task: 'CT-01', model: 'sonnet', imagePaths: [] });
      }
      expect(calls[1]!.timeoutMs).toBe(calls[0]!.timeoutMs);
      expect(calls[1]!.promptLength).toBe(calls[0]!.promptLength);
      expect(calls[1]!.schema).toEqual(calls[0]!.schema);
      expect(ai.agy.calls.runStructured).toHaveLength(0);
      expect(ai.codex.calls.runStructured).toHaveLength(0);

      // 두 호출 모두 AiExecutor를 지나 call_log에 남는다(같은 step_run_id, id 순서 = 시도 순서)
      expect(callLog.rows).toHaveLength(2);
      for (const row of callLog.rows) {
        expect(row.start).toMatchObject({ target: 'AI_CLAUDE_CLI', stepRunId: 90, candidateId: 3 });
      }
      expect(callLog.rows[0]!.result).toMatchObject({
        succeeded: false,
        errorCode: AI_RUN_ERROR_CODES.OUTPUT_INVALID,
      });
      expect(callLog.rows[1]!.result).toMatchObject({ succeeded: true });

      // 다시 부를 때 앱 로그 1줄: 시도 번호·사유(필드 경로뿐 — 값·출력 본문 없음)
      expect(warns).toHaveLength(1);
      expect(warns[0]![0]).toEqual({
        stepRunId: 90,
        task: 'CT-01',
        engine: 'CLAUDE',
        attempt: 1,
        nextAttempt: 2,
        errorCode: AI_RUN_ERROR_CODES.OUTPUT_INVALID,
        detail,
      });
      const logged = JSON.stringify(warns);
      const bad = load(fixture);
      expect(logged).not.toContain(String(bad.headline));
      expect(logged).not.toContain(String(bad.body).slice(0, 20));
    },
  );

  it('두 번 다 떨어지면 두 번째 오류를 바꾸지 않고 던진다 — 정확히 2회(셋째 호출 없음)', async () => {
    script('claude', 'copy-body-json', 'copy-headline-41');
    const error = await failureOf(runCtx());
    expect(error).toBeInstanceOf(AiOutputInvalidError);
    // 엔진(toFailure)이 이 값으로 FAILED(AI, AI_OUTPUT_INVALID)를 만든다 — 지금과 같다
    expect(error).toMatchObject({
      failureKind: 'AI',
      errorCode: AI_RUN_ERROR_CODES.OUTPUT_INVALID,
      detail: '스키마 불일치: /headline maxLength',
    });
    expect(ai.claude.calls.runStructured).toHaveLength(2);
    expect(callLog.rows.map((r) => r.result?.errorCode)).toEqual([
      AI_RUN_ERROR_CODES.OUTPUT_INVALID,
      AI_RUN_ERROR_CODES.OUTPUT_INVALID,
    ]);

    script('claude', 'copy-placeholder');
    ai.resetCalls();
    expect(await failureOf(runCtx())).toBeInstanceOf(AiOutputInvalidError);
    expect(ai.claude.calls.runStructured).toHaveLength(2);
    expect(warns).toHaveLength(2);
  });

  it.each([
    ['시간 초과', new AiCallFailedError('CLAUDE', AI_RUN_ERROR_CODES.TIMEOUT, '120초')],
    [
      'CLI 실패(한도·쿼터 포함)',
      new AiCallFailedError('CLAUDE', AI_RUN_ERROR_CODES.CLI_FAILED, 'exit 1'),
    ],
    ['AGY_ERROR', new AiCallFailedError('AGY', AI_RUN_ERROR_CODES.AGY_ERROR, 'exit 3')],
    ['엔진 사용 불가', new AiEngineUnavailableError('CLAUDE', 'NOT_LOGGED_IN')],
    [
      '이미지 읽음 확인 실패(AI_IMAGES_NOT_SEEN)',
      new AiOutputInvalidError(AI_RUN_ERROR_CODES.IMAGES_NOT_SEEN, 'images_seen 없음'),
    ],
    ['앱 오류', new Error('뜻밖의 오류')],
  ])('%s는 다시 부르지 않는다 — 1회, 오류 그대로', async (_label, thrown) => {
    script('claude', thrown, 'copy-ok');
    expect(await failureOf(runCtx())).toBe(thrown);
    expect(ai.claude.calls.runStructured).toHaveLength(1);
    expect(callLog.rows).toHaveLength(1);
    expect(warns).toHaveLength(0);
  });

  it('고정 모델이 없으면(MODEL_NOT_SET) 부르지도 다시 부르지도 않는다(call_log 없음)', async () => {
    script('claude', 'copy-body-json', 'copy-ok');
    const error = await failureOf(runCtx(pinned({ textModel: null })));
    expect(error).toBeInstanceOf(AiEngineUnavailableError);
    expect(ai.claude.calls.runStructured).toHaveLength(0);
    expect(callLog.rows).toHaveLength(0);
  });

  it.each([
    ['엔진을 쓸 수 없게 되면', new AiEngineUnavailableError('CLAUDE', 'NOT_LOGGED_IN')],
    ['시간 초과면', new AiCallFailedError('CLAUDE', AI_RUN_ERROR_CODES.TIMEOUT, '120초')],
  ])('두 번째 호출에서 %s 그 오류로 끝난다 — 셋째 호출·다른 엔진 없음', async (_label, thrown) => {
    script('claude', 'copy-body-json', thrown);
    expect(await failureOf(runCtx())).toBe(thrown);
    expect(ai.claude.calls.runStructured).toHaveLength(2);
    expect(ai.agy.calls.runStructured).toHaveLength(0);
    expect(callLog.rows.map((r) => r.result?.errorCode)).toEqual([
      AI_RUN_ERROR_CODES.OUTPUT_INVALID,
      thrown.errorCode,
    ]);
  });

  it('고정 엔진이 AGY면 두 호출 모두 AGY·같은 모델이다(설정·다른 엔진을 다시 읽지 않는다)', async () => {
    const agy = pinned({
      engine: 'AGY',
      textModel: 'gemini-3.8-flash-medium',
      cliVersion: '1.2.14',
    });
    script('agy', 'copy-placeholder', 'copy-ok');
    const outcome = await runner.run(runCtx(agy));
    expect(outcome.kind).toBe('COMPLETED');
    expect(ai.agy.calls.runStructured.map((c) => c.model)).toEqual([
      'gemini-3.8-flash-medium',
      'gemini-3.8-flash-medium',
    ]);
    expect(ai.claude.calls.runStructured).toHaveLength(0);
    expect(callLog.rows.map((r) => r.start.target)).toEqual(['AI_AGY_CLI', 'AI_AGY_CLI']);
  });
});

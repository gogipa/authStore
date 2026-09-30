import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { muteNestLogger } from '../../../../test/support/commerce-meta-kit.js';
import {
  createFakeAiEngines,
  type FakeAiEngines,
} from '../../../../test/support/fake-ai-engines.js';
import type { CallLogResult, CallLogService, CallLogStart } from '../http/call-log.service.js';
import type { Clock } from '../http/clock.token.js';
import {
  AI_RUN_ERROR_CODES,
  AiEngineUnavailableError,
  AiInputBlockedError,
  AiOutputInvalidError,
  AiSchemaRuleError,
} from './ai-engine.errors.js';
import { AiExecutor } from './ai-executor.service.js';
import type { PinnedAiContext } from './ai-executor.types.js';

const SCHEMA = {
  type: 'object',
  properties: { match: { type: 'boolean' }, reason: { type: ['string', 'null'] } },
  required: ['match', 'reason'],
  additionalProperties: false,
};

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
  now: () => new Date('2026-09-28T00:00:00Z'),
  sleep: () => Promise.resolve(),
};

const pinned = (patch: Partial<PinnedAiContext> = {}): PinnedAiContext => ({
  engine: 'CLAUDE',
  textModel: 'sonnet',
  visionModel: 'opus',
  cliVersion: '2.1.269',
  settingsSnapshotId: 7,
  stepRunId: 41,
  candidateId: 13,
  ...patch,
});

const input = {
  instruction: '같은 상품인지 판정하라.',
  blocks: [{ source: 'RAKUTEN' as const, label: '상품명', text: 'アシックス ゲルカヤノ14' }],
};

describe('AiExecutor(P1-10 실행기 — 가드 → call_log → 어댑터 → 재검증)', () => {
  muteNestLogger();
  let ai: FakeAiEngines;
  let callLog: FakeCallLog;
  let executor: AiExecutor;

  beforeEach(() => {
    ai = createFakeAiEngines();
    ai.claude.runImpl = () => ({ match: true, reason: null });
    callLog = new FakeCallLog();
    executor = new AiExecutor(ai.adapters, callLog as unknown as CallLogService, clock);
  });

  it('규칙 15: 구조화 실행 1회 = call_log 1행(AI_CLAUDE_CLI·step_run_id·candidate_id), 끝나면 succeeded·duration. 프롬프트·출력 본문은 남기지 않는다', async () => {
    const result = await executor.run(pinned(), { name: 'RK-03', kind: 'TEXT' }, SCHEMA, input);
    expect(result).toMatchObject({
      output: { match: true, reason: null },
      imagesSeen: null,
      engine: 'CLAUDE',
      model: 'sonnet',
      cliVersion: '2.1.269',
      callLogId: 1,
      naverDataException: null,
    });
    expect(callLog.rows).toHaveLength(1);
    const [row] = callLog.rows;
    expect(row!.start).toEqual({
      target: 'AI_CLAUDE_CLI',
      calledAt: clock.now(),
      candidateId: 13,
      stepRunId: 41,
    });
    expect(row!.result).toMatchObject({ succeeded: true });
    expect(row!.result!.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(callLog.rows)).not.toMatch(/アシックス|같은 상품인지/);
    expect(ai.claude.calls.runStructured).toEqual([
      expect.objectContaining({ task: 'RK-03', model: 'sonnet', timeoutMs: 120_000 }),
    ]);
  });

  it('고정한 엔진의 어댑터만 부르고 모델은 ctx 값(비전 = visionModel·180s)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autostore-exec-'));
    try {
      writeFileSync(join(dir, 'a.jpg'), 'x');
      ai.agy.runImpl = () => ({ match: false, reason: '색이 다름', images_seen: ['image-1.jpg'] });
      const result = await executor.run(
        pinned({
          engine: 'AGY',
          textModel: 'gemini-3.8-flash-medium',
          visionModel: 'gemini-3.8-flash-high',
        }),
        { name: 'IM-04', kind: 'VISION' },
        SCHEMA,
        { ...input, imagePaths: [join(dir, 'a.jpg')] },
      );
      expect(result.output).toEqual({ match: false, reason: '색이 다름' });
      expect(result.imagesSeen).toEqual(['image-1.jpg']);
      expect(ai.agy.calls.runStructured).toEqual([
        expect.objectContaining({ model: 'gemini-3.8-flash-high', timeoutMs: 180_000 }),
      ]);
      expect(ai.claude.calls.runStructured).toHaveLength(0);
      expect(ai.codex.calls.runStructured).toHaveLength(0);
      expect(callLog.rows[0]!.start.target).toBe('AI_AGY_CLI');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('규칙 14: 비밀 패턴·네이버 출처 블록은 부르지 않는다(어댑터 0회, call_log 0행)', async () => {
    const secret = executor.run(pinned(), { name: 'CT-01', kind: 'TEXT' }, SCHEMA, {
      instruction: '카피를 써라',
      blocks: [{ source: 'OWNER_INPUT', text: 'client_secret=$2a$10$abcdefghijklmnopqrstuv' }],
    });
    await expect(secret).rejects.toBeInstanceOf(AiInputBlockedError);
    const naver = executor.run(pinned(), { name: 'CT-01', kind: 'TEXT' }, SCHEMA, {
      instruction: '카피를 써라',
      blocks: [{ source: 'NAVER_DATALAB', text: '러닝화' }],
    });
    await expect(naver).rejects.toMatchObject({ errorCode: AI_RUN_ERROR_CODES.INPUT_BLOCKED });
    expect(ai.totalRuns()).toBe(0);
    expect(callLog.rows).toHaveLength(0);
  });

  it('모델이 비었으면 spawn·call_log 없이 AI_ENGINE_UNAVAILABLE(MODEL_NOT_SET)', async () => {
    const err: unknown = await executor
      .run(pinned({ textModel: null }), { name: 'CT-01', kind: 'TEXT' }, SCHEMA, input)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiEngineUnavailableError);
    expect((err as AiEngineUnavailableError).reason).toBe('MODEL_NOT_SET');
    expect(ai.totalRuns()).toBe(0);
    expect(callLog.rows).toHaveLength(0);
  });

  it('규칙 7: 규칙을 어긴 스키마는 호출 전에 거부(call_log 없음)', async () => {
    await expect(
      executor.run(
        pinned(),
        { name: 'CT-01', kind: 'TEXT' },
        { ...SCHEMA, additionalProperties: true },
        input,
      ),
    ).rejects.toBeInstanceOf(AiSchemaRuleError);
    expect(callLog.rows).toHaveLength(0);
  });

  it('규칙 8: 어댑터가 무엇을 주든 다시 검증한다(추가 필드 → AI_OUTPUT_INVALID, call_log 실패로 채움)', async () => {
    ai.claude.runImpl = () => ({ match: true, reason: null, extra: 1 });
    const err: unknown = await executor
      .run(pinned(), { name: 'RK-03', kind: 'TEXT' }, SCHEMA, input)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiOutputInvalidError);
    expect(callLog.rows[0]!.result).toMatchObject({
      succeeded: false,
      errorCode: AI_RUN_ERROR_CODES.OUTPUT_INVALID,
    });
  });

  it('규칙 12: 어댑터가 AI_ENGINE_UNAVAILABLE을 던지면 다른 엔진을 부르지 않고 그대로 던진다', async () => {
    ai.claude.runImpl = () => {
      throw new AiEngineUnavailableError('CLAUDE', 'NOT_INSTALLED');
    };
    await expect(
      executor.run(pinned(), { name: 'RK-03', kind: 'TEXT' }, SCHEMA, input),
    ).rejects.toMatchObject({ reason: 'NOT_INSTALLED', errorCode: 'AI_ENGINE_UNAVAILABLE' });
    expect(ai.agy.calls.runStructured).toHaveLength(0);
    expect(ai.codex.calls.runStructured).toHaveLength(0);
    expect(callLog.rows[0]!.result).toMatchObject({
      succeeded: false,
      errorCode: 'AI_ENGINE_UNAVAILABLE',
    });
  });

  it('비전: images_seen이 넘긴 이미지와 다르면 AI_IMAGES_NOT_SEEN', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autostore-exec-'));
    try {
      writeFileSync(join(dir, 'a.jpg'), 'x');
      writeFileSync(join(dir, 'b.jpg'), 'x');
      ai.claude.runImpl = () => ({ match: true, reason: null, images_seen: ['image-1.jpg'] });
      await expect(
        executor.run(pinned(), { name: 'IM-04', kind: 'VISION' }, SCHEMA, {
          ...input,
          imagePaths: [join(dir, 'a.jpg'), join(dir, 'b.jpg')],
        }),
      ).rejects.toMatchObject({ errorCode: AI_RUN_ERROR_CODES.IMAGES_NOT_SEEN });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('연결 테스트 1회 = call_log 1행(단계 밖이라 step_run_id 없음). 네이버 예외를 켜면 결과에 남긴다', async () => {
    const smoke = await executor.smokeTest('CLAUDE', 'sonnet');
    expect(smoke).toMatchObject({ status: 'PASSED', model: 'sonnet' });
    expect(callLog.rows).toHaveLength(1);
    expect(callLog.rows[0]!.start).toEqual({ target: 'AI_CLAUDE_CLI', calledAt: clock.now() });
    expect(callLog.rows[0]!.result).toMatchObject({ succeeded: true });

    const result = await executor.run(pinned(), { name: 'TG-AI', kind: 'TEXT' }, SCHEMA, {
      instruction: '태그 관련성을 판정하라.',
      blocks: [{ source: 'NAVER_MANUTAG', text: '러닝화' }],
      naverDataException: 'TAG_RELEVANCE_AI',
    });
    expect(result.naverDataException).toBe('TAG_RELEVANCE_AI');
  });

  it('감지·로그인 확인은 어댑터 오류를 삼킨다(미설치·UNKNOWN)', async () => {
    ai.claude.detect = () => Promise.reject(new Error('boom'));
    ai.claude.authStatus = () => Promise.reject(new Error('boom'));
    expect(await executor.detect('CLAUDE')).toEqual({
      installed: false,
      binPath: null,
      cliVersion: null,
      versionSupported: null,
    });
    expect(await executor.authStatus('CLAUDE')).toBe('UNKNOWN');
    expect(await executor.detectVersion('AGY')).toBe('1.2.9');
  });
});

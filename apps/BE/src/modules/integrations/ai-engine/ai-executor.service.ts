import { Inject, Injectable, Logger } from '@nestjs/common';
import { CallLogService } from '../http/call-log.service.js';
import { CLOCK, type Clock } from '../http/clock.token.js';
import {
  AI_ENGINE_CALL_TARGET,
  AI_TEXT_TIMEOUT_MS,
  AI_VISION_TIMEOUT_MS,
} from './ai-engine.constants.js';
import { AiEngineUnavailableError, isAiExecutionError } from './ai-engine.errors.js';
import {
  AI_ENGINE_ADAPTERS,
  type AiEngineAdapter,
  type AiEngineAuthStatus,
  type AiEngineCode,
  type AiEngineDetection,
  type AiEngineSmokeResult,
  type AiJsonSchema,
} from './ai-engine.port.js';
import type {
  AiExecutionResult,
  AiExecutorInput,
  AiTask,
  PinnedAiContext,
} from './ai-executor.types.js';
import { assertAiInputAllowed, composeAiPrompt } from './ai-prompt-guard.js';
import { aiImageFileNames } from './process/work-dir.js';
import { stripImagesSeen, validateAiOutput, withImagesSeen } from './schema/ai-output-validator.js';
import { assertAiSchemaRules } from './schema/ai-schema-rules.js';

/**
 * AI 공통 실행기(P1-10, F-BS-26·31·32·75·76). 단계 모듈이 AI를 부르는 **유일한 입구**다.
 * `run(ctx: PinnedAiContext, task, schema, input)`:
 * 1. 모델 = ctx의 텍스트·비전 모델(호출 시점 설정을 다시 읽지 않는다). 비었으면 spawn 없이 AI_ENGINE_UNAVAILABLE(MODEL_NOT_SET)
 * 2. 스키마 규칙(규칙 7) → 입력 보호(규칙 14) — 걸리면 call_log 없이 던진다
 * 3. call_log INSERT(보내기 직전, target AI_*_CLI, 단계 실행이면 step_run_id·candidate_id) → ctx.engine의 어댑터 하나만 부른다
 *    (다른 엔진으로 넘어가지 않는다, R10) → 앱에서 다시 검증(규칙 8·9) → call_log 결과(succeeded·duration_ms·error_code)
 * 프롬프트·출력 본문은 어디에도 남기지 않는다(규칙 15, NFR-02).
 * 감지·로그인 확인(호출 비용 없음)은 call_log를 남기지 않고, 연결 테스트(`smokeTest`)는 1행 남긴다.
 */
@Injectable()
export class AiExecutor {
  private readonly logger = new Logger(AiExecutor.name);
  private readonly adapters: ReadonlyMap<AiEngineCode, AiEngineAdapter>;

  constructor(
    @Inject(AI_ENGINE_ADAPTERS) adapters: readonly AiEngineAdapter[],
    private readonly callLog: CallLogService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.adapters = new Map(adapters.map((a) => [a.code, a]));
  }

  private adapter(engine: AiEngineCode): AiEngineAdapter {
    const adapter = this.adapters.get(engine);
    if (!adapter) throw new Error(`AI 엔진 어댑터가 없습니다: ${engine}`);
    return adapter;
  }

  /** 감지(`--version`·경로, R6). 던지지 않는다 — 실패는 미설치로 본다 */
  async detect(engine: AiEngineCode): Promise<AiEngineDetection> {
    try {
      return await this.adapter(engine).detect();
    } catch (error) {
      this.logger.warn({ err: error }, `AI 엔진 ${engine} 감지 중 오류(미설치로 봅니다)`);
      return { installed: false, binPath: null, cliVersion: null, versionSupported: null };
    }
  }

  /** CLI 버전만(AI 단계 시작 때 step_run.ai_cli_version, 규칙 10). 실패하면 null */
  async detectVersion(engine: AiEngineCode): Promise<string | null> {
    return (await this.detect(engine)).cliVersion;
  }

  /** 로그인 상태(R6). 던지지 않는다 — 실패는 UNKNOWN */
  async authStatus(engine: AiEngineCode): Promise<AiEngineAuthStatus> {
    try {
      return await this.adapter(engine).authStatus();
    } catch (error) {
      this.logger.warn({ err: error }, `AI 엔진 ${engine} 로그인 확인 중 오류(UNKNOWN)`);
      return 'UNKNOWN';
    }
  }

  /** 계약·연결 테스트 1회(R7, AI-07) + call_log 1행(규칙 15). 던지지 않는다 */
  async smokeTest(engine: AiEngineCode, model: string): Promise<AiEngineSmokeResult> {
    const adapter = this.adapter(engine);
    const log = await this.callLog.start({
      target: AI_ENGINE_CALL_TARGET[engine],
      calledAt: this.clock.now(),
    });
    const started = performance.now();
    let result: AiEngineSmokeResult;
    try {
      result = await adapter.smokeTest(model);
    } catch (error) {
      this.logger.warn({ err: error }, `AI 엔진 ${engine} 연결 테스트 중 오류`);
      result = {
        status: 'FAILED',
        model,
        latencyMs: Math.round(performance.now() - started),
        errorCode: 'CONTRACT_FAILED',
        errorMessage: '연결 테스트 중 앱 오류가 났습니다.',
      };
    }
    await this.callLog.finish(log.id, {
      succeeded: result.status === 'PASSED',
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      durationMs: performance.now() - started,
    });
    return result;
  }

  /** 구조화 실행 1회(단계 모듈의 유일한 AI 입구) */
  async run<T = Record<string, unknown>>(
    ctx: PinnedAiContext,
    task: AiTask,
    schema: AiJsonSchema,
    input: AiExecutorInput,
  ): Promise<AiExecutionResult<T>> {
    const vision = task.kind === 'VISION';
    const model = vision ? ctx.visionModel : ctx.textModel;
    if (!model || model.trim() === '')
      throw new AiEngineUnavailableError(ctx.engine, 'MODEL_NOT_SET');
    const images = input.imagePaths ?? [];
    if (vision && images.length === 0) throw new Error(`비전 작업(${task.name})에 이미지가 없다`);
    if (!vision && images.length > 0)
      throw new Error(`텍스트 작업(${task.name})에 이미지를 넘겼다`);
    const effective = vision ? withImagesSeen(schema) : schema;
    assertAiSchemaRules(effective);
    assertAiInputAllowed(input);
    const prompt = composeAiPrompt(input);
    const adapter = this.adapter(ctx.engine);
    const exception = input.naverDataException ?? null;
    if (exception) {
      // 규칙 14: 네이버 데이터 예외를 켠 사실을 남긴다(값은 남기지 않는다, Proposed — 앱 로그 + 결과 필드)
      this.logger.warn(
        { aiNaverDataException: exception, task: task.name, stepRunId: ctx.stepRunId ?? null },
        `AI 입력에 네이버 데이터 예외(${exception})를 켰습니다`,
      );
    }

    const log = await this.callLog.start({
      target: AI_ENGINE_CALL_TARGET[ctx.engine],
      calledAt: this.clock.now(),
      candidateId: ctx.candidateId ?? null,
      stepRunId: ctx.stepRunId ?? null,
    });
    const started = performance.now();
    try {
      const result = await adapter.runStructured<Record<string, unknown>>(
        task.name,
        schema,
        { prompt, imagePaths: images },
        { model, timeoutMs: vision ? AI_VISION_TIMEOUT_MS : AI_TEXT_TIMEOUT_MS },
      );
      // 앱에서 다시 검증(규칙 8·9) — 어댑터가 무엇을 돌려주든 여기서 한 번 더 본다
      const checked = validateAiOutput(effective, result.output, {
        expectedImages: vision ? aiImageFileNames(images) : undefined,
      });
      const { output, imagesSeen } = stripImagesSeen(checked);
      await this.callLog.finish(log.id, {
        succeeded: true,
        durationMs: performance.now() - started,
      });
      return {
        output: output as T,
        imagesSeen: vision ? imagesSeen : null,
        engine: ctx.engine,
        model,
        cliVersion: ctx.cliVersion ?? result.cliVersion,
        latencyMs: result.latencyMs,
        callLogId: log.id,
        naverDataException: exception,
      };
    } catch (error) {
      await this.callLog
        .finish(log.id, {
          succeeded: false,
          errorCode: isAiExecutionError(error) ? error.errorCode : 'INTERNAL_ERROR',
          errorMessage: isAiExecutionError(error) ? error.userMessage : null,
          durationMs: performance.now() - started,
        })
        .catch((e: unknown) => this.logger.error({ err: e }, 'AI 호출 기록을 채우지 못했습니다'));
      throw error;
    }
  }
}

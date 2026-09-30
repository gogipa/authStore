import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import { parsePageRequest, toPageMeta } from '../../../common/paging/page-request.js';
import type { AiCliCheck } from '../../../generated/prisma/client.js';
import { AgyModelsProvider } from '../../integrations/ai-engine/agy-models.provider.js';
import { AI_ENGINE_CODES, type AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import {
  aiModelFieldError,
  aiModelInvalidException,
  isAllowedAiModel,
} from '../../settings/ai-engine/ai-model.validator.js';
import { SettingsService } from '../../settings/settings.service.js';
import type {
  AiCliCheckAcceptedDto,
  AiCliCheckDto,
  AiCliCheckLatestListDto,
  AiCliCheckListQueryDto,
  AiCliCheckPageDto,
  AiCliCheckRequestDto,
} from './ai-cli-check.dto.js';
import { AI_CLI_CHECK_JOB, AI_CLI_CHECK_JOB_LABEL, AiCliCheckLock } from './ai-cli-check.lock.js';
import { AiCliCheckQueryService } from './ai-cli-check.query.js';
import { AiCliCheckRecorder } from './ai-cli-check.recorder.js';

/** 설정 파일 기본 엔진(PRD §8.9 R3) */
export const DEFAULT_AI_ENGINE: AiEngineCode = 'CLAUDE';

/** 202 Location(05-2 createAiCliCheck, 앞머리 api/v1 포함) */
export const AI_CLI_CHECKS_LATEST_LOCATION = '/api/v1/ai-cli-checks/latest';

/** 규칙 8: smokeTest=true인데 engineCodes 없음(422 VALIDATION_FAILED 칸 문구) */
export const SMOKE_TEST_ENGINES_REQUIRED =
  '연결 테스트는 누른 엔진만 부릅니다. engineCodes에 테스트할 엔진을 넣어 주세요.';

export function toAiCliCheckDto(row: AiCliCheck): AiCliCheckDto {
  return {
    id: row.id,
    engineCode: row.engineCode as AiCliCheckDto['engineCode'],
    trigger: row.trigger as AiCliCheckDto['trigger'],
    installed: row.installed,
    binPath: row.binPath,
    cliVersion: row.cliVersion,
    versionSupported: row.versionSupported,
    authStatus: row.authStatus as AiCliCheckDto['authStatus'],
    smokeStatus: row.smokeStatus as AiCliCheckDto['smokeStatus'],
    model: row.model,
    latencyMs: row.latencyMs,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    checkedAt: row.checkedAt.toISOString(),
  };
}

/**
 * AI CLI 점검 API(05-2 getLatestAiCliChecks·createAiCliCheck, P1-11 Proposed listAiCliChecks, F-SY-13·F-ST-28·F-ST-29).
 * 쓰기(행 추가·SSE)는 P1-10 `AiCliCheckRecorder`가, 읽기는 `AiCliCheckQueryService`가 한다.
 */
@Injectable()
export class AiCliChecksService {
  private readonly logger = new Logger(AiCliChecksService.name);
  /** 마지막으로 받은 점검(잠금을 푼 뒤 끝난다) */
  private running: Promise<void> = Promise.resolve();

  constructor(
    private readonly settings: SettingsService,
    private readonly query: AiCliCheckQueryService,
    private readonly recorder: AiCliCheckRecorder,
    private readonly lock: AiCliCheckLock,
    private readonly agyModels: AgyModelsProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** GET /ai-cli-checks/latest — 엔진마다 최신 ai_cli_check 1건과 선택 엔진 표시(규칙 10) */
  async getLatest(): Promise<AiCliCheckLatestListDto> {
    const selectedEngine = this.readSelectedEngine();
    const latest = await this.query.latestPerEngine();
    return {
      selectedEngine,
      items: latest.map(({ engineCode, row }) => ({
        engineCode,
        selected: engineCode === selectedEngine,
        latest: row ? toAiCliCheckDto(row) : null,
      })),
    };
  }

  /** GET /ai-cli-checks — 점검 이력(P1-11 Proposed, SCR-13 '최근 점검 이력' 표) */
  async list(query: AiCliCheckListQueryDto): Promise<AiCliCheckPageDto> {
    const page = parsePageRequest('/ai-cli-checks', query);
    const direction = page.sort[0]?.direction ?? 'desc';
    const where = query.engineCode ? { engineCode: query.engineCode } : {};
    const { rows, total } = await this.query.page(where, direction, page.skip, page.take);
    return { content: rows.map(toAiCliCheckDto), page: toPageMeta(page, total) };
  }

  /**
   * POST /ai-cli-checks(규칙 7·8·9). 검사 순서(Proposed): 본문 형식(422 VALIDATION_FAILED, STARTUP 포함) →
   * smokeTest=true인데 engineCodes 없음(422 VALIDATION_FAILED) → 연결 테스트 모델(422 AI_MODEL_INVALID) →
   * 잠금(409 ALREADY_IN_PROGRESS details.job=AI_CLI_CHECK) → 기다리지 않고 점검(엔진마다 1행 + SSE) → 202.
   * 연결 테스트는 `engineCodes`의 엔진만 부른다(선택하지 않은 엔진을 스스로 부르지 않는다, R7). `smokeTest=false`면 `models`는 쓰지 않는다.
   */
  async start(request: AiCliCheckRequestDto): Promise<AiCliCheckAcceptedDto> {
    if (request.smokeTest && !request.engineCodes) {
      throw new ApiException('VALIDATION_FAILED', {
        fieldErrors: [{ field: 'engineCodes', message: SMOKE_TEST_ENGINES_REQUIRED }],
      });
    }
    const engineCodes: AiEngineCode[] = request.engineCodes
      ? [...request.engineCodes]
      : [...AI_ENGINE_CODES];
    const models = request.smokeTest ? await this.smokeModels(engineCodes, request.models) : {};
    const release = this.lock.tryAcquire();
    if (!release) {
      throw new ApiException('ALREADY_IN_PROGRESS', {
        message: formatErrorMessage('ALREADY_IN_PROGRESS', { 작업: AI_CLI_CHECK_JOB_LABEL }),
        details: { job: AI_CLI_CHECK_JOB },
      });
    }
    const acceptedAt = this.clock.now();
    this.running = this.recorder
      .check(engineCodes, {
        smokeTest: request.smokeTest ? engineCodes : [],
        models,
        trigger: request.trigger,
      })
      .then(
        () => undefined,
        (error: unknown) => {
          this.logger.error({ err: error }, 'AI 엔진 점검을 마치지 못했습니다');
        },
      )
      .finally(release);
    return {
      engineCodes,
      smokeTest: request.smokeTest,
      trigger: request.trigger,
      status: 'RUNNING',
      acceptedAt: acceptedAt.toISOString(),
    };
  }

  /** 마지막으로 받은 점검이 끝나고 잠금이 풀릴 때까지(테스트·종료) */
  whenIdle(): Promise<void> {
    return this.running;
  }

  /**
   * 연결 테스트 모델(규칙 8): `models[엔진]`, 없으면 설정의 그 엔진 텍스트 모델. 둘 다 비면 422 AI_MODEL_INVALID(`models.{엔진}`).
   * 목록 검사는 저장과 같다(CLAUDE 별칭 3개, AGY `agy models` 목록, CODEX 직접 입력). 설정에 이미 있는 값은 목록 검사를
   * 건너뛴다(Proposed — 설정한 모델은 그대로 시험할 수 있게).
   */
  private async smokeModels(
    engineCodes: readonly AiEngineCode[],
    requested: AiCliCheckRequestDto['models'],
  ): Promise<Partial<Record<AiEngineCode, string>>> {
    const configured = this.settings.currentOrNull()?.ai.models ?? null;
    const agyListed = await this.agyModels.list();
    const out: Partial<Record<AiEngineCode, string>> = {};
    const errors: FieldError[] = [];
    for (const engine of engineCodes) {
      const field = `models.${engine}`;
      const given = requested?.[engine];
      const fromSettings = configured?.[engine]?.text ?? null;
      const model = given ?? fromSettings;
      if (!model) {
        errors.push(aiModelFieldError(field, engine, null));
        continue;
      }
      const alreadyConfigured =
        model === configured?.[engine]?.text || model === configured?.[engine]?.vision;
      if (!alreadyConfigured && !isAllowedAiModel(engine, model, agyListed)) {
        errors.push(aiModelFieldError(field, engine, model));
        continue;
      }
      out[engine] = model;
    }
    if (errors.length > 0) throw aiModelInvalidException(errors);
    return out;
  }

  /**
   * 선택 엔진. 원본은 설정 JSON의 ai 섹션이다(D-16). P1-03 설정 로더가 읽은 현재 설정(`SettingsService`)을 쓰고,
   * 쓸 수 있는 설정이 없으면 기본값 CLAUDE(06 스캐폴딩의 스냅샷 직접 읽기를 P1-10에서 바꿨다).
   */
  private readSelectedEngine(): AiEngineCode {
    return this.settings.currentOrNull()?.ai.engine ?? DEFAULT_AI_ENGINE;
  }
}

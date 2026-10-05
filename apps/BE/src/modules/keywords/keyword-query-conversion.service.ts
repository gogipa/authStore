import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import {
  AiEngineUnavailableError,
  isAiExecutionError,
} from '../integrations/ai-engine/ai-engine.errors.js';
import { AiExecutor } from '../integrations/ai-engine/ai-executor.service.js';
import type { PinnedAiContext } from '../integrations/ai-engine/ai-executor.types.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  AiEngineAvailabilityService,
  aiEngineUnavailableException,
} from '../system/ai-cli-checks/ai-engine-availability.service.js';
import type { RakutenQueryConversionDto } from './dto/rakuten-query-conversion.dto.js';
import {
  buildQueryConversionPrompt,
  cleanConvertedQuery,
  hasHangul,
  QUERY_CONVERSION_AI_TASK,
  QUERY_CONVERSION_SCHEMA,
} from './keyword-query-conversion.prompt.js';
import { KeywordRepository } from './keyword.repository.js';

/**
 * 한글 키워드 → 일본어 라쿠텐 검색어(F-BS-70, 2026-10-05 오너 결정으로 M2에서 앞당김). 오너가 고른 키워드 1개를 선택한
 * AI 엔진의 텍스트 모델에 보내고, 받은 검색어를 돌려준다. 저장하지 않는다 — 화면이 [이 검색어로 소싱]을 누를 때 이 결과로 후보를 만든다.
 * - 입력은 키워드 1개뿐이다. 네이버 데이터 AI 입력 제한(F-BS-14)의 예외 `KEYWORD_QUERY_CONVERSION`을 켜 보내고 실행기가 기록한다
 * - 엔진은 단계 실행과 같은 규칙으로 고른다(`ai.engine`, 사용 가능 판정 → 못 쓰면 409 AI_ENGINE_UNAVAILABLE, 다른 엔진으로 넘어가지 않음).
 *   keywords 모듈은 step-engine을 import하지 않아 그쪽 `SelectedAiEngineResolver`와 같은 순서를 여기서 되풀이한다
 * - 결과가 비었거나 한글이 남았으면 쓰지 않는다(502 AI_CALL_FAILED, errorCode AI_OUTPUT_INVALID). 자동 재시도는 없다 — 다시 누르면 된다
 */
@Injectable()
export class KeywordQueryConversionService {
  constructor(
    private readonly repo: KeywordRepository,
    private readonly settings: SettingsService,
    private readonly availability: AiEngineAvailabilityService,
    private readonly executor: AiExecutor,
  ) {}

  async convert(keywordId: number | null): Promise<RakutenQueryConversionDto> {
    const keyword = keywordId === null ? null : await this.repo.findKeyword(keywordId);
    if (!keyword) throw new ApiException('KEYWORD_NOT_FOUND');
    if (keyword.excludedReason !== null) {
      throw new ApiException('KEYWORD_EXCLUDED', { details: { keywordId: keyword.id } });
    }
    const pinned = await this.prepare();
    try {
      const result = await this.executor.run<{ query_ja: string }>(
        pinned,
        QUERY_CONVERSION_AI_TASK,
        QUERY_CONVERSION_SCHEMA,
        buildQueryConversionPrompt(keyword.keyword),
      );
      const rakutenQuery = cleanConvertedQuery(result.output.query_ja);
      if (rakutenQuery === '' || hasHangul(rakutenQuery)) {
        throw new ApiException('AI_CALL_FAILED', {
          message:
            'AI가 일본어 검색어를 만들지 못했습니다(한글이 남았거나 비어 있습니다). 다시 눌러 보세요.',
          details: { errorCode: 'AI_OUTPUT_INVALID', engineCode: result.engine },
        });
      }
      return {
        keywordId: keyword.id,
        keyword: keyword.keyword,
        rakutenQuery,
        engineCode: result.engine,
        model: result.model,
      };
    } catch (error) {
      throw this.toApiException(error);
    }
  }

  /** 선택 엔진 준비(`SelectedAiEngineResolver.prepare`와 같은 순서): 설정 → 사용 가능 판정 → `--version` 감지 */
  private async prepare(): Promise<PinnedAiContext> {
    const current = this.settings.current();
    const settingsSnapshotId = this.settings.currentSnapshotId();
    const engine = current.ai.engine;
    const pair = current.ai.models[engine];
    await this.availability.assertUsable(engine);
    const cliVersion = await this.executor.detectVersion(engine);
    return {
      engine,
      textModel: pair?.text ?? null,
      visionModel: pair?.vision ?? null,
      cliVersion,
      settingsSnapshotId,
    };
  }

  private toApiException(error: unknown): unknown {
    if (error instanceof ApiException) return error;
    if (error instanceof AiEngineUnavailableError) {
      return aiEngineUnavailableException(error.engine, error.reason);
    }
    if (isAiExecutionError(error)) {
      return new ApiException('AI_CALL_FAILED', {
        message: error.userMessage,
        details: { errorCode: error.errorCode },
      });
    }
    return error;
  }
}

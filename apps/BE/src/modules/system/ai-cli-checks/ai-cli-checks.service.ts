import { Injectable } from '@nestjs/common';
import type { AiCliCheck } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AI_ENGINE_CODES, type AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';
import { SettingsService } from '../../settings/settings.service.js';
import type { AiCliCheckDto, AiCliCheckLatestListDto } from './ai-cli-check.dto.js';

/** 설정 파일 기본 엔진(PRD §8.9 R3) */
export const DEFAULT_AI_ENGINE: AiEngineCode = 'CLAUDE';

@Injectable()
export class AiCliChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** GET /ai-cli-checks/latest — 엔진마다 최신 ai_cli_check 1건과 선택 엔진 표시(05-2 getLatestAiCliChecks) */
  async getLatest(): Promise<AiCliCheckLatestListDto> {
    const selectedEngine = this.readSelectedEngine();
    const latest = await Promise.all(
      AI_ENGINE_CODES.map((engineCode) =>
        this.prisma.aiCliCheck.findFirst({
          where: { engineCode },
          orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
        }),
      ),
    );
    return {
      selectedEngine,
      items: AI_ENGINE_CODES.map((engineCode, i) => {
        const row = latest[i];
        return {
          engineCode,
          selected: engineCode === selectedEngine,
          latest: row ? toDto(row) : null,
        };
      }),
    };
  }

  /**
   * 선택 엔진. 원본은 설정 JSON의 ai 섹션이다(D-16). P1-03 설정 로더가 읽은 현재 설정(`SettingsService`)을 쓰고,
   * 쓸 수 있는 설정이 없으면 기본값 CLAUDE(P1-10에서 스냅샷 직접 읽기를 바꿨다).
   */
  private readSelectedEngine(): AiEngineCode {
    return this.settings.currentOrNull()?.ai.engine ?? DEFAULT_AI_ENGINE;
  }
}

function toDto(row: AiCliCheck): AiCliCheckDto {
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

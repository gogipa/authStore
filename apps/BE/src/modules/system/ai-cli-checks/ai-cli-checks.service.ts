import { Injectable } from '@nestjs/common';
import type { AiCliCheck } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  AI_ENGINE_CODES,
  type AiEngineCode,
  isAiEngineCode,
} from '../../integrations/ai-engine/ai-engine.port.js';
import type { AiCliCheckDto, AiCliCheckLatestListDto } from './ai-cli-check.dto.js';

/** 설정 파일 기본 엔진(PRD §8.9 R3) */
export const DEFAULT_AI_ENGINE: AiEngineCode = 'CLAUDE';

@Injectable()
export class AiCliChecksService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /ai-cli-checks/latest — 엔진마다 최신 ai_cli_check 1건과 선택 엔진 표시(05-2 getLatestAiCliChecks) */
  async getLatest(): Promise<AiCliCheckLatestListDto> {
    const [selectedEngine, ...latest] = await Promise.all([
      this.readSelectedEngine(),
      ...AI_ENGINE_CODES.map((engineCode) =>
        this.prisma.aiCliCheck.findFirst({
          where: { engineCode },
          orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
        }),
      ),
    ]);
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
   * 선택 엔진. 원본은 설정 JSON의 ai 섹션이고 settings_snapshot.content에 사본이 남는다(D-16).
   * 설정 JSON 로더(settings 모듈)가 아직 없어, 가장 최근에 읽은 스냅샷의 ai.engine을 읽고
   * 없거나 틀리면 기본값 CLAUDE를 쓴다. settings 모듈을 만들 때 그쪽 값으로 바꾼다.
   */
  private async readSelectedEngine(): Promise<AiEngineCode> {
    const snapshot = await this.prisma.settingsSnapshot.findFirst({
      orderBy: [{ lastLoadedAt: 'desc' }, { id: 'desc' }],
      select: { content: true },
    });
    const content = snapshot?.content;
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      const ai = (content as Record<string, unknown>).ai;
      if (ai && typeof ai === 'object' && !Array.isArray(ai)) {
        const engine = (ai as Record<string, unknown>).engine;
        if (isAiEngineCode(engine)) return engine;
      }
    }
    return DEFAULT_AI_ENGINE;
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

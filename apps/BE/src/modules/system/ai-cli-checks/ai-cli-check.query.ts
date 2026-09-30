import { Injectable } from '@nestjs/common';
import type { AiCliCheck } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AI_ENGINE_CODES, type AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';

/** 저장 조건 창(R8): 선택 엔진·텍스트 모델로 이 시간 안에 통과한 연결 테스트가 있어야 저장한다 */
export const AI_ENGINE_VERIFY_WINDOW_MS = 10 * 60 * 1000;

/** 최신 행 순서(ERD §3.14 '최신 행' — (engine_code, checked_at DESC) 인덱스, 같은 시각이면 id가 큰 행) */
const LATEST_FIRST = [{ checkedAt: 'desc' as const }, { id: 'desc' as const }];

/**
 * ai_cli_check 읽기 창구(P1-11, system 소유 — SystemModule·AiCliCheckQueryModule이 export). 쓰기는 `AiCliCheckRecorder`만 한다.
 * settings(AI 엔진 저장 조건, R8)가 이것만 부른다(C4 §3 settings → system). DB 말고 다른 의존이 없어 설정 ↔ 시스템 모듈 순환이 없다.
 */
@Injectable()
export class AiCliCheckQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** 엔진 하나의 최신 행(없으면 null) */
  latest(engineCode: AiEngineCode): Promise<AiCliCheck | null> {
    return this.prisma.aiCliCheck.findFirst({ where: { engineCode }, orderBy: LATEST_FIRST });
  }

  /** 엔진 3개(CLAUDE·AGY·CODEX 순서)의 최신 행 */
  async latestPerEngine(): Promise<{ engineCode: AiEngineCode; row: AiCliCheck | null }[]> {
    const rows = await Promise.all(AI_ENGINE_CODES.map((engineCode) => this.latest(engineCode)));
    return AI_ENGINE_CODES.map((engineCode, i) => ({ engineCode, row: rows[i] ?? null }));
  }

  /**
   * 저장 조건(P1-11 규칙 4, R8): `engine_code = engine`, `model = model`, `smoke_status = PASSED`, `checked_at ≥ sinceMs`.
   * 가장 최근 1행(없으면 null). `sinceMs`(epoch ms)는 부르는 쪽이 `checked_at`을 찍는 것과 같은 시계(CLOCK)로
   * `now − AI_ENGINE_VERIFY_WINDOW_MS`를 계산해 넘긴다(시계를 하나로, §8 주의). 경계(정확히 10분 전)는 통과로 본다.
   */
  findRecentPass(
    engineCode: AiEngineCode,
    model: string,
    sinceMs: number,
  ): Promise<AiCliCheck | null> {
    return this.prisma.aiCliCheck.findFirst({
      where: {
        engineCode,
        model,
        smokeStatus: 'PASSED',
        checkedAt: { gte: new Date(sinceMs) },
      },
      orderBy: LATEST_FIRST,
    });
  }

  /** 점검 이력 한 쪽(P1-11 Proposed `GET /ai-cli-checks`, 기본 최신순. 같은 시각이면 id를 같은 방향으로) */
  async page(
    where: { engineCode?: AiEngineCode },
    direction: 'asc' | 'desc',
    skip: number,
    take: number,
  ): Promise<{ rows: AiCliCheck[]; total: number }> {
    const orderBy = [{ checkedAt: direction }, { id: direction }];
    const [rows, total] = await Promise.all([
      this.prisma.aiCliCheck.findMany({ where, orderBy, skip, take }),
      this.prisma.aiCliCheck.count({ where }),
    ]);
    return { rows, total };
  }
}

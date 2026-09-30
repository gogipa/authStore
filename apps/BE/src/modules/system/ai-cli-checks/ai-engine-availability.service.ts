import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import type { AiCliCheck } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AI_ENGINE_SETTINGS_PATH } from '../../integrations/ai-engine/ai-engine.constants.js';
import {
  aiEngineUnavailableMessage,
  type AiUnavailableReason,
} from '../../integrations/ai-engine/ai-engine.errors.js';
import type { AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';
import { AiCliCheckRecorder } from './ai-cli-check.recorder.js';

/** 연결 테스트 FAILED 행에서 사유로 그대로 올리는 error_code(나머지는 CONTRACT_FAILED) */
const PASS_THROUGH_REASONS: readonly AiUnavailableReason[] = [
  'NOT_INSTALLED',
  'NOT_LOGGED_IN',
  'MODEL_NOT_SET',
];

/**
 * 선택 엔진 최신 점검 행으로 사용 가능 판정(P1-10 규칙 11, R10, ERD §3.14 '최신 행'). 쓸 수 있으면 null.
 * - 행 없음 → NOT_CHECKED(Proposed: 앱 시작 점검을 껐거나 아직 한 번도 점검하지 않음)
 * - installed=false → NOT_INSTALLED, auth_status=NOT_LOGGED_IN → NOT_LOGGED_IN
 * - smoke_status=FAILED → CONTRACT_FAILED(error_code가 NOT_LOGGED_IN·MODEL_NOT_SET이면 그 사유)
 * - 지원 밖 버전(version_supported=false)은 거절하지 않는다(경고만, Proposed — 05-3과 PRD §8.9가 달라 PRD를 따랐다)
 * - 감지만 한 SKIPPED 행이 최신이면 쓸 수 있다고 본다(앞의 FAILED를 가린다 — 문서 규칙 그대로, 오너 검토)
 */
export function aiEngineUnavailableReason(row: AiCliCheck | null): AiUnavailableReason | null {
  if (!row) return 'NOT_CHECKED';
  if (!row.installed) return 'NOT_INSTALLED';
  if (row.authStatus === 'NOT_LOGGED_IN') return 'NOT_LOGGED_IN';
  if (row.smokeStatus === 'FAILED') {
    const code = row.errorCode as AiUnavailableReason | null;
    return code && PASS_THROUGH_REASONS.includes(code) ? code : 'CONTRACT_FAILED';
  }
  return null;
}

/** 409 AI_ENGINE_UNAVAILABLE(details: engineCode·reason·settingsPath, 05-3) */
export function aiEngineUnavailableException(
  engineCode: AiEngineCode,
  reason: AiUnavailableReason,
): ApiException {
  return new ApiException('AI_ENGINE_UNAVAILABLE', {
    message: aiEngineUnavailableMessage(engineCode, reason),
    details: { engineCode, reason, settingsPath: AI_ENGINE_SETTINGS_PATH },
  });
}

/**
 * AI 단계 시작 전 사용 가능 판정(F-BS-76). step-engine이 단계 실행·연속 실행 시작 트랜잭션 **전에** 부른다
 * (SystemModule export, C4 §3 step-engine → system, P1-10 Proposed). 쓸 수 없으면 409를 던지고 step_run을 만들지 않는다.
 */
@Injectable()
export class AiEngineAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recorder: AiCliCheckRecorder,
  ) {}

  /** 엔진의 최신 점검 1행(checked_at, id 내림차순) */
  latest(engineCode: AiEngineCode): Promise<AiCliCheck | null> {
    return this.prisma.aiCliCheck.findFirst({
      where: { engineCode },
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** 쓸 수 없으면 409 AI_ENGINE_UNAVAILABLE. 앱 시작 점검이 도는 중이면 끝을 기다린다 */
  async assertUsable(engineCode: AiEngineCode): Promise<AiCliCheck> {
    await this.recorder.whenIdle();
    const row = await this.latest(engineCode);
    const reason = aiEngineUnavailableReason(row);
    if (reason) throw aiEngineUnavailableException(engineCode, reason);
    return row!;
  }
}

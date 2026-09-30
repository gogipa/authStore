import { Injectable } from '@nestjs/common';
import type { CallLog, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { scrubKnownSecrets } from '../../../common/secrets/secret-mask.js';
import { toKstDateValue } from '../../../common/time/kst.js';
import type { CallLogTarget } from './external-targets.js';
import { maskUrl } from './url-mask.js';

export interface CallLogStart {
  target: CallLogTarget;
  /** 보내기 직전 시각(= called_at) */
  calledAt: Date;
  httpMethod?: string | null;
  host?: string | null;
  /** 원문 URL. 저장 전에 비밀 쿼리값을 가린다 */
  url?: string | null;
  candidateId?: number | null;
  stepRunId?: number | null;
}

export interface CallLogResult {
  httpStatus?: number | null;
  succeeded: boolean;
  errorCode?: string | null;
  /** 비밀 없는 오류 요약 */
  errorMessage?: string | null;
  itemCount?: number | null;
  durationMs: number;
  traceId?: string | null;
}

/**
 * call_log 쓰기(ERD §3.12). 호출 1번에 1행.
 * - 보내기 **직전에** 행을 넣는다(실패·중단된 요청도 하루 상한에 든다).
 * - 결과 열은 한 번만 채운다(succeeded가 NULL인 행만). 행은 지우지 않는다(trg_forbid_delete).
 * ExternalHttpGateway가 쓰고, HTTP가 아닌 호출(AI CLI, P1-10)도 같은 방법으로 남긴다.
 */
@Injectable()
export class CallLogService {
  constructor(private readonly prisma: PrismaService) {}

  async start(input: CallLogStart): Promise<CallLog> {
    return this.prisma.callLog.create({
      data: {
        calledAt: input.calledAt,
        kstDate: toKstDateValue(input.calledAt),
        target: input.target,
        httpMethod: input.httpMethod ? input.httpMethod.toUpperCase().slice(0, 10) : null,
        host: input.host ? input.host.slice(0, 255) : null,
        // 이름으로 가린 뒤(maskUrl) 알려진 비밀값이 경로·다른 쿼리에 섞였으면 한 번 더 지운다(P1-07)
        urlMasked: input.url ? scrubKnownSecrets(maskUrl(input.url)) : null,
        candidateId: input.candidateId ?? null,
        stepRunId: input.stepRunId ?? null,
      },
    });
  }

  /** 결과 열을 채운다. 이미 채운 행이면 false */
  async finish(id: number, result: CallLogResult): Promise<boolean> {
    const data: Prisma.CallLogUpdateManyMutationInput = {
      httpStatus: result.httpStatus ?? null,
      succeeded: result.succeeded,
      errorCode: result.errorCode ? scrubKnownSecrets(result.errorCode).slice(0, 100) : null,
      errorMessage: result.errorMessage ? scrubKnownSecrets(result.errorMessage) : null,
      durationMs: Math.max(0, Math.round(result.durationMs)),
      traceId: result.traceId ? result.traceId.slice(0, 100) : null,
    };
    if (result.itemCount !== undefined && result.itemCount !== null) {
      data.itemCount = Math.max(0, Math.trunc(result.itemCount));
    }
    const { count } = await this.prisma.callLog.updateMany({
      where: { id, succeeded: null },
      data,
    });
    return count === 1;
  }

  /** 결과 건수(데이터랩 행 수·검색 결과 수 등)를 나중에 채운다. 이미 있으면 false */
  async recordItemCount(id: number, itemCount: number): Promise<boolean> {
    if (!Number.isInteger(itemCount) || itemCount < 0) {
      throw new Error('itemCount는 0 이상 정수');
    }
    const { count } = await this.prisma.callLog.updateMany({
      where: { id, itemCount: null },
      data: { itemCount },
    });
    return count === 1;
  }
}

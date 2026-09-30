import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../http/clock.token.js';
import { ExternalHttpGateway } from '../http/external-http.gateway.js';
import { RAKUTEN_MAINTENANCE_MARKER, RAKUTEN_PAGE_ENCODING } from './rakuten.constants.js';
import type {
  RakutenPageCallContext,
  RakutenPagePort,
  RakutenPageResponse,
} from './rakuten-page.port.js';

/** EUC-JP 바이트를 글자로 푼다(Node full ICU). 잘못된 바이트는 대체 문자로 둔다 */
export function decodeRakutenPage(bytes: Buffer): string {
  return new TextDecoder(RAKUTEN_PAGE_ENCODING).decode(bytes);
}

/** 점검·삭제 페이지인가(F-SO-14): HTTP 200이어도 본문에 'ページが表示できません'이 있으면 실패 */
export function isRakutenMaintenancePage(bytes: Buffer): boolean {
  return decodeRakutenPage(bytes).includes(RAKUTEN_MAINTENANCE_MARKER);
}

/**
 * 상품 페이지 어댑터(F-BS-36). 관문 RAKUTEN_PAGE로만 보낸다(규칙은 포트 설명). call_log 결과 열: 200 점검 페이지는
 * error_code MAINTENANCE_PAGE로 남긴다(실패로 센다).
 */
@Injectable()
export class RakutenPageHttpAdapter implements RakutenPagePort {
  constructor(
    private readonly gateway: ExternalHttpGateway,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async fetchPage(url: string, ctx: RakutenPageCallContext = {}): Promise<RakutenPageResponse> {
    let receivedAt: Date | null = null;
    const res = await this.gateway.request(
      'RAKUTEN_PAGE',
      { method: 'GET', url, headers: { Accept: 'text/html' } },
      {
        candidateId: ctx.candidateId ?? null,
        stepRunId: ctx.stepRunId ?? null,
        describeResponse: ({ status, body }) => {
          // 수집 시각 = 응답을 받은 때(직렬 큐에서 기다린 시간은 넣지 않는다)
          receivedAt = this.clock.now();
          return status === 200 && isRakutenMaintenancePage(body)
            ? { errorCode: 'MAINTENANCE_PAGE', errorMessage: '점검·삭제 페이지' }
            : undefined;
        },
      },
    );
    return {
      httpStatus: res.status,
      bytes: res.body,
      fetchedAt: receivedAt ?? this.clock.now(),
      callLogId: res.callLogId,
    };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../http/clock.token.js';
import { ExternalHttpGateway } from '../http/external-http.gateway.js';
import {
  isRakutenImageUrl,
  RAKUTEN_IMAGE_MAX_REDIRECTS,
  type RakutenImageCallContext,
  type RakutenImagePort,
  type RakutenImageResponse,
} from './rakuten-image.port.js';

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * 상품 이미지 어댑터(P3-01 F-TH-01). 관문 RAKUTEN_IMAGE로만 보낸다(규칙은 포트 설명). 3xx면 `Location`이 허용 호스트의 https일
 * 때만 최대 2번 따라간다(관문은 리다이렉트를 스스로 따라가지 않는다 — P1-01). 그 밖의 3xx·4xx·5xx는 그대로 돌려준다
 * (실패 판단은 부르는 쪽).
 */
@Injectable()
export class RakutenImageHttpAdapter implements RakutenImagePort {
  constructor(
    private readonly gateway: ExternalHttpGateway,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async fetchImage(url: string, ctx: RakutenImageCallContext = {}): Promise<RakutenImageResponse> {
    let current = url;
    for (let hop = 0; ; hop += 1) {
      let receivedAt: Date | null = null;
      const res = await this.gateway.request(
        'RAKUTEN_IMAGE',
        { method: 'GET', url: current, headers: { Accept: 'image/*' } },
        {
          candidateId: ctx.candidateId ?? null,
          stepRunId: ctx.stepRunId ?? null,
          describeResponse: () => {
            receivedAt = this.clock.now();
            return undefined;
          },
        },
      );
      const location = res.headers.get('location');
      if (REDIRECT_STATUSES.has(res.status) && location && hop < RAKUTEN_IMAGE_MAX_REDIRECTS) {
        let next: string | null = null;
        try {
          next = new URL(location, current).toString();
        } catch {
          next = null;
        }
        if (next && isRakutenImageUrl(next)) {
          current = next;
          continue;
        }
      }
      return {
        httpStatus: res.status,
        bytes: res.body,
        fetchedAt: receivedAt ?? this.clock.now(),
        callLogId: res.callLogId,
        finalUrl: current,
      };
    }
  }
}

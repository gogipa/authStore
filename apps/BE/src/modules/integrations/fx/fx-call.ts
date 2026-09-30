import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import type { SecretKey } from '../../../common/secrets/secret-keys.js';
import { registerKnownSecret } from '../../../common/secrets/secret-mask.js';
import { SECRET_STORE, type SecretStore } from '../../../common/secrets/secret-store.port.js';
import { CallUsageService } from '../call-usage/call-usage.service.js';
import { CallLogService } from '../http/call-log.service.js';
import { CLOCK, type Clock } from '../http/clock.token.js';
import { ExternalHttpGateway } from '../http/external-http.gateway.js';
import type { CallLogTarget } from '../http/external-targets.js';
import type { FxFetchOutcome } from './fx-source.port.js';

/** 응답을 읽은 결과(어댑터가 출처별 파서로 만든다) */
export type FxParsed<T> =
  | { kind: 'OK'; rates: T[] }
  | { kind: 'EMPTY' }
  | { kind: 'ERROR'; errorCode: string; message: string };

export interface FxCallSpec<T> {
  target: Extract<CallLogTarget, 'FX_KOREAEXIM' | 'FX_CUSTOMS'>;
  secretKey: Extract<SecretKey, 'KOREAEXIM_API_KEY' | 'CUSTOMS_SERVICE_KEY'>;
  /** 키로 요청 URL을 만든다(키는 쿼리에 실린다 — call_log에는 관문이 가린 주소만 남는다) */
  buildUrl: (key: string) => string;
  accept: string;
  parse: (bodyText: string) => FxParsed<T>;
}

/** 키가 없을 때 call_log.error_code(05-3 SECRET_NOT_CONFIGURED와 같은 이름) */
export const FX_SECRET_MISSING = 'SECRET_NOT_CONFIGURED';

/**
 * 환율 출처 한 번 부르기(두 어댑터 공통, P2-04 규칙 3·5).
 * 1. 키체인에서 키를 읽는다. 없거나 키체인을 열 수 없으면 **부르지 않고** call_log에 실패 1행을 남긴다(규칙 3, 테스트 '키 없음').
 * 2. 관문(`ExternalHttpGateway`)으로 GET. URL의 `authkey`·`serviceKey`는 관문이 call_log에서 가리고(maskUrl), 값은
 *    알려진 비밀로 등록해 로그·오류 글에서 지운다.
 * 3. 2xx면 본문을 출처 파서로 읽는다. 결과 코드 오류·형식 깨짐은 call_log.error_code에도 남긴다(200이어도 실패로 센다 —
 *    경고 계산 `succeeded=false 또는 error_code 있음`). 빈 응답은 실패가 아니다(건수 0).
 * 4. 2xx가 아니거나 연결 실패(관문 502)면 `FAILED`.
 */
@Injectable()
export class FxApiCaller {
  private readonly logger = new Logger(FxApiCaller.name);

  constructor(
    private readonly gateway: ExternalHttpGateway,
    private readonly callLogs: CallLogService,
    private readonly usage: CallUsageService,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async call<T>(spec: FxCallSpec<T>): Promise<FxFetchOutcome<T>> {
    let key: string | null;
    try {
      key = await this.secrets.get(spec.secretKey);
    } catch (e) {
      const code = e instanceof ApiException ? e.code : 'KEYCHAIN_UNAVAILABLE';
      return this.recordSkipped(spec.target, code, '키체인을 열 수 없어 부르지 않았습니다');
    }
    if (!key) {
      return this.recordSkipped(
        spec.target,
        FX_SECRET_MISSING,
        `${spec.secretKey}가 없어 부르지 않았습니다`,
      );
    }
    registerKnownSecret(key);

    let parsed: FxParsed<T> | null = null;
    try {
      const res = await this.gateway.request(
        spec.target,
        { method: 'GET', url: spec.buildUrl(key), headers: { Accept: spec.accept } },
        {
          describeResponse: ({ status, body }) => {
            if (status < 200 || status >= 300) return undefined;
            parsed = spec.parse(body.toString('utf8'));
            if (parsed.kind === 'ERROR') {
              return { errorCode: parsed.errorCode, errorMessage: parsed.message };
            }
            return { itemCount: parsed.kind === 'OK' ? parsed.rates.length : 0 };
          },
        },
      );
      if (res.status < 200 || res.status >= 300) {
        return {
          kind: 'FAILED',
          errorCode: `HTTP_${res.status}`,
          message: `HTTP ${res.status} 응답`,
          callLogId: res.callLogId,
        };
      }
      const result: FxParsed<T> = parsed ?? spec.parse(res.body.toString('utf8'));
      if (result.kind === 'ERROR') {
        return {
          kind: 'FAILED',
          errorCode: result.errorCode,
          message: result.message,
          callLogId: res.callLogId,
        };
      }
      if (result.kind === 'EMPTY') return { kind: 'EMPTY', callLogId: res.callLogId };
      return { kind: 'OK', rates: result.rates, callLogId: res.callLogId };
    } catch (e) {
      if (e instanceof ApiException) {
        const details = e.details ?? {};
        const callLogId = typeof details.callLogId === 'number' ? details.callLogId : null;
        const reason = typeof details.reason === 'string' ? details.reason : e.code;
        return { kind: 'FAILED', errorCode: reason, message: e.message, callLogId };
      }
      throw e;
    }
  }

  /** 부르지 않은 실패(키 없음·키체인)를 call_log에 1행 남긴다(요청·호스트·주소 없음) */
  private async recordSkipped<T>(
    target: FxCallSpec<T>['target'],
    errorCode: string,
    message: string,
  ): Promise<FxFetchOutcome<T>> {
    const log = await this.callLogs.start({ target, calledAt: this.clock.now() });
    await this.callLogs.finish(log.id, {
      succeeded: false,
      errorCode,
      errorMessage: message,
      durationMs: 0,
    });
    try {
      await this.usage.publishChanged(target);
    } catch (e) {
      this.logger.warn({ err: e }, `call-usage.changed 발행에 실패했습니다(${target})`);
    }
    return { kind: 'FAILED', errorCode, message, callLogId: log.id };
  }
}

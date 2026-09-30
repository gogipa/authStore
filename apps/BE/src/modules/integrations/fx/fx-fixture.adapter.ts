import { parseCustomsResponse } from './customs-service.response.js';
import type {
  FxFetchOutcome,
  FxRawCostRate,
  FxRawCustomsRate,
  FxSourcePort,
} from './fx-source.port.js';
import { parseKeximResponse } from './kexim.response.js';

type Answer<T> = FxFetchOutcome<T> | ((kstDate: string) => FxFetchOutcome<T>);

/**
 * 테스트·개발용 환율 출처(P2-04 §5). 외부를 부르지 않고 정해 둔 결과를 돌려준다. call_log는 쓰지 않는다
 * (관문·call_log까지 보려면 e2e에서 실제 어댑터 + 가짜 fetch를 쓴다).
 * 쓰는 법: `Test.createTestingModule(...).overrideProvider(FX_SOURCE_PORT).useValue(new FxFixtureAdapter())`,
 * 응답 본문 fixture(test/fixtures/fx)는 `FxFixtureAdapter.costFromBody(text)`·`customsFromBody(xml)`로 결과를 만든다.
 */
export class FxFixtureAdapter implements FxSourcePort {
  readonly calls: { method: 'fetchCostJpy' | 'fetchCustomsRates'; kstDate: string }[] = [];
  private cost: Answer<FxRawCostRate> = { kind: 'EMPTY', callLogId: null };
  private customs: Answer<FxRawCustomsRate> = { kind: 'EMPTY', callLogId: null };

  /** 수출입은행 응답 본문 → 결과(파서는 실제 어댑터와 같다) */
  static costFromBody(bodyText: string): FxFetchOutcome<FxRawCostRate> {
    const r = parseKeximResponse(bodyText);
    if (r.kind === 'OK') return { kind: 'OK', rates: [r.rate], callLogId: null };
    if (r.kind === 'EMPTY') return { kind: 'EMPTY', callLogId: null };
    return { kind: 'FAILED', errorCode: r.errorCode, message: r.message, callLogId: null };
  }

  /** 관세청 응답 본문 → 결과 */
  static customsFromBody(xml: string): FxFetchOutcome<FxRawCustomsRate> {
    const r = parseCustomsResponse(xml);
    if (r.kind === 'OK') return { kind: 'OK', rates: r.rates, callLogId: null };
    if (r.kind === 'EMPTY') return { kind: 'EMPTY', callLogId: null };
    return { kind: 'FAILED', errorCode: r.errorCode, message: r.message, callLogId: null };
  }

  /** HTTP 오류처럼 실패한 결과 */
  static failed<T>(errorCode = 'HTTP_500', message = 'HTTP 500 응답'): FxFetchOutcome<T> {
    return { kind: 'FAILED', errorCode, message, callLogId: null };
  }

  answerCost(answer: Answer<FxRawCostRate>): this {
    this.cost = answer;
    return this;
  }

  answerCustoms(answer: Answer<FxRawCustomsRate>): this {
    this.customs = answer;
    return this;
  }

  callsOf(method: 'fetchCostJpy' | 'fetchCustomsRates'): string[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.kstDate);
  }

  reset(): void {
    this.calls.length = 0;
    this.cost = { kind: 'EMPTY', callLogId: null };
    this.customs = { kind: 'EMPTY', callLogId: null };
  }

  fetchCostJpy(kstDate: string): Promise<FxFetchOutcome<FxRawCostRate>> {
    this.calls.push({ method: 'fetchCostJpy', kstDate });
    return Promise.resolve(typeof this.cost === 'function' ? this.cost(kstDate) : this.cost);
  }

  fetchCustomsRates(kstDate: string): Promise<FxFetchOutcome<FxRawCustomsRate>> {
    this.calls.push({ method: 'fetchCustomsRates', kstDate });
    return Promise.resolve(
      typeof this.customs === 'function' ? this.customs(kstDate) : this.customs,
    );
  }
}

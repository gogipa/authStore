import { FakeAiEngineAdapter, type FakeAiEngines, type FakeAiRunCall } from './fake-ai-engines.js';

/**
 * 가짜 AI 동일 상품 판정 보조(P2-03 F-BS-38). 실제 CLI를 부르지 않고 고정 결과 `{ match: true, confidence: 0.8, reason }`을
 * 돌려준다(작업 이름 F-BS-38만 — 다른 작업은 원래 가짜 결과). 실제 CLI 테스트는 켜지 않는다(AI_CLI_LIVE=1일 때만 P1-10 live-cli).
 * - 단위: `new FakeAiMatchEngineAdapter()`를 AiExecutor의 어댑터 목록에 넣는다
 * - e2e: `useFakeAiMatch(t.ai)` — createTestApp의 가짜 엔진 3개(선택 엔진 CLAUDE)에 같은 결과를 건다
 */
export const FAKE_AI_MATCH = {
  match: true,
  confidence: 0.8,
  reason: '型番과 색상 코드가 기준 상품과 같아 보입니다(가짜 AI 결과).',
} as const;

/** F-BS-38 작업이면 고정 결과, 아니면 `fallback` */
export function aiMatchRunImpl(fallback: (call: FakeAiRunCall) => unknown) {
  return (call: FakeAiRunCall): unknown =>
    call.task === 'F-BS-38' ? { ...FAKE_AI_MATCH } : fallback(call);
}

export class FakeAiMatchEngineAdapter extends FakeAiEngineAdapter {
  constructor() {
    super('CLAUDE', { installed: true, cliVersion: '2.1.269', auth: 'OK' });
    this.runImpl = aiMatchRunImpl(() => ({ answer: 'OK' }));
  }

  /** F-BS-38 호출 수 */
  matchCalls(): number {
    return this.calls.runStructured.filter((c) => c.task === 'F-BS-38').length;
  }
}

/** createTestApp의 가짜 엔진 3개에 F-BS-38 고정 결과를 건다 */
export function useFakeAiMatch(engines: FakeAiEngines): void {
  for (const adapter of [engines.claude, engines.agy, engines.codex]) {
    const fallback = adapter.runImpl;
    adapter.runImpl = aiMatchRunImpl(fallback);
  }
}

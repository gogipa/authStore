import { muteNestLogger } from '../../../test/support/commerce-meta-kit.js';
import {
  FAKE_AI_MATCH,
  FakeAiMatchEngineAdapter,
} from '../../../test/support/fake-ai-engine.adapter.js';
import type { CallLogService } from '../integrations/http/call-log.service.js';
import type { Clock } from '../integrations/http/clock.token.js';
import { AiExecutor } from '../integrations/ai-engine/ai-executor.service.js';
import type { PinnedAiContext } from '../integrations/ai-engine/ai-executor.types.js';
import { assertAiSchemaRules } from '../integrations/ai-engine/schema/ai-schema-rules.js';
import { AI_MATCH_SCHEMA, AiMatchService } from './ai-match.service.js';

const callLog = {
  start: () => Promise.resolve({ id: 1 }),
  finish: () => Promise.resolve(true),
} as unknown as CallLogService;
const clock: Clock = {
  now: () => new Date('2026-09-28T00:00:00Z'),
  sleep: () => Promise.resolve(),
};
const pinned: PinnedAiContext = {
  engine: 'CLAUDE',
  textModel: 'sonnet',
  visionModel: 'sonnet',
  cliVersion: '2.1.269',
  settingsSnapshotId: 1,
  stepRunId: 5,
  candidateId: 3,
};
const ANCHOR = {
  itemName: 'アシックス ゲルカヤノ 14 1201A019-108',
  modelCode: '1201A019',
  colorCode: '108',
};
const ROW = {
  itemName: 'アシックス ゲルカヤノ 14 1201A019 クリーム×ブラック',
  shopName: 'ショップC',
};

describe('AI 동일 상품 판정 보조(F-BS-38, 가짜 어댑터)', () => {
  muteNestLogger();

  it('스키마는 규칙 7(additionalProperties false, 모두 required)을 지킨다', () => {
    expect(() => assertAiSchemaRules(AI_MATCH_SCHEMA)).not.toThrow();
    expect(AI_MATCH_SCHEMA.required).toEqual(['match', 'confidence', 'reason']);
  });

  it('고정 결과 { match: true, confidence: 0.8, reason }를 참고로 돌려준다(작업 F-BS-38·텍스트 모델)', async () => {
    const adapter = new FakeAiMatchEngineAdapter();
    const service = new AiMatchService(new AiExecutor([adapter], callLog, clock));
    const { result, stop } = await service.judge(pinned, ANCHOR, ROW);
    expect(result).toEqual({ ...FAKE_AI_MATCH });
    expect(stop).toBe(false);
    expect(adapter.matchCalls()).toBe(1);
    expect(adapter.calls.runStructured[0]).toMatchObject({ task: 'F-BS-38', model: 'sonnet' });
    expect(AiMatchService.toJson(result!)).toEqual({ ...FAKE_AI_MATCH });
  });

  it('결과 모양이 틀리거나 CLI가 실패하면 그 행만 결과 없음(비교는 계속), 모델이 없으면 멈춤', async () => {
    const adapter = new FakeAiMatchEngineAdapter();
    adapter.runImpl = () => ({ match: 'yes' });
    const service = new AiMatchService(new AiExecutor([adapter], callLog, clock));
    expect(await service.judge(pinned, ANCHOR, ROW)).toEqual({ result: null, stop: false });
    adapter.runImpl = () => {
      throw new Error('boom');
    };
    expect((await service.judge(pinned, ANCHOR, ROW)).result).toBeNull();
    const noModel = await service.judge({ ...pinned, textModel: null }, ANCHOR, ROW);
    expect(noModel).toEqual({ result: null, stop: true });
  });
});

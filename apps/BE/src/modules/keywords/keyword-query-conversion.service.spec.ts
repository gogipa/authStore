import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createFakeAiEngines, type FakeAiEngines } from '../../../test/support/fake-ai-engines.js';
import { ApiException } from '../../common/errors/api.exception.js';
import {
  AI_RUN_ERROR_CODES,
  AiCallFailedError,
} from '../integrations/ai-engine/ai-engine.errors.js';
import { AI_ENGINE_ADAPTERS } from '../integrations/ai-engine/ai-engine.port.js';
import { AiExecutor } from '../integrations/ai-engine/ai-executor.service.js';
import {
  CallLogService,
  type CallLogResult,
  type CallLogStart,
} from '../integrations/http/call-log.service.js';
import { CLOCK, type Clock } from '../integrations/http/clock.token.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  AiEngineAvailabilityService,
  aiEngineUnavailableException,
} from '../system/ai-cli-checks/ai-engine-availability.service.js';
import {
  buildQueryConversionPrompt,
  cleanConvertedQuery,
  hasHangul,
  QUERY_CONVERSION_SCHEMA,
} from './keyword-query-conversion.prompt.js';
import { KeywordQueryConversionService } from './keyword-query-conversion.service.js';
import { KeywordRepository } from './keyword.repository.js';

/**
 * 한글 키워드 → 일본어 검색어(F-BS-70). 실제 `AiExecutor`(입력 보호·재검증·call_log)를 DI로 넣고 어댑터·call_log·키워드 저장소·
 * 설정·사용 가능 판정만 가짜로 바꾼다(진짜 CLI·DB 없음).
 */

class FakeCallLog {
  readonly rows: { id: number; start: CallLogStart; result: CallLogResult | null }[] = [];
  start(input: CallLogStart) {
    const row = { id: this.rows.length + 1, start: input, result: null };
    this.rows.push(row);
    return Promise.resolve({ id: row.id });
  }
  finish(id: number, result: CallLogResult) {
    this.rows[id - 1]!.result = result;
    return Promise.resolve(true);
  }
}

const clock: Clock = {
  now: () => new Date('2026-10-05T00:00:00Z'),
  sleep: () => Promise.resolve(),
};
const AGY_TEXT = 'gemini-3.8-flash-medium';

const keywordRow = (
  patch: Partial<{ id: number; keyword: string; excludedReason: string | null }> = {},
) => ({
  id: 601,
  keyword: '여성로퍼',
  excludedReason: null,
  ...patch,
});

describe('KeywordQueryConversionService — 한글 키워드 → 일본어 검색어(F-BS-70)', () => {
  const originalWarn = Logger.prototype.warn;
  let ai: FakeAiEngines;
  let callLog: FakeCallLog;
  let service: KeywordQueryConversionService;
  let found: ReturnType<typeof keywordRow> | null;
  let assertUsable: (engine: string) => Promise<void>;
  let usableCalls: string[];
  let warns: unknown[][];

  /** AGY 가짜 어댑터가 돌려줄 결과 */
  const answer = (output: unknown) => {
    ai.agy.runImpl = () => output;
  };
  const failureOf = async (id: number | null): Promise<unknown> => {
    try {
      await service.convert(id);
    } catch (error) {
      return error;
    }
    throw new Error('던지지 않았다');
  };

  beforeEach(async () => {
    ai = createFakeAiEngines();
    callLog = new FakeCallLog();
    found = keywordRow();
    warns = [];
    Logger.prototype.warn = (...args: unknown[]) => {
      warns.push(args);
    };
    usableCalls = [];
    assertUsable = () => Promise.resolve();
    const moduleRef = await Test.createTestingModule({
      providers: [
        KeywordQueryConversionService,
        AiExecutor,
        { provide: AI_ENGINE_ADAPTERS, useValue: ai.adapters },
        { provide: CallLogService, useValue: callLog },
        { provide: CLOCK, useValue: clock },
        {
          provide: KeywordRepository,
          useValue: { findKeyword: (id: number) => Promise.resolve(id === 601 ? found : null) },
        },
        {
          provide: SettingsService,
          useValue: {
            current: () => ({
              ai: {
                engine: 'AGY',
                models: { AGY: { text: AGY_TEXT, vision: 'gemini-3.8-flash-high' } },
              },
            }),
            currentSnapshotId: () => 5,
          },
        },
        {
          provide: AiEngineAvailabilityService,
          useValue: {
            assertUsable: (engine: string) => {
              usableCalls.push(engine);
              return assertUsable(engine);
            },
          },
        },
      ],
    }).compile();
    service = moduleRef.get(KeywordQueryConversionService);
  });

  afterEach(() => {
    Logger.prototype.warn = originalWarn;
  });

  it('키워드 1개를 선택 엔진(AGY)의 텍스트 모델로 보내고 바꾼 검색어를 돌려준다. 네이버 데이터 예외를 켠 사실을 남긴다', async () => {
    answer({ query_ja: 'ローファー レディース' });
    await expect(service.convert(601)).resolves.toEqual({
      keywordId: 601,
      keyword: '여성로퍼',
      rakutenQuery: 'ローファー レディース',
      engineCode: 'AGY',
      model: AGY_TEXT,
    });
    expect(usableCalls).toEqual(['AGY']);
    const calls = ai.agy.calls.runStructured;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ task: 'KW-06', model: AGY_TEXT });
    expect(calls[0]!.promptIncludes('여성로퍼')).toBe(true);
    expect(calls[0]!.schema).toEqual(QUERY_CONVERSION_SCHEMA);
    // call_log 1행(성공), 네이버 데이터 예외 기록(앱 로그 경고)
    expect(callLog.rows.map((r) => r.result?.succeeded)).toEqual([true]);
    expect(warns.some((w) => JSON.stringify(w).includes('KEYWORD_QUERY_CONVERSION'))).toBe(true);
  });

  it('결과의 공백(전각·줄바꿈 포함)을 한 칸으로 다듬는다', async () => {
    answer({ query_ja: '  ニューバランス\u3000530 \n' });
    const result = await service.convert(601);
    expect(result.rakutenQuery).toBe('ニューバランス 530');
  });

  it('한글이 남았거나 비면 쓰지 않는다 — 502 AI_CALL_FAILED(errorCode AI_OUTPUT_INVALID)', async () => {
    answer({ query_ja: 'ローファー 레이디스' });
    const error = await failureOf(601);
    expect(error).toBeInstanceOf(ApiException);
    expect(error).toMatchObject({
      code: 'AI_CALL_FAILED',
      details: { errorCode: 'AI_OUTPUT_INVALID', engineCode: 'AGY' },
    });
    answer({ query_ja: ' \u3000 ' });
    expect(await failureOf(601)).toMatchObject({ code: 'AI_CALL_FAILED' });
  });

  it('스키마를 어기면(필드 없음) 앱 재검증이 막아 502 AI_CALL_FAILED(AI_OUTPUT_INVALID)', async () => {
    answer({ other: 'x' });
    expect(await failureOf(601)).toMatchObject({
      code: 'AI_CALL_FAILED',
      details: { errorCode: AI_RUN_ERROR_CODES.OUTPUT_INVALID },
    });
  });

  it('AI 호출이 시간 제한으로 끝나면 502 AI_CALL_FAILED(AI_TIMEOUT) — 한국어 문구를 그대로 쓴다', async () => {
    ai.agy.runImpl = () => {
      throw new AiCallFailedError('AGY', AI_RUN_ERROR_CODES.TIMEOUT, '120초');
    };
    const error = await failureOf(601);
    expect(error).toMatchObject({ code: 'AI_CALL_FAILED', details: { errorCode: 'AI_TIMEOUT' } });
    expect((error as ApiException).message).toContain('시간 제한');
  });

  it('키워드가 없으면(없는 id·잘못된 id) 404 KEYWORD_NOT_FOUND, AI를 부르지 않는다', async () => {
    expect(await failureOf(999)).toMatchObject({ code: 'KEYWORD_NOT_FOUND' });
    expect(await failureOf(null)).toMatchObject({ code: 'KEYWORD_NOT_FOUND' });
    expect(ai.totalRuns()).toBe(0);
    expect(usableCalls).toHaveLength(0);
  });

  it('아동화로 빠진 키워드는 409 KEYWORD_EXCLUDED, AI를 부르지 않는다', async () => {
    found = keywordRow({ excludedReason: 'CHILD_TERM' });
    expect(await failureOf(601)).toMatchObject({ code: 'KEYWORD_EXCLUDED' });
    expect(ai.totalRuns()).toBe(0);
  });

  it('선택 엔진을 쓸 수 없으면 409 AI_ENGINE_UNAVAILABLE 그대로, AI를 부르지 않는다(다른 엔진으로 넘어가지 않음)', async () => {
    assertUsable = () => Promise.reject(aiEngineUnavailableException('AGY', 'NOT_LOGGED_IN'));
    expect(await failureOf(601)).toMatchObject({
      code: 'AI_ENGINE_UNAVAILABLE',
      details: { engineCode: 'AGY', reason: 'NOT_LOGGED_IN' },
    });
    expect(ai.totalRuns()).toBe(0);
  });

  it('비밀 모양이 든 입력은 입력 보호가 막는다(502 AI_CALL_FAILED, 어댑터 호출 0, call_log 0)', async () => {
    found = keywordRow({ keyword: 'Bearer abcdefghijklmnopqrstuvwxyz0123' });
    expect(await failureOf(601)).toMatchObject({
      code: 'AI_CALL_FAILED',
      details: { errorCode: AI_RUN_ERROR_CODES.INPUT_BLOCKED },
    });
    expect(ai.totalRuns()).toBe(0);
    expect(callLog.rows).toHaveLength(0);
  });
});

describe('키워드 → 일본어 검색어 프롬프트·다듬기', () => {
  it('입력은 출처 NAVER_DATALAB 블록 하나(키워드 한 줄)이고 예외 KEYWORD_QUERY_CONVERSION을 켠다', () => {
    const input = buildQueryConversionPrompt(' 뉴발란스 530 ');
    expect(input.blocks).toEqual([
      { source: 'NAVER_DATALAB', label: '키워드', text: '뉴발란스 530' },
    ]);
    expect(input.naverDataException).toBe('KEYWORD_QUERY_CONVERSION');
    expect(input.instruction).toContain('일본어');
    expect(input.instruction).toContain('query_ja');
  });

  it('한글 판별·공백 다듬기', () => {
    expect(hasHangul('여성로퍼')).toBe(true);
    expect(hasHangul('ㅋㅋ')).toBe(true);
    expect(hasHangul('ローファー NIKE 530')).toBe(false);
    expect(cleanConvertedQuery('  a\u3000b \n c ')).toBe('a b c');
  });
});

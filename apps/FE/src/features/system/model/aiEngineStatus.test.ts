import { describe, expect, it } from 'vitest';
import {
  aiCliCheck,
  aiCliCheckLatestList,
  boardChecks,
  detectedOnly,
} from '@/test/fixtures/aiEngine';
import {
  AI_CLI_CHECK_TRIGGER_LABEL,
  authStatusView,
  engineCheckViews,
  engineHealthChip,
  firstRunAiEngineState,
  formatLatency,
  hasRecentPass,
  recommendEngine,
} from './aiEngineStatus';

const NOW = Date.parse('2026-09-27T05:10:00.000Z');
const MIN = 60_000;
const at = (msBefore: number) => new Date(NOW - msBefore).toISOString();

describe('recommendEngine(F-SY-23, 규칙 14: CLAUDE → CODEX → AGY)', () => {
  const views = (rows: Parameters<typeof aiCliCheckLatestList>[0]) =>
    engineCheckViews(aiCliCheckLatestList(rows));

  it('모두 PASSED면 CLAUDE', () => {
    expect(
      recommendEngine(
        views({
          CLAUDE: aiCliCheck({ engineCode: 'CLAUDE' }),
          AGY: aiCliCheck({ engineCode: 'AGY' }),
          CODEX: aiCliCheck({ engineCode: 'CODEX' }),
        }),
      ),
    ).toBe('CLAUDE');
  });

  it('CLAUDE 미설치·AGY와 CODEX PASSED면 CODEX', () => {
    expect(
      recommendEngine(
        views({
          CLAUDE: detectedOnly('CLAUDE', { installed: false }),
          AGY: aiCliCheck({ engineCode: 'AGY' }),
          CODEX: aiCliCheck({ engineCode: 'CODEX' }),
        }),
      ),
    ).toBe('CODEX');
  });

  it('AGY만 PASSED면 AGY', () => {
    expect(
      recommendEngine(
        views({
          CLAUDE: aiCliCheck({ smokeStatus: 'FAILED', errorCode: 'CONTRACT_FAILED' }),
          AGY: aiCliCheck({ engineCode: 'AGY' }),
          CODEX: null,
        }),
      ),
    ).toBe('AGY');
  });

  it('PASSED가 없으면 null(추천하려고 테스트를 부르지 않는다)', () => {
    expect(recommendEngine(views({ CLAUDE: detectedOnly('CLAUDE') }))).toBeNull();
    expect(recommendEngine(views({}))).toBeNull();
  });
});

describe('hasRecentPass(10분 경계, 표시용)', () => {
  it('9분 59초 전 통과 → true, 10분 1초 전 → false', () => {
    const recent = aiCliCheck({ checkedAt: at(9 * MIN + 59_000) });
    const old = aiCliCheck({ checkedAt: at(10 * MIN + 1000) });
    expect(hasRecentPass([recent], 'CLAUDE', 'sonnet', NOW)).toBe(true);
    expect(hasRecentPass([old], 'CLAUDE', 'sonnet', NOW)).toBe(false);
  });

  it('다른 모델·다른 엔진·FAILED·모델 없음은 false', () => {
    const row = aiCliCheck({ checkedAt: at(MIN) });
    expect(hasRecentPass([row], 'CLAUDE', 'opus', NOW)).toBe(false);
    expect(hasRecentPass([row], 'AGY', 'sonnet', NOW)).toBe(false);
    expect(
      hasRecentPass(
        [aiCliCheck({ smokeStatus: 'FAILED', checkedAt: at(MIN) })],
        'CLAUDE',
        'sonnet',
        NOW,
      ),
    ).toBe(false);
    expect(hasRecentPass([row], 'CLAUDE', null, NOW)).toBe(false);
    expect(hasRecentPass([null, undefined], 'CLAUDE', 'sonnet', NOW)).toBe(false);
  });
});

describe('engineCheckViews·상태 문구(SCR-13 카드와 SCR-11 같은 문구)', () => {
  it('최신 행이 감지만(SKIPPED)이어도 이력에서 마지막 연결 테스트를 찾는다', () => {
    const passed = aiCliCheck({ id: 1, checkedAt: at(5 * MIN) });
    const detected = detectedOnly('CLAUDE', { id: 2, checkedAt: at(MIN) });
    const [claude] = engineCheckViews(aiCliCheckLatestList({ CLAUDE: detected }), [
      passed,
      detected,
    ]);
    expect(claude!.latest?.id).toBe(2);
    expect(claude!.lastSmoke?.id).toBe(1);
    expect(engineHealthChip(claude!).label).toBe('정상');
  });

  it('보드 상태: Claude 정상 · Antigravity 테스트 안 함(로그인은 연결 테스트로 확인) · Codex 설치 안 됨', () => {
    const [claude, agy, codex] = engineCheckViews(aiCliCheckLatestList(boardChecks()));
    expect(claude!.selected).toBe(true);
    expect([claude, agy, codex].map((v) => engineHealthChip(v!).label)).toEqual([
      '정상',
      '테스트 안 함',
      '설치 안 됨',
    ]);
    expect(authStatusView(claude!)).toMatchObject({
      chip: { label: '로그인됨' },
      note: 'claude auth status',
      noteIsCommand: true,
    });
    expect(authStatusView(agy!)).toMatchObject({
      chip: { label: '연결 테스트로 확인' },
      note: '확인 명령이 없습니다',
    });
  });

  it('agy 연결 테스트를 통과하면 로그인됨(연결 테스트로 확인함)', () => {
    const [, agy] = engineCheckViews(
      aiCliCheckLatestList({ AGY: aiCliCheck({ engineCode: 'AGY', authStatus: 'UNKNOWN' }) }),
    );
    expect(authStatusView(agy!)).toMatchObject({
      chip: { label: '로그인됨' },
      note: '연결 테스트로 확인함',
    });
  });

  it('걸린 시간·계기 한국어', () => {
    expect(formatLatency(12_700)).toBe('12.7초');
    expect(formatLatency(9_800)).toBe('9.8초');
    expect(formatLatency(null)).toBe('—');
    expect(AI_CLI_CHECK_TRIGGER_LABEL).toEqual({
      STARTUP: '앱 시작',
      MANUAL: '직접 누름',
      BEFORE_SAVE: '저장 전',
      FIRST_RUN: '첫 실행',
    });
  });
});

describe('firstRunAiEngineState(Proposed: 선택 엔진의 마지막 연결 테스트로 확정 판단)', () => {
  it('선택 엔진이 통과했으면 완료(모델·시각)', () => {
    const state = firstRunAiEngineState(engineCheckViews(aiCliCheckLatestList(boardChecks())));
    expect(state).toEqual({
      done: true,
      engine: 'CLAUDE',
      model: 'sonnet',
      at: '2026-09-27T05:00:00.000Z',
    });
  });

  it('아니면 할 일 + 추천', () => {
    const state = firstRunAiEngineState(
      engineCheckViews(
        aiCliCheckLatestList({
          CLAUDE: detectedOnly('CLAUDE', { installed: false }),
          CODEX: aiCliCheck({ engineCode: 'CODEX' }),
        }),
      ),
    );
    expect(state).toEqual({ done: false, recommended: 'CODEX' });
  });
});

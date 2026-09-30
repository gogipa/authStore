import type { AiCliCheck } from '../../../generated/prisma/client.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import {
  aiEngineUnavailableException,
  aiEngineUnavailableReason,
} from './ai-engine-availability.service.js';

const row = (patch: Partial<AiCliCheck> = {}): AiCliCheck => ({
  id: 1,
  engineCode: 'CLAUDE',
  trigger: 'STARTUP',
  installed: true,
  binPath: '/usr/local/bin/claude',
  cliVersion: '2.1.269',
  versionSupported: null,
  authStatus: 'OK',
  smokeStatus: 'PASSED',
  model: 'sonnet',
  latencyMs: 1200,
  errorCode: null,
  errorMessage: null,
  checkedAt: new Date('2026-09-28T00:00:00Z'),
  ...patch,
});

describe('AI 단계 시작 전 사용 가능 판정(P1-10 규칙 11, R10)', () => {
  it.each([
    ['행 없음', null, 'NOT_CHECKED'],
    [
      '미설치',
      row({ installed: false, smokeStatus: 'SKIPPED', model: null, latencyMs: null }),
      'NOT_INSTALLED',
    ],
    ['로그인 풀림', row({ authStatus: 'NOT_LOGGED_IN', smokeStatus: 'SKIPPED' }), 'NOT_LOGGED_IN'],
    [
      '연결 테스트 실패',
      row({ smokeStatus: 'FAILED', errorCode: 'CONTRACT_FAILED' }),
      'CONTRACT_FAILED',
    ],
    [
      '연결 테스트가 로그인 풀림을 봄',
      row({ smokeStatus: 'FAILED', errorCode: 'NOT_LOGGED_IN' }),
      'NOT_LOGGED_IN',
    ],
    ['모델 없음', row({ smokeStatus: 'FAILED', errorCode: 'MODEL_NOT_SET' }), 'MODEL_NOT_SET'],
    [
      '알 수 없는 실패 코드',
      row({ smokeStatus: 'FAILED', errorCode: 'AI_TIMEOUT' }),
      'CONTRACT_FAILED',
    ],
  ] as const)('%s → %s', (_name, value, reason) => {
    expect(aiEngineUnavailableReason(value)).toBe(reason);
  });

  it.each([
    ['통과', row()],
    [
      '감지만 한 SKIPPED(최신 행 규칙 그대로)',
      row({ smokeStatus: 'SKIPPED', model: null, latencyMs: null }),
    ],
    ['지원 밖 버전은 경고만(Proposed)', row({ versionSupported: false })],
    ['agy UNKNOWN 로그인', row({ engineCode: 'AGY', authStatus: 'UNKNOWN' })],
  ])('%s → 쓸 수 있음', (_name, value) => {
    expect(aiEngineUnavailableReason(value)).toBeNull();
  });

  it('409 AI_ENGINE_UNAVAILABLE: details = { engineCode, reason, settingsPath }, 문구는 05-3 그대로', () => {
    const e = aiEngineUnavailableException('CLAUDE', 'NOT_INSTALLED');
    expect(e).toBeInstanceOf(ApiException);
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('AI_ENGINE_UNAVAILABLE');
    expect(e.details).toEqual({
      engineCode: 'CLAUDE',
      reason: 'NOT_INSTALLED',
      settingsPath: '/settings/ai-engine',
    });
    expect(e.message).toBe(
      "선택한 AI 엔진(Claude Code)을 지금 쓸 수 없습니다(설치되지 않음). 'AI 엔진' 설정에서 확인해 주세요.",
    );
  });
});

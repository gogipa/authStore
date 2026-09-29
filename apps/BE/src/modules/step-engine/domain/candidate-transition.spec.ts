import { nextCandidateStatus, hasReadyFields } from './candidate-transition.js';
import { REQUIRED_STEPS, type StepStatusMap } from './steps.js';

/** 필수 9단계 COMPLETED, ⑨는 NOT_RUN */
function allRequiredCompleted(): StepStatusMap {
  const map: StepStatusMap = { REGISTER: 'NOT_RUN' };
  for (const code of REQUIRED_STEPS) map[code] = 'COMPLETED';
  return map;
}

const VALID = { G2: true, G3: true };

describe('nextCandidateStatus — 후보 상태 자동 전환(F-CW-05, 규칙 5)', () => {
  it('작업중 + 9단계 COMPLETED + G2·G3 유효 → 승인대기(READY_FOR_APPROVAL)', () => {
    expect(nextCandidateStatus('WORKING', allRequiredCompleted(), VALID, { ready: true })).toEqual({
      toStatus: 'AWAITING_APPROVAL',
      reason: 'READY_FOR_APPROVAL',
    });
  });

  it('⑨ REGISTER가 NOT_RUN이어도(필수 아님) 승인대기로 간다', () => {
    const steps = allRequiredCompleted();
    expect(steps.REGISTER).toBe('NOT_RUN');
    expect(nextCandidateStatus('WORKING', steps, VALID)?.toStatus).toBe('AWAITING_APPROVAL');
  });

  it('ck_candidate_ready 값이 없으면 승인대기로 올리지 않는다(CHECK 위반 500 방지)', () => {
    expect(
      nextCandidateStatus('WORKING', allRequiredCompleted(), VALID, { ready: false }),
    ).toBeNull();
    expect(
      hasReadyFields({
        itemCode: 'shop:1',
        anchorColorCode: '108',
        gender: 'MALE',
        leafCategoryId: null,
      }),
    ).toBe(false);
    expect(
      hasReadyFields({
        itemCode: 'shop:1',
        anchorColorCode: '108',
        gender: 'MALE',
        leafCategoryId: '5001',
      }),
    ).toBe(true);
  });

  it('게이트가 무효면 작업중에 머문다(통과 기록 없음 = 무효)', () => {
    expect(
      nextCandidateStatus('WORKING', allRequiredCompleted(), { G2: true, G3: false }),
    ).toBeNull();
    expect(
      nextCandidateStatus('WORKING', allRequiredCompleted(), { G2: false, G3: true }),
    ).toBeNull();
  });

  it.each(['AWAITING_APPROVAL', 'VALIDATED'] as const)(
    '%s + TAGS만 RERUN_REQUIRED → 작업중(STEP_NOT_CURRENT)',
    (status) => {
      const steps = { ...allRequiredCompleted(), TAGS: 'RERUN_REQUIRED' as const };
      expect(nextCandidateStatus(status, steps, VALID)).toEqual({
        toStatus: 'WORKING',
        reason: 'STEP_NOT_CURRENT',
      });
    },
  );

  it.each(['AWAITING_APPROVAL', 'VALIDATED'] as const)(
    '%s + G3 무효 → 작업중(GATE_FINGERPRINT_CHANGED)',
    (status) => {
      expect(nextCandidateStatus(status, allRequiredCompleted(), { G2: true, G3: false })).toEqual({
        toStatus: 'WORKING',
        reason: 'GATE_FINGERPRINT_CHANGED',
      });
    },
  );

  it('단계와 게이트가 모두 어긋나면 단계 사유가 먼저다', () => {
    const steps = { ...allRequiredCompleted(), PRICING: 'FAILED' as const };
    expect(nextCandidateStatus('AWAITING_APPROVAL', steps, { G2: false, G3: false })?.reason).toBe(
      'STEP_NOT_CURRENT',
    );
  });

  it('승인대기에서 모두 그대로면 바꾸지 않는다(페이지 수집 7시간 경과는 입력이 아니다 — 지문만 본다)', () => {
    // 전환 함수는 시각을 받지 않는다. 6시간이 지나도 단계·게이트가 그대로면 승인대기에 머문다(PRD §5.3)
    expect(nextCandidateStatus('AWAITING_APPROVAL', allRequiredCompleted(), VALID)).toBeNull();
    expect(nextCandidateStatus('VALIDATED', allRequiredCompleted(), VALID)).toBeNull();
  });

  it('단계 결과 INSUFFICIENT_STOCK → 제외 + 같은 사유(작업중·승인대기·검증완료)', () => {
    for (const status of ['WORKING', 'AWAITING_APPROVAL', 'VALIDATED'] as const) {
      expect(
        nextCandidateStatus(status, allRequiredCompleted(), VALID, {
          exclusion: 'INSUFFICIENT_STOCK',
        }),
      ).toEqual({ toStatus: 'EXCLUDED', reason: 'INSUFFICIENT_STOCK' });
    }
    expect(
      nextCandidateStatus('WORKING', {}, VALID, { exclusion: 'ANCHOR_NO_MATCH' })?.reason,
    ).toBe('ANCHOR_NO_MATCH');
  });

  it('임시·제외·등록 진행 후보는 자동으로 바꾸지 않는다', () => {
    for (const status of [
      'TEMP',
      'EXCLUDED',
      'REGISTERING',
      'RESULT_CHECK_REQUIRED',
      'REGISTERED',
    ] as const) {
      expect(nextCandidateStatus(status, allRequiredCompleted(), VALID)).toBeNull();
      expect(
        nextCandidateStatus(status, allRequiredCompleted(), VALID, {
          exclusion: 'NOT_SALE_CANDIDATE',
        }),
      ).toBeNull();
    }
  });
});

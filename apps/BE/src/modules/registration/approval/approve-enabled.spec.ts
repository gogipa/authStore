import {
  approvalContext,
  standardOptionsInput,
} from '../../../../test/fixtures/registration/approval/approval-fixtures.js';
import { approveDisabledReasonOf } from './approve-enabled.js';

describe('승인 버튼 꺼짐 이유(P4-02 규칙 14 — 승인 API 409·422 코드와 같다)', () => {
  it('기본 fixture는 켜짐(null)', () => {
    expect(approveDisabledReasonOf(approvalContext())).toBeNull();
  });

  it('진행 중 기록 → G2·G3 무효 → 판정 유효 시간 초과 → 로컬 중복 → 표준형 순서다', () => {
    const all = approvalContext({
      inputs: {
        registrations: {
          inProgress: { registrationId: 1, status: 'REGISTERING' },
          duplicate: {
            registrationId: 2,
            status: 'REGISTERED',
            originProductNo: '1',
            channelProductNo: '2',
          },
        },
        gates: { G3: { valid: false } },
      } as never,
      now: '2026-09-28T12:00:00.000Z',
    });
    expect(approveDisabledReasonOf(all)?.code).toBe('REGISTRATION_IN_PROGRESS');
    const gate = approvalContext({ inputs: { gates: { G3: { valid: false } } } as never });
    expect(approveDisabledReasonOf(gate)).toEqual({
      code: 'GATE_NOT_PASSED',
      message: 'G3 썸네일 선택을 먼저 통과해 주세요.',
    });
    const expired = approvalContext({ now: '2026-09-28T11:02:01.000Z' });
    expect(approveDisabledReasonOf(expired)).toEqual({
      code: 'JUDGEMENT_EXPIRED',
      message: "판정에 쓴 라쿠텐 페이지가 6시간이 넘었습니다. '재조회'로 다시 판정해 주세요.",
    });
    const duplicate = approvalContext({
      inputs: {
        registrations: {
          duplicate: {
            registrationId: 2,
            status: 'REGISTERED',
            originProductNo: '1',
            channelProductNo: '2',
          },
        },
      } as never,
    });
    expect(approveDisabledReasonOf(duplicate)?.code).toBe('DUPLICATE_REGISTRATION');
    const standard = approvalContext({}, { optionType: 'STANDARD' });
    expect(approveDisabledReasonOf(standard)?.code).toBe('VALIDATION_FAILED');
    expect(approveDisabledReasonOf(standard)?.message).toContain('표준형 옵션을 지원하지 않습니다');
  });

  it('P4-03: 카테고리가 표준형을 지원하면 STANDARD도 켜짐', () => {
    const standard = approvalContext(
      { inputs: { standardOptions: standardOptionsInput() } as never },
      { optionType: 'STANDARD' },
    );
    expect(standard.draft.standardOption).toEqual({ supported: true, reason: null });
    expect(approveDisabledReasonOf(standard)).toBeNull();
  });
});

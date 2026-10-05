import { describe, expect, it } from 'vitest';
import { candidateDetail, continuousRun, gateList } from '@/test/fixtures/stepEngine';
import {
  chainStepsText,
  continuousRunTitle,
  skippedStepsText,
  stopReasonText,
} from './continuousRun';
import { gateViewsFromList } from './gateViews';

describe('연속 실행 글(P1-06 Proposed)', () => {
  it('멈춘 이유마다 다음에 할 곳을 알린다', () => {
    expect(stopReasonText('AWAIT_G2', 'PRICING')).toContain('③ 판정 화면에서 국내 기준가');
    expect(stopReasonText('AWAIT_G2', 'SOURCING')).toContain('② 소싱이 입력을 기다려');
    expect(stopReasonText('AWAIT_G3', 'THUMBNAIL')).toContain('⑤ 썸네일 화면에서 대표 썸네일');
    expect(stopReasonText('AWAIT_G4', 'REGISTER')).toBe(
      '끝까지 실행했습니다. 최종 승인(G4)에서 확인해 주세요.',
    );
    expect(stopReasonText('NO_RUNNABLE_STEP', 'THUMBNAIL')).toBe(
      '더 실행할 단계가 없어 멈췄습니다. ⑤ 썸네일에서 입력을 마치거나 다시 실행해 주세요.',
    );
    expect(stopReasonText('APP_RESTART', null)).toContain('앱이 꺼져');
  });

  it('제목·진행한 단계·건너뛴 단계', () => {
    const run = continuousRun({
      id: 1,
      skippedStepCodes: ['PRICING', 'CATEGORY'],
    });
    expect(continuousRunTitle(run)).toBe('연속 실행 중입니다');
    expect(continuousRunTitle({ kind: 'RERUN_STALE', endedAt: '2026-09-28T00:00:00Z' })).toBe(
      '재실행 필요 단계 모두 실행이 멈췄습니다',
    );
    expect(skippedStepsText(run)).toBe('③ 판정, ④ 카테고리');
    expect(chainStepsText({ stepRuns: [] })).toBe('');
  });
});

describe('게이트 배지(게이트 목록으로)', () => {
  const detail = candidateDetail({ id: 1 });

  it('G2·G3 통과는 목록의 passed(지문 일치), G3은 G2 전이면 잠김, G4는 여정 상태로 확인 필요', () => {
    expect(gateViewsFromList(gateList().items, detail)).toEqual([
      { gate: 'G2', state: 'pending' },
      { gate: 'G3', state: 'locked' },
      { gate: 'G4', state: 'locked' },
    ]);
    expect(
      gateViewsFromList(gateList({ G2: true, G3: true }).items, {
        ...detail,
        status: 'AWAITING_APPROVAL',
      }),
    ).toEqual([
      { gate: 'G2', state: 'passed' },
      { gate: 'G3', state: 'passed' },
      { gate: 'G4', state: 'pending' },
    ]);
    expect(gateViewsFromList(gateList({ G4: true }).items, detail)[2]).toEqual({
      gate: 'G4',
      state: 'passed',
    });
  });

  it('목록을 받기 전에는 여정 상세 gates로 그린다', () => {
    const valid = candidateDetail({
      id: 1,
      gates: [
        { gate: 'G2', gatePassId: 1, passedAt: '2026-09-28T00:00:00Z', valid: true },
        { gate: 'G3', gatePassId: null, passedAt: null, valid: false },
      ],
    });
    expect(gateViewsFromList(undefined, valid).map((v) => v.state)).toEqual([
      'passed',
      'pending',
      'locked',
    ]);
  });
});

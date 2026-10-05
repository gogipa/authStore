import { describe, expect, it } from 'vitest';
import {
  candidateDetail,
  candidateSummary,
  requiredDone,
  resumeTarget,
  stepBriefs,
} from '@/test/fixtures/stepEngine';
import { parseCandidateId } from './candidateId';
import { candidateGateViews } from './gateViews';
import { anchorKeyLabel, candidateDisplayName } from './displayName';
import {
  resumeRelativePath,
  resumeStepLabel,
  resumeStepPath,
  resumeTargetLabel,
  resumeTargetPath,
} from './resume';
import { groupStepStatus, stepDots } from './stepDots';

describe('이어 하기 경로(model/resume)', () => {
  it('이어 할 단계 → 단계 화면, 없으면 최종 승인(05-1 route맵 §3-2)', () => {
    expect(resumeRelativePath('PRICING')).toBe('judgement');
    expect(resumeRelativePath('CATEGORY')).toBe('judgement#category');
    expect(resumeRelativePath('NOTICE_RAW')).toBe('content');
    expect(resumeRelativePath('REGISTER')).toBe('approval');
    expect(resumeRelativePath(null)).toBe('approval');
    expect(resumeStepPath(12, 'THUMBNAIL')).toBe('/candidates/12/thumbnail');
    expect(resumeStepPath(12, null)).toBe('/candidates/12/approval');
  });

  it("'{단계} 열기' 글자: ⑥-x는 '⑥ 콘텐츠', ⑨·없음은 '최종 승인'", () => {
    expect(resumeStepLabel('PRICING')).toBe('③ 판정');
    expect(resumeStepLabel('NOTICE_RAW')).toBe('⑥ 콘텐츠');
    expect(resumeStepLabel('REGISTER')).toBe('최종 승인');
    expect(resumeStepLabel(null)).toBe('최종 승인');
  });

  it('게이트 대기 → G2 판정 화면, G3 썸네일 화면, G4 최종 승인', () => {
    expect(resumeTargetPath(resumeTarget({ candidateId: 5, gate: 'G2' }))).toBe(
      '/candidates/5/judgement',
    );
    expect(resumeTargetPath(resumeTarget({ candidateId: 5, gate: 'G3' }))).toBe(
      '/candidates/5/thumbnail',
    );
    expect(resumeTargetPath(resumeTarget({ candidateId: 5, gate: 'G4' }))).toBe(
      '/candidates/5/approval',
    );
    expect(resumeTargetLabel(resumeTarget({ candidateId: 5, gate: 'G4' }))).toBe('최종 승인');
    expect(resumeTargetLabel(resumeTarget({ candidateId: 5, gate: 'G2' }))).toBe('판정 확정');
    const step = resumeTarget({ candidateId: 5, stepCode: 'CATEGORY', stepStatus: 'NOT_RUN' });
    expect(resumeTargetPath(step)).toBe('/candidates/5/judgement#category');
    expect(resumeTargetLabel(step)).toBe('④ 카테고리');
  });
});

describe('여정 id(model/candidateId)', () => {
  it('1 이상 int4 정수만', () => {
    expect(parseCandidateId('12')).toBe(12);
    for (const raw of ['0', 'abc', '1.5', '-1', '012', '', null, undefined, '99999999999']) {
      expect(parseCandidateId(raw)).toBeNull();
    }
  });
});

describe('단계 점(model/stepDots)', () => {
  it('⑥ 묶음: 실패 > 재실행 필요 > 입력 대기 > 실행중 > 미실행 > 완료', () => {
    expect(groupStepStatus(['COMPLETED', 'COMPLETED', 'COMPLETED'])).toBe('COMPLETED');
    expect(groupStepStatus(['COMPLETED', 'NOT_RUN', 'COMPLETED'])).toBe('NOT_RUN');
    expect(groupStepStatus(['RUNNING', 'NOT_RUN', 'COMPLETED'])).toBe('RUNNING');
    expect(groupStepStatus(['WAITING_INPUT', 'RUNNING', 'NOT_RUN'])).toBe('WAITING_INPUT');
    expect(groupStepStatus(['WAITING_INPUT', 'RERUN_REQUIRED', 'COMPLETED'])).toBe(
      'RERUN_REQUIRED',
    );
    expect(groupStepStatus(['RERUN_REQUIRED', 'FAILED', 'COMPLETED'])).toBe('FAILED');
  });

  it('단계 10개 → 점 8개(②~⑨)', () => {
    const dots = stepDots(requiredDone({ COPY: 'COMPLETED', NOTICE_RAW: 'FAILED' }));
    expect(dots.map((d) => d.no)).toEqual(['②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']);
    expect(dots.map((d) => d.status)).toEqual([
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'FAILED',
      'COMPLETED',
      'COMPLETED',
      'NOT_RUN',
    ]);
    expect(stepDots(stepBriefs()).every((d) => d.status === 'NOT_RUN')).toBe(true);
  });
});

describe('표시명·여정 머리(model/displayName, CandidateDetailHeader)', () => {
  it('표시명 → 型番 · 색상 → 여정 #id', () => {
    expect(
      candidateDisplayName(
        candidateSummary({ id: 3, displayName: '아식스 젤카야노 14 · 크림/블랙' }),
      ),
    ).toBe('아식스 젤카야노 14 · 크림/블랙');
    expect(
      candidateDisplayName(
        candidateSummary({
          id: 3,
          displayName: null,
          anchorModelCode: '1201A019108',
          selectedColor: '크림/블랙',
        }),
      ),
    ).toBe('1201A019108 · 크림/블랙');
    expect(candidateDisplayName(candidateSummary({ id: 3, displayName: null }))).toBe('여정 #3');
    expect(anchorKeyLabel(candidateDetail({ id: 1 }))).toBe('MR530SG · 화이트/실버');
    expect(
      anchorKeyLabel(candidateDetail({ id: 1, anchorModelCode: null, anchorItemCode: null })),
    ).toBeNull();
  });

  it('게이트 표시: G2 통과 전 G3 잠김, 승인대기면 G4 확인 필요, 승인 시각이 있으면 통과', () => {
    expect(candidateGateViews(candidateDetail({ id: 1 })).map((g) => g.state)).toEqual([
      'pending',
      'locked',
      'locked',
    ]);
    const passed = candidateDetail({
      id: 1,
      status: 'AWAITING_APPROVAL',
      gates: [
        { gate: 'G2', gatePassId: 1, passedAt: '2026-09-28T00:00:00Z', valid: true },
        { gate: 'G3', gatePassId: null, passedAt: null, valid: false },
      ],
    });
    expect(candidateGateViews(passed).map((g) => g.state)).toEqual([
      'passed',
      'pending',
      'pending',
    ]);
    expect(
      candidateGateViews({ ...passed, status: 'REGISTERED', approvedAt: '2026-09-28T00:00:00Z' })[2]
        ?.state,
    ).toBe('passed');
  });
});

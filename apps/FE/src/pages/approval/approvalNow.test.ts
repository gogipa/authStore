import { describe, expect, it } from 'vitest';
import { APPROVAL_GUIDE } from '@/features/guide';
import {
  approvalNowKey,
  approvalNowLinkStep,
  approvalNowPlace,
  type ApprovalNowInput,
  type ApprovalNowKey,
} from './approvalNow';

type Line = ApprovalNowInput['lines'][number];

/** 사전 검증 3줄(통과 여부만 다르게). 실제 화면은 13줄이다 */
function lines(passed: boolean | null, patch: Record<string, Partial<Line>> = {}): readonly Line[] {
  return (['PRODUCT_NAME', 'TAGS', 'JUDGEMENT_FRESHNESS'] as const).map((id) => ({
    id,
    passed,
    linkStep: id === 'PRODUCT_NAME' ? 'NOTICE_HTML' : id === 'TAGS' ? 'TAGS' : null,
    ...patch[id],
  }));
}

/** 승인대기 · ⑧ 완료 · 사전 검증 모두 통과 · 차단 켜짐 · 승인 가능 */
const base: ApprovalNowInput = {
  candidateStatus: 'AWAITING_APPROVAL',
  uploadStatus: 'COMPLETED',
  uploadRunBlocked: false,
  blockerStep: null,
  loading: false,
  lines: lines(true),
  duplicated: false,
  apiBlocked: true,
  approveEnabled: true,
  canCheckResult: false,
};
const key = (over: Partial<ApprovalNowInput>) => approvalNowKey({ ...base, ...over });

describe('⑧·⑨ 지금 할 일 글 고르기(D-41)', () => {
  it('여정이나 ⑧ 상태를 아직 모르거나 일할 수 없는 여정이면 줄을 감춘다(null)', () => {
    expect(key({ candidateStatus: undefined })).toBeNull();
    expect(key({ candidateStatus: 'TEMP' })).toBeNull();
    expect(key({ candidateStatus: 'EXCLUDED' })).toBeNull();
    expect(key({ uploadStatus: undefined })).toBeNull();
    expect(key({ uploadStatus: 'WAITING_INPUT' })).toBeNull();
  });

  it('⑧ 이미지 업로드가 먼저다: 미실행·실행중·재실행 필요·실패', () => {
    expect(key({ uploadStatus: 'NOT_RUN', candidateStatus: 'WORKING' })).toBe('upload');
    expect(key({ uploadStatus: 'RUNNING', candidateStatus: 'WORKING' })).toBe('uploading');
    expect(key({ uploadStatus: 'RERUN_REQUIRED', candidateStatus: 'WORKING' })).toBe('uploadRerun');
    expect(key({ uploadStatus: 'FAILED', candidateStatus: 'WORKING' })).toBe('uploadFailed');
    // 사전 검증이 실패 중이어도 ⑧을 먼저 말한다
    expect(key({ uploadStatus: 'RERUN_REQUIRED', lines: lines(false) })).toBe('uploadRerun');
  });

  it('⑧ 실행 버튼이 꺼져 있으면 누르라고 하지 않고 꺼진 이유를 먼저 보라고 한다(실행중은 그대로)', () => {
    for (const uploadStatus of ['NOT_RUN', 'RERUN_REQUIRED', 'FAILED'] as const) {
      expect(key({ uploadStatus, uploadRunBlocked: true, candidateStatus: 'WORKING' })).toBe(
        'uploadBlocked',
      );
    }
    expect(key({ uploadStatus: 'RUNNING', uploadRunBlocked: true })).toBe('uploading');
  });

  it('⑧까지 끝났는데 승인대기가 아니면 막는 앞 단계를 열라고 한다(막는 곳이 없으면 감춘다)', () => {
    expect(key({ candidateStatus: 'WORKING', blockerStep: 'TAGS' })).toBe('finishSteps');
    expect(key({ candidateStatus: 'WORKING', blockerStep: null })).toBeNull();
  });

  it('승인대기: 중복 → 검사 중 → 사전 검증 실패 → 승인 순서로 첫 번째 막힌 일을 말한다', () => {
    expect(key({ duplicated: true, lines: lines(false) })).toBe('duplicate');
    expect(key({ lines: lines(null), loading: true })).toBe('checking');
    expect(key({ lines: [], loading: true })).toBe('checking');
    // 검사 결과가 없는데 받는 중도 아니면(요청 실패) 줄을 감춘다
    expect(key({ lines: lines(null), loading: false })).toBeNull();
    expect(key({ lines: lines(false, { TAGS: { passed: true } }), approveEnabled: false })).toBe(
      'fixValidation',
    );
    expect(key({})).toBe('approveDryRun');
  });

  it('판정 유효 시간 한 줄만 실패하면 [재조회]를, 다른 줄도 실패했으면 그 줄부터 고치라고 한다', () => {
    const onlyFreshness = lines(true, { JUDGEMENT_FRESHNESS: { passed: false } });
    expect(key({ lines: onlyFreshness, approveEnabled: false })).toBe('refetch');
    const both = lines(true, {
      JUDGEMENT_FRESHNESS: { passed: false },
      TAGS: { passed: false },
    });
    expect(key({ lines: both, approveEnabled: false })).toBe('fixValidation');
  });

  it('승인 글은 등록 API 차단 스위치에 따라 갈린다(켜짐=드라이런, 꺼짐=실제 등록, 모르면 감춘다)', () => {
    expect(key({ apiBlocked: true })).toBe('approveDryRun');
    expect(key({ apiBlocked: false })).toBe('approveLive');
    expect(key({ apiBlocked: undefined })).toBeNull();
  });

  it('승인을 막는 까닭을 줄에서 찾을 수 없으면(실패한 줄 없음) 줄을 감춘다', () => {
    expect(key({ approveEnabled: false })).toBeNull();
  });

  it('승인한 뒤 상태: 검증완료 · 등록요청중 · 결과확인필요 · 등록됨', () => {
    expect(key({ candidateStatus: 'VALIDATED' })).toBe('validated');
    expect(key({ candidateStatus: 'REGISTERING' })).toBe('registering');
    expect(key({ candidateStatus: 'RESULT_CHECK_REQUIRED', canCheckResult: true })).toBe(
      'checkResult',
    );
    expect(key({ candidateStatus: 'RESULT_CHECK_REQUIRED', canCheckResult: false })).toBeNull();
    expect(key({ candidateStatus: 'REGISTERED' })).toBe('registered');
    // 승인한 뒤에는 ⑧ 상태와 상관없이 등록 결과를 말한다
    expect(key({ candidateStatus: 'REGISTERED', uploadStatus: undefined })).toBe('registered');
  });

  it('지금 할 일 글 키가 안내 글(APPROVAL_GUIDE.now)의 키와 모두 같다', () => {
    const reachable = new Set<ApprovalNowKey>();
    const add = (over: Partial<ApprovalNowInput>) => {
      const found = key(over);
      if (found) reachable.add(found);
    };
    add({ uploadStatus: 'NOT_RUN' });
    add({ uploadStatus: 'NOT_RUN', uploadRunBlocked: true });
    add({ uploadStatus: 'RUNNING' });
    add({ uploadStatus: 'RERUN_REQUIRED' });
    add({ uploadStatus: 'FAILED' });
    add({ candidateStatus: 'WORKING', blockerStep: 'TAGS' });
    add({ lines: lines(null), loading: true });
    add({ duplicated: true });
    add({ lines: lines(false), approveEnabled: false });
    add({ lines: lines(true, { JUDGEMENT_FRESHNESS: { passed: false } }), approveEnabled: false });
    add({ apiBlocked: true });
    add({ apiBlocked: false });
    add({ candidateStatus: 'VALIDATED' });
    add({ candidateStatus: 'REGISTERING' });
    add({ candidateStatus: 'RESULT_CHECK_REQUIRED', canCheckResult: true });
    add({ candidateStatus: 'REGISTERED' });
    expect([...reachable].sort()).toEqual(Object.keys(APPROVAL_GUIDE.now).sort());
  });
});

describe('⑧·⑨ 지금 여기 자리와 이동 링크', () => {
  it('지금 할 일이 있는 자리에만 표시한다(기다리기만 하거나 앱 밖의 일이면 없다)', () => {
    expect(approvalNowPlace(null)).toBeNull();
    expect(approvalNowPlace('upload')).toBe('upload');
    expect(approvalNowPlace('uploadRerun')).toBe('upload');
    expect(approvalNowPlace('uploadFailed')).toBe('upload');
    expect(approvalNowPlace('uploadBlocked')).toBeNull();
    expect(approvalNowPlace('uploading')).toBeNull();
    expect(approvalNowPlace('finishSteps')).toBe('approve');
    expect(approvalNowPlace('checking')).toBeNull();
    expect(approvalNowPlace('duplicate')).toBe('existing');
    expect(approvalNowPlace('fixValidation')).toBe('validation');
    expect(approvalNowPlace('refetch')).toBe('validation');
    expect(approvalNowPlace('approveDryRun')).toBe('approve');
    expect(approvalNowPlace('approveLive')).toBe('approve');
    expect(approvalNowPlace('validated')).toBe('switch');
    expect(approvalNowPlace('registering')).toBeNull();
    expect(approvalNowPlace('checkResult')).toBe('result');
    expect(approvalNowPlace('registered')).toBeNull();
  });

  it('모든 글 키에 자리 규칙이 있다', () => {
    for (const nowKey of Object.keys(APPROVAL_GUIDE.now)) {
      expect(approvalNowPlace(nowKey as ApprovalNowKey), nowKey).not.toBeUndefined();
    }
  });

  it('링크는 안내 글에 링크 글이 있는 키에만 열 단계를 준다', () => {
    const failed = lines(true, {
      PRODUCT_NAME: { passed: false },
      TAGS: { passed: false },
      JUDGEMENT_FRESHNESS: { passed: false, linkStep: 'SOURCING' },
    });
    // 고칠 단계는 실패한 줄 가운데 맨 위(판정 유효 시간 줄은 [재조회]로 하니 뺀다)
    expect(approvalNowLinkStep('fixValidation', { lines: failed, blockerStep: null })).toBe(
      'NOTICE_HTML',
    );
    // 링크가 없는 실패 줄(중복·단계 최신성 등)은 건너뛴다
    const noLink = lines(true, {
      PRODUCT_NAME: { passed: false, linkStep: null },
      TAGS: { passed: false },
    });
    expect(approvalNowLinkStep('fixValidation', { lines: noLink, blockerStep: null })).toBe('TAGS');
    expect(
      approvalNowLinkStep('fixValidation', {
        lines: lines(true, { PRODUCT_NAME: { passed: false, linkStep: null } }),
        blockerStep: null,
      }),
    ).toBeNull();
    expect(
      approvalNowLinkStep('finishSteps', { lines: lines(true), blockerStep: 'THUMBNAIL' }),
    ).toBe('THUMBNAIL');
    expect(approvalNowLinkStep('approveDryRun', { lines: failed, blockerStep: 'TAGS' })).toBeNull();
    expect(approvalNowLinkStep(null, { lines: failed, blockerStep: 'TAGS' })).toBeNull();
    expect(Object.keys(APPROVAL_GUIDE.links).sort()).toEqual(['finishSteps', 'fixValidation']);
  });
});

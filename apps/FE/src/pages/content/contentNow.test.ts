import { describe, expect, it } from 'vitest';
import { CONTENT_GUIDE } from '@/features/guide';
import { contentNow, contentNowKey, type ContentNowInput } from './contentNow';

const base: ContentNowInput = {
  copyStatus: 'COMPLETED',
  factStatus: 'COMPLETED',
  assemblyStatus: 'COMPLETED',
  runBlocked: false,
  copyChoicePending: false,
  factRecheck: false,
  assemblyRecheck: false,
  profileMissing: false,
};
const now = (over: Partial<ContentNowInput>) => contentNow({ ...base, ...over });
const key = (over: Partial<ContentNowInput>) => contentNowKey({ ...base, ...over });

describe('⑥ 지금 할 일 글 고르기(D-41)', () => {
  it('단계 상태를 하나라도 아직 못 받았으면 줄을 감춘다(null)', () => {
    expect(key({ copyStatus: undefined })).toBeNull();
    expect(key({ factStatus: undefined })).toBeNull();
    expect(key({ assemblyStatus: undefined })).toBeNull();
  });

  it('세 단계가 모두 끝났으면 done이고, 놓일 구획은 없다', () => {
    expect(now({})).toEqual({ key: 'done', step: null });
  });

  it('아무것도 안 했으면 start(맨 위 실행 줄). 맨 위 실행이 꺼졌으면 blocked', () => {
    const none = {
      copyStatus: 'NOT_RUN',
      factStatus: 'NOT_RUN',
      assemblyStatus: 'NOT_RUN',
    } as const;
    expect(now(none)).toEqual({ key: 'start', step: null });
    expect(now({ ...none, runBlocked: true })).toEqual({ key: 'blocked', step: null });
  });

  it('어느 단계든 실행 중이면 기다리라고 한다(막힌 일보다 먼저)', () => {
    expect(key({ factStatus: 'RUNNING' })).toBe('running');
    expect(key({ copyStatus: 'RUNNING', factStatus: 'NOT_RUN' })).toBe('running');
    expect(key({ copyStatus: 'FAILED', assemblyStatus: 'RUNNING' })).toBe('running');
  });

  it('⑥-1 → ⑥-2 → ⑥-3 순서로 첫 번째 막힌 일을 말한다', () => {
    // ⑥-1이 비었으면 ⑥-2·⑥-3이 어떻든 ⑥-1이 먼저
    expect(
      now({ copyStatus: 'NOT_RUN', factStatus: 'FAILED', assemblyStatus: 'RERUN_REQUIRED' }),
    ).toEqual({ key: 'runStep', step: 'COPY' });
    // ⑥-1이 끝나면 ⑥-2
    expect(now({ factStatus: 'NOT_RUN', assemblyStatus: 'NOT_RUN' })).toEqual({
      key: 'runStep',
      step: 'NOTICE_RAW',
    });
    // ⑥-1·⑥-2가 끝나면 ⑥-3
    expect(now({ assemblyStatus: 'NOT_RUN' })).toEqual({ key: 'runStep', step: 'NOTICE_HTML' });
  });

  it('⑥-1: 실패 · 재실행 필요(그대로 유지 안내) · 다시 실행 결과 고르기. 맨 위 실행이 꺼졌으면 blocked', () => {
    expect(now({ copyStatus: 'FAILED' })).toEqual({ key: 'failedStep', step: 'COPY' });
    expect(now({ copyStatus: 'RERUN_REQUIRED' })).toEqual({ key: 'rerunCopy', step: 'COPY' });
    expect(now({ copyChoicePending: true })).toEqual({ key: 'chooseCopy', step: 'COPY' });
    expect(key({ copyStatus: 'FAILED', runBlocked: true })).toBe('blocked');
    expect(key({ copyStatus: 'RERUN_REQUIRED', runBlocked: true })).toBe('blocked');
    // 고르기는 ⑥-2의 막힌 일보다 먼저
    expect(now({ copyChoicePending: true, factStatus: 'WAITING_INPUT' })).toEqual({
      key: 'chooseCopy',
      step: 'COPY',
    });
  });

  it('⑥-2: 입력 대기는 원산지 직접 넣기, 실패·재실행 필요는 그 구획 다시 실행, 재확인 표시는 확인', () => {
    expect(now({ factStatus: 'WAITING_INPUT' })).toEqual({
      key: 'originInput',
      step: 'NOTICE_RAW',
    });
    expect(now({ factStatus: 'FAILED' })).toEqual({ key: 'failedStep', step: 'NOTICE_RAW' });
    expect(now({ factStatus: 'RERUN_REQUIRED' })).toEqual({ key: 'rerunStep', step: 'NOTICE_RAW' });
    expect(now({ factRecheck: true })).toEqual({ key: 'recheckStep', step: 'NOTICE_RAW' });
    // 재실행 필요이면서 재확인 표시가 있으면 확인(또는 다시 실행)을 안내하는 글 하나로 말한다
    expect(now({ factStatus: 'RERUN_REQUIRED', factRecheck: true })).toEqual({
      key: 'recheckStep',
      step: 'NOTICE_RAW',
    });
    // 입력 대기에서는 재확인보다 원산지 입력이 먼저
    expect(key({ factStatus: 'WAITING_INPUT', factRecheck: true })).toBe('originInput');
  });

  it('⑥-3: 프로필 빈칸이면 프로필 채우기, 아니면 실행·다시 실행. 재확인 표시는 확인', () => {
    expect(now({ assemblyStatus: 'NOT_RUN', profileMissing: true })).toEqual({
      key: 'fillProfile',
      step: 'NOTICE_HTML',
    });
    expect(now({ assemblyStatus: 'FAILED', profileMissing: true })).toEqual({
      key: 'fillProfile',
      step: 'NOTICE_HTML',
    });
    expect(now({ assemblyStatus: 'FAILED' })).toEqual({ key: 'failedStep', step: 'NOTICE_HTML' });
    expect(now({ assemblyStatus: 'RERUN_REQUIRED' })).toEqual({
      key: 'rerunStep',
      step: 'NOTICE_HTML',
    });
    expect(now({ assemblyRecheck: true })).toEqual({ key: 'recheckStep', step: 'NOTICE_HTML' });
    expect(
      key({ assemblyStatus: 'RERUN_REQUIRED', assemblyRecheck: true, profileMissing: true }),
    ).toBe('recheckStep');
    // 이미 끝난 ⑥-3은 프로필이 비었다고 다시 막지 않는다
    expect(key({ profileMissing: true })).toBe('done');
  });

  it('프로필 빈칸은 ⑥-3이 첫 번째 막힌 일일 때만 말한다(⑥-1·⑥-2가 먼저)', () => {
    const none = {
      copyStatus: 'NOT_RUN',
      factStatus: 'NOT_RUN',
      assemblyStatus: 'NOT_RUN',
    } as const;
    expect(key({ ...none, profileMissing: true })).toBe('start');
    expect(key({ factStatus: 'NOT_RUN', assemblyStatus: 'NOT_RUN', profileMissing: true })).toBe(
      'runStep',
    );
  });

  it('입력을 기다릴 일이 없는 ⑥-1·⑥-3이 입력 대기이면 알 수 없는 상태라 줄을 감춘다', () => {
    expect(key({ copyStatus: 'WAITING_INPUT' })).toBeNull();
    expect(key({ assemblyStatus: 'WAITING_INPUT' })).toBeNull();
  });

  it('고른 모든 글 키가 안내 글에 있고, 구획이 놓이는 키와 맨 위 키가 나뉜다', () => {
    const inputs: Partial<ContentNowInput>[] = [
      { copyStatus: 'NOT_RUN', factStatus: 'NOT_RUN', assemblyStatus: 'NOT_RUN' },
      { copyStatus: 'NOT_RUN', factStatus: 'NOT_RUN', assemblyStatus: 'NOT_RUN', runBlocked: true },
      { factStatus: 'RUNNING' },
      { copyStatus: 'NOT_RUN' },
      { copyStatus: 'RERUN_REQUIRED' },
      { copyStatus: 'FAILED' },
      { copyChoicePending: true },
      { factStatus: 'WAITING_INPUT' },
      { factStatus: 'RERUN_REQUIRED' },
      { factRecheck: true },
      { assemblyStatus: 'NOT_RUN', profileMissing: true },
      {},
    ];
    const keys = new Set(inputs.map((over) => key(over)));
    expect([...keys].sort()).toEqual(Object.keys(CONTENT_GUIDE.now).sort());
    for (const k of keys) expect(CONTENT_GUIDE.now[k!]).toBeTruthy();
    for (const over of inputs) {
      const picked = now(over)!;
      const header = ['running', 'blocked', 'start', 'done'].includes(picked.key);
      expect(picked.step === null, picked.key).toBe(header);
    }
  });

  it('{step} 자리를 쓰는 글은 구획이 정해진 키에만 있다', () => {
    const withStep = Object.entries(CONTENT_GUIDE.now)
      .filter(([, text]) => text.includes('{step}'))
      .map(([k]) => k)
      .sort();
    expect(withStep).toEqual(['failedStep', 'recheckStep', 'rerunStep', 'runStep']);
  });
});

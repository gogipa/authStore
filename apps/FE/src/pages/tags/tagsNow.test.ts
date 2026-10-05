import { describe, expect, it } from 'vitest';
import { tagsNowKey, type TagsNowInput } from './tagsNow';

const base: TagsNowInput = {
  stepStatus: 'NOT_RUN',
  runBlocked: false,
  competitorInputCount: 0,
  finalTagCount: undefined,
};
const key = (over: Partial<TagsNowInput>) => tagsNowKey({ ...base, ...over });

describe('⑦ 지금 할 일 글 고르기(D-41)', () => {
  it('단계 상태가 아직 없으면 줄을 감춘다(null)', () => {
    expect(key({ stepStatus: undefined })).toBeNull();
  });

  it('⑦은 입력을 기다리며 멈추지 않는다 — 입력 대기라고 오면 줄을 감춘다', () => {
    expect(key({ stepStatus: 'WAITING_INPUT' })).toBeNull();
  });

  it('미실행: 경쟁 태그를 넣어 두었는지로 글이 갈리고, 목록을 못 읽었으면 감춘다', () => {
    expect(key({ competitorInputCount: 0 })).toBe('start');
    expect(key({ competitorInputCount: 1 })).toBe('startWithCompetitor');
    expect(key({ competitorInputCount: 3 })).toBe('startWithCompetitor');
    expect(key({ competitorInputCount: undefined })).toBeNull();
  });

  it('실행 중·재실행 필요·실패는 상태 그대로의 글을 말한다', () => {
    expect(key({ stepStatus: 'RUNNING' })).toBe('running');
    expect(key({ stepStatus: 'RERUN_REQUIRED' })).toBe('rerun');
    expect(key({ stepStatus: 'FAILED' })).toBe('failed');
    // 실행 중에는 경쟁 태그 수·최종 태그 수를 보지 않는다
    expect(key({ stepStatus: 'RUNNING', competitorInputCount: undefined })).toBe('running');
  });

  it('실행이 꺼져 있으면(미실행·재실행 필요·실패) 그 이유부터 말한다', () => {
    expect(key({ runBlocked: true })).toBe('blocked');
    expect(key({ stepStatus: 'RERUN_REQUIRED', runBlocked: true })).toBe('blocked');
    expect(key({ stepStatus: 'FAILED', runBlocked: true })).toBe('blocked');
    // 경쟁 태그 목록을 못 읽었어도 꺼진 이유는 말한다
    expect(key({ runBlocked: true, competitorInputCount: undefined })).toBe('blocked');
  });

  it('완료인데 [다시 실행]이 꺼져 있어도 확인할 일을 가린다(blocked가 아니다)', () => {
    expect(key({ stepStatus: 'COMPLETED', runBlocked: true, finalTagCount: 10 })).toBe('done');
  });

  it('완료: 최종 태그가 있으면 확인하라고, 하나도 없으면 넣으라고 말하고, 산출물을 못 읽었으면 감춘다', () => {
    expect(key({ stepStatus: 'COMPLETED', finalTagCount: 10 })).toBe('done');
    expect(key({ stepStatus: 'COMPLETED', finalTagCount: 3 })).toBe('done');
    expect(key({ stepStatus: 'COMPLETED', finalTagCount: 0 })).toBe('noTags');
    expect(key({ stepStatus: 'COMPLETED', finalTagCount: undefined })).toBeNull();
  });
});

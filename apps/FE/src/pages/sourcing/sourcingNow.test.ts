import { describe, expect, it } from 'vitest';
import { sourcingNowKey, type SourcingNowInput } from './sourcingNow';

type Head = NonNullable<SourcingNowInput['head']>;
const row = (isSelected: boolean) => ({ isSelected }) as unknown as Head['rows'][number];

function head(over: Partial<Head> = {}) {
  return {
    comparisonPerformed: true,
    exploreMode: false,
    isCurrent: true,
    rows: [row(false), row(false)],
    ...over,
  } as Head;
}

const base: SourcingNowInput = {
  stepStatus: 'WAITING_INPUT',
  head: head(),
  genderKnown: true,
  adultPending: false,
};
const key = (over: Partial<SourcingNowInput>) => sourcingNowKey({ ...base, ...over });

describe('② 지금 할 일 글 고르기(D-34)', () => {
  it('단계 상태가 아직 없으면 줄을 감춘다(null)', () => {
    expect(key({ stepStatus: undefined })).toBeNull();
  });

  it('입력을 기다리지 않는 상태는 상태 그대로의 글을 말한다', () => {
    expect(key({ stepStatus: 'NOT_RUN', head: undefined })).toBe('start');
    expect(key({ stepStatus: 'RUNNING' })).toBe('running');
    expect(key({ stepStatus: 'COMPLETED' })).toBe('done');
    expect(key({ stepStatus: 'RERUN_REQUIRED' })).toBe('rerun');
    expect(key({ stepStatus: 'FAILED' })).toBe('failed');
  });

  it('입력 대기: 기준 상품 → 성별 → 살 샵 → 성인용 확인 순서로 첫 번째 막힌 일을 말한다', () => {
    expect(key({ head: head({ exploreMode: true }), genderKnown: false })).toBe('pickAnchor');
    expect(key({ genderKnown: false })).toBe('pickGender');
    expect(key({})).toBe('pickShop');
    expect(key({ adultPending: true })).toBe('pickShop');
    expect(key({ head: head({ rows: [row(true), row(false)] }), adultPending: true })).toBe(
      'confirmAdult',
    );
    expect(key({ head: head({ rows: [row(true), row(false)] }) })).toBeNull();
  });

  it('입력 대기인데 비교표를 아직 못 읽었거나 지난 버전이면 줄을 감춘다', () => {
    expect(key({ head: undefined })).toBeNull();
    expect(key({ head: head({ isCurrent: false }) })).toBeNull();
  });

  it('비교를 하지 않은 여정(URL로 바로 만든 여정)은 성인용 확인만 남을 수 있다', () => {
    const noCompare = head({ comparisonPerformed: false, rows: [] });
    expect(key({ head: noCompare })).toBeNull();
    expect(key({ head: noCompare, adultPending: true })).toBe('confirmAdult');
  });
});

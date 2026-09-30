import { describe, expect, it } from 'vitest';
import {
  emptyMetaSyncStatusList,
  metaSyncRun,
  metaSyncStatusList,
  SYNCED_AT,
} from '@/test/fixtures/commerceMeta';
import { hasRunningMetaSync, lastMetaSyncSuccess, metaSyncRows } from './metaSyncRows';

const AT = (hhmm: string) => `2026-09-28T${hhmm}:00.000+09:00`;

describe('메타 동기화 패널 줄 묶기(metaSyncRows, Proposed P1-08)', () => {
  it('보드 3줄: 카테고리(대상 6개)·주소록·택배사. 모두 성공이면 성공·09:10', () => {
    const rows = metaSyncRows(metaSyncStatusList());
    expect(rows.map((r) => [r.label, r.state, r.time])).toEqual([
      ['카테고리', 'succeeded', SYNCED_AT],
      ['주소록', 'succeeded', SYNCED_AT],
      ['택배사', 'succeeded', SYNCED_AT],
    ]);
    expect(rows[0]!.targets.map((t) => t.target)).toEqual([
      'CATEGORY',
      'CATEGORY_DETAIL',
      'STANDARD_OPTIONS',
      'PRODUCT_ATTRIBUTES',
      'PROVIDED_NOTICE',
      'ORIGIN_AREA',
    ]);
    expect(lastMetaSyncSuccess(metaSyncStatusList())).toBe(SYNCED_AT);
    expect(hasRunningMetaSync(metaSyncStatusList())).toBe(false);
  });

  it('묶은 줄은 가장 나쁜 상태: 동기화 중 > 실패 > 받기 전 > 성공. 성공이면 가장 오래된 성공 시각', () => {
    const oldest = metaSyncStatusList({
      ORIGIN_AREA: metaSyncRun('ORIGIN_AREA', 'SUCCEEDED', AT('08:00')),
    });
    expect(metaSyncRows(oldest)[0]).toMatchObject({ state: 'succeeded', time: AT('08:00') });

    const failed = metaSyncStatusList({
      CATEGORY_DETAIL: metaSyncRun('CATEGORY_DETAIL', 'FAILED', AT('10:00')),
      STANDARD_OPTIONS: metaSyncRun('STANDARD_OPTIONS', 'FAILED', AT('10:05')),
    });
    const row = metaSyncRows(failed)[0]!;
    expect(row).toMatchObject({ state: 'failed', time: AT('10:05') });
    expect(row.targets.find((t) => t.target === 'CATEGORY_DETAIL')).toMatchObject({
      state: 'failed',
      errorMessage: expect.stringContaining('HTTP 500'),
    });

    const running = metaSyncStatusList({
      CATEGORY_DETAIL: metaSyncRun('CATEGORY_DETAIL', 'FAILED', AT('10:00')),
      CATEGORY: metaSyncRun('CATEGORY', 'RUNNING', AT('11:00')),
    });
    expect(metaSyncRows(running)[0]).toMatchObject({ state: 'running', time: AT('11:00') });
    expect(hasRunningMetaSync(running)).toBe(true);

    const partlyNever = metaSyncStatusList({ PROVIDED_NOTICE: null }, { PROVIDED_NOTICE: null });
    expect(metaSyncRows(partlyNever)[0]).toMatchObject({ state: 'never', time: null });
  });

  it('한 번도 안 돌았으면 모두 받기 전·시각 없음, 마지막 성공 없음', () => {
    const rows = metaSyncRows(emptyMetaSyncStatusList());
    expect(rows.every((r) => r.state === 'never' && r.time === null)).toBe(true);
    expect(lastMetaSyncSuccess(emptyMetaSyncStatusList())).toBeNull();
  });

  it('실패한 대상도 마지막 성공 시각은 남는다(캡션은 가장 최근 성공)', () => {
    const list = metaSyncStatusList(
      { ADDRESSBOOK: metaSyncRun('ADDRESSBOOK', 'FAILED', AT('10:00')) },
      { ADDRESSBOOK: AT('09:30') },
    );
    expect(lastMetaSyncSuccess(list)).toBe(AT('09:30'));
    expect(metaSyncRows(list)[1]).toMatchObject({ state: 'failed', time: AT('10:00') });
  });
});

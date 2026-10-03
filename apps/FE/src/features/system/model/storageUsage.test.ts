import { describe, expect, it } from 'vitest';
import { storageUsage, storageUsageItem } from '@/test/fixtures/storageUsage';
import {
  formatBytes,
  STORAGE_ITEM_NOTE,
  STORAGE_PARTIAL_NOTE,
  STORAGE_UNREADABLE_NOTE,
  storageDiskRow,
  storageItemRow,
  storageRows,
} from './storageUsage';

describe('formatBytes(1000 단위, 소수 한 자리, 붙여 쓰기)', () => {
  it.each([
    [0, '0B'],
    [999, '999B'],
    [1000, '1KB'],
    [1500, '1.5KB'],
    [999_960, '1MB'],
    [85_300_000, '85.3MB'],
    [1_234_000_000, '1.2GB'],
    [494_400_000_000, '494.4GB'],
    [1_500_000_000_000, '1.5TB'],
  ])('%d → %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('%d → —', (bytes) => {
    expect(formatBytes(bytes)).toBe('—');
  });
});

describe('storageItemRow(행 상태)', () => {
  it('OK: 크기·파일 수, 칩 없음, 기본 안내만', () => {
    expect(storageItemRow(storageUsageItem())).toEqual({
      key: 'AGY_RECORDS',
      label: 'agy 기록',
      location: '~/.gemini/antigravity-cli',
      locationIsPath: true,
      size: '1.2GB',
      sizeSuffix: null,
      count: '3,412개',
      countSuffix: null,
      chip: null,
      notes: ['앱은 지우지 않습니다. 필요하면 직접 정리하세요.'],
    });
  });

  it("PARTIAL: 뒤에 '이상'을 붙이고 waiting '일부만 잼' + 이유 문장", () => {
    const row = storageItemRow(storageUsageItem({ status: 'PARTIAL' }));
    expect([row.size, row.sizeSuffix]).toEqual(['1.2GB', '이상']);
    expect([row.count, row.countSuffix]).toEqual(['3,412개', '이상']);
    expect(row.chip).toEqual({ tone: 'waiting', label: '일부만 잼' });
    expect(row.notes).toEqual([STORAGE_PARTIAL_NOTE, STORAGE_ITEM_NOTE.AGY_RECORDS]);
  });

  it("NOT_FOUND: '—'와 idle '폴더 없음', 폴더마다 다른 문장", () => {
    const agy = storageItemRow(
      storageUsageItem({ status: 'NOT_FOUND', bytes: null, fileCount: null }),
    );
    expect([agy.size, agy.sizeSuffix, agy.count, agy.countSuffix]).toEqual(['—', null, '—', null]);
    expect(agy.chip).toEqual({ tone: 'idle', label: '폴더 없음' });
    expect(agy.notes[0]).toBe('agy를 아직 쓰지 않았으면 없습니다.');
    const images = storageItemRow(
      storageUsageItem({ key: 'APP_IMAGES', status: 'NOT_FOUND', bytes: null, fileCount: null }),
    );
    expect(images.label).toBe('앱 이미지');
    expect(images.notes).toEqual(['아직 저장한 이미지가 없습니다.', STORAGE_ITEM_NOTE.APP_IMAGES]);
  });

  it("UNREADABLE: '—'와 waiting '읽지 못함'", () => {
    const row = storageItemRow(
      storageUsageItem({ status: 'UNREADABLE', bytes: null, fileCount: null }),
    );
    expect(row.size).toBe('—');
    expect(row.chip).toEqual({ tone: 'waiting', label: '읽지 못함' });
    expect(row.notes[0]).toBe(STORAGE_UNREADABLE_NOTE);
  });
});

describe('storageDiskRow·storageRows', () => {
  it("디스크: '120.5GB 남음', 파일 수 '—', 안내 '전체 494.4GB'", () => {
    expect(storageDiskRow({ freeBytes: 120_500_000_000, totalBytes: 494_400_000_000 })).toEqual({
      key: 'DISK',
      label: '디스크 남은 공간',
      location: '앱 데이터 폴더가 있는 디스크',
      locationIsPath: false,
      size: '120.5GB',
      sizeSuffix: '남음',
      count: '—',
      countSuffix: null,
      chip: null,
      notes: ['전체 494.4GB'],
    });
  });

  it("디스크를 읽지 못하면 '—'와 '읽지 못함'", () => {
    const row = storageDiskRow({ freeBytes: null, totalBytes: null });
    expect([row.size, row.sizeSuffix]).toEqual(['—', null]);
    expect(row.chip).toEqual({ tone: 'waiting', label: '읽지 못함' });
    expect(row.notes).toEqual(['디스크 정보를 읽지 못했습니다.']);
  });

  it('행 순서는 agy 기록 · 앱 이미지 · 디스크(응답 순서와 상관없이)', () => {
    const usage = storageUsage();
    const reversed = { ...usage, items: [...usage.items].reverse() };
    expect(storageRows(reversed).map((r) => r.key)).toEqual(['AGY_RECORDS', 'APP_IMAGES', 'DISK']);
  });
});

import type { components } from '@/shared/api/schema';

type StorageUsage = components['schemas']['StorageUsage'];
type StorageUsageItem = components['schemas']['StorageUsageItem'];

/** 명세 예시 시각: 2026-10-03 14:20 KST */
export const STORAGE_MEASURED_AT = '2026-10-03T05:20:00.000Z';

/** 폴더 한 행(기본: 화면시안_명세 SCR-13 D-25 절의 agy 기록 1.2GB · 3,412개) */
export function storageUsageItem(overrides: Partial<StorageUsageItem> = {}): StorageUsageItem {
  return {
    key: 'AGY_RECORDS',
    displayPath: '~/.gemini/antigravity-cli',
    status: 'OK',
    bytes: 1_234_000_000,
    fileCount: 3412,
    ...overrides,
  };
}

/** 저장 공간 응답(명세 예시: agy 기록 1.2GB · 앱 이미지 85.3MB · 남은 120.5GB / 전체 494.4GB) */
export function storageUsage(overrides: Partial<StorageUsage> = {}): StorageUsage {
  return {
    items: [
      storageUsageItem(),
      storageUsageItem({
        key: 'APP_IMAGES',
        displayPath: '~/Library/Application Support/autoStore/images',
        bytes: 85_300_000,
        fileCount: 412,
      }),
    ],
    disk: { freeBytes: 120_500_000_000, totalBytes: 494_400_000_000 },
    measuredAt: STORAGE_MEASURED_AT,
    ...overrides,
  };
}

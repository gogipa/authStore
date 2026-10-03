import type { components } from '@/shared/api/schema';
import { EMPTY_VALUE, formatCount } from '@/shared/lib/format';
import type { ChipTone } from '@/shared/ui';

export type StorageUsage = components['schemas']['StorageUsage'];
export type StorageUsageItem = components['schemas']['StorageUsageItem'];
export type StorageUsageKey = components['schemas']['StorageUsageKey'];
export type StorageUsageStatus = components['schemas']['StorageUsageStatus'];
export type StorageDiskSpace = components['schemas']['StorageDiskSpace'];

/** 행 순서(05-2 StorageUsage.items 순서 + 디스크) */
export const STORAGE_USAGE_ORDER: readonly StorageUsageKey[] = ['AGY_RECORDS', 'APP_IMAGES'];

export const STORAGE_ITEM_LABEL: Readonly<Record<StorageUsageKey, string>> = {
  AGY_RECORDS: 'agy 기록',
  APP_IMAGES: '앱 이미지',
};

/** 행마다 늘 붙는 안내(화면시안_명세 SCR-13 D-25 절) */
export const STORAGE_ITEM_NOTE: Readonly<Record<StorageUsageKey, string>> = {
  AGY_RECORDS: '앱은 지우지 않습니다. 필요하면 직접 정리하세요.',
  APP_IMAGES: '라쿠텐 원본·생성 후보 등 앱이 쓰는 파일입니다. 직접 지우지 마세요.',
};

const NOT_FOUND_NOTE: Readonly<Record<StorageUsageKey, string>> = {
  AGY_RECORDS: 'agy를 아직 쓰지 않았으면 없습니다.',
  APP_IMAGES: '아직 저장한 이미지가 없습니다.',
};

export const STORAGE_PARTIAL_NOTE =
  '5초 안에 다 세지 못했거나 읽을 수 없는 폴더가 있어 센 만큼만 보입니다.';
export const STORAGE_UNREADABLE_NOTE =
  '권한이 없거나 폴더가 아니어서 읽지 못했습니다. 바로가기는 따라가지 않습니다.';
export const STORAGE_DISK_UNREADABLE_NOTE = '디스크 정보를 읽지 못했습니다.';
export const STORAGE_DISK_LABEL = '디스크 남은 공간';
export const STORAGE_DISK_LOCATION = '앱 데이터 폴더가 있는 디스크';

/** 표 아래 도움말(캡션) */
export const STORAGE_USAGE_HELP =
  '파일 크기를 더한 값입니다. 앱은 크기만 재고 파일을 지우거나 고치지 않습니다. 한 번에 최대 5초까지 재고, 1분 안에 다시 열면 같은 값을 보입니다. 바로가기(심볼릭 링크)는 따라가지 않습니다.';

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;
const oneDecimalFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });

/**
 * 바이트 → `1.2GB`. 1000 단위(macOS Finder와 같다), 소수 한 자리까지, 숫자와 단위를 붙여 쓴다('255mm'와 같은 꼴).
 * 반올림해 1000이 되면 다음 단위로 올린다(999,960B → `1MB`). 음수·NaN이면 '—'.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return EMPTY_VALUE;
  let value = bytes;
  let unit = 0;
  while (unit < BYTE_UNITS.length - 1 && Math.round(value * 10) / 10 >= 1000) {
    value /= 1000;
    unit += 1;
  }
  const text = unit === 0 ? String(Math.round(value)) : oneDecimalFormat.format(value);
  return `${text}${BYTE_UNITS[unit]}`;
}

/** 표 한 행(폴더 2개 + 디스크) */
export interface StorageRowView {
  key: StorageUsageKey | 'DISK';
  label: string;
  /** 폴더면 표시 경로(mono), 디스크면 설명 글 */
  location: string;
  locationIsPath: boolean;
  /** 크기 값(mono). 없으면 '—' */
  size: string;
  /** 크기 뒤 글(mono 아님): PARTIAL '이상', 디스크 '남음' */
  sizeSuffix: string | null;
  /** 파일 수 값(mono). 없으면 '—' */
  count: string;
  /** 파일 수 뒤 글: PARTIAL '이상' */
  countSuffix: string | null;
  chip: { tone: ChipTone; label: string } | null;
  /** 안내 칸 문장(상태 문장 → 기본 안내 순서) */
  notes: string[];
}

/** 폴더 한 행: 상태에 따라 크기·개수·칩·문장이 바뀐다(OK·PARTIAL·NOT_FOUND·UNREADABLE) */
export function storageItemRow(item: StorageUsageItem): StorageRowView {
  const suffix = item.status === 'PARTIAL' ? '이상' : null;
  const base = {
    key: item.key,
    label: STORAGE_ITEM_LABEL[item.key],
    location: item.displayPath,
    locationIsPath: true,
    size: item.bytes === null ? EMPTY_VALUE : formatBytes(item.bytes),
    sizeSuffix: item.bytes === null ? null : suffix,
    count: item.fileCount === null ? EMPTY_VALUE : `${formatCount(item.fileCount)}개`,
    countSuffix: item.fileCount === null ? null : suffix,
  };
  const note = STORAGE_ITEM_NOTE[item.key];
  switch (item.status) {
    case 'PARTIAL':
      return {
        ...base,
        chip: { tone: 'waiting', label: '일부만 잼' },
        notes: [STORAGE_PARTIAL_NOTE, note],
      };
    case 'NOT_FOUND':
      return {
        ...base,
        chip: { tone: 'idle', label: '폴더 없음' },
        notes: [NOT_FOUND_NOTE[item.key], note],
      };
    case 'UNREADABLE':
      return {
        ...base,
        chip: { tone: 'waiting', label: '읽지 못함' },
        notes: [STORAGE_UNREADABLE_NOTE, note],
      };
    default:
      return { ...base, chip: null, notes: [note] };
  }
}

/** 디스크 행: '120.5GB 남음' + 안내 '전체 494.4GB'. 읽지 못하면 '—'와 '읽지 못함' */
export function storageDiskRow(disk: StorageDiskSpace): StorageRowView {
  const readable = disk.freeBytes !== null;
  return {
    key: 'DISK',
    label: STORAGE_DISK_LABEL,
    location: STORAGE_DISK_LOCATION,
    locationIsPath: false,
    size: disk.freeBytes === null ? EMPTY_VALUE : formatBytes(disk.freeBytes),
    sizeSuffix: readable ? '남음' : null,
    count: EMPTY_VALUE,
    countSuffix: null,
    chip: readable ? null : { tone: 'waiting', label: '읽지 못함' },
    notes: [
      ...(readable ? [] : [STORAGE_DISK_UNREADABLE_NOTE]),
      ...(disk.totalBytes === null ? [] : [`전체 ${formatBytes(disk.totalBytes)}`]),
    ],
  };
}

/** 표 행 3개: agy 기록 · 앱 이미지 · 디스크 남은 공간(응답 순서와 상관없이 이 순서) */
export function storageRows(usage: StorageUsage): StorageRowView[] {
  const items = STORAGE_USAGE_ORDER.flatMap((key) => {
    const item = usage.items.find((i) => i.key === key);
    return item ? [storageItemRow(item)] : [];
  });
  return [...items, storageDiskRow(usage.disk)];
}

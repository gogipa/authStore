import type { FxRateLatestSet, FxRatePage, FxRateRecord, FxRateWarning } from '@/features/pricing';
import type {
  ForwarderRateTableDetail,
  ForwarderRateTableImportResult,
  ForwarderRateTableSummary,
  ForwarderRateTier,
} from '@/features/settings';

/** 환율 기록 한 건(기본: 원가 환율 JPY(100) 876 → 8.76원/엔, 2026-09-28 09:00 KST 자동 수집) */
export function fxRecord(overrides: Partial<FxRateRecord> = {}): FxRateRecord {
  return {
    id: 1,
    rateKind: 'COST',
    currency: 'JPY',
    rateValue: 876,
    unit: 100,
    source: 'KEXIM',
    sourceNote: null,
    referenceAt: '2026-09-28T02:00:00.000Z',
    collectedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

/** 최신값 3종(원가 8.76 · 과세 엔 8.76 · 과세 달러 1,358.72) */
export function fxLatest(
  warnings: FxRateWarning[] = [],
  items: FxRateRecord[] = [
    fxRecord(),
    fxRecord({
      id: 2,
      rateKind: 'CUSTOMS',
      source: 'CUSTOMS_SERVICE',
      referenceAt: '2026-09-26T15:00:00.000Z',
    }),
    fxRecord({
      id: 3,
      rateKind: 'CUSTOMS',
      currency: 'USD',
      rateValue: 1358.72,
      unit: 1,
      source: 'CUSTOMS_SERVICE',
      referenceAt: '2026-09-26T15:00:00.000Z',
    }),
  ],
): FxRateLatestSet {
  return { items, warnings };
}

export const FX_FETCH_FAILED_WARNING: FxRateWarning = {
  code: 'FX_FETCH_FAILED',
  rateKind: 'COST',
  currency: 'JPY',
  message:
    '원가 환율 자동 수집이 실패했습니다(2026-09-28 11:00). 마지막 값을 계속 씁니다. 필요하면 환율을 직접 넣어 주세요.',
};

export function fxPage(content: FxRateRecord[] = fxLatest().items): FxRatePage {
  return {
    content,
    page: {
      number: 0,
      size: 10,
      totalElements: content.length,
      totalPages: content.length > 0 ? 1 : 0,
    },
  };
}

export function rateTier(overrides: Partial<ForwarderRateTier> = {}): ForwarderRateTier {
  return {
    id: 1,
    weightMaxKg: 1.2,
    fee: 15000,
    currency: 'KRW',
    volumetricDivisor: null,
    volumetricAppliesWhen: null,
    ...overrides,
  };
}

/** 요금표 버전 요약(기본: #1 v2026-09 활성) */
export function rateTableSummary(
  overrides: Partial<ForwarderRateTableSummary> = {},
): ForwarderRateTableSummary {
  return {
    id: 1,
    forwarderName: '[배대지 A]',
    sourceFileName: 'rate-table-v2026-09.csv',
    sourceFileSha256: 'a'.repeat(64),
    rowCount: 3,
    isActive: true,
    importedAt: '2026-09-28T00:00:00.000Z',
    activatedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

/** 요금표 상세(0.5kg 9,000원 · 1.2kg 15,000원 · 2kg 18,000원) */
export function rateTableDetail(
  overrides: Partial<ForwarderRateTableDetail> = {},
  tiers: ForwarderRateTier[] = [
    rateTier({ id: 1, weightMaxKg: 0.5, fee: 9000 }),
    rateTier({ id: 2, weightMaxKg: 1.2, fee: 15000 }),
    rateTier({
      id: 3,
      weightMaxKg: 2,
      fee: 18000,
      volumetricDivisor: 6000,
      volumetricAppliesWhen: 'SUM_CM>160',
    }),
  ],
): ForwarderRateTableDetail {
  return { ...rateTableSummary({ rowCount: tiers.length, ...overrides }), tiers };
}

export function rateTablePage(content: ForwarderRateTableSummary[]) {
  return {
    content,
    page: {
      number: 0,
      size: 20,
      totalElements: content.length,
      totalPages: content.length > 0 ? 1 : 0,
    },
  };
}

export function rateTableImportResult(
  rateTable: ForwarderRateTableDetail,
  overrides: Partial<ForwarderRateTableImportResult> = {},
): ForwarderRateTableImportResult {
  return { rateTable, reused: false, rerunRequiredStepCount: 0, ...overrides };
}

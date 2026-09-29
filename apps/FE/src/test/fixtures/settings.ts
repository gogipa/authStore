import type { components } from '@/shared/api/schema';

type SettingsView = components['schemas']['SettingsView'];
type SettingsReloadResult = components['schemas']['SettingsReloadResult'];
type FieldError = components['schemas']['FieldError'];

/**
 * GET /settings 응답(P1-03 BE 기본 템플릿에서 화면이 읽는 칸만). 비율은 퍼센트 수(2.5 = 2.5%).
 */
export function settingsContent() {
  return {
    schemaVersion: '1',
    costs: {
      cardSurchargePct: 2.5,
      saleFeePct: 3,
      saleFeeAdInflowPct: 1,
      saleFeeIncludesShipping: true,
      npayFeeGrade: 'GENERAL',
      npayFeePctByGrade: {
        MICRO: 1.947,
        SMALL_1: 2.563,
        SMALL_2: 2.728,
        SMALL_3: 3.003,
        GENERAL: 3.63,
      },
      miscCostKrw: 3000,
      targetMarginPct: 10,
      minProfitKrw: 5000,
      judgementMarginPct: 1,
      roundingUnitKrw: 100,
      pointValueFactorForMargin: 0,
      vatMode: 'A',
      sellerlifeCoupon: { enabled: false, amountKrw: 2000, monthlyLimit: 0 },
    },
    pricing: { sellTaxableSizes: false },
    ai: {
      engine: 'CLAUDE',
      models: {
        CLAUDE: { text: 'sonnet', vision: 'sonnet' },
        AGY: { text: null, vision: null },
        CODEX: { text: null, vision: null },
      },
    },
  };
}

export function settingsView(
  overrides: { valid?: boolean; errors?: FieldError[]; content?: Record<string, unknown> } = {},
): SettingsView {
  const errors = overrides.errors ?? [];
  return {
    id: 3,
    contentSha256: 'a'.repeat(64),
    schemaVersion: '1',
    appVersion: '0.1.0',
    fileManifest: [{ name: 'settings.json', sha256: 'b'.repeat(64), sizeBytes: 6000 }],
    content: overrides.content ?? settingsContent(),
    firstLoadedAt: '2026-09-30T00:00:00.000Z',
    lastLoadedAt: '2026-09-30T00:10:00.000Z',
    isCurrent: true,
    valid: overrides.valid ?? errors.length === 0,
    errors,
  };
}

export function settingsReloadResult(
  created = true,
  changedKeys = ['costs.targetMarginPct'],
): SettingsReloadResult {
  const view = settingsView();
  return {
    snapshot: {
      id: view.id + (created ? 1 : 0),
      contentSha256: view.contentSha256,
      schemaVersion: view.schemaVersion,
      appVersion: view.appVersion,
      fileManifest: view.fileManifest,
      content: view.content,
      firstLoadedAt: view.firstLoadedAt,
      lastLoadedAt: view.lastLoadedAt,
      isCurrent: true,
    },
    created,
    changedKeys: created ? changedKeys : [],
    rerunRequiredStepCount: 0,
  };
}

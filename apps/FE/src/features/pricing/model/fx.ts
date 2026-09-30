import type { components } from '@/shared/api/schema';
import { EMPTY_VALUE, formatKstTime, KST_TIME_ZONE } from '@/shared/lib/format';

export type FxRateRecord = components['schemas']['FxRateRecord'];
export type FxRateWarning = components['schemas']['FxRateWarning'];
export type FxRateLatestSet = components['schemas']['FxRateLatestSet'];
export type FxRatePage = components['schemas']['FxRatePage'];
export type FxRateManualInput = components['schemas']['FxRateManualInput'];
export type FxRateKind = components['schemas']['FxRateKind'];
export type FxCurrency = components['schemas']['FxCurrency'];
export type FxRateSource = components['schemas']['FxRateSource'];
export type FxUnit = FxRateRecord['unit'];

/** 종류·통화 키(최신값 순서 = 05-2 FxRateLatestSet) */
export type FxSeriesKey = 'COST/JPY' | 'CUSTOMS/JPY' | 'CUSTOMS/USD';
export const FX_SERIES: readonly FxSeriesKey[] = ['COST/JPY', 'CUSTOMS/JPY', 'CUSTOMS/USD'];

export function fxSeriesKey(rateKind: FxRateKind, currency: FxCurrency): FxSeriesKey | null {
  const key = `${rateKind}/${currency}`;
  return (FX_SERIES as readonly string[]).includes(key) ? (key as FxSeriesKey) : null;
}

/** 화면 이름(Judgement 보드 '원가 환율', 과세환율은 통화를 붙인다 — 열린질문 P2-04 Proposed) */
export const FX_SERIES_LABEL: Record<FxSeriesKey, string> = {
  'COST/JPY': '원가 환율',
  'CUSTOMS/JPY': '과세환율(엔)',
  'CUSTOMS/USD': '과세환율(달러)',
};

export const FX_KIND_LABEL: Record<FxRateKind, string> = { COST: '원가 환율', CUSTOMS: '과세환율' };
export const FX_CURRENCY_LABEL: Record<FxCurrency, string> = { JPY: '엔(JPY)', USD: '달러(USD)' };

/** 출처 짧은 이름('자동'·'직접'). 보드 '원가 환율 · 자동 09:00' */
export const FX_SOURCE_SHORT: Record<FxRateSource, string> = {
  KEXIM: '자동',
  CUSTOMS_SERVICE: '자동',
  MANUAL: '직접',
};

export const FX_SOURCE_LABEL: Record<FxRateSource, string> = {
  KEXIM: '한국수출입은행',
  CUSTOMS_SERVICE: '관세청',
  MANUAL: '직접 입력',
};

/** 단위 표기(1엔·100엔·1달러) */
export function unitLabel(unit: number, currency: FxCurrency): string {
  return `${unit}${currency === 'JPY' ? '엔' : '달러'}`;
}

/**
 * 계산용 환율 = rateValue / unit(원/엔·원/달러). BE `perUnit()`과 같은 뜻(판정 계산은 BE Decimal로 한다 — 화면은 표시만).
 * 소수 넷째 자리까지인 원값을 정수로 옮겨 나눠 부동소수점 흔들림을 줄인다.
 */
export function perUnitRate(rateValue: number, unit: number): number {
  return Math.round(rateValue * 10_000) / (unit * 10_000);
}

const perUnitFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 4 });

/** 표기 '8.76원/엔' · '1,358.72원/달러' */
export function formatPerUnitRate(rateValue: number, unit: number, currency: FxCurrency): string {
  if (!Number.isFinite(rateValue) || unit <= 0) return EMPTY_VALUE;
  return `${perUnitFormat.format(perUnitRate(rateValue, unit))}원/${currency === 'JPY' ? '엔' : '달러'}`;
}

export function formatRecordRate(
  record: Pick<FxRateRecord, 'rateValue' | 'unit' | 'currency'>,
): string {
  return formatPerUnitRate(record.rateValue, record.unit, record.currency);
}

/** 최신값 표에서 한 종류 */
export function latestOf(
  latest: FxRateLatestSet | undefined,
  key: FxSeriesKey,
): FxRateRecord | null {
  return latest?.items.find((i) => `${i.rateKind}/${i.currency}` === key) ?? null;
}

/** 요약 머리 '원가 환율 · 자동 09:00'(시각 = 수집·입력 시각 KST). 값이 없으면 '원가 환율 · 없음' */
export function fxSummaryLabel(key: FxSeriesKey, record: FxRateRecord | null): string {
  if (!record) return `${FX_SERIES_LABEL[key]} · 없음`;
  return `${FX_SERIES_LABEL[key]} · ${FX_SOURCE_SHORT[record.source]} ${formatKstTime(record.collectedAt)}`;
}

/** 한 줄 요약 '원가 환율 · 자동 09:00 · 8.76원/엔' */
export function fxSummaryLine(key: FxSeriesKey, record: FxRateRecord | null): string {
  return record
    ? `${fxSummaryLabel(key, record)} · ${formatRecordRate(record)}`
    : fxSummaryLabel(key, null);
}

/** 설정 '환율' 탭 캡션(보드 '원가 8.76원/엔 · 09:00') */
export function fxTabCaption(latest: FxRateLatestSet | undefined): string {
  const cost = latestOf(latest, 'COST/JPY');
  if (!cost) return '원가 환율 없음';
  return `원가 ${formatRecordRate(cost)} · ${formatKstTime(cost.collectedAt)}`;
}

/** 수집 안내 뒤 문장(보드 그대로) */
export const FX_FALLBACK_TEXT = '수집이 실패하면 마지막 값을 계속 쓰고 경고를 띄웁니다.';

/**
 * 설정 요약 캡션(보드 '09:00 자동 수집. 수집이 실패하면 마지막 값을 계속 쓰고 경고를 띄웁니다.'). 보드의 09:00은 고정 시각이 아니라
 * 지금 원가 환율을 받은 시각으로 읽었다(수출입은행 고시는 영업일 11시 뒤, Proposed). 직접 넣은 값이면 '직접 입력'.
 */
export function fxAutoCaption(cost: FxRateRecord | null): string {
  if (!cost) return `자동 수집 전. ${FX_FALLBACK_TEXT}`;
  const how = cost.source === 'MANUAL' ? '직접 입력' : '자동 수집';
  return `${formatKstTime(cost.collectedAt)} ${how}. ${FX_FALLBACK_TEXT}`;
}

// ── 직접 입력 칸 ─────────────────────────────────────────────────────────

export interface ManualFxFormValues {
  rateKind: FxRateKind;
  currency: FxCurrency;
  /** 입력 글자(숫자 칸) */
  rateValue: string;
  unit: FxUnit;
  sourceNote: string;
  /** datetime-local 값(KST 'YYYY-MM-DDTHH:mm') */
  referenceAt: string;
}

export type ManualFxField = keyof ManualFxFormValues;
export type ManualFxErrors = Partial<Record<ManualFxField, string>>;

const kstLocalFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: KST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 그 시각의 KST 'YYYY-MM-DDTHH:mm'(datetime-local 칸 값) */
export function kstDateTimeLocal(date: Date): string {
  const parts = Object.fromEntries(
    kstLocalFormat.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** 새 입력 기본값: 원가 환율 · 엔 · 100엔 · 기준 시각 = 지금(KST) */
export function manualFxDefaults(now: Date, series: FxSeriesKey = 'COST/JPY'): ManualFxFormValues {
  const [rateKind, currency] = series.split('/') as [FxRateKind, FxCurrency];
  return {
    rateKind,
    currency,
    rateValue: '',
    unit: currency === 'JPY' ? 100 : 1,
    sourceNote: '',
    referenceAt: kstDateTimeLocal(now),
  };
}

/** 종류·통화를 바꿀 때: 원가 환율은 엔만, 달러는 단위 1만(BE 422와 같은 규칙을 칸에서 먼저 막는다) */
export function applyManualFxChange(
  values: ManualFxFormValues,
  change: Partial<ManualFxFormValues>,
): ManualFxFormValues {
  const next = { ...values, ...change };
  if (next.rateKind === 'COST') next.currency = 'JPY';
  if (next.currency === 'USD') next.unit = 1;
  return next;
}

const RATE_RE = /^\d{1,8}(\.\d{1,4})?$/;
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** 보내기 전 칸 검사(서버 422와 같은 뜻). 오류가 없으면 빈 객체 */
export function validateManualFx(values: ManualFxFormValues): ManualFxErrors {
  const errors: ManualFxErrors = {};
  const text = values.rateValue.trim().replace(/,/g, '');
  if (!RATE_RE.test(text) || Number(text) <= 0) {
    errors.rateValue = '0보다 큰 숫자(소수 넷째 자리까지)를 넣어 주세요.';
  }
  if (values.currency === 'USD' && values.unit === 100) {
    errors.unit = '달러(USD)는 단위 1만 넣을 수 있습니다.';
  }
  if (values.sourceNote.length > 200) errors.sourceNote = '200자 이내로 적어 주세요.';
  if (!LOCAL_RE.test(values.referenceAt)) errors.referenceAt = '기준 시각을 넣어 주세요.';
  return errors;
}

/** 칸 값 → 요청 본문. 기준 시각은 한국 시간으로 본다(+09:00) */
export function toManualFxInput(values: ManualFxFormValues): FxRateManualInput {
  const note = values.sourceNote.trim();
  return {
    rateKind: values.rateKind,
    currency: values.currency,
    rateValue: Number(values.rateValue.trim().replace(/,/g, '')),
    unit: values.unit,
    sourceNote: note === '' ? null : note,
    referenceAt: `${values.referenceAt}:00+09:00`,
  };
}

const MANUAL_FIELDS: readonly ManualFxField[] = [
  'rateKind',
  'currency',
  'rateValue',
  'unit',
  'sourceNote',
  'referenceAt',
];

/** 서버 422 fieldErrors → 칸 오류(칸 이름이 요청 필드와 같다). 칸에 없는 오류는 `rest`로 */
export function manualFxErrorsOf(
  fieldErrors: readonly { field: string; message: string }[] | undefined,
): {
  byField: ManualFxErrors;
  rest: string[];
} {
  const byField: ManualFxErrors = {};
  const rest: string[] = [];
  for (const e of fieldErrors ?? []) {
    if ((MANUAL_FIELDS as readonly string[]).includes(e.field)) {
      const field = e.field as ManualFxField;
      byField[field] ??= e.message;
    } else {
      rest.push(`${e.field}: ${e.message}`);
    }
  }
  return { byField, rest };
}

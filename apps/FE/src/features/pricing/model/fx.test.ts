import { describe, expect, it } from 'vitest';
import { fxLatest, fxRecord } from '@/test/fixtures/pricing';
import {
  applyManualFxChange,
  formatPerUnitRate,
  fxAutoCaption,
  fxSummaryLine,
  fxTabCaption,
  kstDateTimeLocal,
  latestOf,
  manualFxDefaults,
  manualFxErrorsOf,
  perUnitRate,
  toManualFxInput,
  validateManualFx,
} from './fx';

describe('환율 표기(model/fx, P2-04)', () => {
  it('perUnitRate = rateValue / unit, 표기 8.76원/엔 · 1,358.72원/달러', () => {
    expect(perUnitRate(876, 100)).toBe(8.76);
    expect(perUnitRate(876.1234, 100)).toBeCloseTo(8.761234, 10);
    expect(formatPerUnitRate(876, 100, 'JPY')).toBe('8.76원/엔');
    expect(formatPerUnitRate(8.76, 1, 'JPY')).toBe('8.76원/엔');
    expect(formatPerUnitRate(1358.72, 1, 'USD')).toBe('1,358.72원/달러');
  });

  it("한 줄 요약 '원가 환율 · 자동 09:00 · 8.76원/엔', 수동이면 '직접', 없으면 '없음'", () => {
    expect(fxSummaryLine('COST/JPY', fxRecord())).toBe('원가 환율 · 자동 09:00 · 8.76원/엔');
    expect(
      fxSummaryLine(
        'COST/JPY',
        fxRecord({ source: 'MANUAL', collectedAt: '2026-09-28T05:30:00.000Z' }),
      ),
    ).toBe('원가 환율 · 직접 14:30 · 8.76원/엔');
    expect(fxSummaryLine('CUSTOMS/USD', null)).toBe('과세환율(달러) · 없음');
  });

  it("탭 캡션 '원가 8.76원/엔 · 09:00'과 요약 안내('09:00 자동 수집. …')", () => {
    const latest = fxLatest();
    expect(fxTabCaption(latest)).toBe('원가 8.76원/엔 · 09:00');
    expect(fxTabCaption({ items: [], warnings: [] })).toBe('원가 환율 없음');
    expect(fxAutoCaption(latestOf(latest, 'COST/JPY'))).toBe(
      '09:00 자동 수집. 수집이 실패하면 마지막 값을 계속 쓰고 경고를 띄웁니다.',
    );
    expect(fxAutoCaption(null)).toBe(
      '자동 수집 전. 수집이 실패하면 마지막 값을 계속 쓰고 경고를 띄웁니다.',
    );
    expect(latestOf(latest, 'CUSTOMS/USD')?.rateValue).toBe(1358.72);
  });
});

describe('직접 입력 칸(model/fx)', () => {
  const now = new Date('2026-09-28T02:05:00.000Z');

  it('기본값: 원가 환율 · 엔 · 100엔 · 기준 시각 = 지금(KST)', () => {
    expect(kstDateTimeLocal(now)).toBe('2026-09-28T11:05');
    expect(manualFxDefaults(now)).toEqual({
      rateKind: 'COST',
      currency: 'JPY',
      rateValue: '',
      unit: 100,
      sourceNote: '',
      referenceAt: '2026-09-28T11:05',
    });
    expect(manualFxDefaults(now, 'CUSTOMS/USD')).toMatchObject({ currency: 'USD', unit: 1 });
  });

  it('USD를 고르면 단위가 1로, 원가 환율로 바꾸면 통화가 엔으로', () => {
    const base = manualFxDefaults(now, 'CUSTOMS/JPY');
    expect(applyManualFxChange(base, { currency: 'USD' })).toMatchObject({
      currency: 'USD',
      unit: 1,
    });
    const usd = applyManualFxChange(base, { currency: 'USD' });
    expect(applyManualFxChange(usd, { rateKind: 'COST' })).toMatchObject({
      rateKind: 'COST',
      currency: 'JPY',
    });
  });

  it('검사: 0 이하·글자·소수 다섯째 자리·긴 출처·빈 시각은 칸 오류', () => {
    const base = { ...manualFxDefaults(now), rateValue: '876' };
    expect(validateManualFx(base)).toEqual({});
    expect(validateManualFx({ ...base, rateValue: '0' })).toHaveProperty('rateValue');
    expect(validateManualFx({ ...base, rateValue: 'abc' })).toHaveProperty('rateValue');
    expect(validateManualFx({ ...base, rateValue: '8.12345' })).toHaveProperty('rateValue');
    expect(validateManualFx({ ...base, rateValue: '1,358.72' })).toEqual({});
    expect(validateManualFx({ ...base, sourceNote: 'x'.repeat(201) })).toHaveProperty('sourceNote');
    expect(validateManualFx({ ...base, referenceAt: '' })).toHaveProperty('referenceAt');
    expect(validateManualFx({ ...base, currency: 'USD', unit: 100 })).toHaveProperty('unit');
  });

  it('요청 본문: 쉼표를 지운 숫자, 빈 출처는 null, 기준 시각은 +09:00', () => {
    expect(
      toManualFxInput({
        ...manualFxDefaults(now),
        rateValue: ' 1,358.72 ',
        sourceNote: '  ',
        currency: 'USD',
        unit: 1,
      }),
    ).toEqual({
      rateKind: 'COST',
      currency: 'USD',
      rateValue: 1358.72,
      unit: 1,
      sourceNote: null,
      referenceAt: '2026-09-28T11:05:00+09:00',
    });
  });

  it('서버 fieldErrors를 칸별로 나누고 칸에 없는 오류는 따로', () => {
    expect(
      manualFxErrorsOf([
        { field: 'unit', message: '달러(USD)는 단위 1만 넣을 수 있습니다.' },
        { field: 'unit', message: '두 번째' },
        { field: 'foo', message: '모르는 칸' },
      ]),
    ).toEqual({
      byField: { unit: '달러(USD)는 단위 1만 넣을 수 있습니다.' },
      rest: ['foo: 모르는 칸'],
    });
  });
});

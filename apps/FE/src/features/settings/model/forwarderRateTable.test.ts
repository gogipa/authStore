import { describe, expect, it } from 'vitest';
import { rateTableDetail, rateTableImportResult, rateTier } from '@/test/fixtures/pricing';
import {
  appliesWhenLabel,
  DEFAULT_SHOE_BOX,
  formatTierFee,
  importResultText,
  rateTableTabCaption,
  rateTableVersionLabel,
  readDefaultForwarderFeeKrw,
  readShoeBox,
  shoeBoxTier,
} from './forwarderRateTable';

describe('요금표 표기(model/forwarderRateTable, P2-04)', () => {
  it("버전 'v2026-09'(가져온 달 KST)·탭 캡션 '요금표 v2026-09'", () => {
    expect(rateTableVersionLabel({ importedAt: '2026-09-30T16:00:00.000Z' })).toBe('v2026-10');
    expect(rateTableVersionLabel({ importedAt: '2026-09-28T00:00:00.000Z' })).toBe('v2026-09');
    expect(rateTableTabCaption(rateTableDetail())).toBe('요금표 v2026-09');
    expect(rateTableTabCaption(null)).toBe('요금표 없음 · 기본값');
  });

  it('요금은 통화 그대로(원 15,000원 · 엔 ¥1,500), 적용 조건 글', () => {
    expect(formatTierFee(15000, 'KRW')).toBe('15,000원');
    expect(formatTierFee(1500, 'JPY')).toBe('¥1,500');
    expect(appliesWhenLabel({ volumetricDivisor: 6000, volumetricAppliesWhen: null })).toBe(
      '늘 비교',
    );
    expect(appliesWhenLabel({ volumetricDivisor: 6000, volumetricAppliesWhen: 'NEVER' })).toBe(
      '부피무게 안 봄',
    );
    expect(appliesWhenLabel({ volumetricDivisor: null, volumetricAppliesWhen: null })).toBe(
      '부피무게 안 봄',
    );
    expect(appliesWhenLabel({ volumetricDivisor: 5000, volumetricAppliesWhen: 'SUM_CM>160' })).toBe(
      '세 변 합 160cm 초과일 때',
    );
  });

  it("신발 박스 1.2kg이 들어가는 구간(BE 규칙과 같다) — 보드 '신발 박스 1.2kg 15,000원'", () => {
    expect(shoeBoxTier(rateTableDetail().tiers, DEFAULT_SHOE_BOX)?.fee).toBe(15000);
    // 1.2 구간에 나눗수 6000(늘 비교)이면 부피무게 1.452kg → 다음 구간
    const tiers = [
      rateTier({ id: 1, weightMaxKg: 1.2, volumetricDivisor: 6000 }),
      rateTier({ id: 2, weightMaxKg: 2, fee: 18000 }),
    ];
    expect(shoeBoxTier(tiers, DEFAULT_SHOE_BOX)?.fee).toBe(18000);
    expect(shoeBoxTier([rateTier({ weightMaxKg: 1 })], DEFAULT_SHOE_BOX)).toBeNull();
  });

  it('설정 content에서 신발 박스·기본 배대지 비용(없으면 기본값)', () => {
    expect(readShoeBox(undefined)).toEqual(DEFAULT_SHOE_BOX);
    expect(
      readShoeBox({
        pricing: { shoeBox: { lengthCm: 30, widthCm: 20, heightCm: 10, weightKg: 1 } },
      }),
    ).toEqual({
      lengthCm: 30,
      widthCm: 20,
      heightCm: 10,
      weightKg: 1,
    });
    expect(readDefaultForwarderFeeKrw({ pricing: { defaultForwarderFeeKrw: 16000 } })).toBe(16000);
    expect(readDefaultForwarderFeeKrw({})).toBe(15000);
  });

  it('가져오기 결과 글: 새 버전·같은 파일·재실행 필요', () => {
    expect(importResultText(rateTableImportResult(rateTableDetail()))).toBe(
      '새 버전(#1 · 구간 3개)을 가져와 켰습니다',
    );
    expect(
      importResultText(
        rateTableImportResult(rateTableDetail(), { reused: true, rerunRequiredStepCount: 1 }),
      ),
    ).toBe('같은 파일이라 기존 버전(#1)을 다시 켰습니다 · 판정 1건이 재실행 필요가 됐습니다');
  });
});

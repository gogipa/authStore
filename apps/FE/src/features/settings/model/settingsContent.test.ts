import { describe, expect, it } from 'vitest';
import {
  readAppliedCostDefaults,
  readSelectedAiEngine,
  readSellTaxableSizes,
} from './settingsContent';
import { settingsContent } from '@/test/fixtures/settings';

describe('settings content 읽기', () => {
  it('비용 칸: Npay는 등급표[등급]', () => {
    expect(readAppliedCostDefaults(settingsContent())).toEqual({
      cardSurchargePct: 2.5,
      saleFeePct: 3,
      npayFeePct: 3.63,
      miscCostKrw: 3000,
      targetMarginPct: 10,
      minProfitKrw: 5000,
      vatMode: 'A',
    });
    const content = settingsContent();
    content.costs.npayFeeGrade = 'MICRO';
    expect(readAppliedCostDefaults(content).npayFeePct).toBe(1.947);
  });

  it('없거나 모양이 다르면 null', () => {
    expect(readAppliedCostDefaults(undefined).cardSurchargePct).toBeNull();
    expect(
      readAppliedCostDefaults({ costs: { cardSurchargePct: '2.5' } }).cardSurchargePct,
    ).toBeNull();
    expect(readSellTaxableSizes({})).toBeNull();
    expect(readSellTaxableSizes({ pricing: { sellTaxableSizes: true } })).toBe(true);
    expect(readSelectedAiEngine({ ai: { engine: 'GEMINI' } })).toBeNull();
  });

  it('선택 엔진: 화면 이름과 텍스트 모델', () => {
    expect(readSelectedAiEngine(settingsContent())).toEqual({
      engine: 'CLAUDE',
      displayName: 'Claude Code',
      textModel: 'sonnet',
    });
    expect(
      readSelectedAiEngine({ ai: { engine: 'AGY', models: { AGY: { text: null } } } }),
    ).toEqual({
      engine: 'AGY',
      displayName: 'Antigravity CLI',
      textModel: null,
    });
  });
});

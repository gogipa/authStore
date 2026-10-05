import { describe, expect, it } from 'vitest';
import { judgementNowKey, type JudgementNowInput } from './judgementNow';

/** ③ 완료 · G2 통과 · ④ 입력 대기(카테고리를 고를 수 있음) */
const base: JudgementNowInput = {
  pricingStatus: 'COMPLETED',
  categoryStatus: 'WAITING_INPUT',
  domesticPriceSaved: true,
  notSaleCandidate: false,
  noComparisonPending: false,
  g2Passed: true,
  categoryPickable: true,
  genderChanged: false,
  blocked: false,
};
const key = (over: Partial<JudgementNowInput>) => judgementNowKey({ ...base, ...over });

describe('③·④ 지금 할 일 글 고르기(D-41)', () => {
  it('③ 상태를 아직 모르면 줄을 감춘다(null)', () => {
    expect(key({ pricingStatus: undefined })).toBeNull();
  });

  describe('③ 판정', () => {
    it('실행 전: 국내 기준가를 저장하지 않았으면 입력부터, 저장했으면 [실행]', () => {
      expect(key({ pricingStatus: 'NOT_RUN', domesticPriceSaved: false })).toBe('enterPrice');
      expect(key({ pricingStatus: 'NOT_RUN', domesticPriceSaved: true })).toBe('runPricing');
    });

    it('저장 여부를 아직 읽는 중이면 줄을 감춘다', () => {
      expect(key({ pricingStatus: 'NOT_RUN', domesticPriceSaved: undefined })).toBeNull();
    });

    it('입력 대기: 국내 기준가를 넣으면 이어서 계산한다는 글(저장 여부와 관계없다)', () => {
      expect(key({ pricingStatus: 'WAITING_INPUT', domesticPriceSaved: false })).toBe(
        'waitingPrice',
      );
    });

    it('실행중 · 재실행 필요 · 실패는 상태 그대로의 글을 말한다', () => {
      expect(key({ pricingStatus: 'RUNNING' })).toBe('pricingRunning');
      expect(key({ pricingStatus: 'RERUN_REQUIRED' })).toBe('rerunPricing');
      expect(key({ pricingStatus: 'FAILED' })).toBe('failedPricing');
    });

    it('③이 끝나기 전에는 ④나 G2를 말하지 않는다', () => {
      // G2·④가 이미 끝난 값이 남아 있어도(앞 단계를 다시 돌린 경우) 첫 번째로 막힌 ③을 말한다
      const done = {
        g2Passed: true,
        categoryStatus: 'COMPLETED',
        domesticPriceSaved: true,
      } as const;
      expect(key({ ...done, pricingStatus: 'NOT_RUN' })).toBe('runPricing');
      expect(key({ ...done, pricingStatus: 'WAITING_INPUT' })).toBe('waitingPrice');
      expect(key({ ...done, pricingStatus: 'RUNNING' })).toBe('pricingRunning');
      expect(key({ ...done, pricingStatus: 'RERUN_REQUIRED' })).toBe('rerunPricing');
      expect(key({ ...done, pricingStatus: 'FAILED' })).toBe('failedPricing');
    });
  });

  describe('소싱 확정(G2)', () => {
    it('③ 완료인데 G2를 아직 안 했으면 [소싱 확정(G2)]', () => {
      expect(key({ g2Passed: false })).toBe('passG2');
    });

    it("비교하지 않은 URL 여정은 '비교 없이 확정' 체크가 먼저, 체크한 뒤에는 [소싱 확정(G2)]", () => {
      expect(key({ g2Passed: false, noComparisonPending: true })).toBe('checkNoComparison');
      expect(key({ g2Passed: false, noComparisonPending: false })).toBe('passG2');
    });

    it('게이트를 아직 못 읽었으면 줄을 감춘다', () => {
      expect(key({ g2Passed: undefined })).toBeNull();
    });

    it('판매 후보가 아니면 G2보다 그 이유를 먼저 말한다', () => {
      expect(key({ g2Passed: false, notSaleCandidate: true })).toBe('notSaleCandidate');
      // 여정이 제외 상태로 바뀌어 화면이 잠겨도 이유는 말한다
      expect(key({ notSaleCandidate: true, blocked: true })).toBe('notSaleCandidate');
    });

    it('판매 후보 아님은 ③이 완료일 때만 말한다', () => {
      expect(key({ pricingStatus: 'RERUN_REQUIRED', notSaleCandidate: true })).toBe('rerunPricing');
    });

    it('G2를 이미 통과했으면 G2를 말하지 않고 ④로 넘어간다', () => {
      expect(key({ g2Passed: true, noComparisonPending: true })).toBe('pickCategory');
    });
  });

  describe('④ 카테고리', () => {
    it('G2 통과 뒤 ④ 상태별: 실행 → 실행중 → 고르기 → 완료', () => {
      expect(key({ categoryStatus: 'NOT_RUN' })).toBe('runCategory');
      expect(key({ categoryStatus: 'RUNNING' })).toBe('categoryRunning');
      expect(key({ categoryStatus: 'WAITING_INPUT' })).toBe('pickCategory');
      expect(key({ categoryStatus: 'COMPLETED' })).toBe('done');
    });

    it('재실행 필요 · 실패는 [다시 실행]을 말한다', () => {
      expect(key({ categoryStatus: 'RERUN_REQUIRED' })).toBe('rerunCategory');
      expect(key({ categoryStatus: 'FAILED' })).toBe('failedCategory');
    });

    it('입력 대기인데 고를 결정이 화면에 없으면(지난 버전·아직 못 읽음) 줄을 감춘다', () => {
      expect(key({ categoryStatus: 'WAITING_INPUT', categoryPickable: false })).toBeNull();
    });

    it('레일의 ④ 상태를 아직 모르면 줄을 감춘다', () => {
      expect(key({ categoryStatus: undefined })).toBeNull();
    });

    it('완료인데 여정 성별이 바뀌었으면 완료 대신 다시 고르라고 말한다', () => {
      expect(key({ categoryStatus: 'COMPLETED', genderChanged: true })).toBe('genderChanged');
    });

    it('G2를 하기 전에는 ④가 어떤 상태여도 G2를 먼저 말한다', () => {
      for (const categoryStatus of ['NOT_RUN', 'WAITING_INPUT', 'COMPLETED'] as const) {
        expect(key({ g2Passed: false, categoryStatus })).toBe('passG2');
      }
    });
  });

  it('등록 진행 중이거나 제외된 여정은 줄을 감춘다', () => {
    expect(key({ blocked: true })).toBeNull();
    expect(key({ pricingStatus: 'NOT_RUN', domesticPriceSaved: false, blocked: true })).toBeNull();
    expect(key({ pricingStatus: 'WAITING_INPUT', blocked: true })).toBeNull();
  });
});

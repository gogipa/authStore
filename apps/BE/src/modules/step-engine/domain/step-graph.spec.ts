import { inputKeyLabel, INPUT_KEYS, readSettingsPath, settingsKeyAffects } from './input-keys.js';
import {
  COMPLETION_ONLY_INPUTS,
  directReaders,
  inputKeysFromStep,
  outputKeysOf,
  STEP_INPUT_SPECS,
  stepsReadingInput,
} from './step-graph.js';
import { STEP_FLOW, STEP_GRAPH } from './steps.js';

describe('입력 키 그래프(PRD §5.3 표, P1-05)', () => {
  it('앞 단계 입력의 출처 단계가 STEP_GRAPH requires(필수 — 완료만 보는 앞 단계 빼고)·optional(선택)과 같다', () => {
    for (const code of STEP_FLOW) {
      const specs = STEP_INPUT_SPECS[code].filter((s) => s.source === 'PREV_STEP');
      const required = [...new Set(specs.filter((s) => s.required).map((s) => s.sourceStepCode))];
      const optional = [...new Set(specs.filter((s) => !s.required).map((s) => s.sourceStepCode))];
      const completionOnly = Object.keys(COMPLETION_ONLY_INPUTS[code] ?? {});
      const requires = STEP_GRAPH[code].requires.filter((r) => !completionOnly.includes(r));
      expect([code, required.sort()]).toEqual([code, [...requires].sort()]);
      expect([code, optional.sort()]).toEqual([code, [...STEP_GRAPH[code].optional].sort()]);
    }
  });

  it('필수 후보 필드가 STEP_GRAPH candidateFields와 같고, 입력 키는 64자 이하·단계 안에서 겹치지 않는다', () => {
    for (const code of STEP_FLOW) {
      const fields = STEP_INPUT_SPECS[code]
        .filter((s) => s.source === 'CANDIDATE' && s.required)
        .map((s) => s.inputKey);
      expect([code, fields]).toEqual([code, [...STEP_GRAPH[code].candidateFields]]);
      const keys = STEP_INPUT_SPECS[code].map((s) => s.inputKey);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) expect(key.length).toBeLessThanOrEqual(64);
    }
  });

  it('실행 중 오너 입력은 지문 밖(③ 국내 기준가, ⑤ 레퍼런스 선택), URL 후보 쿠폰은 시작 조건', () => {
    const pricing = STEP_INPUT_SPECS.PRICING;
    expect(
      pricing.find((s) => s.inputKey === INPUT_KEYS.ownerDomesticPrice)?.isStartCondition,
    ).toBe(false);
    expect(pricing.find((s) => s.inputKey === INPUT_KEYS.ownerCoupon)).toMatchObject({
      isStartCondition: true,
      required: false,
    });
    expect(
      STEP_INPUT_SPECS.THUMBNAIL.find((s) => s.inputKey === INPUT_KEYS.ownerReferenceSelection)
        ?.isStartCondition,
    ).toBe(false);
  });

  it('⑤ 시작 조건(지문)은 설정 두 키뿐이다 — ② 완료는 완료만 본다(P3-01 규칙 1·2)', () => {
    const thumbnail = STEP_INPUT_SPECS.THUMBNAIL;
    expect(thumbnail.filter((s) => s.isStartCondition).map((s) => s.inputKey)).toEqual([
      'settings.thumbnail.promptTemplate',
      'settings.thumbnail.faceOptionDefault',
    ]);
    expect(thumbnail.filter((s) => s.source === 'PREV_STEP')).toEqual([]);
    expect(STEP_GRAPH.THUMBNAIL.requires).toEqual(['SOURCING']);
    expect(COMPLETION_ONLY_INPUTS.THUMBNAIL).toEqual({ SOURCING: 'sourcing.selection' });
    expect(thumbnail.filter((s) => !s.isStartCondition).map((s) => s.inputKey)).toEqual([
      'owner.referenceSelection',
      'owner.faceOption',
      'owner.promptAdjustment',
    ]);
  });

  it('직접 읽는 단계(전파 대상): ⑤ → ⑧만, ④ → ⑥-3·⑦, ③ → ⑥-3. ⑨는 뺀다', () => {
    expect(directReaders('THUMBNAIL')).toEqual(['UPLOAD']);
    expect(directReaders('CATEGORY')).toEqual(['NOTICE_HTML', 'TAGS']);
    expect(directReaders('PRICING')).toEqual(['NOTICE_HTML']);
    expect(directReaders('COPY')).toEqual(['NOTICE_HTML']);
    expect(directReaders('SOURCING')).toEqual([
      'PRICING',
      'CATEGORY',
      'THUMBNAIL',
      'COPY',
      'NOTICE_RAW',
      'TAGS',
    ]);
    expect(directReaders('UPLOAD')).toEqual([]);
  });

  it('입력 키 → 읽는 단계: 성별은 ③·④·⑥-3·⑦, ④ 리프 카테고리는 ⑥-3·⑦·⑨, 레퍼런스 선택은 ⑤', () => {
    expect(stepsReadingInput('candidate.gender')).toEqual([
      'PRICING',
      'CATEGORY',
      'NOTICE_HTML',
      'TAGS',
    ]);
    expect(stepsReadingInput('category.leafPath')).toEqual(['NOTICE_HTML', 'TAGS', 'REGISTER']);
    expect(stepsReadingInput('owner.referenceSelection')).toEqual(['THUMBNAIL']);
    expect(stepsReadingInput('nope')).toEqual([]);
  });

  it('산출물 키: ③은 판매 사이즈·판정 결과, ②→③ 입력은 목표 사이즈 SKU', () => {
    expect(outputKeysOf('PRICING').sort()).toEqual(['pricing.judgement', 'pricing.saleSizes']);
    expect(inputKeysFromStep('PRICING', 'SOURCING')).toEqual(['sourcing.targetSkus']);
  });

  it('설정 키 전파 맞추기: 섹션·하위 키 양방향, 다른 키는 아님', () => {
    expect(settingsKeyAffects('costs.targetMarginPct', 'settings.costs')).toBe(true);
    expect(settingsKeyAffects('costs', 'settings.costs.targetMarginPct')).toBe(true);
    expect(settingsKeyAffects('sourcing.minSizeCount', 'settings.sourcing.minSizeCount')).toBe(
      true,
    );
    expect(settingsKeyAffects('costs.targetMarginPct', 'settings.costsExtra')).toBe(false);
    expect(settingsKeyAffects('pricing.shoeBox', 'settings.costs')).toBe(false);
    expect(settingsKeyAffects('costs', 'owner.coupon')).toBe(false);
    expect(readSettingsPath({ a: { b: 3 } }, 'a.b')).toBe(3);
    expect(readSettingsPath({ a: 1 }, 'a.b')).toBeUndefined();
  });

  it('입력 키 화면 이름(모르는 설정 키는 설정 경로)', () => {
    expect(inputKeyLabel('owner.referenceSelection')).toBe('레퍼런스 선택');
    expect(inputKeyLabel('owner.domesticPrice')).toBe('국내 기준가');
    expect(inputKeyLabel('settings.safety.childShoeMaxSizeMm')).toBe(
      '설정 safety.childShoeMaxSizeMm',
    );
    expect(inputKeyLabel('unknown.key')).toBe('unknown.key');
  });
});

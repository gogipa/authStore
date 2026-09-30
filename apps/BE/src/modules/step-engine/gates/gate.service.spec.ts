import { ApiException } from '../../../common/errors/api.exception.js';
import { StepEngineApi } from '../step-engine.api.js';
import { StepEngineModule } from '../step-engine.module.js';
import { ContinuousRunService } from '../continuous/continuous-run.service.js';
import { GateService, parseGateCode, parseGatePassBody } from './gate.service.js';

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof ApiException ? error.code : 'OTHER';
  }
}

describe('게이트 통과 요청 검사(P1-06 규칙 10)', () => {
  it('경로 gateCode는 G2·G3만(G1·G4·모르는 값은 422 INVALID_GATE_CODE)', () => {
    expect(parseGateCode('G2')).toBe('G2');
    expect(parseGateCode('G3')).toBe('G3');
    for (const bad of ['G1', 'G4', 'g2', '', 'G5']) {
      expect(codeOf(() => parseGateCode(bad))).toBe('INVALID_GATE_CODE');
    }
  });

  it('G2 body: basisStepRunId(1 이상 정수)만. 그 밖 칸·잘못된 값은 422 VALIDATION_FAILED', () => {
    expect(parseGatePassBody('G2', { basisStepRunId: 7 }).basisStepRunId).toBe(7);
    expect(codeOf(() => parseGatePassBody('G2', {}))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => parseGatePassBody('G2', { basisStepRunId: 0 }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => parseGatePassBody('G2', { basisStepRunId: '7' }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => parseGatePassBody('G2', { basisStepRunId: 7, checklist: {} }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('G3 body: 대표 이미지·추가(서로 다름, 대표와 겹치지 않음)·체크리스트 객체가 필요하다(값·장수 검사는 P3-02 공급자)', () => {
    const ok = {
      basisStepRunId: 3,
      representativeImageAssetId: 10,
      additionalImageAssetIds: [11, 12],
      checklist: { shoeRatioOver70: true },
      sameProductColorConfirmed: true,
    };
    expect(parseGatePassBody('G3', ok).basisStepRunId).toBe(3);
    expect(
      codeOf(() => parseGatePassBody('G3', { ...ok, additionalImageAssetIds: [11, 11] })),
    ).toBe('VALIDATION_FAILED');
    // 10장은 모양은 맞다 — 개수 규칙은 G3 공급자가 422 IMAGE_COUNT_INVALID로 본다(P3-02 Proposed, 표 C)
    expect(
      parseGatePassBody('G3', {
        ...ok,
        additionalImageAssetIds: Array.from({ length: 10 }, (_, i) => i + 11),
      }).basisStepRunId,
    ).toBe(3);
    expect(
      codeOf(() => parseGatePassBody('G3', { ...ok, additionalImageAssetIds: [10, 11] })),
    ).toBe('VALIDATION_FAILED');
    expect(codeOf(() => parseGatePassBody('G3', { ...ok, checklist: undefined }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => parseGatePassBody('G3', { ...ok, sameProductColorConfirmed: 'yes' }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('웹 화면 전용(규칙 12): 게이트 통과·연속 실행 서비스는 모듈 밖(CLI M3가 쓸 StepEngineApi)으로 열지 않는다', () => {
    const exported = Reflect.getMetadata('exports', StepEngineModule) as unknown[];
    expect(exported).not.toContain(GateService);
    expect(exported).not.toContain(ContinuousRunService);
    expect(Object.getOwnPropertyNames(StepEngineApi.prototype)).not.toEqual(
      expect.arrayContaining(['pass']),
    );
  });
});

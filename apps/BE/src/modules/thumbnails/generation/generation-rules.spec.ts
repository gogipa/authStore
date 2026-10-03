import { ApiException } from '../../../common/errors/api.exception.js';
import { referenceSetSha256 } from '../references/reference-set-hash.js';
import {
  durationText,
  GENERATION_TIMEOUT_MAX_MS,
  generationReferenceSetSha256,
  generationTimeoutMs,
  lowerFaceOption,
  nextAttempt,
  parseGenerationRequest,
  runWithTimeout,
  settleWithin,
} from './generation-rules.js';

const sha = (c: string) => c.repeat(64);

function errorOf(fn: () => unknown): ApiException {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiException) return error;
    throw error;
  }
  throw new Error('던지지 않았습니다');
}

describe('회차 계산(P3-02 규칙 4)', () => {
  it('번호 1 첫 요청 → 1회차 INITIAL, 다시 → 2회차 OWNER_RETRY, 번호 2는 따로 센다', () => {
    expect(nextAttempt([], 1)).toEqual({ attemptNo: 1, triggerType: 'INITIAL' });
    const existing = [{ slotNo: 1, attemptNo: 1 }];
    expect(nextAttempt(existing, 1)).toEqual({ attemptNo: 2, triggerType: 'OWNER_RETRY' });
    expect(nextAttempt(existing, 2)).toEqual({ attemptNo: 1, triggerType: 'INITIAL' });
    expect(
      nextAttempt(
        [
          { slotNo: 1, attemptNo: 1 },
          { slotNo: 1, attemptNo: 3 },
          { slotNo: 2, attemptNo: 1 },
        ],
        1,
      ),
    ).toEqual({ attemptNo: 4, triggerType: 'OWNER_RETRY' });
  });
});

describe('reference_set_sha256(P3-02 규칙 4)', () => {
  it('P3-01 referenceSetSha256과 같은 값이고 레퍼런스 순서와 관계없다', () => {
    const refs = [{ sha256: sha('b') }, { sha256: sha('a') }, { sha256: sha('c') }];
    const value = generationReferenceSetSha256(refs);
    expect(value).toBe(referenceSetSha256([sha('a'), sha('b'), sha('c')]));
    expect(generationReferenceSetSha256([...refs].reverse())).toBe(value);
    expect(value).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('얼굴 노출 낮추기(P3-02 규칙 6)', () => {
  it('FULL_FACE → CHIN_CROP → HANDS_UPPER_BODY → 더 없음(null)', () => {
    expect(lowerFaceOption('FULL_FACE')).toBe('CHIN_CROP');
    expect(lowerFaceOption('CHIN_CROP')).toBe('HANDS_UPPER_BODY');
    expect(lowerFaceOption('HANDS_UPPER_BODY')).toBeNull();
  });
});

describe('생성 요청 검사(P3-02 규칙 2)', () => {
  it('slotNos는 1..N 안의 중복 없는 값 — 오름차순으로 돌려준다', () => {
    expect(parseGenerationRequest({ slotNos: [2, 1], faceOption: 'FULL_FACE' }, 2)).toEqual({
      slotNos: [1, 2],
      faceOption: 'FULL_FACE',
      promptAdjustment: null,
    });
    expect(
      parseGenerationRequest(
        { slotNos: [1], faceOption: 'CHIN_CROP', promptAdjustment: 'softer light' },
        2,
      ).promptAdjustment,
    ).toBe('softer light');
  });

  it.each([
    ['N=2에서 3번', { slotNos: [3], faceOption: 'FULL_FACE' }, 'slotNos'],
    ['0번', { slotNos: [0], faceOption: 'FULL_FACE' }, 'slotNos'],
    ['중복', { slotNos: [1, 1], faceOption: 'FULL_FACE' }, 'slotNos'],
    ['빈 목록', { slotNos: [], faceOption: 'FULL_FACE' }, 'slotNos'],
    ['정수 아님', { slotNos: [1.5], faceOption: 'FULL_FACE' }, 'slotNos'],
    ['얼굴 옵션 3종 밖', { slotNos: [1], faceOption: 'SIDE' }, 'faceOption'],
    [
      '조정 2001자',
      { slotNos: [1], faceOption: 'FULL_FACE', promptAdjustment: 'a'.repeat(2001) },
      'promptAdjustment',
    ],
  ])('%s → 422 VALIDATION_FAILED', (_name, body, field) => {
    const error = errorOf(() => parseGenerationRequest(body, 2));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fieldErrors?.map((e) => e.field)).toContain(field);
  });

  it('조정 2000자는 받는다', () => {
    expect(
      parseGenerationRequest(
        { slotNos: [1], faceOption: 'FULL_FACE', promptAdjustment: 'a'.repeat(2000) },
        2,
      ).promptAdjustment,
    ).toHaveLength(2000);
  });
});

describe('타임아웃(P3-02 규칙 5 — 하드 15분)', () => {
  it('설정 초 → ms, 15분을 넘지 않는다. 값이 없거나 0 이하면 기본값 300초(D-23)', () => {
    expect(generationTimeoutMs(300)).toBe(300_000);
    expect(generationTimeoutMs(900)).toBe(GENERATION_TIMEOUT_MAX_MS);
    expect(generationTimeoutMs(5000)).toBe(GENERATION_TIMEOUT_MAX_MS);
    expect(generationTimeoutMs(1)).toBe(1000);
    for (const missing of [undefined, 0, -1, Number.NaN]) {
      expect(generationTimeoutMs(missing)).toBe(300_000);
    }
    expect(durationText(300_000)).toBe('5분');
    expect(durationText(900_000)).toBe('15분');
    expect(durationText(1000)).toBe('1초');
    expect(durationText(90_000)).toBe('1분 30초');
  });

  it('시간 안에 끝나면 DONE, 넘으면 signal을 끊고 TIMEOUT(공급자를 기다리지 않는다)', async () => {
    await expect(runWithTimeout(() => Promise.resolve(7), 1000)).resolves.toEqual({
      kind: 'DONE',
      value: 7,
    });
    let aborted = false;
    const result = await runWithTimeout(
      (signal) =>
        new Promise<number>(() => {
          signal.addEventListener('abort', () => (aborted = true));
        }),
      10,
    );
    expect(result).toMatchObject({ kind: 'TIMEOUT' });
    expect(aborted).toBe(true);
  });

  it('TIMEOUT의 settled는 끊긴 공급자가 실제로 끝날 때 풀린다(실패여도). settleWithin은 상한까지만 기다린다', async () => {
    let finish: () => void = () => undefined;
    const result = await runWithTimeout(
      (signal) =>
        new Promise<number>((_resolve, reject) => {
          // 끊긴 뒤 자식이 끝나는 데 시간이 걸리는 공급자
          signal.addEventListener('abort', () => {
            finish = () => reject(new Error('killed'));
          });
        }),
      10,
    );
    if (result.kind !== 'TIMEOUT') throw new Error('TIMEOUT이 아닙니다');
    let settled = false;
    void result.settled.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    finish();
    await result.settled;
    expect(settled).toBe(true);
    // 끝나지 않는 약속도 상한 뒤에는 돌아온다
    const started = Date.now();
    await settleWithin(new Promise<void>(() => undefined), 30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it('공급자 오류는 그대로 던진다', async () => {
    await expect(runWithTimeout(() => Promise.reject(new Error('boom')), 1000)).rejects.toThrow(
      'boom',
    );
  });
});

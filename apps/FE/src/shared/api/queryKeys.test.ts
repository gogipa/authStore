import { describe, expect, expectTypeOf, it } from 'vitest';
import { API_TAGS, qk } from './queryKeys';

describe('qk', () => {
  it('[태그, operationId, 파라미터]', () => {
    expect(qk('step-engine', 'getCandidate', { candidateId: 12 })).toEqual([
      'step-engine',
      'getCandidate',
      { candidateId: 12 },
    ]);
  });

  it('파라미터가 없으면 두 칸', () => {
    const key = qk('integrations', 'getCallUsage');
    expect(key).toEqual(['integrations', 'getCallUsage']);
    expectTypeOf(key).toEqualTypeOf<readonly ['integrations', 'getCallUsage']>();
  });

  it('명세에 없는 operationId·태그는 타입 오류다', () => {
    // @ts-expect-error 05-2에 없는 연산 이름
    qk('integrations', 'getNothing');
    // @ts-expect-error OpenAPI 태그가 아니다
    qk('candidates', 'getCandidate');
  });

  it('태그는 05-2 OpenAPI 태그 15개다', () => {
    expect(API_TAGS).toHaveLength(15);
  });
});

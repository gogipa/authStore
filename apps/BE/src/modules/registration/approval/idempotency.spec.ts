import { ApiException } from '../../../common/errors/api.exception.js';
import type { Db } from '../../step-engine/candidates/step-engine-tx.js';
import {
  isSameApproval,
  parseApprovalBody,
  parseIdempotencyKey,
  replayIdempotentApproval,
} from './idempotency.js';

const KEY = '3f2c1b6e-8d4a-4c1e-9b7f-0a1b2c3d4e5f';

function stubDb(row: unknown): Db {
  return {
    registration: { findUnique: () => Promise.resolve(row) },
  } as unknown as Db;
}

const stored = {
  id: 31,
  stepRunId: 210,
  status: 'VALIDATED',
  optionType: 'COMBINATION',
  uploadResultId: 9,
  priceJudgementId: 7,
  sellerManagementCode: 'RKT:shop-a:10000123:108',
  displayStatusType: 'SUSPENSION',
  approvedAt: new Date('2026-09-28T06:00:00Z'),
  stepRun: { candidateId: 12 },
};

describe('멱등(P4-03 규칙 5 — approval/idempotency.ts)', () => {
  it('헤더 없음 400 IDEMPOTENCY_KEY_REQUIRED, UUID 아님 422 VALIDATION_FAILED, 대문자는 소문자로', () => {
    const codeOf = (raw: unknown) => {
      try {
        parseIdempotencyKey(raw);
        return null;
      } catch (error) {
        return (error as ApiException).code;
      }
    };
    expect(codeOf(undefined)).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(codeOf('  ')).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(codeOf('not-a-uuid')).toBe('VALIDATION_FAILED');
    expect(parseIdempotencyKey(KEY.toUpperCase())).toBe(KEY);
  });

  it('body: 정의 밖 칸·빠진 칸·0은 422 VALIDATION_FAILED(fieldErrors)', () => {
    expect(
      parseApprovalBody({
        optionType: 'COMBINATION',
        expectedUploadResultId: 9,
        expectedPriceJudgementId: 7,
      }),
    ).toEqual({
      optionType: 'COMBINATION',
      expectedUploadResultId: 9,
      expectedPriceJudgementId: 7,
    });
    try {
      parseApprovalBody({ optionType: 'BAD', expectedUploadResultId: 0, foo: 1 });
      throw new Error('던져야 한다');
    } catch (error) {
      const e = error as ApiException;
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.fieldErrors?.map((f) => f.field).sort()).toEqual(
        ['expectedPriceJudgementId', 'expectedUploadResultId', 'foo', 'optionType'].sort(),
      );
    }
  });

  it('같은 키·같은 본문 → 같은 registrationId(첫 응답)', async () => {
    const replay = await replayIdempotentApproval(stubDb(stored), KEY, {
      candidateId: 12,
      optionType: 'COMBINATION',
      uploadResultId: 9,
      priceJudgementId: 7,
    });
    expect(replay).toEqual({
      registrationId: 31,
      stepRunId: 210,
      candidateId: 12,
      status: 'VALIDATED',
      sellerManagementCode: 'RKT:shop-a:10000123:108',
      displayStatusType: 'SUSPENSION',
      approvedAt: '2026-09-28T06:00:00.000Z',
    });
    expect(
      await replayIdempotentApproval(stubDb(null), KEY, {
        ...replay!,
        optionType: 'X',
        uploadResultId: 1,
        priceJudgementId: 1,
      }),
    ).toBeNull();
  });

  it('같은 키·다른 optionType → 422 IDEMPOTENCY_KEY_REUSED', async () => {
    await expect(
      replayIdempotentApproval(stubDb(stored), KEY, {
        candidateId: 12,
        optionType: 'STANDARD',
        uploadResultId: 9,
        priceJudgementId: 7,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(
      isSameApproval(
        { candidateId: 12, optionType: 'COMBINATION', uploadResultId: 9, priceJudgementId: 7 },
        { candidateId: 13, optionType: 'COMBINATION', uploadResultId: 9, priceJudgementId: 7 },
      ),
    ).toBe(false);
  });
});

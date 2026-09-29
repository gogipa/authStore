import { ApiException } from '../../../common/errors/api.exception.js';
import { STEP_FLOW } from '../domain/steps.js';
import {
  createCandidateServicesHarness,
  UNIT_NOW,
  type CandidateServicesHarness,
} from './candidate-services.testing.js';
import { isActiveItemColorViolation } from './candidate-identity.service.js';

const KEY = { itemCode: 'shop-a:10000123', selectedColor: '크림/블랙' };

async function expectApiError(promise: Promise<unknown>, code: string): Promise<ApiException> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiException);
    expect((e as ApiException).code).toBe(code);
    return e as ApiException;
  }
  throw new Error(`${code} 예외가 나지 않았습니다`);
}

describe('CandidateIdentityService — 진행 중 중복(F-CW-04, 규칙 3)', () => {
  let h: CandidateServicesHarness;

  beforeEach(async () => {
    h = await createCandidateServicesHarness();
  });

  it('진행 중 같은 itemCode+색상 → CANDIDATE_DUPLICATE(details.existingCandidateId)', async () => {
    const existing = h.prisma.seedCandidate({ status: 'WORKING', ...KEY });
    const err = await expectApiError(
      h.identity.assertNoDuplicate(h.prisma as never, KEY),
      'CANDIDATE_DUPLICATE',
    );
    expect(err.getStatus()).toBe(409);
    expect(err.details).toEqual({ existingCandidateId: existing.id });
  });

  it.each(['EXCLUDED', 'REGISTERED'])('상대가 %s면 통과한다', async (status) => {
    h.prisma.seedCandidate({
      status,
      ...KEY,
      excludedReason: status === 'EXCLUDED' ? 'OWNER_EXCLUDED' : null,
    });
    await expect(h.identity.assertNoDuplicate(h.prisma as never, KEY)).resolves.toBeUndefined();
  });

  it('자기 자신은 중복이 아니다(다시 작업·소싱 선택 변경)', async () => {
    const self = h.prisma.seedCandidate({ status: 'EXCLUDED', ...KEY });
    await expect(
      h.identity.assertNoDuplicate(h.prisma as never, KEY, self.id),
    ).resolves.toBeUndefined();
  });

  it('앵커 키(型番 + 색상 코드)만 같은 진행 중 후보 → 경고 ANCHOR_KEY_DUPLICATE(막지 않음)', async () => {
    const other = h.prisma.seedCandidate({
      status: 'WORKING',
      anchorModelCode: '1201A019108',
      anchorColorCode: '108',
      itemCode: 'shop-b:20000456',
      selectedColor: '크림/블랙',
    });
    const warnings = await h.identity.anchorDuplicateWarnings(h.prisma as never, {
      anchorModelCode: '1201A019108',
      anchorItemCode: null,
      anchorColorCode: '108',
    });
    expect(warnings).toEqual([
      { code: 'ANCHOR_KEY_DUPLICATE', message: expect.stringContaining(`#${other.id}`) as string },
    ]);
    // 색상 코드가 다르면 경고하지 않는다
    expect(
      await h.identity.anchorDuplicateWarnings(h.prisma as never, {
        anchorModelCode: '1201A019108',
        anchorItemCode: null,
        anchorColorCode: '001',
      }),
    ).toEqual([]);
    // 제외된 후보는 진행 중이 아니다
    other.status = 'EXCLUDED';
    expect(
      await h.identity.anchorDuplicateWarnings(h.prisma as never, {
        anchorModelCode: '1201A019108',
        anchorItemCode: null,
        anchorColorCode: '108',
      }),
    ).toEqual([]);
  });

  it('DB 부분 UNIQUE 오류(23505)를 알아본다', () => {
    expect(
      isActiveItemColorViolation({
        code: 'P2002',
        message: 'Unique constraint failed on the constraint: `uq_candidate_active_item_color`',
      }),
    ).toBe(true);
    expect(
      isActiveItemColorViolation({
        code: 'P2002',
        meta: { target: ['candidate_id', 'step_code'] },
      }),
    ).toBe(false);
    expect(isActiveItemColorViolation(new Error('boom'))).toBe(false);
  });
});

describe('CandidateIdentityService — 앵커 키 고정(F-CW-03, 규칙 4)', () => {
  let h: CandidateServicesHarness;

  beforeEach(async () => {
    h = await createCandidateServicesHarness();
  });

  const fixed = {
    status: 'WORKING',
    anchorModelCode: '1201A019108',
    anchorColorCode: '108',
    anchorFixedAt: new Date('2026-09-27T00:00:00Z'),
    ...KEY,
  };

  it('처음 확정하면 앵커 세 칸과 anchor_fixed_at을 쓴다', async () => {
    const c = h.prisma.seedCandidate({ status: 'WORKING' });
    const result = await h.transactions.run((scope) =>
      h.identity.fixAnchor(scope, c.id, { anchorModelCode: '1201A019108', anchorColorCode: '108' }),
    );
    expect(result).toEqual({ changed: true, warnings: [] });
    expect(c).toMatchObject({
      anchorModelCode: '1201A019108',
      anchorItemCode: null,
      anchorColorCode: '108',
      anchorFixedAt: UNIT_NOW,
    });
  });

  it('같은 값으로 다시 확정 → 변화 없음', async () => {
    const c = h.prisma.seedCandidate(fixed);
    const result = await h.transactions.run((scope) =>
      h.identity.fixAnchor(scope, c.id, { anchorModelCode: '1201A019108', anchorColorCode: '108' }),
    );
    expect(result.changed).toBe(false);
    expect(c.anchorFixedAt).toEqual(new Date('2026-09-27T00:00:00Z'));
  });

  it('다른 색상 → ANCHOR_KEY_MISMATCH(409)', async () => {
    const c = h.prisma.seedCandidate(fixed);
    const err = await expectApiError(
      h.transactions.run((scope) =>
        h.identity.fixAnchor(scope, c.id, {
          anchorModelCode: '1201A019108',
          anchorColorCode: '001',
        }),
      ),
      'ANCHOR_KEY_MISMATCH',
    );
    expect(err.getStatus()).toBe(409);
    expect(c.anchorColorCode).toBe('108');
  });

  it('같은 앵커 안 itemCode 변경 → 허용(G2 지문이 바뀌므로 상태를 다시 계산한다)', async () => {
    const c = h.prisma.seedCandidate(fixed, {}, STEP_FLOW);
    const result = await h.transactions.run((scope) =>
      h.identity.changeSourcingSelection(scope, c.id, {
        itemCode: 'shop-b:20000456',
        selectedColor: '크림/블랙',
        anchor: { anchorModelCode: '1201A019108', anchorColorCode: '108' },
      }),
    );
    expect(result.changed).toBe(true);
    expect(c.itemCode).toBe('shop-b:20000456');
  });

  it('다른 앵커의 행으로 소싱 선택을 바꾸려 하면 ANCHOR_KEY_MISMATCH', async () => {
    const c = h.prisma.seedCandidate(fixed, {}, STEP_FLOW);
    await expectApiError(
      h.transactions.run((scope) =>
        h.identity.changeSourcingSelection(scope, c.id, {
          itemCode: 'shop-c:1',
          selectedColor: '화이트',
          anchor: { anchorModelCode: 'MR530SG', anchorColorCode: 'SG' },
        }),
      ),
      'ANCHOR_KEY_MISMATCH',
    );
    expect(c.itemCode).toBe(KEY.itemCode);
  });

  it('소싱 선택 변경도 진행 중 중복을 막는다', async () => {
    const other = h.prisma.seedCandidate({
      status: 'AWAITING_APPROVAL',
      itemCode: 'shop-b:20000456',
      selectedColor: '크림/블랙',
    });
    const c = h.prisma.seedCandidate(fixed, {}, STEP_FLOW);
    const err = await expectApiError(
      h.transactions.run((scope) =>
        h.identity.changeSourcingSelection(scope, c.id, {
          itemCode: 'shop-b:20000456',
          selectedColor: '크림/블랙',
        }),
      ),
      'CANDIDATE_DUPLICATE',
    );
    expect(err.details).toEqual({ existingCandidateId: other.id });
  });

  it('잠긴 후보의 앵커·소싱 선택은 바꿀 수 없다(CANDIDATE_LOCKED)', async () => {
    const c = h.prisma.seedCandidate({ ...fixed, status: 'REGISTERING' });
    const err = await expectApiError(
      h.transactions.run((scope) =>
        h.identity.changeSourcingSelection(scope, c.id, {
          itemCode: 'shop-b:1',
          selectedColor: '크림/블랙',
        }),
      ),
      'CANDIDATE_LOCKED',
    );
    expect(err.details).toEqual({ status: 'REGISTERING' });
  });
});

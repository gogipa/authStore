import { ApiException } from '../../../common/errors/api.exception.js';
import { STEP_FLOW, type StepCode } from '../domain/steps.js';
import {
  createCandidateServicesHarness,
  gateValidity,
  type CandidateServicesHarness,
} from './candidate-services.testing.js';

function stepRow(h: CandidateServicesHarness, candidateId: number, code: StepCode) {
  return h.prisma.candidateStep.rows.find(
    (r) => r.candidateId === candidateId && r.stepCode === code,
  )!;
}

describe('CandidateGenderService — 성별(F-CW-08, 규칙 10)', () => {
  let h: CandidateServicesHarness;

  beforeEach(async () => {
    h = await createCandidateServicesHarness();
  });

  it('OWNER 값에 ② 다른 판단 → 값 유지 + genderRecheckRequired=true', async () => {
    const c = h.prisma.seedCandidate({ gender: 'MALE', genderSource: 'OWNER' }, {}, STEP_FLOW);
    const result = await h.transactions.run((scope) =>
      h.gender.applyStep2Gender(scope, c.id, 'FEMALE'),
    );
    expect(result).toMatchObject({
      gender: 'MALE',
      genderSource: 'OWNER',
      genderRecheckRequired: true,
      changed: false,
    });
    expect(c).toMatchObject({ gender: 'MALE', genderSource: 'OWNER', genderRecheckRequired: true });
    // 같은 판단이 다시 오면 재확인 필요를 푼다
    await h.transactions.run((scope) => h.gender.applyStep2Gender(scope, c.id, 'MALE'));
    expect(c.genderRecheckRequired).toBe(false);
  });

  it('STEP2 값은 ② 판단으로 덮어쓰고, 바뀌면 현재 버전이 있는 PRICING·NOTICE_HTML·TAGS를 재실행 필요로', async () => {
    const c = h.prisma.seedCandidate(
      { gender: 'MALE', genderSource: 'STEP2' },
      { SOURCING: 'COMPLETED', PRICING: 'COMPLETED' },
      STEP_FLOW,
    );
    const result = await h.transactions.run((scope) =>
      h.gender.applyStep2Gender(scope, c.id, 'FEMALE'),
    );
    expect(result).toMatchObject({
      gender: 'FEMALE',
      genderSource: 'STEP2',
      changed: true,
      affectedSteps: ['PRICING'],
    });
    expect(c).toMatchObject({
      gender: 'FEMALE',
      genderSource: 'STEP2',
      genderRecheckRequired: false,
    });
    expect(stepRow(h, c.id, 'PRICING')).toMatchObject({
      status: 'RERUN_REQUIRED',
      staleInputs: ['candidate.gender'],
    });
  });

  it('PUT 같은 값 → changed=false·affectedSteps=[](전파 없음), 출처는 OWNER로', async () => {
    const c = h.prisma.seedCandidate(
      { gender: 'MALE', genderSource: 'STEP2' },
      { SOURCING: 'COMPLETED', PRICING: 'COMPLETED', TAGS: 'COMPLETED' },
      STEP_FLOW,
    );
    const result = await h.gender.setOwnerGender(c.id, 'MALE');
    expect(result).toEqual({
      candidateId: c.id,
      gender: 'MALE',
      genderSource: 'OWNER',
      genderRecheckRequired: false,
      changed: false,
      affectedSteps: [],
      resumedStepRunIds: [],
    });
    expect(stepRow(h, c.id, 'PRICING').status).toBe('COMPLETED');
    expect(c.genderSource).toBe('OWNER');
    expect(h.published.filter((e) => e.name === 'candidate-step.changed')).toHaveLength(0);
  });

  it('PUT 다른 값 → 현재 버전이 있는 PRICING·NOTICE_HTML·TAGS만 affectedSteps(④는 넣지 않는다)', async () => {
    const c = h.prisma.seedCandidate(
      { gender: 'MALE', genderSource: 'STEP2' },
      {
        SOURCING: 'COMPLETED',
        PRICING: 'COMPLETED',
        CATEGORY: 'COMPLETED',
        COPY: 'COMPLETED',
        NOTICE_RAW: 'COMPLETED',
        NOTICE_HTML: 'WAITING_INPUT',
        // TAGS 미실행 → 현재 버전이 없어 넣지 않는다
      },
      STEP_FLOW,
    );
    const result = await h.gender.setOwnerGender(c.id, 'FEMALE');
    expect(result.changed).toBe(true);
    expect(result.affectedSteps).toEqual(['PRICING', 'NOTICE_HTML']);
    expect(stepRow(h, c.id, 'CATEGORY').status).toBe('COMPLETED');
    expect(stepRow(h, c.id, 'TAGS').status).toBe('NOT_RUN');
    expect(stepRow(h, c.id, 'NOTICE_HTML')).toMatchObject({
      status: 'RERUN_REQUIRED',
      staleInputs: ['candidate.gender'],
    });
    // 커밋 뒤 SSE candidate-step.changed가 단계마다 하나
    expect(
      h.published
        .filter((e) => e.name === 'candidate-step.changed')
        .map((e) => (e.data as { stepCode: string }).stepCode),
    ).toEqual(['PRICING', 'NOTICE_HTML']);
    expect(h.audits[0]).toMatchObject({ eventType: 'OWNER_EDITED', candidateId: c.id });
  });

  it('승인대기 후보의 성별을 바꾸면 같은 트랜잭션에서 작업중(STEP_NOT_CURRENT)으로 되돌린다', async () => {
    h = await createCandidateServicesHarness({
      gates: { evaluate: () => Promise.resolve(gateValidity(true, true)) },
    });
    const all: Record<string, string> = {};
    for (const code of STEP_FLOW) if (code !== 'REGISTER') all[code] = 'COMPLETED';
    const c = h.prisma.seedCandidate(
      {
        status: 'AWAITING_APPROVAL',
        itemCode: 'shop-a:1',
        selectedColor: '크림/블랙',
        anchorColorCode: '108',
        anchorModelCode: '1201A019108',
        gender: 'MALE',
        genderSource: 'STEP2',
        leafCategoryId: '50000830',
      },
      all,
      STEP_FLOW,
    );
    await h.gender.setOwnerGender(c.id, 'FEMALE');
    expect(c.status).toBe('WORKING');
    expect(h.prisma.candidateStatusHistory.rows.at(-1)).toMatchObject({
      fromStatus: 'AWAITING_APPROVAL',
      toStatus: 'WORKING',
      reason: 'STEP_NOT_CURRENT',
    });
    expect(h.published.some((e) => e.name === 'candidate.status-changed')).toBe(true);
  });

  it('승인대기 후보에 ② 판단 불가(null)가 오면 성별을 비우기 전에 작업중(STEP_NOT_CURRENT)으로 되돌린다(ck_candidate_ready)', async () => {
    h = await createCandidateServicesHarness({
      gates: { evaluate: () => Promise.resolve(gateValidity(true, true)) },
    });
    const all: Record<string, string> = {};
    for (const code of STEP_FLOW) if (code !== 'REGISTER') all[code] = 'COMPLETED';
    const c = h.prisma.seedCandidate(
      {
        status: 'AWAITING_APPROVAL',
        itemCode: 'shop-a:1',
        selectedColor: '크림/블랙',
        anchorColorCode: '108',
        anchorModelCode: '1201A019108',
        gender: 'MALE',
        genderSource: 'STEP2',
        leafCategoryId: '50000830',
      },
      all,
      STEP_FLOW,
    );
    // 가짜 Prisma도 ck_candidate_ready를 흉내 내므로, 순서가 틀리면 여기서 CHECK 위반으로 떨어진다.
    const result = await h.transactions.run((scope) =>
      h.gender.applyStep2Gender(scope, c.id, null),
    );
    expect(result).toMatchObject({
      gender: null,
      genderSource: null,
      changed: true,
      affectedSteps: ['PRICING', 'NOTICE_HTML', 'TAGS'],
    });
    expect(c).toMatchObject({ status: 'WORKING', gender: null, genderSource: null });
    const history = h.prisma.candidateStatusHistory.rows.filter((r) => r.candidateId === c.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromStatus: 'AWAITING_APPROVAL',
      toStatus: 'WORKING',
      reason: 'STEP_NOT_CURRENT',
    });
  });

  it('성별을 읽는 단계가 실행 중이면 409 STEP_LOCKED_BY_RUNNING_STEP, 잠긴 후보는 CANDIDATE_LOCKED, 제외 후보는 CANDIDATE_EXCLUDED', async () => {
    const running = h.prisma.seedCandidate(
      { gender: 'MALE', genderSource: 'STEP2' },
      { SOURCING: 'COMPLETED', TAGS: 'RUNNING' },
      STEP_FLOW,
    );
    await expect(h.gender.setOwnerGender(running.id, 'FEMALE')).rejects.toMatchObject({
      code: 'STEP_LOCKED_BY_RUNNING_STEP',
      details: { stepCode: 'TAGS' },
    });
    expect(running.gender).toBe('MALE');

    const locked = h.prisma.seedCandidate({ status: 'RESULT_CHECK_REQUIRED' }, {}, STEP_FLOW);
    await expect(h.gender.setOwnerGender(locked.id, 'FEMALE')).rejects.toBeInstanceOf(ApiException);
    await expect(h.gender.setOwnerGender(locked.id, 'FEMALE')).rejects.toMatchObject({
      code: 'CANDIDATE_LOCKED',
    });

    const excluded = h.prisma.seedCandidate(
      { status: 'EXCLUDED', excludedReason: 'OWNER_EXCLUDED' },
      {},
      STEP_FLOW,
    );
    await expect(h.gender.setOwnerGender(excluded.id, 'FEMALE')).rejects.toMatchObject({
      code: 'CANDIDATE_EXCLUDED',
    });

    // ② 소싱이 실행 중이어도 성별을 읽지 않으므로 막지 않는다
    const sourcing = h.prisma.seedCandidate({}, { SOURCING: 'RUNNING' }, STEP_FLOW);
    await expect(h.gender.setOwnerGender(sourcing.id, 'MALE')).resolves.toMatchObject({
      changed: true,
    });
  });
});

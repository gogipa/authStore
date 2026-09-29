import { Test, type TestingModule } from '@nestjs/testing';
import {
  UserActionLogService,
  type UserActionLogInput,
} from '../../../common/audit/user-action-log.service.js';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FakeStepEnginePrisma } from '../../../../test/helpers/fake-prisma.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import {
  GATE_VALIDITY,
  type CandidateGateValidity,
  type GateValidityPort,
} from '../ports/gate-validity.port.js';
import { GENDER_INPUT_LISTENERS } from '../ports/gender-input.port.js';
import { CandidateGenderService } from './candidate-gender.service.js';
import { CandidateGuardService } from './candidate-guard.service.js';
import { CandidateIdentityService } from './candidate-identity.service.js';
import { CandidateStatusService } from './candidate-status.service.js';
import { StepEngineTransactions } from './step-engine-tx.js';

/**
 * 후보 서비스 단위 테스트 틀(테스트 전용 — 이름이 *.testing.ts라 테스트만 가져온다). 실제 서비스들을 Nest DI로 묶고,
 * DB·시계·게이트·SSE·감사 기록만 가짜로 끼운다. 게이트 유효성은 `overrideProvider(GATE_VALIDITY)`로 바꿀 수 있다.
 */
export const UNIT_NOW = new Date('2026-09-28T00:00:00Z');

export function gateValidity(g2: boolean, g3: boolean): CandidateGateValidity {
  return {
    G2: { gate: 'G2', gatePassId: g2 ? 1 : null, passedAt: g2 ? UNIT_NOW : null, valid: g2 },
    G3: { gate: 'G3', gatePassId: g3 ? 2 : null, passedAt: g3 ? UNIT_NOW : null, valid: g3 },
  };
}

export interface CandidateServicesHarness {
  moduleRef: TestingModule;
  prisma: FakeStepEnginePrisma;
  published: { name: string; data: unknown }[];
  audits: UserActionLogInput[];
  identity: CandidateIdentityService;
  gender: CandidateGenderService;
  status: CandidateStatusService;
  transactions: StepEngineTransactions;
}

export async function createCandidateServicesHarness(
  options: { gates?: GateValidityPort } = {},
): Promise<CandidateServicesHarness> {
  const prisma = new FakeStepEnginePrisma();
  const published: { name: string; data: unknown }[] = [];
  const audits: UserActionLogInput[] = [];
  const clock: Clock = { now: () => UNIT_NOW, sleep: () => Promise.resolve() };
  const moduleRef = await Test.createTestingModule({
    providers: [
      StepEngineTransactions,
      CandidateGuardService,
      CandidateStatusService,
      CandidateIdentityService,
      CandidateGenderService,
      { provide: PrismaService, useValue: null },
      { provide: CLOCK, useValue: null },
      { provide: GATE_VALIDITY, useValue: null },
      { provide: ProgressEventsService, useValue: null },
      { provide: UserActionLogService, useValue: null },
      { provide: GENDER_INPUT_LISTENERS, useValue: [] },
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(GATE_VALIDITY)
    .useValue(options.gates ?? { evaluate: () => Promise.resolve(gateValidity(false, false)) })
    .overrideProvider(ProgressEventsService)
    .useValue({
      publish: (name: string, data: unknown) => {
        published.push({ name, data });
        return { id: published.length, name, data, candidateId: null };
      },
    })
    .overrideProvider(UserActionLogService)
    .useValue({
      record: (input: UserActionLogInput) => {
        audits.push(input);
        return Promise.resolve({ id: audits.length });
      },
    })
    .compile();
  return {
    moduleRef,
    prisma,
    published,
    audits,
    identity: moduleRef.get(CandidateIdentityService),
    gender: moduleRef.get(CandidateGenderService),
    status: moduleRef.get(CandidateStatusService),
    transactions: moduleRef.get(StepEngineTransactions),
  };
}

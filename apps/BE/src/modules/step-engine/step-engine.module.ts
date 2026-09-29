import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { CandidateGenderService } from './candidates/candidate-gender.service.js';
import { CandidateGuardService } from './candidates/candidate-guard.service.js';
import { CandidateIdentityService } from './candidates/candidate-identity.service.js';
import { CandidateStatusService } from './candidates/candidate-status.service.js';
import { CandidateStepsController } from './candidates/candidate-steps.controller.js';
import { CandidateService } from './candidates/candidate.service.js';
import { CandidatesController } from './candidates/candidates.controller.js';
import { StepEngineTransactions } from './candidates/step-engine-tx.js';
import { CANDIDATE_CREATION_EXTENSION } from './ports/candidate-creation.extension.js';
import { GATE_VALIDITY, LatestPassGateValidity } from './ports/gate-validity.port.js';
import { GENDER_INPUT_LISTENERS } from './ports/gender-input.port.js';

/**
 * 핵심: 후보·단계 실행(StepRun)·버전·입력 지문·게이트·연속 실행. 단계 모듈을 부르고 앞 단계 산출물을 넘긴다(03-ADR-003).
 *
 * P1-04(후보 층): 후보 만들기·목록·상세·상태 전환·제외·다시 작업·성별·이어 하기. 뒤 문서가 그대로 쓰는 것:
 * - `StepEngineTransactions.run(scope => …)`: 상태를 바꾸는 트랜잭션(커밋 뒤 SSE)
 * - `CandidateGuardService`: 404·잠금·제외·상태·실행 중 검사
 * - `CandidateStatusService.reevaluate(scope, candidateId, cause)`·`transition()`: 자동 전환·전이 기록
 * - `CandidateIdentityService`: 중복 검사·앵커 확정·소싱 선택 변경(② P2-03)
 * - `CandidateGenderService.applyStep2Gender(scope, …)`: ② 자동 성별(P2-03). 판단 불가(null)로 승인대기·검증완료
 *   후보의 성별을 비울 때는 ck_candidate_ready 때문에 먼저 작업중(STEP_NOT_CURRENT)으로 되돌린다
 * - 포트: `GATE_VALIDITY`(P1-06이 지문 비교로 바꾼다), `CANDIDATE_CREATION_EXTENSION`(P2-02가 ② URL_CREATE를 채운다),
 *   `GENDER_INPUT_LISTENERS`(열린 ②·④에 성별을 넘긴다, P2-03·P2-06)
 */
@Module({
  imports: [SettingsModule, IntegrationsModule],
  controllers: [CandidatesController, CandidateStepsController],
  providers: [
    StepEngineTransactions,
    CandidateGuardService,
    CandidateStatusService,
    CandidateIdentityService,
    CandidateGenderService,
    CandidateService,
    { provide: GATE_VALIDITY, useClass: LatestPassGateValidity },
    { provide: CANDIDATE_CREATION_EXTENSION, useValue: null },
    { provide: GENDER_INPUT_LISTENERS, useValue: [] },
  ],
  exports: [
    StepEngineTransactions,
    CandidateGuardService,
    CandidateStatusService,
    CandidateIdentityService,
    CandidateGenderService,
    GATE_VALIDITY,
  ],
})
export class StepEngineModule {}

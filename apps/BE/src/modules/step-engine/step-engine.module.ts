import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SystemModule } from '../system/system.module.js';
import { CandidateStepRailController } from './candidate-step-rail.controller.js';
import { CandidateGenderService } from './candidates/candidate-gender.service.js';
import { CandidateGuardService } from './candidates/candidate-guard.service.js';
import { CandidateIdentityService } from './candidates/candidate-identity.service.js';
import { CandidateStatusService } from './candidates/candidate-status.service.js';
import { CandidateStepsController } from './candidates/candidate-steps.controller.js';
import { CandidateService } from './candidates/candidate.service.js';
import { CandidatesController } from './candidates/candidates.controller.js';
import { StepEngineTransactions } from './candidates/step-engine-tx.js';
import { ContinuousRunService } from './continuous/continuous-run.service.js';
import {
  CandidateContinuousRunsController,
  ContinuousRunsController,
} from './continuous/continuous-runs.controller.js';
import { SelectedAiEngineResolver } from './execution/selected-ai-engine.resolver.js';
import { StepExecutionService } from './execution/step-execution.service.js';
import { StepExecutor } from './execution/step-executor.js';
import { GateBasisRegistry } from './gates/gate-basis.registry.js';
import { GateValidityService } from './gates/gate-validity.service.js';
import { GateService } from './gates/gate.service.js';
import { GatesController } from './gates/gates.controller.js';
import { OwnerEditService } from './owner-edits/owner-edit.service.js';
import { AI_ENGINE_RESOLVER } from './ports/ai-engine-resolver.port.js';
import { CANDIDATE_CREATION_EXTENSION } from './ports/candidate-creation.extension.js';
import { GATE_VALIDITY } from './ports/gate-validity.port.js';
import { GENDER_INPUT_LISTENERS } from './ports/gender-input.port.js';
import { PAGE_DATA, SourcingSelectionPageData } from './ports/page-data.port.js';
import { delegatingCreationExtension, StepModulePorts } from './ports/step-module-ports.js';
import { CandidateRefetchController } from './candidates/candidate-refetch.controller.js';
import { NoComparisonController } from './no-comparison/no-comparison.controller.js';
import { NoComparisonService } from './no-comparison/no-comparison.service.js';
import { PropagationService } from './propagation/propagation.service.js';
import { StaleDiffService } from './rail/stale-diff.service.js';
import { StepRailService } from './rail/step-rail.service.js';
import { RestartRecoveryService } from './recovery/restart-recovery.service.js';
import { StepRunnerRegistry } from './runner/step-runner.registry.js';
import { StepEngineApi } from './step-engine.api.js';
import { StepRunsController } from './step-runs.controller.js';

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
 *
 * P1-05(단계 실행 엔진): 실행·버전·입력 지문·재실행 필요 전파·오너 수정·재시작 정리·단계 레일.
 * - 단계 모듈 규약: contracts/step-runner.ts(`StepRunner`·`@StepRunnerFor`)와 `StepEngineApi`(입력 대기 이어 가기·끝내기,
 *   완료 뒤 오너 입력 변경, 현재 완료 버전). 실행기는 `StepRunnerRegistry`가 DiscoveryService로 모은다(단계 모듈 import 없음)
 * - 단일 진입점: `StepExecutionService.start(candidateId, stepCode, { mode, ownerInputs, stepChainId })`
 *   (연속 실행 P1-06·일괄 M2·CLI M3도 이것을 부른다). 비동기 실행은 `StepExecutor`(M1 직렬, 테스트 `whenIdle()`)
 * - 포트: `AI_ENGINE_RESOLVER`(시작 트랜잭션 전 AI 엔진 준비, P1-10), `PAGE_DATA`(② 페이지 수집 시각, P2-02)
 * - 설정 변경 전파: `PropagationService`가 onModuleInit에서 SettingsService.setRerunPropagator로 끼운다
 *
 * P1-06(연속 실행·게이트): 여기부터 연속 실행·재실행 필요 단계 모두 실행·G2·G3 통과 기록·게이트 상태.
 * - 게이트 규약: contracts/gate-basis.ts(`GateBasisProvider`·`@GateBasisFor`) — pricing(P2-05)이 G2, thumbnails(P3-02)가
 *   G3 공급자를 등록한다(`GateBasisRegistry`, DiscoveryService). 구성값 만들기 `g2Basis`·`g3Basis`
 * - `GATE_VALIDITY` = `GateValidityService`(지문 비교). 끝 트랜잭션·오너 수정·소싱 선택 변경이 `snapshot` → 바꾸기 →
 *   `detectInvalidation`으로 무효를 알린다(SSE gate.invalidated)
 * - 통과·목록은 `GateService`(웹 화면 API 전용 — StepEngineApi로 열지 않는다, 규칙 12)
 * - 연속 실행은 `ContinuousRunService`: 계획은 순수 함수 continuous/chain-planner.ts, 이어 가기는
 *   `StepExecutionService.onChainRunSettled` 훅(프로세스 안), 재시작 때 열린 묶음은 APP_RESTART로 닫는다
 * - 실행기 선택 메서드: ③ `judgementPageCollectedAt`(6시간 규칙, P2-05), ② `refetch`(재조회 모드, P2-02)
 *
 * P1-10(AI 실행기): `AI_ENGINE_RESOLVER` = `SelectedAiEngineResolver` — AI 단계(`usesAi`) 시작 **트랜잭션 전에** system의
 * 사용 가능 판정(`AiEngineAvailabilityService.assertUsable`, C4 §3 step-engine → system) + `--version` 감지, 시작 INSERT 때
 * step_run.ai_engine·ai_model(주 작업 `aiModelKind`의 모델)·ai_cli_version을 쓴다. 실행 문맥 `pinnedAi`(PinnedAiContext)로
 * 단계 모듈이 `AiExecutor.run`을 부른다. AI 실행 오류(`AiExecutionError`)는 FAILED(AI·코드)로 닫는다. `ai.*` 설정 키는
 * 입력 지문·재실행 전파에 넣지 않는다(R9).
 *
 * P2-02(② 라쿠텐 연동): 단계 모듈 확장 자리 `StepModulePorts` — sourcing이 앱 시작 때 `StepEngineApi.register…`로
 * 'URL로 만들기' ② URL_CREATE(`CANDIDATE_CREATION_EXTENSION`)와 소싱 선택 읽기를 끼운다. `StepEngineApi.recordInlineRun`
 * (호출자 트랜잭션 안에서 버전 하나를 열고 곧바로 닫기)·`readSourcingSelection`. 재조회 `POST /candidates/{id}/refetch`
 * (`StepExecutionService.startRefetch`: ② 재조회 모드 → ③ 이력이 있으면 이어서 ③, execution_mode=STEP). 실행기 규약에
 * 선택 메서드 `beforeStart`(시작 전 단계별 409·422)와 `persist`의 커밋 뒤 훅, 입력 대기 중간 산출물(`output`)을 더했다.
 *
 * P2-03(② 소싱 비교표): `GENDER_INPUT_LISTENERS`는 `StepModulePorts.genderInputListeners`(단계 모듈이 앱 시작 때
 * `StepEngineApi.registerGenderInputListener`로 더한다). `StepEngineApi.pinnedAiOf(stepRunId)`: 입력 대기 중 백그라운드 작업
 * (② 앵커 뒤 AI 동일 상품 판정 보조)이 그 실행에 고정한 엔진으로 AI를 부른다. `recordInlineRun`은 AI 단계도 받는다
 * (AI를 부르지 않는 결과만 — ai_* NULL, ② SOURCING이 AI 단계가 되어 'URL로 만들기'가 이것을 쓴다).
 */
@Module({
  imports: [SettingsModule, IntegrationsModule, SystemModule, DiscoveryModule],
  controllers: [
    CandidatesController,
    CandidateStepsController,
    CandidateStepRailController,
    StepRunsController,
    GatesController,
    CandidateContinuousRunsController,
    ContinuousRunsController,
    CandidateRefetchController,
    NoComparisonController,
  ],
  providers: [
    StepModulePorts,
    StepEngineTransactions,
    CandidateGuardService,
    CandidateStatusService,
    CandidateIdentityService,
    CandidateGenderService,
    CandidateService,
    StepRunnerRegistry,
    StepExecutor,
    PropagationService,
    StepExecutionService,
    OwnerEditService,
    RestartRecoveryService,
    StepRailService,
    StaleDiffService,
    StepEngineApi,
    GateBasisRegistry,
    GateValidityService,
    GateService,
    ContinuousRunService,
    NoComparisonService,
    { provide: GATE_VALIDITY, useExisting: GateValidityService },
    {
      provide: CANDIDATE_CREATION_EXTENSION,
      inject: [StepModulePorts],
      useFactory: delegatingCreationExtension,
    },
    {
      provide: GENDER_INPUT_LISTENERS,
      inject: [StepModulePorts],
      useFactory: (ports: StepModulePorts) => ports.genderInputListeners,
    },
    { provide: AI_ENGINE_RESOLVER, useClass: SelectedAiEngineResolver },
    { provide: PAGE_DATA, useClass: SourcingSelectionPageData },
  ],
  exports: [
    StepEngineTransactions,
    CandidateGuardService,
    CandidateStatusService,
    CandidateIdentityService,
    CandidateGenderService,
    GATE_VALIDITY,
    StepEngineApi,
  ],
})
export class StepEngineModule {}

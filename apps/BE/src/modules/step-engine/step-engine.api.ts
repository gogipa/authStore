import { Injectable } from '@nestjs/common';
import type { StepRun } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CandidateStatusService } from './candidates/candidate-status.service.js';
import { StepEngineTransactions, type Db, type StepEngineTx } from './candidates/step-engine-tx.js';
import type { StepOutcome } from './contracts/step-runner.js';
import type { GateCode, StepCode } from './domain/steps.js';
import { StepExecutionService } from './execution/step-execution.service.js';
import { GateValidityService } from './gates/gate-validity.service.js';
import type { PinnedAiContext } from '../integrations/ai-engine/ai-executor.types.js';
import type { ReferenceInputChange } from '../settings/forwarder-rate-tables/rate-table-rerun.port.js';
import type { CandidateCreationExtension } from './ports/candidate-creation.extension.js';
import type { GenderInputListener } from './ports/gender-input.port.js';
import type {
  SourcingGenreView,
  SourcingImagesView,
  SourcingItemContentView,
  SourcingSelectionReader,
  SourcingSelectionView,
  SourcingTargetSkus,
} from './ports/sourcing-selection.port.js';
import { StepModulePorts } from './ports/step-module-ports.js';
import { PropagationService } from './propagation/propagation.service.js';

/** 게이트 하나의 최신 통과·유효성(P3-02 — 05-2 ThumbnailG3Validity 모양) */
export interface GateStateView {
  gatePassId: number | null;
  passedAt: Date | null;
  basisStepRunId: number | null;
  valid: boolean;
  changedBasisKeys: string[];
}

/** 입력 대기 실행 이어 가기(다시 run) 또는 끝내기(결과를 줌) */
export type ResumeWaitingInput =
  | { data?: unknown; outcome?: undefined; scope?: undefined }
  | { outcome: StepOutcome; scope?: StepEngineTx; data?: undefined };

/**
 * 단계 모듈(P2~P4)이 step-engine에서 쓰는 창구(P1-05). 단계 모듈이 가져오는 것은 contracts/step-runner.ts와 이것뿐이다.
 * - `resumeWaiting(stepRunId, { data })`: 입력 대기 실행을 이어 간다(RUNNING으로 되돌리고 run을 다시 돈다. ctx.resume.data)
 * - `resumeWaiting(stepRunId, { outcome, scope? })`: 입력 대기 실행을 그 결과로 끝낸다(scope를 주면 그 트랜잭션 안에서)
 *   — 예: G3 선택으로 ⑤ 완료(P1-06), ② 소싱 선택으로 ② 완료(P2-03)
 * - `ownerInputChanged(candidateId, inputKey, scope?)`: 완료 뒤 오너 입력 새 행(③ 국내 기준가·⑤ 레퍼런스 선택·URL 후보 쿠폰)
 *   → 그 키를 읽는 단계의 재실행 필요(규칙 7). 바뀐 단계를 돌려준다
 * - `currentCompletedRun(candidateId, stepCode, db?)`: 현재 버전이 COMPLETED면 그 실행, 아니면 null(앞 단계 산출물 읽기)
 * P2-02:
 * - `recordInlineRun(scope, candidateId, stepCode, outcomeFor)`: 호출자 트랜잭션 안에서 버전 하나를 열고 곧바로 닫는다
 *   (② 'URL로 만들기' URL_CREATE — 후보 만들기와 같은 트랜잭션). 외부 호출 없이 결과를 정할 때만
 * - `registerCandidateCreationExtension(ext)`·`registerSourcingSelectionReader(reader)`: 단계 모듈이 앱 시작 때 끼운다
 * - `readSourcingSelection(sourcingStepRunId, db?)`: ② 버전의 소싱 선택(③·⑤·⑥이 쓴다). 등록 전·선택 없음이면 null
 * P2-03:
 * - `registerGenderInputListener(listener)`: 오너 성별 입력(PUT …/gender)을 열린 단계에 넘기는 리스너(②·④)
 * - `pinnedAiOf(stepRunId, db?)`: 그 실행에 시작 때 고정한 AI 문맥(엔진·모델·CLI 버전 + 설정 스냅샷의 모델). 입력 대기 중
 *   백그라운드 작업(② 앵커 뒤 AI 동일 상품 판정 보조)이 `AiExecutor.run`에 넘긴다. AI를 고정하지 않은 실행이면 null
 * P2-05:
 * - `readSourcingTargetSkus(sourcingStepRunId, gender, db?)`: ② 버전의 목표 사이즈별 SKU·재고 칸(③ 판정 입력). sourcing이
 *   등록한 읽기 함수의 선택 메서드(`readTargetSkus`)를 부른다
 * P2-06:
 * - `readSourcingGenre(sourcingStepRunId, db?)`: ② 버전의 소싱 선택 상품 장르·상품유형(④ 입력). 읽기 함수의 선택 메서드
 *   `readGenre`를 부른다
 * - `refreshWaitingRunInputs(scope, stepRunId, inputKeys)`: 입력 대기 중인 실행의 입력 기록(값 해시·출처)·시작 지문을 지금
 *   값으로 다시 쓴다(④ 성별 재확인 — 같은 실행에서 이어 가는 예외, F-CA-05)
 * P3-01:
 * - `readSourcingImages(sourcingStepRunId, db?)`: ② 버전의 소싱 선택 상품 원본 이미지 출처(⑤ 원본 받기). 읽기 함수의 선택
 *   메서드 `readImages`를 부른다. ⑤는 이 값을 입력 지문에 넣지 않는다
 * - `refreshWaitingRunInputs`는 ⑤ 레퍼런스 저장(실행 중 오너 입력 `owner.referenceSelection` 해시 갱신)도 쓴다
 * P3-03:
 * - `readSourcingItemContent(sourcingStepRunId, db?)`: ② 버전의 소싱 선택 상품 상품명·설명(NFKC 글·HTML 원문)·상품/SKU 속성·
 *   선택 색상 원문(⑥-1 카피·⑥-2 사양 추출 입력). 읽기 함수의 선택 메서드 `readItemContent`를 부른다
 * P3-02:
 * - `recordOwnerEditRun(scope, candidateId, stepCode, baseStepRunId, outcomeFor)`: 호출자 트랜잭션 안에서 완료된 현재 버전을
 *   바탕으로 오너 수정(EDIT) 새 버전을 열고 `outcomeFor`의 결과로 곧바로 닫는다(⑤ 완료 뒤 G3 다시 고르기 — 새 선택은
 *   `persist`가 닫기 전에 쓴다). `outcomeFor` 안에서 새 버전에 산출물(레퍼런스 복사 등)을 쓸 수 있다
 * - `gateState(candidateId, gate, db?)`: 게이트 최신 통과·지문 유효·바뀐 구성값(⑤ 산출물 조회의 G3 유효 — 05-2
 *   ThumbnailG3Validity). 게이트 통과 자체는 여기에 열지 않는다(웹 화면 전용 `POST …/gates/{code}/pass`)
 */
@Injectable()
export class StepEngineApi {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly executions: StepExecutionService,
    private readonly propagation: PropagationService,
    private readonly status: CandidateStatusService,
    private readonly ports: StepModulePorts,
    private readonly gateValidity: GateValidityService,
  ) {}

  recordOwnerEditRun(
    scope: StepEngineTx,
    candidateId: number,
    stepCode: StepCode,
    baseStepRunId: number,
    outcomeFor: (run: StepRun) => Promise<StepOutcome>,
  ): Promise<StepRun> {
    return this.executions.recordOwnerEditRun(
      scope,
      candidateId,
      stepCode,
      baseStepRunId,
      outcomeFor,
    );
  }

  /** 게이트(G2·G3) 하나의 최신 통과와 지금 값 기준 유효성(지문 재계산) */
  async gateState(
    candidateId: number,
    gate: GateCode,
    db: Db = this.prisma,
  ): Promise<GateStateView> {
    const inspection = (await this.gateValidity.inspect(db, candidateId))[gate];
    return {
      gatePassId: inspection.latest?.id ?? null,
      passedAt: inspection.latest?.passedAt ?? null,
      basisStepRunId: inspection.latest?.basisStepRunId ?? null,
      valid: inspection.valid,
      changedBasisKeys: inspection.changedBasisKeys,
    };
  }

  recordInlineRun(
    scope: StepEngineTx,
    candidateId: number,
    stepCode: StepCode,
    outcomeFor: (run: StepRun) => Promise<StepOutcome>,
  ): Promise<StepRun> {
    return this.executions.recordInlineRun(scope, candidateId, stepCode, outcomeFor);
  }

  registerCandidateCreationExtension(extension: CandidateCreationExtension): void {
    this.ports.registerCandidateCreationExtension(extension);
  }

  registerSourcingSelectionReader(reader: SourcingSelectionReader): void {
    this.ports.registerSourcingSelectionReader(reader);
  }

  registerGenderInputListener(listener: GenderInputListener): void {
    this.ports.registerGenderInputListener(listener);
  }

  pinnedAiOf(stepRunId: number, db: Db = this.prisma): Promise<PinnedAiContext | null> {
    return this.executions.pinnedAiForRun(db, stepRunId);
  }

  async readSourcingSelection(
    sourcingStepRunId: number,
    db: Db = this.prisma,
  ): Promise<SourcingSelectionView | null> {
    const reader = this.ports.sourcingSelectionReader;
    return reader ? reader.read(db, sourcingStepRunId) : null;
  }

  /**
   * ② 버전의 소싱 선택 상품에서 목표 사이즈별 SKU·재고 칸(P2-05 — ③ 판정 입력). 읽기 함수가 없거나 선택이 없으면 null
   */
  async readSourcingTargetSkus(
    sourcingStepRunId: number,
    gender: 'MALE' | 'FEMALE',
    db: Db = this.prisma,
  ): Promise<SourcingTargetSkus | null> {
    const reader = this.ports.sourcingSelectionReader;
    return reader?.readTargetSkus ? reader.readTargetSkus(db, sourcingStepRunId, gender) : null;
  }

  /** ② 버전의 소싱 선택 상품 장르·상품유형(P2-06 — ④ 입력). 읽기 함수가 없거나 선택이 없으면 null */
  async readSourcingGenre(
    sourcingStepRunId: number,
    db: Db = this.prisma,
  ): Promise<SourcingGenreView | null> {
    const reader = this.ports.sourcingSelectionReader;
    return reader?.readGenre ? reader.readGenre(db, sourcingStepRunId) : null;
  }

  /** ② 버전의 소싱 선택 상품 원본 이미지 출처(P3-01 — ⑤ 입력). 읽기 함수가 없거나 선택이 없으면 null */
  async readSourcingImages(
    sourcingStepRunId: number,
    db: Db = this.prisma,
  ): Promise<SourcingImagesView | null> {
    const reader = this.ports.sourcingSelectionReader;
    return reader?.readImages ? reader.readImages(db, sourcingStepRunId) : null;
  }

  /** ② 버전의 소싱 선택 상품 글·속성(P3-03 — ⑥-1·⑥-2 입력). 읽기 함수가 없거나 선택이 없으면 null */
  async readSourcingItemContent(
    sourcingStepRunId: number,
    db: Db = this.prisma,
  ): Promise<SourcingItemContentView | null> {
    const reader = this.ports.sourcingSelectionReader;
    return reader?.readItemContent ? reader.readItemContent(db, sourcingStepRunId) : null;
  }

  /** 입력 대기 실행의 입력 기록 일부를 지금 값으로(P2-06 — ④ 성별 재확인). 호출자 트랜잭션 안(후보 행 잠금) */
  refreshWaitingRunInputs(
    scope: StepEngineTx,
    stepRunId: number,
    inputKeys: readonly string[],
  ): Promise<void> {
    return this.executions.refreshWaitingInputs(scope, stepRunId, inputKeys);
  }

  resumeWaiting(stepRunId: number, input: ResumeWaitingInput = {}): Promise<StepRun> {
    if (input.outcome) {
      const outcome = input.outcome;
      return input.scope
        ? this.executions.completeWaiting(input.scope, stepRunId, outcome)
        : this.transactions.run((scope) =>
            this.executions.completeWaiting(scope, stepRunId, outcome),
          );
    }
    return this.executions.resumeWaiting(stepRunId, input.data ?? null);
  }

  async ownerInputChanged(
    candidateId: number,
    inputKey: string,
    scope?: StepEngineTx,
  ): Promise<StepCode[]> {
    const apply = async (s: StepEngineTx) => {
      const changed = await this.propagation.ownerInputChanged(s, candidateId, inputKey);
      if (changed.length > 0) await this.status.reevaluate(s, candidateId);
      return changed;
    };
    return scope ? apply(scope) : this.transactions.run(apply);
  }

  referenceInputsChanged(
    changes: readonly ReferenceInputChange[],
    scope?: StepEngineTx,
  ): Promise<number> {
    const apply = (s: StepEngineTx) =>
      this.propagation.onReferenceInputsChanged(changes, s.tx, (fn) => s.afterCommit(fn));
    return scope ? apply(scope) : this.transactions.run(apply);
  }

  async currentCompletedRun(
    candidateId: number,
    stepCode: StepCode,
    db: Db = this.prisma,
  ): Promise<StepRun | null> {
    const step = await db.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId, stepCode } },
      select: { status: true, currentStepRunId: true },
    });
    if (!step || step.status !== 'COMPLETED' || step.currentStepRunId === null) return null;
    return db.stepRun.findUnique({ where: { id: step.currentStepRunId } });
  }
}

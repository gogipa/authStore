import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { Candidate, CandidateStep } from '../../../generated/prisma/client.js';
import { ForwarderRateTablesService } from '../../settings/forwarder-rate-tables/forwarder-rate-tables.service.js';
import type { ReferenceInputChange } from '../../settings/forwarder-rate-tables/rate-table-rerun.port.js';
import { PurchaseAgencyProfileService } from '../../settings/purchase-agency-profile/purchase-agency-profile.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { CandidateStatusService } from '../candidates/candidate-status.service.js';
import { StepEngineTransactions, type StepEngineTx } from '../candidates/step-engine-tx.js';
import type { Tx } from '../contracts/step-runner.js';
import { changedInputKeys, fingerprint, valueHash } from '../domain/fingerprint.js';
import { settingsKeyAffects } from '../domain/input-keys.js';
import { waitedSeconds, endTimeFor } from '../domain/run-time.js';
import { directReaders } from '../domain/step-graph.js';
import { LOCKED_STATUSES, type StepCode, type StepStatus } from '../domain/steps.js';
import { publishAfterCommit } from '../execution/step-events.js';
import {
  hashesOf,
  inputContextOf,
  loadInputRows,
  loadStepRows,
  readResolvedInputs,
} from '../execution/step-run-store.js';
import { StepRunnerRegistry } from '../runner/step-runner.registry.js';

/** 재실행 필요로 바꿀 수 있는 단계 상태(현재 버전이 있고 실행 중·실패가 아님) */
const STALEABLE: readonly StepStatus[] = ['COMPLETED', 'RERUN_REQUIRED', 'WAITING_INPUT'];

/**
 * '재실행 필요' 전파(F-BS-21, PRD §5.3 판정 규칙 3~5, 규칙 6·7).
 * - 새 버전 완료·오너 수정·이전 버전 다시 고르기(`propagateFromStep`): 그 단계의 산출물을 **직접** 읽는 단계만 지문을
 *   다시 계산해(실행기 `readInputs`) 저장된 입력 해시와 비교한다. 다르면 재실행 필요 + 바뀐 입력 이름, 같으면 그대로.
 * - 완료 뒤 오너 입력 변경(`ownerInputChanged`, ③ 국내 기준가·⑤ 레퍼런스 선택·URL 후보 ③ 쿠폰): 그 입력 키를 읽는
 *   단계의 최신 값 해시를 현재 버전의 같은 키 해시와 비교한다.
 * - 설정 변경(`onSettingsChanged`, settings.reloaded의 changedKeys): 그 설정 키를 읽은 단계만. 등록 진행 잠금 후보는
 *   건너뛴다(P1-05 Proposed).
 * - 구매대행 프로필 변경(`onProfileChanged`, P1-09): 바뀐 프로필 입력(`profile.<필드>`)을 읽은 단계만. 규칙은 설정 변경과 같다.
 * - 판정 기준 데이터 변경(`onReferenceInputsChanged`, P2-04): 새 최신 환율(`fx.*`)·활성 요금표(`forwarder.rateTable`).
 *   그 입력을 읽은 단계 가운데 **저장된 값 해시가 새 값 해시와 다른** 단계만. 나머지 규칙은 설정 변경과 같다.
 * 공통: 자동으로 다시 실행하지 않는다. 현재 버전이 없는(NOT_RUN) 단계·실행 중·실패 단계는 바꾸지 않는다.
 * 입력 대기 중이던 실행은 step_run도 RERUN_REQUIRED로 닫는다.
 */
@Injectable()
export class PropagationService implements OnModuleInit {
  private readonly logger = new Logger(PropagationService.name);

  constructor(
    private readonly registry: StepRunnerRegistry,
    private readonly settings: SettingsService,
    private readonly events: ProgressEventsService,
    private readonly status: CandidateStatusService,
    private readonly transactions: StepEngineTransactions,
    private readonly profile: PurchaseAgencyProfileService,
    private readonly rateTables: ForwarderRateTablesService,
  ) {}

  /**
   * 설정 변경 전파를 settings 모듈 포트(SETTINGS_RERUN_PROPAGATOR)에 끼운다. 설정 시작 검사(onApplicationBootstrap)보다
   * 먼저 끼워야 해서 onModuleInit에서 한다. 전파 SSE는 설정 트랜잭션이 커밋된 뒤(settings.reloaded 뒤) 보낸다.
   * 구매대행 프로필 저장의 전파(PROFILE_RERUN_PROPAGATOR, P1-09)도 같은 방식으로 끼운다.
   */
  onModuleInit(): void {
    this.settings.setRerunPropagator((changedKeys, tx, afterCommit) =>
      this.onSettingsChanged(changedKeys, tx, afterCommit),
    );
    this.profile.setRerunPropagator((changedInputKeys, tx, afterCommit) =>
      this.onProfileChanged(changedInputKeys, tx, afterCommit),
    );
    this.rateTables.setRerunPropagator((changes, tx, afterCommit) =>
      this.onReferenceInputsChanged(changes, tx, afterCommit),
    );
  }

  /** 규칙 6: `stepCode`의 값이 바뀌었다 → 직접 읽는 단계 재계산. 재실행 필요가 된(또는 사유가 늘어난) 단계를 돌려준다 */
  async propagateFromStep(
    scope: StepEngineTx,
    candidateId: number,
    stepCode: StepCode,
  ): Promise<StepCode[]> {
    const readers = directReaders(stepCode);
    if (readers.length === 0) return [];
    const candidate = await scope.tx.candidate.findUniqueOrThrow({ where: { id: candidateId } });
    const rows = await loadStepRows(scope.tx, candidateId);
    const changed: StepCode[] = [];
    for (const code of readers) {
      const row = rows.find((r) => r.stepCode === code);
      if (!row) continue;
      const diff = await this.diffStartInputs(scope.tx, candidate, rows, row);
      if (!diff || diff.changed.length === 0) continue;
      await this.markStale(scope, row, diff.changed, diff.currentFingerprint);
      changed.push(code);
    }
    return changed;
  }

  /**
   * 규칙 7: 후보 단위 오너 입력(`inputKey`)이 바뀌었다(domestic_price·thumbnail_reference_input·pricing_coupon_input 새 행).
   * 그 키를 읽는 단계의 최신 값 해시를 현재 버전의 같은 키 해시와 비교해 다르면 재실행 필요. 입력 대기 중인 단계는
   * 시작 조건 키(URL 후보 쿠폰)만 재실행 필요로 닫고, 실행 중 오너 입력 키는 정상 입력이라 그대로 둔다.
   */
  async ownerInputChanged(
    scope: StepEngineTx,
    candidateId: number,
    inputKey: string,
  ): Promise<StepCode[]> {
    const candidate = await scope.tx.candidate.findUniqueOrThrow({ where: { id: candidateId } });
    const rows = await loadStepRows(scope.tx, candidateId);
    const settings = this.settings.currentOrNull();
    if (!settings) return [];
    const changed: StepCode[] = [];
    for (const row of rows) {
      const code = row.stepCode as StepCode;
      if (!STALEABLE.includes(row.status as StepStatus) || row.currentStepRunId === null) continue;
      const runner = this.registry.get(code);
      if (!runner) continue;
      const current = await readResolvedInputs(
        runner,
        inputContextOf(scope.tx, candidate, settings, rows),
      );
      const now = current.find((input) => input.inputKey === inputKey);
      if (!now) continue;
      if (row.status === 'WAITING_INPUT' && !now.isStartCondition) continue;
      const stored = await loadInputRows(scope.tx, row.currentStepRunId);
      const keyChanged = changedInputKeys(
        hashesOf(stored, false),
        hashesOf(current, false),
      ).includes(inputKey);
      if (!keyChanged) continue;
      await this.markStale(scope, row, [inputKey], fingerprint(hashesOf(current)));
      changed.push(code);
    }
    return changed;
  }

  /**
   * 설정 변경 전파(SETTINGS_RERUN_PROPAGATOR). 새 설정 스냅샷을 만드는 트랜잭션 안에서 불린다. 바뀐 키를 읽은
   * 단계(현재 버전의 SETTINGS 시작 조건 입력이 그 키이거나 그 위·아래 키)만 재실행 필요로 둔다. 값이 바뀐 키라서 해시는
   * 다시 계산하지 않는다(새 설정은 이 트랜잭션이 끝나야 현재 설정이 된다). 잠긴 후보(등록요청중·결과확인필요·등록됨)는
   * 건너뛰고, 제외 후보는 다시 작업할 때를 위해 표시한다(P1-05 Proposed). 승인대기·검증완료 후보는 작업중으로 돌아간다.
   * @returns 재실행 필요가 된(사유가 늘어난) 후보 단계 수
   */
  async onSettingsChanged(
    changedKeys: readonly string[],
    tx: Tx,
    afterCommit: (fn: () => void) => void = () => undefined,
  ): Promise<number> {
    if (changedKeys.length === 0) return 0;
    const count = await this.markSettingsReaders(
      ({ inputKey }) => changedKeys.some((changed) => settingsKeyAffects(changed, inputKey)),
      tx,
      afterCommit,
    );
    if (count > 0) this.logger.log(`설정 변경으로 재실행 필요가 된 단계 ${count}개`);
    return count;
  }

  /**
   * 구매대행 프로필 변경 전파(PROFILE_RERUN_PROPAGATOR, P1-09). 프로필 저장 트랜잭션 안에서 불린다. 현재 버전의
   * SETTINGS 시작 조건 입력이 바뀐 프로필 입력 이름(`profile.importer` 등, 정확히 같은 이름)인 단계만 재실행 필요로
   * 둔다(⑥-3·⑨ — ⑧은 ⑥-3 HTML을 거쳐). 나머지 규칙(잠긴 후보 건너뜀·제외 후보 표시·승인대기 후보 작업중으로)은
   * 설정 변경과 같다. 자동으로 다시 실행하지 않는다.
   * @returns 재실행 필요가 된(사유가 늘어난) 후보 단계 수
   */
  async onProfileChanged(
    changedInputKeys: readonly string[],
    tx: Tx,
    afterCommit: (fn: () => void) => void = () => undefined,
  ): Promise<number> {
    if (changedInputKeys.length === 0) return 0;
    const changed = new Set(changedInputKeys);
    const count = await this.markSettingsReaders(
      ({ inputKey }) => changed.has(inputKey),
      tx,
      afterCommit,
    );
    if (count > 0) this.logger.log(`구매대행 프로필 변경으로 재실행 필요가 된 단계 ${count}개`);
    return count;
  }

  /**
   * 판정 기준 데이터 변경 전파(P2-04 규칙 10·13): 새 최신 환율(수동 입력 포함, `fx.costJpy`·`fx.customsJpy`·`fx.customsUsd`)
   * 또는 활성 요금표 교체(`forwarder.rateTable`). 그 값을 쓰는 트랜잭션 안에서 불린다. 현재 버전의 SETTINGS 시작 조건
   * 입력이 이 이름이고 **저장된 값 해시가 새 값의 해시와 다른** 단계만 재실행 필요로 둔다(같은 값이면 — 같은 고시 재수집·
   * 같은 값 수동 정정 — 그대로). 범위(Proposed, 05-1 §7.3 'P2-04 구현 결정'): 설정 변경과 같다 — 잠긴 후보는 건너뛰고,
   * 제외 후보는 표시하고, 승인대기·검증완료 후보는 작업중으로 돌아간다. 자동으로 다시 실행하지 않는다.
   * @returns 재실행 필요가 된(사유가 늘어난) 후보 단계 수
   */
  async onReferenceInputsChanged(
    changes: readonly ReferenceInputChange[],
    tx: Tx,
    afterCommit: (fn: () => void) => void = () => undefined,
  ): Promise<number> {
    if (changes.length === 0) return 0;
    const hashes = new Map(changes.map((c) => [c.inputKey, valueHash(c.value ?? null)]));
    const count = await this.markSettingsReaders(
      ({ inputKey, valueHash: stored }) => {
        const next = hashes.get(inputKey);
        return next !== undefined && next !== stored;
      },
      tx,
      afterCommit,
    );
    if (count > 0) {
      const keys = changes.map((c) => c.inputKey).join(', ');
      this.logger.log(`판정 기준(${keys}) 변경으로 재실행 필요가 된 단계 ${count}개`);
    }
    return count;
  }

  /** 현재 버전의 SETTINGS 시작 조건 입력 가운데 `affects`에 맞는 것이 있는 단계를 재실행 필요로 둔다 */
  private async markSettingsReaders(
    affects: (input: { inputKey: string; valueHash: string }) => boolean,
    tx: Tx,
    afterCommit: (fn: () => void) => void,
  ): Promise<number> {
    const scope: StepEngineTx = { tx, now: this.transactions.now(), afterCommit };
    const rows = await tx.candidateStep.findMany({
      where: {
        status: { in: [...STALEABLE] },
        currentStepRunId: { not: null },
        candidate: { status: { notIn: [...LOCKED_STATUSES] } },
      },
      orderBy: [{ candidateId: 'asc' }, { id: 'asc' }],
    });
    let count = 0;
    const touched = new Set<number>();
    for (const row of rows) {
      const inputs = await tx.stepRunInput.findMany({
        where: { stepRunId: row.currentStepRunId!, sourceType: 'SETTINGS', isStartCondition: true },
        select: { inputKey: true, valueHash: true },
      });
      const affected = inputs
        .filter(affects)
        .map((input) => input.inputKey)
        .sort();
      if (affected.length === 0) continue;
      await this.markStale(scope, row, affected, null);
      touched.add(row.candidateId);
      count += 1;
    }
    for (const candidateId of touched) await this.status.reevaluate(scope, candidateId);
    return count;
  }

  /** 현재 버전의 시작 조건 입력과 지금 값을 비교(실행기가 없으면 null) */
  private async diffStartInputs(
    tx: Tx,
    candidate: Candidate,
    rows: readonly CandidateStep[],
    row: CandidateStep,
  ): Promise<{ changed: string[]; currentFingerprint: string } | null> {
    if (!STALEABLE.includes(row.status as StepStatus) || row.currentStepRunId === null) return null;
    const runner = this.registry.get(row.stepCode as StepCode);
    const settings = this.settings.currentOrNull();
    if (!runner || !settings) return null;
    const current = await readResolvedInputs(runner, inputContextOf(tx, candidate, settings, rows));
    const stored = await loadInputRows(tx, row.currentStepRunId);
    const currentHashes = hashesOf(current);
    return {
      changed: changedInputKeys(hashesOf(stored), currentHashes),
      currentFingerprint: fingerprint(currentHashes),
    };
  }

  /**
   * 단계를 재실행 필요로 표시한다. 완료 → 재실행 필요(사유 = 바뀐 입력), 재실행 필요 → 사유를 더한다(시각 유지),
   * 입력 대기 → 열린 step_run도 RERUN_REQUIRED로 닫는다(대기 시간 누적). 커밋 뒤 SSE.
   */
  async markStale(
    scope: StepEngineTx,
    row: CandidateStep,
    changed: readonly string[],
    currentFingerprint: string | null,
  ): Promise<CandidateStep> {
    const now = scope.now;
    let closedRun = null;
    if (row.status === 'WAITING_INPUT' && row.currentStepRunId !== null) {
      const run = await scope.tx.stepRun.findUniqueOrThrow({ where: { id: row.currentStepRunId } });
      closedRun = await scope.tx.stepRun.update({
        where: { id: run.id },
        data: {
          status: 'RERUN_REQUIRED',
          rerunReasonInputs: [...changed],
          inputFingerprintEnd: currentFingerprint,
          waitSecondsTotal: run.waitSecondsTotal + waitedSeconds(run.waitingSince, now),
          waitingSince: null,
          endedAt: endTimeFor(run.startedAt, now),
        },
      });
    }
    const already = row.status === 'RERUN_REQUIRED';
    const staleInputs = already
      ? [...row.staleInputs, ...changed.filter((key) => !row.staleInputs.includes(key))]
      : [...changed];
    const updated = await scope.tx.candidateStep.update({
      where: { id: row.id },
      data: {
        status: 'RERUN_REQUIRED',
        staleInputs,
        staleSince: already ? (row.staleSince ?? now) : now,
      },
    });
    publishAfterCommit(scope, this.events, {
      run: closedRun ? { row: closedRun } : undefined,
      steps: [updated],
    });
    return updated;
  }
}

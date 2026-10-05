import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import type { Prisma, SourcingComparisonRow } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { CandidateGuardService } from '../step-engine/candidates/candidate-guard.service.js';
import {
  CandidateIdentityService,
  duplicateError,
  isActiveItemColorViolation,
  type ItemColorKey,
} from '../step-engine/candidates/candidate-identity.service.js';
import { StepEngineTransactions } from '../step-engine/candidates/step-engine-tx.js';
import type { CandidateEffects } from '../step-engine/contracts/step-runner.js';
import type { StepCode } from '../step-engine/domain/steps.js';
import { GATE_VALIDITY, type GateValidityPort } from '../step-engine/ports/gate-validity.port.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { effectiveMatch, normalizeColorCode } from './anchor-match.js';
import { needsAdultConfirmation } from './entry-checks.js';
import { type DetectedCandidateGender, resolveCandidateGender } from './gender-detection.js';
import { RakutenItemFetcher } from './rakuten-item-fetcher.js';
import type { RakutenItemWithSkus } from './rakuten-item.repository.js';
import { idPathFromNamePath } from '../integrations/rakuten/rakuten-genre.service.js';
import { anchorOfHead, SourcingComparisonRepository } from './sourcing-comparison.repository.js';
import { skusOfColor } from './stock-judgement.js';
import { anchorKeyOfHead } from './sourcing-rows.js';

/** 05-2 SourcingSelectionResult */
export interface SourcingSelectionResult {
  candidateId: number;
  sourcingComparisonId: number;
  stepRunId: number;
  stepStatus: string;
  selectedRowId: number;
  itemCode: string;
  selectedColor: string | null;
  g2Invalidated: boolean;
  staleDownstreamSteps: StepCode[];
}

type Tx = Prisma.TransactionClient;
type RowWithSnapshot = SourcingComparisonRow & { rakutenItem: RakutenItemWithSkus | null };

/** 머리 행에 남긴 자동 성별(앵커 때 판단) */
function storedDetection(head: {
  detectedGender: string | null;
  genderBasis: string | null;
}): DetectedCandidateGender | null {
  const gender = head.detectedGender;
  if (gender !== 'MALE' && gender !== 'FEMALE') return null;
  const basis = head.genderBasis;
  return {
    gender,
    basis: basis === 'KEYWORD_CID' || basis === 'GENRE_PATH' ? basis : 'ITEM_NAME',
  };
}

/** 색상 코드를 얻지 못해 앵커를 확정할 수 없다(ck_candidate_anchor_fixed, ERD §7.3-1 — 시안 샵 C) */
function colorCodeMissing(rowId: number): ApiException {
  return new ApiException('ANCHOR_KEY_MISMATCH', {
    message:
      '색상 번호를 알 수 없어 이 여정의 기준 모델·색상을 정할 수 없습니다. 상품 이름이나 상품 페이지에 색상 번호가 있는 다른 샵 상품을 골라 주세요.',
    details: { rowId, reason: 'COLOR_CODE_MISSING' },
  });
}

/**
 * 최종 후보 한 개 고르기(05-2 selectSourcingComparisonRow, F-SO-29, F-CW-02·04, P2-03 규칙 15). 고르면 곧바로 ②를 완료한다
 * (§7-25). 한 트랜잭션: 행 `is_selected`(비교표당 1행) + 머리 행 성별·아동화 신호 + ② 완료(P1-05 `resumeWaiting({ outcome })`
 * — 끝 지문·현재 버전·뒷단계 재실행 필요 전파·상태 재평가) + 후보 효과(처음이면 앵커 키 + anchor_fixed_at, item_code·
 * selected_color, ② 자동 성별 — 오너 성별은 덮어쓰지 않고 다르면 재확인 필요). G2 무효는 P1-06 지문 비교로 알아낸다
 * (다른 샵이면 `g2Invalidated=true` + SSE gate.invalidated).
 * 검사 순서(Proposed): 422 본문 → 404 비교표·행 → 다른 비교표의 행 422 → 같은 행 다시(닫힌 버전) 200 같은 응답 → 잠금·제외
 * 409 → ② 입력 대기 아님 409 STEP_RUN_NOT_WAITING_INPUT → 앵커 전(탐색) 409 ANCHOR_NOT_FIXED → 미검증 409 ROW_NOT_VERIFIED →
 * 성별 없음 409 GENDER_REQUIRED → 재고 부족 409 ROW_STOCK_INSUFFICIENT → 앵커 불일치(같은 상품이 아님·색상 코드 없음·확정 앵커와
 * 다름) 409 ANCHOR_KEY_MISMATCH → 아동화 의심·대상 외 장르인데 확인 없음 409 ADULT_CONFIRMATION_REQUIRED(머리 행 신호는
 * 남긴다 — '성인용 상품 확인'을 켜려고) → 진행 중 같은 itemCode+색상 409 CANDIDATE_DUPLICATE(`details.existingCandidateId`)
 */
@Injectable()
export class SelectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly identity: CandidateIdentityService,
    private readonly api: StepEngineApi,
    private readonly repo: SourcingComparisonRepository,
    private readonly fetcher: RakutenItemFetcher,
    private readonly settings: SettingsService,
    @Inject(GATE_VALIDITY) private readonly gates: GateValidityPort,
  ) {}

  async select(sourcingComparisonId: number, rowId: number): Promise<SourcingSelectionResult> {
    const found = await this.repo.findHead(sourcingComparisonId);
    if (!found) throw new ApiException('SOURCING_COMPARISON_NOT_FOUND');
    const rowFound = await this.prisma.sourcingComparisonRow.findUnique({
      where: { id: rowId },
      select: { sourcingComparisonId: true },
    });
    if (!rowFound) throw new ApiException('SOURCING_COMPARISON_ROW_NOT_FOUND');
    if (rowFound.sourcingComparisonId !== sourcingComparisonId) {
      throw new ApiException('VALIDATION_FAILED', {
        fieldErrors: [{ field: 'rowId', message: '이 비교표의 행이 아닙니다.' }],
      });
    }
    const candidateId = found.stepRun.candidateId;
    // 아동화 신호는 409로 막더라도 머리 행에 남긴다('성인용 상품 확인'을 켜야 한다) — 본 트랜잭션 전에 따로 쓴다
    await this.recordAdultSignals(sourcingComparisonId, rowId);
    const settings = this.settings.current();
    // 트랜잭션 안에서 정한 중복 검사 키(콜백 안 대입은 좁히기가 따라가지 않아 상자에 둔다)
    const pending: { key: ItemColorKey | null } = { key: null };
    try {
      return await this.transactions.run(async (scope) => {
        const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
        const head = (await this.repo.findHead(sourcingComparisonId, scope.tx))!;
        const row: RowWithSnapshot = await scope.tx.sourcingComparisonRow.findUniqueOrThrow({
          where: { id: rowId },
          include: { rakutenItem: { include: { skus: { orderBy: { id: 'asc' } } } } },
        });
        // 같은 행을 다시 고름(이미 완료된 버전): 변화 없이 같은 응답
        if (head.stepRun.status !== 'WAITING_INPUT' && row.isSelected) {
          return {
            candidateId,
            sourcingComparisonId,
            stepRunId: head.stepRunId,
            stepStatus: head.stepRun.status,
            selectedRowId: row.id,
            itemCode: row.itemCode,
            selectedColor: candidate.selectedColor,
            g2Invalidated: false,
            staleDownstreamSteps: [],
          };
        }
        this.guard.assertMutable(candidate);
        if (head.stepRun.status !== 'WAITING_INPUT' || !head.comparisonPerformed) {
          throw new ApiException('STEP_RUN_NOT_WAITING_INPUT');
        }
        if (head.anchorInputMethod === null) throw new ApiException('ANCHOR_NOT_FIXED');
        if (!row.isVerified || !row.rakutenItem) throw new ApiException('ROW_NOT_VERIFIED');

        // 성별(F-SO-18·19): cid → 고른 상품 페이지의 장르 경로 → 상품명, 그래도 모르면 앵커 때 판단(같은 모델). 오너 성별이 우선
        const detected =
          (await this.repo.detectGender(scope.tx, head, candidate, {
            itemName: row.itemName,
            genrePath: row.rakutenItem.genrePath,
          })) ?? storedDetection(head);
        const gender = resolveCandidateGender({
          candidate,
          detected,
          ownerGenderInStep: head.ownerGender,
        }).effective;
        if (gender === null) throw new ApiException('GENDER_REQUIRED');
        await scope.tx.sourcingComparison.update({
          where: { id: head.id },
          data: { detectedGender: detected?.gender ?? null, genderBasis: detected?.basis ?? null },
        });
        // 고른 행은 확정 성별로 다시 계산한다(목표 사이즈 범위가 바뀌었을 수 있다)
        const ctx = await this.repo.contextOf(
          scope.tx,
          { ...head, detectedGender: detected?.gender ?? head.detectedGender },
          { gender, genderSource: 'OWNER' },
          settings,
        );
        const { row: judged } = await this.repo.applySnapshot(
          scope.tx,
          row.id,
          row.rakutenItem,
          ctx,
        );
        if (judged.stockPass !== true) throw new ApiException('ROW_STOCK_INSUFFICIENT');
        if (!effectiveMatch(judged)) {
          throw new ApiException('ANCHOR_KEY_MISMATCH', {
            details: {
              rowId: row.id,
              anchorMatch: judged.anchorMatch,
              janMatch: judged.janMatch,
              makerModelMatch: judged.makerModelMatch,
              ownerMatchDecision: judged.ownerMatchDecision,
            },
          });
        }
        // 앵커 키(型番 정규화값 또는 앵커 itemCode + 색상 코드). 색상 코드가 없으면 고른 페이지의 앵커 색상 SKU 코드
        const anchor = anchorOfHead(head);
        const colorSkus = skusOfColor(row.rakutenItem.skus, {
          anchorColorCode: anchor.colorCode,
          anchorColorLabel: anchor.colorLabel,
        });
        const anchorColorCode =
          head.anchorColorCode ??
          row.colorCode ??
          colorSkus.find((s) => s.colorCode)?.colorCode ??
          null;
        if (!anchorColorCode) throw colorCodeMissing(row.id);
        const anchorKey = anchorKeyOfHead({ ...head, anchorColorCode });
        if (!anchorKey) throw colorCodeMissing(row.id);
        if (candidate.anchorFixedAt !== null) {
          const sameColor =
            normalizeColorCode(candidate.anchorColorCode) === normalizeColorCode(anchorColorCode);
          const sameModel =
            candidate.anchorModelCode !== null
              ? candidate.anchorModelCode === anchorKey.anchorModelCode
              : candidate.anchorItemCode === anchorKey.anchorItemCode;
          if (!sameColor || !sameModel) {
            throw new ApiException('ANCHOR_KEY_MISMATCH', {
              details: {
                anchorModelCode: candidate.anchorModelCode,
                anchorItemCode: candidate.anchorItemCode,
                anchorColorCode: candidate.anchorColorCode,
              },
            });
          }
        }
        const checks = this.fetcher.checksOf(
          row.rakutenItem,
          idPathFromNamePath(row.rakutenItem.genrePath),
        );
        if (checks.adultConfirmationRequired && head.adultProductConfirmedAt === null) {
          throw new ApiException('ADULT_CONFIRMATION_REQUIRED');
        }
        const selectedColor = (
          colorSkus.find((s) => s.colorLabel)?.colorLabel ??
          head.anchorColorLabel ??
          anchorColorCode
        ).slice(0, 128);
        pending.key = { itemCode: row.itemCode, selectedColor };
        await this.identity.assertNoDuplicate(scope.tx, pending.key, candidateId);

        // ── 쓰기 ──
        await scope.tx.sourcingComparisonRow.updateMany({
          where: { sourcingComparisonId: head.id, isSelected: true, id: { not: row.id } },
          data: { isSelected: false },
        });
        await scope.tx.sourcingComparisonRow.update({
          where: { id: row.id },
          data: { isSelected: true },
        });
        await scope.tx.sourcingComparison.update({
          where: { id: head.id },
          data: {
            anchorColorCode,
            childSizeSuspect: checks.childSizeSuspect,
            genreScope: checks.genreScope,
          },
        });
        const stepsBefore = await this.stepStatuses(scope.tx, candidateId);
        const gatesBefore = await this.gates.snapshot?.(scope.tx, candidateId);
        const effects: CandidateEffects = {
          sourcingSelection: { itemCode: row.itemCode, selectedColor, anchor: anchorKey },
          ...(detected ? { step2Gender: detected.gender } : {}),
        };
        if (candidate.anchorFixedAt === null) effects.anchor = anchorKey;
        const closed = await this.api.resumeWaiting(head.stepRunId, {
          scope,
          outcome: { kind: 'COMPLETED', output: { action: 'RESUMED' }, candidateEffects: effects },
        });
        const gatesAfter = await this.gates.snapshot?.(scope.tx, candidateId);
        const stepsAfter = await this.stepStatuses(scope.tx, candidateId);
        const staleDownstreamSteps = [...stepsAfter.entries()]
          .filter(
            ([code, status]) =>
              status === 'RERUN_REQUIRED' && stepsBefore.get(code) !== 'RERUN_REQUIRED',
          )
          .map(([code]) => code)
          .filter((code) => code !== 'SOURCING');
        return {
          candidateId,
          sourcingComparisonId,
          stepRunId: head.stepRunId,
          stepStatus: closed.status,
          selectedRowId: row.id,
          itemCode: row.itemCode,
          selectedColor,
          g2Invalidated:
            gatesBefore !== undefined &&
            gatesAfter !== undefined &&
            gatesBefore.G2 !== 'MISMATCH' &&
            gatesAfter.G2 === 'MISMATCH',
          staleDownstreamSteps,
        };
      });
    } catch (error) {
      // 동시 요청이 DB 부분 UNIQUE(uq_candidate_active_item_color)에 걸리면 409로(500으로 새지 않게)
      if (pending.key && isActiveItemColorViolation(error)) {
        throw duplicateError(
          await this.identity.findActiveDuplicate(this.prisma, pending.key, candidateId),
        );
      }
      throw error;
    }
  }

  /** 고를 행의 아동화 신호를 머리 행에 남긴다(입력 대기 버전만, 다른 검사 전 — 실패해도 조용히) */
  private async recordAdultSignals(sourcingComparisonId: number, rowId: number): Promise<void> {
    const row = await this.prisma.sourcingComparisonRow.findUnique({
      where: { id: rowId },
      include: {
        rakutenItem: { include: { skus: true } },
        sourcingComparison: { include: { stepRun: true } },
      },
    });
    const head = row?.sourcingComparison;
    if (!row?.rakutenItem || !head || head.stepRun.status !== 'WAITING_INPUT') return;
    if (head.adultProductConfirmedAt !== null || !head.comparisonPerformed) return;
    const checks = this.fetcher.checksOf(
      row.rakutenItem,
      idPathFromNamePath(row.rakutenItem.genrePath),
    );
    if (!checks.adultConfirmationRequired) return;
    const signals = { childSizeSuspect: checks.childSizeSuspect, genreScope: checks.genreScope };
    if (
      needsAdultConfirmation(head) &&
      head.childSizeSuspect === signals.childSizeSuspect &&
      head.genreScope === signals.genreScope
    ) {
      return;
    }
    try {
      await this.transactions.run(async (scope) => {
        await this.guard.lockForUpdate(scope.tx, head.stepRun.candidateId);
        const run = await scope.tx.stepRun.findUniqueOrThrow({ where: { id: head.stepRunId } });
        if (run.status !== 'WAITING_INPUT') return;
        await scope.tx.sourcingComparison.update({
          where: { id: sourcingComparisonId },
          data: signals,
        });
      });
    } catch {
      // 신호 기록은 보조다 — 본 검사가 같은 이유로 막는다
    }
  }

  private async stepStatuses(tx: Tx, candidateId: number): Promise<Map<StepCode, string>> {
    const rows = await tx.candidateStep.findMany({
      where: { candidateId },
      select: { stepCode: true, status: true },
    });
    return new Map(rows.map((r) => [r.stepCode as StepCode, r.status]));
  }
}

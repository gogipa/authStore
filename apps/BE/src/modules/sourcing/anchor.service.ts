import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import {
  type Candidate,
  Prisma,
  type SourcingComparison,
  type SourcingComparisonRow,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  RAKUTEN_SEARCH_PORT,
  type RakutenSearchPort,
} from '../integrations/rakuten/rakuten-search.port.js';
import { SettingsService } from '../settings/settings.service.js';
import type { AppSettings } from '../settings/schema/settings.types.js';
import { CandidateStatusService } from '../step-engine/candidates/candidate-status.service.js';
import { isLockedStatus } from '../step-engine/domain/steps.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { AI_MATCH_MAX_ROWS, AiMatchService } from './ai-match.service.js';
import {
  extractModelCode,
  isUncertain,
  normalizeColorCode,
  normalizeModelCode,
} from './anchor-match.js';
import { EXCLUSION_STOP_REASONS, exclusionAfterFetch } from './comparison-exclusion.js';
import { ComparisonScope } from './comparison-scope.js';
import type { PageFetchStopReason } from './page-fetch-loop.js';
import type { RakutenItemWithSkus } from './rakuten-item.repository.js';
import { anchorJansOf, type RowCalcContext } from './row-calculation.js';
import {
  anchorOfHead,
  SourcingComparisonRepository,
  type HeadWithRun,
} from './sourcing-comparison.repository.js';
import { apiRowCreateData } from './sourcing-comparison.store.js';
import { BackgroundJobs, JobStopped } from './sourcing-jobs.js';
import { SourcingPageFetchService } from './sourcing-page-fetch.service.js';
import type { AnchorRequest } from './sourcing-requests.js';
import { anchorKeyOfHead, filterSearchRows } from './sourcing-rows.js';

/** 05-2 SourcingJobAccepted */
export interface SourcingJobAccepted {
  candidateId: number;
  sourcingComparisonId: number;
  stepRunId: number;
  stepStatus: string;
  rowId: number | null;
}

/** '일치가 20개보다 적으면 page=2까지'(RK-03 4) */
export const PAGE2_MATCH_THRESHOLD = 20;

type AnchorColumns = Pick<
  SourcingComparison,
  | 'anchorInputMethod'
  | 'anchorItemCode'
  | 'anchorModelCode'
  | 'anchorModelCodeNorm'
  | 'anchorColorCode'
  | 'anchorColorLabel'
>;

function sameAnchor(a: AnchorColumns, b: AnchorColumns): boolean {
  return (
    (a.anchorModelCodeNorm ?? null) === (b.anchorModelCodeNorm ?? null) &&
    (a.anchorItemCode ?? null) === (b.anchorItemCode ?? null) &&
    normalizeColorCode(a.anchorColorCode) === normalizeColorCode(b.anchorColorCode)
  );
}

export function acceptedOf(head: HeadWithRun, rowId: number | null = null): SourcingJobAccepted {
  return {
    candidateId: head.stepRun.candidateId,
    sourcingComparisonId: head.id,
    stepRunId: head.stepRunId,
    stepStatus: head.stepRun.status,
    rowId,
  };
}

export function comparisonLocation(candidateId: number): string {
  return `/api/v1/candidates/${candidateId}/sourcing-comparison`;
}

/**
 * 앵커 정하기와 그 뒤 작업(05-2 fixSourcingAnchor, P2-03 규칙 1~7).
 * 동기(202 전, 한 트랜잭션): 본문 검사 422 → 404 → 잠금·제외 409 → ② 입력 대기 아님 409 STEP_RUN_NOT_WAITING_INPUT →
 * 앵커 풀기(SEARCH_PICK은 그 행의 상품명에서 型番·색상 코드, 없으면 422) → 후보에 확정된 앵커와 다름 409 ANCHOR_KEY_MISMATCH
 * → 이 버전에 이미 앵커가 있으면 같은 앵커는 같은 202(작업을 다시 돌리지 않는다), 다른 앵커는 409 ANCHOR_KEY_MISMATCH(Proposed —
 * 한 버전의 앵커는 한 번, 바꾸려면 ② 다시 실행) → 머리 행 앵커 + 행 분류 + 성별 신호.
 * 백그라운드(커밋 뒤): MATCH < 20이면 검색 page=2(6시간 캐시) → AI 동일 상품 판정 보조(NEEDS_REVIEW) → 성별을 모르면 멈춤
 * (성별 입력 대기) → P2-02 페이지 조회 반복(앵커 상품 먼저, 행마다 재고·실질가·재대조 + SSE sourcing.row-updated, 끝나면
 * sourcing.page-fetch-finished) → JAN 재대조 다시·AI(어긋난 행) → 제외 판단(Proposed, `exclusionAfterFetch`: 반복이
 * PAGE_CAP·NO_MORE_ROWS로 끝났을 때만 — 같은 상품일 수 있는 행 0 → ANCHOR_NO_MATCH, 읽은 행이 있는데 재고 통과 0 →
 * INSUFFICIENT_STOCK).
 * ② 다시 실행(후보 앵커가 확정된 버전)은 실행기 persist가 `prepareAnchored` + `startJob`을 부른다(앵커 입력 없이 이어 간다).
 */
@Injectable()
export class AnchorService {
  private readonly logger = new Logger(AnchorService.name);
  private readonly jobs = new BackgroundJobs(this.logger);
  private readonly running = new Set<number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ComparisonScope,
    private readonly status: CandidateStatusService,
    private readonly settings: SettingsService,
    private readonly api: StepEngineApi,
    @Inject(RAKUTEN_SEARCH_PORT) private readonly search: RakutenSearchPort,
    private readonly pageFetch: SourcingPageFetchService,
    private readonly repo: SourcingComparisonRepository,
    private readonly aiMatch: AiMatchService,
  ) {}

  whenIdle(): Promise<void> {
    return this.jobs.whenIdle();
  }

  // ── 동기: 앵커 저장 ──────────────────────────────────────────────────────

  async fix(sourcingComparisonId: number, request: AnchorRequest): Promise<SourcingJobAccepted> {
    const found = await this.repo.findHead(sourcingComparisonId);
    if (!found) throw new ApiException('SOURCING_COMPARISON_NOT_FOUND');
    return this.scope.forRequest(found.stepRun.candidateId, found.stepRunId, async (scope, c) => {
      const head = (await this.repo.findHead(sourcingComparisonId, scope.tx))!;
      if (!head.comparisonPerformed) throw new ApiException('STEP_RUN_NOT_WAITING_INPUT');
      const anchor = await this.resolveAnchor(scope.tx, head, request, c.candidate);
      if (head.anchorInputMethod !== null) {
        if (sameAnchor(head, anchor)) return acceptedOf(head);
        throw anchorMismatch(head);
      }
      const updated = await scope.tx.sourcingComparison.update({
        where: { id: head.id },
        data: anchor,
      });
      await this.prepareAnchored(scope.tx, updated, c.candidate);
      scope.afterCommit(() => this.startJob(head.id));
      return acceptedOf(head);
    });
  }

  /** 요청 → 머리 행 앵커 칸. 후보에 앵커가 확정돼 있으면 같아야 한다(색상 코드를 비우면 후보 색상 코드) */
  private async resolveAnchor(
    tx: Prisma.TransactionClient,
    head: SourcingComparison,
    request: AnchorRequest,
    candidate: Candidate,
  ): Promise<AnchorColumns> {
    let anchor: AnchorColumns;
    if (request.anchorInputMethod === 'SEARCH_PICK') {
      const row = await tx.sourcingComparisonRow.findUnique({
        where: {
          sourcingComparisonId_itemCode: {
            sourcingComparisonId: head.id,
            itemCode: request.anchorItemCode,
          },
        },
        include: { rakutenItem: { select: { modelCode: true, modelCodeNorm: true } } },
      });
      if (!row) {
        throw new ApiException('VALIDATION_FAILED', {
          fieldErrors: [{ field: 'anchorItemCode', message: '이 비교표에 없는 상품입니다.' }],
        });
      }
      // 型番·색상 코드: 상품명, 없으면 그 행 페이지의 メーカー型番('1201A019-108' → 1201A019 + 108)
      const extracted =
        extractModelCode(row.itemName) ??
        (row.rakutenItem?.modelCode ? extractModelCode(row.rakutenItem.modelCode) : null);
      const modelNorm = extracted?.modelCodeNorm ?? null;
      anchor = {
        anchorInputMethod: 'SEARCH_PICK',
        anchorItemCode: row.itemCode,
        anchorModelCode: modelNorm,
        anchorModelCodeNorm: modelNorm,
        anchorColorCode:
          (request.anchorColorCode ?? extracted?.colorCode ?? null)?.slice(0, 64) ?? null,
        anchorColorLabel: request.anchorColorLabel?.slice(0, 128) ?? null,
      };
    } else {
      anchor = {
        anchorInputMethod: 'CODE_ENTRY',
        anchorItemCode: null,
        anchorModelCode: request.anchorModelCode.slice(0, 128),
        anchorModelCodeNorm: request.anchorModelCodeNorm,
        anchorColorCode: request.anchorColorCode?.slice(0, 64) ?? null,
        anchorColorLabel: request.anchorColorLabel?.slice(0, 128) ?? null,
      };
    }
    if (candidate.anchorFixedAt !== null) {
      if (anchor.anchorColorCode === null) anchor.anchorColorCode = candidate.anchorColorCode;
      const key = anchorKeyOfHead(anchor);
      const same =
        key !== null &&
        normalizeColorCode(key.anchorColorCode) === normalizeColorCode(candidate.anchorColorCode) &&
        (candidate.anchorModelCode !== null
          ? key.anchorModelCode === normalizeModelCode(candidate.anchorModelCode)
          : key.anchorItemCode === candidate.anchorItemCode);
      if (!same) throw anchorMismatch(candidate);
    }
    return anchor;
  }

  /**
   * 앵커가 정해진 버전 준비(호출자 트랜잭션, 버전이 열려 있을 때): 행 분류(F-SO-09) + 성별 신호(F-SO-18, 머리 행
   * detected_gender·gender_basis). 외부 호출 없음
   */
  async prepareAnchored(
    tx: Prisma.TransactionClient,
    head: SourcingComparison,
    candidate: Pick<Candidate, 'sourceKeywordId'>,
  ): Promise<void> {
    await this.repo.classifyRows(tx, head);
    const detected = await this.repo.detectGender(tx, head, candidate);
    await tx.sourcingComparison.update({
      where: { id: head.id },
      data: { detectedGender: detected?.gender ?? null, genderBasis: detected?.basis ?? null },
    });
  }

  // ── 백그라운드 ───────────────────────────────────────────────────────────

  /** 앵커 뒤 작업을 건다(같은 비교표 작업이 돌고 있으면 무시) */
  startJob(sourcingComparisonId: number): void {
    this.jobs.run(`비교표 #${sourcingComparisonId} 앵커 뒤 작업`, () =>
      this.runJob(sourcingComparisonId),
    );
  }

  private async runJob(headId: number): Promise<void> {
    if (this.running.has(headId)) return;
    this.running.add(headId);
    try {
      const head = await this.repo.findHead(headId);
      if (!head || head.stepRun.status !== 'WAITING_INPUT' || head.anchorInputMethod === null)
        return;
      const candidateId = head.stepRun.candidateId;
      const settings = this.settings.current();
      await this.searchPage2(head, settings);
      const budget = { left: AI_MATCH_MAX_ROWS, stopped: false };
      await this.judgeUncertainRows(head, budget, { onlyUnverified: true });

      const rows = await this.prisma.sourcingComparisonRow.findMany({
        where: { sourcingComparisonId: headId },
      });
      const matchCount = rows.filter((r) => r.anchorMatch === 'MATCH').length;
      if (matchCount === 0) {
        const result = await this.pageFetch.run({
          candidateId,
          stepRunId: head.stepRunId,
          sourcingComparisonId: headId,
          rows: [],
          judgeStock: () => false,
        });
        await this.judgeExclusion(headId, result.stopReason);
        return;
      }
      const ctx = await this.context(headId, settings);
      if (ctx.gender === null) {
        this.logger.log(
          `비교표 #${headId}: 성별을 판단하지 못해 페이지 조회 전에 성별 입력을 기다립니다`,
        );
        return;
      }
      await this.scope.forJob(candidateId, head.stepRunId, (scope) =>
        this.repo.recalculateVerifiedRows(scope.tx, head, ctx).then(() => undefined),
      );
      const stopReason = await this.fetchPages(head, ctx);
      // 앵커 상품 JAN이 반복 중간에 정해졌을 수 있어 검증 행을 한 번 더 대조한다(페이지를 다시 읽지 않는다)
      const finalCtx = await this.context(headId, settings);
      await this.scope.forJob(candidateId, head.stepRunId, (scope) =>
        this.repo.recalculateVerifiedRows(scope.tx, head, finalCtx).then(() => undefined),
      );
      await this.judgeUncertainRows(head, budget, { onlyUnverified: false });
      await this.judgeExclusion(headId, stopReason);
    } finally {
      this.running.delete(headId);
    }
  }

  private async context(headId: number, settings: Readonly<AppSettings>): Promise<RowCalcContext> {
    const head = await this.prisma.sourcingComparison.findUniqueOrThrow({
      where: { id: headId },
      include: { stepRun: { include: { candidate: true } } },
    });
    return this.repo.contextOf(this.prisma, head, head.stepRun.candidate, settings);
  }

  /** '일치가 20개보다 적으면 page=2'(RK-03 4). 이미 2페이지 행이 있거나 검색어가 없으면 하지 않는다. 검색 실패는 넘어간다 */
  private async searchPage2(head: HeadWithRun, settings: Readonly<AppSettings>): Promise<void> {
    const rows = await this.prisma.sourcingComparisonRow.findMany({
      where: { sourcingComparisonId: head.id },
      select: { anchorMatch: true, searchRank: true },
    });
    const hits = settings.sourcing.rakutenApi.hits;
    const matchCount = rows.filter((r) => r.anchorMatch === 'MATCH').length;
    const hasPage2 = rows.some((r) => (r.searchRank ?? 0) > hits);
    if (matchCount >= PAGE2_MATCH_THRESHOLD || hasPage2 || !head.searchKeyword) return;
    let result;
    try {
      result = await this.search.search(
        { keyword: head.searchKeyword, page: 2 },
        { candidateId: head.stepRun.candidateId, stepRunId: head.stepRunId },
      );
    } catch (error) {
      const code = error instanceof ApiException ? error.code : (error as Error)?.name;
      this.logger.warn(`비교표 #${head.id}: 검색 2페이지를 받지 못했습니다(${code ?? 'Error'})`);
      return;
    }
    const { rows: drafts } = filterSearchRows(result.items, settings, result.fetchedAt);
    if (drafts.length === 0) return;
    await this.scope.forJob(head.stepRun.candidateId, head.stepRunId, async (scope, c) => {
      await scope.tx.sourcingComparisonRow.createMany({
        data: drafts.map((d) =>
          apiRowCreateData(head.id, { ...d, searchRank: d.searchRank + hits }),
        ),
        skipDuplicates: true,
      });
      const fresh = await scope.tx.sourcingComparison.findUniqueOrThrow({ where: { id: head.id } });
      await this.repo.classifyRows(scope.tx, fresh);
      if (fresh.detectedGender === null) {
        const detected = await this.repo.detectGender(scope.tx, fresh, c.candidate);
        if (detected) {
          await scope.tx.sourcingComparison.update({
            where: { id: head.id },
            data: { detectedGender: detected.gender, genderBasis: detected.basis },
          });
        }
      }
    });
  }

  /** P2-02 페이지 조회 반복에 재고 판정·행 갱신을 넣어 돈다. 멈춤 사유를 돌려준다 */
  private async fetchPages(head: HeadWithRun, ctx: RowCalcContext): Promise<PageFetchStopReason> {
    const candidateId = head.stepRun.candidateId;
    const rows = await this.prisma.sourcingComparisonRow.findMany({
      where: { sourcingComparisonId: head.id, anchorMatch: 'MATCH', isVerified: false },
      orderBy: { id: 'asc' },
    });
    const anchorRow = head.anchorItemCode
      ? rows.find((r) => r.itemCode === head.anchorItemCode)
      : undefined;
    const updated = new Map<number, SourcingComparisonRow>();
    let order = 0;
    const result = await this.pageFetch.run({
      candidateId,
      stepRunId: head.stepRunId,
      sourcingComparisonId: head.id,
      firstRowIds: anchorRow ? [anchorRow.id] : [],
      rows: rows.map((r) => ({
        rowId: r.id,
        anchorMatch: r.anchorMatch,
        apiItemPriceMin3Yen: r.apiItemPriceMin3Yen,
        apiItemPriceYen: r.apiItemPriceYen,
        apiPostageFlag: r.apiPostageFlag,
        searchRank: r.searchRank,
        itemUrl: r.itemUrl,
        itemCode: r.itemCode,
        shopCode: r.shopCode,
      })),
      onFetched: async (row, outcome) => {
        order += 1;
        const fetchOrder = order;
        await this.scope.forJob(candidateId, head.stepRunId, async (scope) => {
          if (outcome.kind === 'UNUSABLE') {
            const marked = await this.repo.markUnusable(
              scope.tx,
              row.rowId,
              outcome.reason,
              fetchOrder,
            );
            this.scope.publishRowUpdated(scope, candidateId, marked);
            return;
          }
          const snapshot: RakutenItemWithSkus = outcome.snapshot.item;
          if (row.itemCode === head.anchorItemCode) {
            const jans = anchorJansOf(snapshot.skus, anchorOfHead(head));
            if (jans.length > 0) ctx.anchorJans = jans;
          }
          const { row: saved } = await this.repo.applySnapshot(scope.tx, row.rowId, snapshot, ctx, {
            fetchOrder,
          });
          updated.set(row.rowId, saved);
          this.scope.publishRowUpdated(scope, candidateId, saved);
        });
      },
      judgeStock: (row) => {
        const saved = updated.get(row.rowId);
        return saved ? SourcingComparisonRepository.countsAsPassed(saved) : false;
      },
    });
    return result.stopReason;
  }

  /**
   * AI 동일 상품 판정 보조(F-BS-38, Proposed 범위): 불확실한 행(`isUncertain`) 중 결과가 없는 것을 검색 순위 순으로,
   * 작업당 `AI_MATCH_MAX_ROWS`까지. 앵커 뒤(미검증 NEEDS_REVIEW)와 조회 뒤(어긋난 검증 행) 두 번 부른다
   */
  async judgeUncertainRows(
    head: HeadWithRun,
    budget: { left: number; stopped: boolean },
    options: { onlyUnverified: boolean; rowIds?: number[] },
  ): Promise<void> {
    if (budget.left <= 0 || budget.stopped) return;
    const pinned = await this.api.pinnedAiOf(head.stepRunId);
    if (!pinned) return;
    const fresh = await this.prisma.sourcingComparison.findUniqueOrThrow({
      where: { id: head.id },
    });
    const rows = await this.prisma.sourcingComparisonRow.findMany({
      where: {
        sourcingComparisonId: head.id,
        aiMatch: { equals: Prisma.AnyNull },
        ...(options.onlyUnverified ? { isVerified: false } : {}),
        ...(options.rowIds ? { id: { in: options.rowIds } } : {}),
      },
      orderBy: [{ searchRank: 'asc' }, { id: 'asc' }],
    });
    const targets = rows.filter((r) => isUncertain(r));
    if (targets.length === 0) return;
    const anchorRow = fresh.anchorItemCode
      ? await this.prisma.sourcingComparisonRow.findUnique({
          where: {
            sourcingComparisonId_itemCode: {
              sourcingComparisonId: head.id,
              itemCode: fresh.anchorItemCode,
            },
          },
        })
      : null;
    const anchorProduct = {
      itemName: anchorRow?.itemName ?? '(型番·색상 코드로 정한 기준 상품)',
      shopName: anchorRow?.shopName ?? null,
      modelCode: fresh.anchorModelCode,
      colorCode: fresh.anchorColorCode,
      colorLabel: fresh.anchorColorLabel,
      ownerEntered: fresh.anchorInputMethod === 'CODE_ENTRY',
    };
    for (const row of targets) {
      if (budget.left <= 0 || budget.stopped) return;
      if (anchorRow && row.id === anchorRow.id) continue;
      budget.left -= 1;
      const { result, stop } = await this.aiMatch.judge(pinned, anchorProduct, {
        itemName: row.itemName,
        shopName: row.shopName,
        modelCode: row.modelCodeNorm,
        colorCode: row.colorCode,
      });
      if (stop) budget.stopped = true;
      if (!result) continue;
      await this.scope.forJob(head.stepRun.candidateId, head.stepRunId, async (scope) => {
        const saved = await scope.tx.sourcingComparisonRow.update({
          where: { id: row.id },
          data: { aiMatch: AiMatchService.toJson(result) },
        });
        this.scope.publishRowUpdated(scope, head.stepRun.candidateId, saved);
      });
    }
  }

  /**
   * 제외 판단(F-SO-21 — 시점·기준은 `exclusionAfterFetch`, Proposed): 페이지 조회 반복이 PAGE_CAP·NO_MORE_ROWS로 끝났을 때만.
   * 같은 상품일 수 있는 행(일치·확인 필요·오너 '같은 상품')이 0 → ANCHOR_NO_MATCH, 읽은 행이 있는데 재고 통과 0 →
   * INSUFFICIENT_STOCK. 전환은 step-engine 상태 재평가(F-CW-05)가 한다. ②는 입력 대기 그대로다('다시 작업' 뒤 이어 갈 수 있다)
   */
  private async judgeExclusion(headId: number, stopReason: PageFetchStopReason): Promise<void> {
    if (!EXCLUSION_STOP_REASONS.includes(stopReason)) return;
    const head = await this.repo.findHead(headId);
    if (!head) return;
    const rows = await this.prisma.sourcingComparisonRow.findMany({
      where: { sourcingComparisonId: headId },
      select: { anchorMatch: true, isVerified: true, stockPass: true, ownerMatchDecision: true },
    });
    const exclusion = exclusionAfterFetch(stopReason, rows);
    if (!exclusion) return;
    try {
      await this.scope.forJob(head.stepRun.candidateId, head.stepRunId, async (scope, c) => {
        if (isLockedStatus(c.candidate.status) || c.candidate.status === 'EXCLUDED') return;
        await this.status.reevaluate(scope, c.candidate.id, {
          stepRunId: head.stepRunId,
          exclusion,
        });
      });
    } catch (error) {
      if (!(error instanceof JobStopped)) throw error;
    }
  }
}

function anchorMismatch(current: {
  anchorModelCode: string | null;
  anchorItemCode: string | null;
  anchorColorCode: string | null;
}): ApiException {
  return new ApiException('ANCHOR_KEY_MISMATCH', {
    details: {
      anchorModelCode: current.anchorModelCode,
      anchorItemCode: current.anchorItemCode,
      anchorColorCode: current.anchorColorCode,
    },
  });
}

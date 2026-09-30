import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import { ExternalHttpGateway } from '../integrations/http/external-http.gateway.js';
import { SettingsService } from '../settings/settings.service.js';
import { AI_MATCH_MAX_ROWS } from './ai-match.service.js';
import { acceptedOf, AnchorService, type SourcingJobAccepted } from './anchor.service.js';
import { ComparisonScope } from './comparison-scope.js';
import { RakutenItemFetcher } from './rakuten-item-fetcher.js';
import { parseRakutenItemUrl } from './rakuten-url.js';
import { SourcingComparisonRepository } from './sourcing-comparison.repository.js';
import { BackgroundJobs } from './sourcing-jobs.js';

/** 진행 중 작업 이름(05-3 ALREADY_IN_PROGRESS details.job) */
export const STOCK_CHECK_JOB = 'STOCK_CHECK';
const STOCK_CHECK_LABEL = '재고 확인';

/** 한 페이지만 쓸 수 없는 실패(점검·파싱 실패·응답 없음·itemCode 못 찾음) → 그 행을 수동 확인으로 */
const UNUSABLE_CODES = ['EXTERNAL_API_ERROR', 'RAKUTEN_ITEM_CODE_UNRESOLVED'];

/**
 * 미검증 행 '재고 확인'(05-2 requestSourcingRowStockCheck, F-SO-15·16, P2-03 규칙 12). 그 행의 상품 페이지만 읽는다
 * (P2-02 `RakutenItemFetcher` — 관문 RAKUTEN_PAGE 직렬 큐·하루 상한 1건, `fetch_reason=STOCK_CHECK`). 이미 검증한 행도
 * 누르면 새로 읽는다(새 스냅샷).
 * 검사 순서(202 전): 404 행 → 잠금·제외 409 → ② 입력 대기 아님 409 STEP_RUN_NOT_WAITING_INPUT → 앵커 없음 409
 * ANCHOR_NOT_FIXED(Proposed — 앵커 색상을 몰라 재고를 판정할 수 없다) → 같은 행 진행 중 409 ALREADY_IN_PROGRESS
 * (`details.job=STOCK_CHECK`) → 하루 상한·쉼 409(`assertCallable`). 결과는 SSE `sourcing.row-updated`(HTTP 응답 없음):
 * 행에 스냅샷을 잇고 검증·재고·실질가·재대조, 쓸 수 없는 페이지면 수동 확인. 규칙으로 불확실하면 AI 보조 한 번.
 */
@Injectable()
export class StockCheckService {
  private readonly logger = new Logger(StockCheckService.name);
  private readonly jobs = new BackgroundJobs(this.logger);
  private readonly inProgress = new Set<number>();

  constructor(
    private readonly scope: ComparisonScope,
    private readonly repo: SourcingComparisonRepository,
    private readonly fetcher: RakutenItemFetcher,
    private readonly gateway: ExternalHttpGateway,
    private readonly settings: SettingsService,
    private readonly anchors: AnchorService,
  ) {}

  whenIdle(): Promise<void> {
    return this.jobs.whenIdle();
  }

  async request(rowId: number): Promise<SourcingJobAccepted> {
    const found = await this.repo.findRow(rowId);
    if (!found) throw new ApiException('SOURCING_COMPARISON_ROW_NOT_FOUND');
    const head = found.sourcingComparison;
    const candidateId = head.stepRun.candidateId;
    let claimed = false;
    let accepted: SourcingJobAccepted;
    try {
      accepted = await this.scope.forRequest(candidateId, head.stepRunId, async (_scope, c) => {
        if (head.anchorInputMethod === null) throw new ApiException('ANCHOR_NOT_FIXED');
        if (this.inProgress.has(rowId)) {
          throw new ApiException('ALREADY_IN_PROGRESS', {
            message: formatErrorMessage('ALREADY_IN_PROGRESS', { 작업: STOCK_CHECK_LABEL }),
            details: { job: STOCK_CHECK_JOB, rowId },
          });
        }
        // 확인과 표시 사이에 await가 없다 — 겹친 요청은 하나만 지난다
        this.inProgress.add(rowId);
        claimed = true;
        await this.gateway.assertCallable('RAKUTEN_PAGE');
        return acceptedOf({ ...head, stepRun: c.run }, rowId);
      });
    } catch (error) {
      if (claimed) this.inProgress.delete(rowId);
      throw error;
    }
    this.jobs.run(`비교표 행 #${rowId} 재고 확인`, async () => {
      try {
        await this.check(rowId);
      } finally {
        this.inProgress.delete(rowId);
      }
    });
    return accepted;
  }

  private async check(rowId: number): Promise<void> {
    const found = await this.repo.findRow(rowId);
    if (!found) return;
    const head = found.sourcingComparison;
    const candidateId = head.stepRun.candidateId;
    const url = parseRakutenItemUrl(found.itemUrl);
    if (!url) {
      await this.scope.forJob(candidateId, head.stepRunId, async (scope) => {
        const marked = await this.repo.markUnusable(scope.tx, rowId, 'URL_INVALID');
        this.scope.publishRowUpdated(scope, candidateId, marked);
      });
      return;
    }
    let snapshot;
    try {
      snapshot = await this.fetcher.fetchSnapshot(url, {
        entrySource: found.rowSource === 'MANUAL' ? 'MANUAL' : 'API',
        fetchReason: 'STOCK_CHECK',
        candidateId,
        stepRunId: head.stepRunId,
        knownItemCode: { itemCode: found.itemCode, shopCode: found.shopCode },
      });
    } catch (error) {
      if (error instanceof ApiException && UNUSABLE_CODES.includes(error.code)) {
        const reason = error.details?.reason;
        await this.scope.forJob(candidateId, head.stepRunId, async (scope) => {
          const marked = await this.repo.markUnusable(
            scope.tx,
            rowId,
            typeof reason === 'string' ? reason : error.code,
          );
          this.scope.publishRowUpdated(scope, candidateId, marked);
        });
        return;
      }
      // 하루 상한·쉼(202 뒤에 닿음)은 행을 바꾸지 않는다 — 화면은 오늘 조회 수(call-usage)로 안다
      const code = error instanceof ApiException ? error.code : (error as Error)?.name;
      this.logger.warn(`비교표 행 #${rowId} 재고 확인을 하지 못했습니다(${code ?? 'Error'})`);
      return;
    }
    const settings = this.settings.current();
    await this.scope.forJob(candidateId, head.stepRunId, async (scope, c) => {
      const fresh = await scope.tx.sourcingComparison.findUniqueOrThrow({ where: { id: head.id } });
      const ctx = await this.repo.contextOf(scope.tx, fresh, c.candidate, settings);
      const { row } = await this.repo.applySnapshot(scope.tx, rowId, snapshot.item, ctx);
      this.scope.publishRowUpdated(scope, candidateId, row);
    });
    await this.anchors.judgeUncertainRows(
      head,
      { left: Math.min(1, AI_MATCH_MAX_ROWS), stopped: false },
      { onlyUnverified: false, rowIds: [rowId] },
    );
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { findChildTerm } from '../../common/child-shoe/child-shoe.rules.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import { ProgressEventsService } from '../../common/events/progress-events.service.js';
import { formatKstDateTime, secondsUntilNextKstMidnight } from '../../common/time/kst.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CallUsageService } from '../integrations/call-usage/call-usage.service.js';
import {
  DATALAB_RANK_PORT,
  type DatalabRankPageResponse,
  type DatalabRankPort,
} from '../integrations/datalab/datalab-rank.port.js';
import { CLOCK, type Clock } from '../integrations/http/clock.token.js';
import {
  DAILY_LIMIT_PROVIDER,
  type DailyLimitProvider,
} from '../integrations/http/daily-limit.provider.js';
import { EXTERNAL_TARGETS } from '../integrations/http/external-targets.js';
import { SettingsService } from '../settings/settings.service.js';
import { type CollectionPeriod, collectionPeriod, rangeMatches } from './collection-period.js';
import { classifyDatalabResponse, describeDatalabResponse } from './datalab-response.js';
import type { KeywordCollectionAcceptedDto } from './dto/keyword-snapshot.dto.js';
import { KeywordRepository, toDateValue } from './keyword.repository.js';
import {
  isStructureChangeReason,
  KEYWORD_COLLECTION_JOB,
  KEYWORD_COLLECTION_JOB_LABEL,
  KEYWORD_COLLECTION_LOCK_SQL,
  type KeywordAbortReason,
  RESPONSE_RANGE_MAX_LENGTH,
  type RankLimit,
} from './keywords.constants.js';

/** 버튼 수집 한 번의 계획(시작 때 설정 스냅샷으로 고정) */
export interface CollectionPlan {
  snapshotId: number;
  cids: readonly string[];
  period: CollectionPeriod;
  rankLimit: RankLimit;
  pageSize: number;
  pagesPerCid: number;
  requestsTotal: number;
  intervalMs: number;
  childTerms: readonly string[];
}

/** 수집 범위 → cid당 페이지 수(설정 pageSize·maxPage). 100위 = 5, 500위 = 25(count 20) */
export function pagesPerCidOf(rankLimit: number, pageSize: number, maxPage: number): number {
  return Math.max(1, Math.min(Math.ceil(rankLimit / pageSize), maxPage));
}

/** 응답 range 원문(40자까지) */
function clipRange(range: string): string {
  return [...range].slice(0, RESPONSE_RANGE_MAX_LENGTH).join('');
}

/**
 * 데이터랩 버튼 수집(F-KW-01~04·06·07, F-BS-33, P2-01 규칙 1~8).
 * 오너가 '수집'을 누를 때만 1회 돈다: RUNNING 묶음 저장 → 202 → 백그라운드로 cid(50000173 → 50000174) → page(1~N)를
 * **하나씩** 부른다. 요청 사이 설정 간격(2초 이상, `CLOCK.sleep`)을 둔다. 예약·자동 반복·병렬·재시도·백오프는 없다.
 * - 페이지마다 키워드 줄을 저장하고(아동 단어는 excluded_reason CHILD) SSE `keyword-collection.progress`
 * - `ranks: []`나 요청 크기보다 적은 페이지는 그 cid의 끝 → 다음 cid
 * - 이상 8종이면 곧바로 ABORTED(사유·HTTP 상태) + SSE `keyword-collection.aborted`. 403·418·429 뒤 24시간 쉼은 관문이
 *   call_log로 기록한다(판단 원본도 call_log)
 * - 다 끝나면 COMPLETED(응답 range 원문·대조 결과) + SSE `keyword-collection.completed`
 * - 응답을 받지 못함(시간 초과·연결 실패)은 NETWORK_ERROR, 그 밖에 도중에 멈추면 INTERRUPTED로 닫는다(Proposed — RUNNING이
 *   남아 ALREADY_IN_PROGRESS로 계속 막히지 않게). 앱이 꺼진 뒤의 RUNNING은 재시작 정리(`KeywordCollectionRecovery`)가 닫는다
 * 시계·대기는 `CLOCK` 토큰(P1-01 — now·sleep)으로 받는다. 테스트는 가짜 시계로 바꾼다.
 */
@Injectable()
export class KeywordCollectionService {
  private readonly logger = new Logger(KeywordCollectionService.name);
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: KeywordRepository,
    private readonly settings: SettingsService,
    private readonly usage: CallUsageService,
    private readonly events: ProgressEventsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DATALAB_RANK_PORT) private readonly port: DatalabRankPort,
    @Inject(DAILY_LIMIT_PROVIDER) private readonly dailyLimit: DailyLimitProvider,
  ) {}

  /**
   * 버튼 수집 시작(202). 검사 순서(Proposed): 설정 없음 503 → 수집 중 409 ALREADY_IN_PROGRESS → 24시간 쉼 409
   * EXTERNAL_CALL_COOLDOWN → 오늘 남은 요청이 이번 요청 수보다 적음 409 DAILY_LIMIT_REACHED → RUNNING 묶음 저장(잠금 안에서
   * 수집 중을 한 번 더 본다).
   */
  async start(input: { rankLimit: RankLimit }): Promise<KeywordCollectionAcceptedDto> {
    const settings = this.settings.current();
    const config = settings.keywords.datalab;
    await this.assertNotRunning();
    const now = this.clock.now();
    await this.assertNotCoolingDown(now);

    const cids = [...config.defaultCids];
    const pagesPerCid = pagesPerCidOf(input.rankLimit, config.pageSize, config.maxPage);
    const requestsTotal = cids.length * pagesPerCid;
    await this.assertDailyBudget(now, requestsTotal);

    const period = collectionPeriod(now);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(KEYWORD_COLLECTION_LOCK_SQL);
      await this.assertNotRunning(tx);
      return tx.keywordSnapshot.create({
        data: {
          method: 'BUTTON',
          collectedAt: now,
          requestedCids: cids,
          periodStart: toDateValue(period.startDate),
          periodEnd: toDateValue(period.endDate),
          rankLimit: input.rankLimit,
          status: 'RUNNING',
        },
      });
    });
    const plan: CollectionPlan = {
      snapshotId: row.id,
      cids,
      period,
      rankLimit: input.rankLimit,
      pageSize: config.pageSize,
      pagesPerCid,
      requestsTotal,
      intervalMs: Math.round(config.requestIntervalSeconds * 1000),
      childTerms: [...settings.safety.childKeywords],
    };
    this.enqueue(plan);
    return {
      keywordSnapshotId: row.id,
      status: 'RUNNING',
      rankLimit: input.rankLimit,
      requestedCids: cids,
    };
  }

  /** 백그라운드 수집이 끝날 때까지(테스트·종료 정리용) */
  async whenIdle(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.tail;
      await current;
    } while (current !== this.tail);
  }

  private async assertNotRunning(db?: Parameters<KeywordRepository['findRunning']>[0]) {
    const running = await this.repo.findRunning(db);
    if (!running) return;
    throw new ApiException('ALREADY_IN_PROGRESS', {
      message: formatErrorMessage('ALREADY_IN_PROGRESS', { 작업: KEYWORD_COLLECTION_JOB_LABEL }),
      details: { job: KEYWORD_COLLECTION_JOB, keywordSnapshotId: running.id },
    });
  }

  /** 24시간 쉼(call_log 기준, 규칙 7). 버튼 수집만 막는다 — 붙여넣기는 된다 */
  private async assertNotCoolingDown(now: Date): Promise<void> {
    const cooldown = await this.usage.activeCooldown('DATALAB', now);
    if (!cooldown) return;
    const retryAfter = Math.max(
      1,
      Math.ceil((cooldown.blockedUntil.getTime() - now.getTime()) / 1000),
    );
    throw new ApiException('EXTERNAL_CALL_COOLDOWN', {
      message: formatErrorMessage('EXTERNAL_CALL_COOLDOWN', {
        대상: EXTERNAL_TARGETS.DATALAB.label,
        시각: formatKstDateTime(cooldown.blockedUntil),
      }),
      details: {
        target: 'DATALAB',
        blockedUntil: cooldown.blockedUntil.toISOString(),
        httpStatus: cooldown.httpStatus,
      },
      headers: { 'Retry-After': String(retryAfter) },
    });
  }

  /**
   * 하루 상한(Proposed): 도중에 상한에 걸려 반쪽 수집이 되지 않게, 오늘 남은 요청이 이번 수집 요청 수(100위 10·500위 50)보다
   * 적으면 시작하지 않는다(409 DAILY_LIMIT_REACHED, details.required·remaining).
   */
  private async assertDailyBudget(now: Date, required: number): Promise<void> {
    const limit = this.dailyLimit('DATALAB');
    if (limit === null) return;
    const used = await this.usage.countToday('DATALAB', now);
    if (used + required <= limit) return;
    throw new ApiException('DAILY_LIMIT_REACHED', {
      message: formatErrorMessage('DAILY_LIMIT_REACHED', {
        대상: EXTERNAL_TARGETS.DATALAB.label,
        n: limit,
      }),
      details: {
        target: 'DATALAB',
        dailyLimit: limit,
        required,
        remaining: Math.max(0, limit - used),
      },
      headers: { 'Retry-After': String(secondsUntilNextKstMidnight(now)) },
    });
  }

  private enqueue(plan: CollectionPlan): void {
    const job = this.tail.then(() => this.execute(plan));
    this.tail = job.catch((e: unknown) => {
      this.logger.error({ err: e }, '키워드 수집이 예외로 끝났습니다');
    });
  }

  /** 수집 실행(cid → page 차례). 예외가 나도 묶음을 RUNNING으로 두지 않는다 */
  private async execute(plan: CollectionPlan): Promise<void> {
    const state = { responseRange: null as string | null, rangeMatched: null as boolean | null };
    try {
      let requestsDone = 0;
      for (const cid of plan.cids) {
        for (let page = 1; page <= plan.pagesPerCid; page += 1) {
          if (requestsDone > 0) await this.clock.sleep(plan.intervalMs);
          let response: DatalabRankPageResponse;
          try {
            response = await this.port.fetchRankPage(
              { cid, startDate: plan.period.startDate, endDate: plan.period.endDate, page },
              {
                describe: (res) => describeDatalabResponse(res, { page, pageSize: plan.pageSize }),
              },
            );
          } catch (e) {
            const reason: KeywordAbortReason =
              e instanceof ApiException && e.code === 'EXTERNAL_API_ERROR'
                ? 'NETWORK_ERROR'
                : 'INTERRUPTED';
            if (!(e instanceof ApiException)) {
              this.logger.error({ err: e }, `데이터랩 요청 실패(cid ${cid}, page ${page})`);
            } else {
              this.logger.warn(`데이터랩 요청이 멈췄습니다(${e.code}, cid ${cid}, page ${page})`);
            }
            await this.abort(plan, reason, null, state);
            return;
          }
          requestsDone += 1;
          const verdict = classifyDatalabResponse(response, { page, pageSize: plan.pageSize });
          if (verdict.kind !== 'ABORT' && verdict.range !== null) {
            state.responseRange ??= clipRange(verdict.range);
            const matched = rangeMatches(verdict.range, plan.period);
            state.rangeMatched = (state.rangeMatched ?? true) && matched;
          }
          if (verdict.kind === 'ABORT') {
            await this.abort(plan, verdict.reason, verdict.httpStatus, state);
            return;
          }
          if (verdict.kind === 'OK') {
            await this.repo.insertKeywords(
              plan.snapshotId,
              verdict.entries.map((e) => ({
                cid,
                rank: e.rank,
                keyword: e.keyword,
                excluded: findChildTerm(e.keyword, plan.childTerms) !== null,
              })),
            );
          }
          this.events.publish('keyword-collection.progress', {
            keywordSnapshotId: plan.snapshotId,
            cid,
            page,
            pagesPerCid: plan.pagesPerCid,
            requestsDone,
            requestsTotal: plan.requestsTotal,
          });
          if (verdict.kind === 'END' || verdict.lastPage) break;
        }
      }
      await this.repo.complete(plan.snapshotId, state);
      const counts = (await this.repo.countsOf([plan.snapshotId])).get(plan.snapshotId)!;
      this.events.publish('keyword-collection.completed', {
        keywordSnapshotId: plan.snapshotId,
        keywordCount: counts.keywordCount,
        excludedCount: counts.excludedCount,
        rangeMatched: state.rangeMatched,
      });
    } catch (e) {
      this.logger.error({ err: e }, `키워드 수집 #${plan.snapshotId}이 도중에 멈췄습니다`);
      await this.abort(plan, 'INTERRUPTED', null, state).catch((err: unknown) => {
        this.logger.error({ err }, `키워드 수집 #${plan.snapshotId}을 닫지 못했습니다`);
      });
    }
  }

  /** ABORTED로 닫고 SSE `keyword-collection.aborted`(구조 변경 의심·24시간 쉼 포함) */
  private async abort(
    plan: CollectionPlan,
    reason: KeywordAbortReason,
    httpStatus: number | null,
    state: { responseRange: string | null; rangeMatched: boolean | null },
  ): Promise<void> {
    const closed = await this.repo.abort(plan.snapshotId, { reason, httpStatus, ...state });
    if (!closed) return;
    const cooldown = await this.usage.activeCooldown('DATALAB', this.clock.now());
    this.events.publish('keyword-collection.aborted', {
      keywordSnapshotId: plan.snapshotId,
      abortReason: reason,
      httpStatus,
      structureChangeSuspected: isStructureChangeReason(reason),
      blockedUntil: cooldown ? cooldown.blockedUntil.toISOString() : null,
    });
    this.logger.warn(`키워드 수집 #${plan.snapshotId} 중단: ${reason}`);
  }
}

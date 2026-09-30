import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import {
  COMMERCE_SECRET_KEYS,
  type CommerceSecretKey,
  secretKeysLabel,
} from '../../../common/secrets/secret-keys.js';
import { scrubKnownSecrets } from '../../../common/secrets/secret-mask.js';
import { SECRET_STORE, type SecretStore } from '../../../common/secrets/secret-store.port.js';
import type { CommerceMetaSyncRun, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../http/clock.token.js';
import { CommerceApiClient } from '../naver-commerce/commerce-api.client.js';
import { CommerceMetaApi, MetaFetchError } from './commerce-meta-api.js';
import { CommerceMetaCacheService } from './commerce-meta-cache.service.js';
import {
  META_SYNC_ERROR_MESSAGE_MAX,
  META_SYNC_JOB,
  META_SYNC_JOB_LABEL,
  META_SYNC_TARGETS,
  type MetaSyncRunStatus,
  type MetaSyncTarget,
} from './commerce-meta.constants.js';
import type {
  CommerceMetaSyncRunDto,
  CommerceMetaSyncStatusListDto,
  CommerceMetaSyncTargetStatusDto,
} from './dto/commerce-meta-sync.dto.js';
import { MetaMappingError } from './mappers/mapper-utils.js';
import { META_TARGET_SYNCERS } from './syncers/index.js';
import { MetaPrerequisiteError } from './syncers/meta-target-syncer.js';

/** 대상 run 행 만들기를 한 번에 하나만(같은 대상 RUNNING 두 개 방지). 값은 임의의 고정 수 */
const META_SYNC_LOCK_SQL = 'SELECT pg_advisory_xact_lock(8010808)';

/** 캐시 쓰기 트랜잭션 제한 시간(카테고리 수천 행 upsert) */
const APPLY_TX_OPTIONS = { maxWait: 10_000, timeout: 120_000 } as const;

/** 남은 대상을 부르지 않고 같은 사유로 닫는 오류(키 없음·키체인·인증 실패 — 대상마다 되풀이해도 같다) */
const FATAL_ERROR_CODES = ['SECRET_NOT_CONFIGURED', 'KEYCHAIN_UNAVAILABLE', 'COMMERCE_AUTH_FAILED'];

export function toMetaSyncRunDto(row: CommerceMetaSyncRun): CommerceMetaSyncRunDto {
  return {
    id: row.id,
    target: row.target as MetaSyncTarget,
    status: row.status as MetaSyncRunStatus,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    itemCount: row.itemCount,
    errorMessage: row.errorMessage,
  };
}

/** 대상들을 실행 순서(05-2 enum 순서, CATEGORY 먼저)로 */
export function orderMetaTargets(targets: readonly MetaSyncTarget[]): MetaSyncTarget[] {
  return META_SYNC_TARGETS.filter((t) => targets.includes(t));
}

/** 실패 사유(error_message): 비밀 없는 한 줄. 알 수 없는 예외는 내부 오류 문구로(원 예외는 로그에만) */
export function metaSyncErrorMessage(error: unknown): string {
  const known =
    error instanceof ApiException ||
    error instanceof MetaFetchError ||
    error instanceof MetaMappingError ||
    error instanceof MetaPrerequisiteError;
  const message = known
    ? error.message
    : '받은 메타데이터를 저장하지 못했습니다(앱 내부 오류). 로그를 확인해 주세요.';
  const scrubbed = scrubKnownSecrets(message).trim() || '알 수 없는 오류';
  return scrubbed.length > META_SYNC_ERROR_MESSAGE_MAX
    ? scrubbed.slice(0, META_SYNC_ERROR_MESSAGE_MAX)
    : scrubbed;
}

function isKnownError(error: unknown): boolean {
  return (
    error instanceof ApiException ||
    error instanceof MetaFetchError ||
    error instanceof MetaMappingError ||
    error instanceof MetaPrerequisiteError
  );
}

function isFatalError(error: unknown): boolean {
  return error instanceof ApiException && FATAL_ERROR_CODES.includes(error.code);
}

type MetaDbReader = Pick<Prisma.TransactionClient, 'commerceMetaSyncRun'>;

/**
 * 메타데이터 동기화(P1-08, F-BS-48·F-SY-03). 수동(`POST /commerce-meta-sync-runs`)과 하루 1회 자동이 같은 서비스를 쓴다.
 * 흐름: 대상 검증(DTO) → 진행 중 확인(DB RUNNING) → 커머스 키 확인 → 대상별 run 행 RUNNING(한 트랜잭션, 잠금)
 *      → 202 → 백그라운드로 대상 차례 실행 → 대상마다 run 마감 + SSE `commerce-meta-sync.completed`.
 * - 대상 하나: 외부 호출을 모두 끝낸 뒤(트랜잭션 밖) 캐시 쓰기 + removed_at + run SUCCEEDED를 한 트랜잭션으로(규칙 5).
 *   실패하면 run만 FAILED(error_message)로 닫고 이전 캐시는 그대로다.
 * - 대상 하나가 실패해도 나머지는 계속한다(Proposed). 다만 키 없음·키체인·인증 실패는 남은 대상도 같은 사유로 닫는다.
 * - 실행은 프로세스 안 한 줄(직렬)로 돈다. 커머스API 호출이 겹치지 않는다(규칙 15). 테스트는 `whenIdle()`로 기다린다.
 */
@Injectable()
export class CommerceMetaSyncService {
  private readonly logger = new Logger(CommerceMetaSyncService.name);
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    private readonly events: ProgressEventsService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly client: CommerceApiClient,
    private readonly cache: CommerceMetaCacheService,
  ) {}

  /** 대상 8개의 최신 실행과 마지막 성공 시각(05-2 순서, 규칙 8) */
  async latest(): Promise<CommerceMetaSyncStatusListDto> {
    const items = await Promise.all(
      META_SYNC_TARGETS.map(async (target): Promise<CommerceMetaSyncTargetStatusDto> => {
        const [latestRun, lastSucceeded] = await Promise.all([
          this.prisma.commerceMetaSyncRun.findFirst({
            where: { target },
            orderBy: { id: 'desc' },
          }),
          this.prisma.commerceMetaSyncRun.findFirst({
            where: { target, status: 'SUCCEEDED' },
            orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
            select: { finishedAt: true },
          }),
        ]);
        return {
          target,
          latestRun: latestRun ? toMetaSyncRunDto(latestRun) : null,
          lastSucceededAt: lastSucceeded?.finishedAt?.toISOString() ?? null,
        };
      }),
    );
    return { items };
  }

  /**
   * 지금 동기화(수동). 요청 대상 중 RUNNING이 있으면 409 ALREADY_IN_PROGRESS(details.job=META_SYNC·targets),
   * 커머스 키가 없으면 409 SECRET_NOT_CONFIGURED, 키체인 오류는 503 KEYCHAIN_UNAVAILABLE. 만든 RUNNING 행을 돌려준다.
   */
  async start(targets?: readonly MetaSyncTarget[]): Promise<CommerceMetaSyncRunDto[]> {
    const wanted = orderMetaTargets(targets ?? META_SYNC_TARGETS);
    await this.assertNotRunning(this.prisma, wanted);
    await this.assertCommerceKeys();
    const runs = await this.openRuns(wanted);
    this.enqueue(runs);
    return runs.map(toMetaSyncRunDto);
  }

  /**
   * 자동 실행(스케줄러). 커머스 키가 없으면 조용히 건너뛰고(Proposed) null. 키체인 오류·진행 중이면 건너뛴다(경고 로그).
   */
  async startAuto(targets: readonly MetaSyncTarget[]): Promise<CommerceMetaSyncRunDto[] | null> {
    const wanted = orderMetaTargets(targets);
    if (wanted.length === 0) return null;
    try {
      await this.assertCommerceKeys();
      const runs = await this.openRuns(wanted);
      this.enqueue(runs);
      return runs.map(toMetaSyncRunDto);
    } catch (e) {
      if (e instanceof ApiException && e.code === 'SECRET_NOT_CONFIGURED') return null;
      if (e instanceof ApiException) {
        this.logger.warn(`메타데이터 자동 동기화를 건너뜁니다(${e.code}).`);
        return null;
      }
      throw e;
    }
  }

  /** 백그라운드 실행이 모두 끝날 때까지 기다린다(테스트·종료 정리용) */
  async whenIdle(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.tail;
      await current;
    } while (current !== this.tail);
  }

  private async assertNotRunning(db: MetaDbReader, targets: readonly MetaSyncTarget[]) {
    const running = await db.commerceMetaSyncRun.findMany({
      where: { status: 'RUNNING', target: { in: [...targets] } },
      select: { target: true },
    });
    if (running.length === 0) return;
    const busy = orderMetaTargets(running.map((r) => r.target as MetaSyncTarget));
    throw new ApiException('ALREADY_IN_PROGRESS', {
      message: formatErrorMessage('ALREADY_IN_PROGRESS', { 작업: META_SYNC_JOB_LABEL }),
      details: { job: META_SYNC_JOB, targets: busy },
    });
  }

  /** 커머스 키 두 개가 키체인에 있는지(값은 쓰지 않는다). 없으면 409, 키체인 오류는 503(저장소가 던진다) */
  private async assertCommerceKeys(): Promise<void> {
    const values = await Promise.all(COMMERCE_SECRET_KEYS.map((key) => this.secrets.get(key)));
    const missing: CommerceSecretKey[] = COMMERCE_SECRET_KEYS.filter((_, i) => !values[i]);
    if (missing.length === 0) return;
    throw new ApiException('SECRET_NOT_CONFIGURED', {
      message: formatErrorMessage('SECRET_NOT_CONFIGURED', { '키 이름': secretKeysLabel(missing) }),
      details: { secretKeys: missing },
    });
  }

  /** 대상별 RUNNING 행을 한 트랜잭션에서 만든다. 잠금 뒤 한 번 더 진행 중을 본다(동시 요청) */
  private openRuns(targets: readonly MetaSyncTarget[]): Promise<CommerceMetaSyncRun[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(META_SYNC_LOCK_SQL);
      await this.assertNotRunning(tx, targets);
      const startedAt = this.clock.now();
      const runs: CommerceMetaSyncRun[] = [];
      for (const target of targets) {
        runs.push(
          await tx.commerceMetaSyncRun.create({ data: { target, status: 'RUNNING', startedAt } }),
        );
      }
      return runs;
    });
  }

  private enqueue(runs: readonly CommerceMetaSyncRun[]): void {
    const job = this.tail.then(() => this.execute(runs));
    this.tail = job.catch((e: unknown) => {
      this.logger.error({ err: e }, '메타데이터 동기화 실행이 예외로 끝났습니다');
    });
  }

  /** 대상 차례 실행. 한 대상이 실패해도 다음으로 간다 */
  private async execute(runs: readonly CommerceMetaSyncRun[]): Promise<void> {
    const api = new CommerceMetaApi(this.client, this.clock);
    const ordered = [...runs].sort(
      (a, b) =>
        META_SYNC_TARGETS.indexOf(a.target as MetaSyncTarget) -
        META_SYNC_TARGETS.indexOf(b.target as MetaSyncTarget),
    );
    let fatalMessage: string | null = null;
    for (const run of ordered) {
      if (fatalMessage !== null) {
        await this.failRun(run, fatalMessage);
        continue;
      }
      try {
        await this.syncOne(run, api);
      } catch (e) {
        if (!isKnownError(e)) {
          this.logger.error({ err: e }, `메타데이터 동기화 실패(${run.target})`);
        }
        const message = metaSyncErrorMessage(e);
        if (isFatalError(e)) fatalMessage = message;
        await this.failRun(run, message);
      }
    }
  }

  private async syncOne(run: CommerceMetaSyncRun, api: CommerceMetaApi): Promise<void> {
    const syncer = META_TARGET_SYNCERS[run.target as MetaSyncTarget];
    const raw = await syncer.fetch({ api, leaves: this.cache });
    const now = this.clock.now();
    const itemCount = await this.prisma.$transaction(async (tx) => {
      const count = await syncer.apply(tx, raw, now);
      await tx.commerceMetaSyncRun.updateMany({
        where: { id: run.id, status: 'RUNNING' },
        data: { status: 'SUCCEEDED', finishedAt: now, itemCount: count, errorMessage: null },
      });
      return count;
    }, APPLY_TX_OPTIONS);
    this.publish(run, 'SUCCEEDED', now, itemCount, null);
  }

  private async failRun(run: CommerceMetaSyncRun, errorMessage: string): Promise<void> {
    const now = this.clock.now();
    try {
      await this.prisma.commerceMetaSyncRun.updateMany({
        where: { id: run.id, status: 'RUNNING' },
        data: { status: 'FAILED', finishedAt: now, errorMessage },
      });
    } catch (e) {
      this.logger.error(
        { err: e },
        `메타데이터 동기화 실패 기록을 남기지 못했습니다(${run.target})`,
      );
      return;
    }
    this.publish(run, 'FAILED', now, null, errorMessage);
  }

  private publish(
    run: CommerceMetaSyncRun,
    status: 'SUCCEEDED' | 'FAILED',
    finishedAt: Date,
    itemCount: number | null,
    errorMessage: string | null,
  ): void {
    try {
      this.events.publish('commerce-meta-sync.completed', {
        runId: run.id,
        target: run.target as MetaSyncTarget,
        status,
        finishedAt: finishedAt.toISOString(),
        itemCount,
        errorMessage,
      });
    } catch (e) {
      this.logger.warn(
        `commerce-meta-sync.completed 발행에 실패했습니다: ${e instanceof Error ? e.name : 'Error'}`,
      );
    }
  }
}

import { Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import { parsePageRequest, toPage } from '../../../common/paging/page-request.js';
import { formatKstDateTime } from '../../../common/time/kst.js';
import type { CallLog, FxRate, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FX_SECRET_MISSING } from '../../integrations/fx/fx-call.js';
import {
  StepEngineTransactions,
  type StepEngineTx,
} from '../../step-engine/candidates/step-engine-tx.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import type {
  CreateManualFxRateDto,
  FxRateLatestSetDto,
  FxRatePageDto,
  FxRateRecordDto,
  FxRateWarningDto,
  ListFxRatesQueryDto,
} from './dto/fx-rate.dto.js';
import {
  Decimal,
  divergenceOf,
  formatPerUnit,
  FX_SERIES,
  fxInputKey,
  fxInputValue,
  perUnit,
  type FxCurrency,
  type FxRateKind,
  type FxSeriesKey,
  type FxSource,
  type FxUnit,
} from './fx-rate.normalize.js';

type Db = Prisma.TransactionClient;
type SeriesKey = FxSeriesKey;

/** user_action_log SETTING_CHANGED detail의 `setting`(수동 환율 입력, F-ST-06) */
export const FX_MANUAL_AUDIT_SETTING = 'FX_RATE_MANUAL';

/** ③ 판정(P2-05)이 쓰는 환율 한 종류 */
export interface FxRateForJudgement {
  id: number;
  rateKind: FxRateKind;
  currency: FxCurrency;
  /** 고시 원값 */
  rateValue: Decimal;
  unit: FxUnit;
  /** 계산용 = rateValue / unit(`perUnit`) */
  perUnit: Decimal;
  source: FxSource;
  referenceAt: Date;
  collectedAt: Date;
}

/** ③ 판정의 환율 3종(FX_base·FX_cJPY·FX_cUSD). 판정 스냅샷이 이 id 3개를 참조한다(F-BS-44) */
export interface FxRatesForJudgement {
  cost: FxRateForJudgement;
  customsJpy: FxRateForJudgement;
  customsUsd: FxRateForJudgement;
}

/** 자동 수집 한 행(수집기가 정규화한 값) */
export interface CollectedFxRate {
  rateKind: FxRateKind;
  currency: FxCurrency;
  rateValue: Decimal;
  unit: FxUnit;
  source: Extract<FxSource, 'KEXIM' | 'CUSTOMS_SERVICE'>;
  referenceAt: Date;
  /** 응답의 그 항목(비밀 키 이름은 이미 뺐다) */
  rawResponse: unknown;
}

const KIND_LABEL: Record<FxRateKind, string> = { COST: '원가 환율', CUSTOMS: '과세환율' };
const FETCH_TARGET: Record<FxRateKind, 'FX_KOREAEXIM' | 'FX_CUSTOMS'> = {
  COST: 'FX_KOREAEXIM',
  CUSTOMS: 'FX_CUSTOMS',
};
const TARGET_KEY_LABEL: Record<FxRateKind, string> = {
  COST: '한국수출입은행 환율 API 키',
  CUSTOMS: '관세청 과세환율 키',
};

function seriesKey(rateKind: string, currency: string): SeriesKey {
  return `${rateKind}/${currency}` as SeriesKey;
}

export function toFxRateRecordDto(row: FxRate): FxRateRecordDto {
  return {
    id: row.id,
    rateKind: row.rateKind as FxRateKind,
    currency: row.currency as FxCurrency,
    rateValue: row.rateValue.toNumber(),
    unit: row.unit as FxUnit,
    source: row.source as FxSource,
    sourceNote: row.sourceNote,
    referenceAt: row.referenceAt.toISOString(),
    collectedAt: row.collectedAt.toISOString(),
  };
}

function toJudgementRate(row: FxRate): FxRateForJudgement {
  return {
    id: row.id,
    rateKind: row.rateKind as FxRateKind,
    currency: row.currency as FxCurrency,
    rateValue: row.rateValue,
    unit: row.unit as FxUnit,
    perUnit: perUnit(row.rateValue, row.unit),
    source: row.source as FxSource,
    referenceAt: row.referenceAt,
    collectedAt: row.collectedAt,
  };
}

/** call_log 한 행이 실패인가(HTTP 오류·연결 실패는 succeeded=false, 200인데 결과 코드 오류·형식 깨짐은 error_code) */
function isFailedCall(row: Pick<CallLog, 'succeeded' | 'errorCode'> | null): boolean {
  return row !== null && (row.succeeded === false || row.errorCode !== null);
}

/**
 * 환율(pricing 소유 fx_rate, P2-04 규칙 4~10, F-BS-42·43·44·F-ST-06).
 * - 최신값 = 종류·통화별 `reference_at`이 가장 큰 행(같으면 id가 큰 행 — 같은 기준 시각의 수동 정정이 이긴다, Proposed)
 * - 경고: `FX_FETCH_FAILED`(출처별 마지막으로 끝난 call_log가 실패) · `FX_DIVERGENCE`(최신 과세 엔 vs 원가 ±20% 초과). 막지 않는다
 * - 새 최신값(자동·수동)은 그 값을 읽은 ③을 재실행 필요로(`StepEngineApi.referenceInputsChanged`, 값이 같으면 그대로) +
 *   커밋 뒤 SSE `fx-rate.updated`. 행은 고치지 않고 늘 새로 넣는다(fx_rate_append_only)
 * - ③ 판정은 `getLatestForJudgement()`(3종 중 하나라도 없으면 409 `FX_RATE_UNAVAILABLE`)와 `perUnit()`만 쓴다
 */
@Injectable()
export class FxRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly engine: StepEngineApi,
    private readonly events: ProgressEventsService,
    private readonly audit: UserActionLogService,
  ) {}

  /** GET /fx-rates/latest: 종류·통화별 최신 행(있는 것만, COST/JPY → CUSTOMS/JPY → CUSTOMS/USD)과 경고 */
  async getLatest(): Promise<FxRateLatestSetDto> {
    const latest = await this.latestSet(this.prisma);
    const items = FX_SERIES.map((s) => latest[seriesKey(s.rateKind, s.currency)]).filter(
      (row): row is FxRate => row !== null,
    );
    return {
      items: items.map(toFxRateRecordDto),
      warnings: await this.warnings(this.prisma, latest),
    };
  }

  /** GET /fx-rates: 이력(필터 rateKind·currency·source, 정렬 referenceAt·collectedAt, 같은 값이면 id 같은 방향) */
  async list(query: ListFxRatesQueryDto): Promise<FxRatePageDto> {
    const request = parsePageRequest('/fx-rates', query);
    const where: Prisma.FxRateWhereInput = {
      ...(query.rateKind ? { rateKind: query.rateKind } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.source ? { source: query.source } : {}),
    };
    const orderBy: Prisma.FxRateOrderByWithRelationInput[] = request.sort.map((s) => ({
      [s.field]: s.direction,
    }));
    orderBy.push({ id: request.sort[0]!.direction });
    const [rows, total] = await Promise.all([
      this.prisma.fxRate.findMany({ where, orderBy, skip: request.skip, take: request.take }),
      this.prisma.fxRate.count({ where }),
    ]);
    return toPage(rows.map(toFxRateRecordDto), request, total);
  }

  /**
   * POST /fx-rates: 수동 입력(source=MANUAL) 새 행. 칸 사이 규칙은 422 VALIDATION_FAILED — 달러는 단위 1만(ck_fx_unit),
   * 원가 환율은 엔만(Proposed, F-BS-40). 새 최신값이면 ③ 재실행 필요 전파 + SSE. 감사 기록 SETTING_CHANGED.
   */
  async createManual(input: CreateManualFxRateDto): Promise<FxRateRecordDto> {
    const errors: FieldError[] = [];
    if (input.currency === 'USD' && input.unit === 100) {
      errors.push({
        field: 'unit',
        message: '달러(USD)는 단위 1만 넣을 수 있습니다.',
        rejectedValue: input.unit,
      });
    }
    if (input.rateKind === 'COST' && input.currency !== 'JPY') {
      errors.push({
        field: 'currency',
        message: '원가 환율은 엔(JPY)만 넣을 수 있습니다.',
        rejectedValue: input.currency,
      });
    }
    const referenceAt = new Date(input.referenceAt);
    if (Number.isNaN(referenceAt.getTime())) {
      errors.push({
        field: 'referenceAt',
        message: '날짜·시각을 읽을 수 없습니다.',
        rejectedValue: input.referenceAt,
      });
    }
    const rateValue = new Decimal(input.rateValue);
    if (rateValue.lte(0)) {
      errors.push({
        field: 'rateValue',
        message: '0보다 커야 합니다.',
        rejectedValue: input.rateValue,
      });
    }
    if (errors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors: errors });

    const row = await this.transactions.run(async (scope) => {
      const created = await scope.tx.fxRate.create({
        data: {
          rateKind: input.rateKind,
          currency: input.currency,
          rateValue,
          unit: input.unit,
          source: 'MANUAL',
          sourceNote: input.sourceNote?.trim() || null,
          referenceAt,
          collectedAt: scope.now,
        },
      });
      await this.afterNewRows(scope, [created]);
      await this.audit.record(
        {
          eventType: 'SETTING_CHANGED',
          occurredAt: scope.now,
          detail: {
            setting: FX_MANUAL_AUDIT_SETTING,
            fxRateId: created.id,
            rateKind: created.rateKind,
            currency: created.currency,
          },
        },
        scope.tx,
      );
      return created;
    });
    return toFxRateRecordDto(row);
  }

  /**
   * ③ 판정이 쓸 환율 3종(P2-05 시작 조건). 하나라도 없으면 409 `FX_RATE_UNAVAILABLE`(details.missing = ['COST/JPY', …]).
   * 트랜잭션 안에서도 부를 수 있게 db를 받는다.
   */
  async getLatestForJudgement(db: Db = this.prisma): Promise<FxRatesForJudgement> {
    const latest = await this.latestSet(db);
    const missing = FX_SERIES.map((s) => seriesKey(s.rateKind, s.currency)).filter(
      (k) => !latest[k],
    );
    if (missing.length > 0) {
      throw new ApiException('FX_RATE_UNAVAILABLE', { details: { missing } });
    }
    return {
      cost: toJudgementRate(latest['COST/JPY']!),
      customsJpy: toJudgementRate(latest['CUSTOMS/JPY']!),
      customsUsd: toJudgementRate(latest['CUSTOMS/USD']!),
    };
  }

  /**
   * 자동 수집 행을 넣는다(수집기 전용). 같은 종류·통화·출처·기준 시각이면 새 행 없이 넘어간다(uq_fx_rate_auto — 같은 고시
   * 재수집은 성공으로 본다). 넣은 행이 새 최신값이면 전파 + SSE. 한 트랜잭션.
   */
  saveCollected(
    rows: readonly CollectedFxRate[],
  ): Promise<{ inserted: FxRate[]; rerunRequiredStepCount: number }> {
    return this.transactions.run(async (scope) => {
      const inserted: FxRate[] = [];
      for (const row of rows) {
        const saved = await this.insertAuto(scope, row);
        if (saved) inserted.push(saved);
      }
      const rerunRequiredStepCount =
        inserted.length > 0 ? await this.afterNewRows(scope, inserted) : 0;
      return { inserted, rerunRequiredStepCount };
    });
  }

  /** 자동 수집 실패 알림(SSE fx-rate.updated, warningCode FX_FETCH_FAILED). 과세환율은 엔·달러 둘 다 */
  publishFetchFailed(rateKind: FxRateKind): void {
    const currencies: FxCurrency[] = rateKind === 'COST' ? ['JPY'] : ['JPY', 'USD'];
    for (const currency of currencies) {
      this.events.publish('fx-rate.updated', {
        rateKind,
        currency,
        fxRateId: null,
        warningCode: 'FX_FETCH_FAILED',
      });
    }
  }

  /** 종류·통화별 최신 행 */
  async latestSet(db: Db): Promise<Record<SeriesKey, FxRate | null>> {
    const rows = await Promise.all(
      FX_SERIES.map((s) =>
        db.fxRate.findFirst({
          where: { rateKind: s.rateKind, currency: s.currency },
          orderBy: [{ referenceAt: 'desc' }, { id: 'desc' }],
        }),
      ),
    );
    const out = {} as Record<SeriesKey, FxRate | null>;
    FX_SERIES.forEach((s, i) => {
      out[seriesKey(s.rateKind, s.currency)] = rows[i] ?? null;
    });
    return out;
  }

  /** 경고(규칙 5·6). 막지 않는다 */
  async warnings(db: Db, latest?: Record<SeriesKey, FxRate | null>): Promise<FxRateWarningDto[]> {
    const set = latest ?? (await this.latestSet(db));
    const out: FxRateWarningDto[] = [];
    for (const rateKind of ['COST', 'CUSTOMS'] as const) {
      const last = await db.callLog.findFirst({
        where: { target: FETCH_TARGET[rateKind], succeeded: { not: null } },
        orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
        select: { succeeded: true, errorCode: true, calledAt: true },
      });
      if (!last || !isFailedCall(last)) continue;
      out.push({
        code: 'FX_FETCH_FAILED',
        rateKind,
        currency: rateKind === 'COST' ? 'JPY' : null,
        message:
          last.errorCode === FX_SECRET_MISSING
            ? `${TARGET_KEY_LABEL[rateKind]}가 없어 ${KIND_LABEL[rateKind]}을 자동으로 받지 못했습니다. 시스템 상태에서 키를 넣거나 환율을 직접 넣어 주세요.`
            : `${KIND_LABEL[rateKind]} 자동 수집이 실패했습니다(${formatKstDateTime(last.calledAt)}). 마지막 값을 계속 씁니다. 필요하면 환율을 직접 넣어 주세요.`,
      });
    }
    const cost = set['COST/JPY'];
    const customs = set['CUSTOMS/JPY'];
    if (cost && customs) {
      const costPerUnit = perUnit(cost.rateValue, cost.unit);
      const customsPerUnit = perUnit(customs.rateValue, customs.unit);
      const d = divergenceOf(costPerUnit, customsPerUnit);
      if (d.exceeds) {
        const sign = d.pct.gt(0) ? '+' : '';
        out.push({
          code: 'FX_DIVERGENCE',
          rateKind: 'CUSTOMS',
          currency: 'JPY',
          message: `과세환율(엔) ${formatPerUnit(customsPerUnit, 'JPY')}이 원가 환율 ${formatPerUnit(costPerUnit, 'JPY')}과 ${sign}${d.pct.toFixed(2)}% 다릅니다. 두 값을 확인해 주세요.`,
        });
      }
    }
    return out;
  }

  /**
   * 넣은 행 가운데 새 최신값인 것만: ③ 재실행 필요 전파(입력 `fx.*`, 값 = 계산용 환율) + 커밋 뒤 SSE fx-rate.updated
   * (warningCode = 이 행으로 ±20% 차이가 있으면 FX_DIVERGENCE). 재실행 필요가 된 단계 수를 돌려준다.
   */
  private async afterNewRows(scope: StepEngineTx, rows: readonly FxRate[]): Promise<number> {
    const latest = await this.latestSet(scope.tx);
    const fresh = rows.filter(
      (row) => latest[seriesKey(row.rateKind, row.currency)]?.id === row.id,
    );
    if (fresh.length === 0) return 0;
    const changes = fresh.flatMap((row) => {
      const inputKey = fxInputKey(row.rateKind as FxRateKind, row.currency as FxCurrency);
      return inputKey ? [{ inputKey, value: fxInputValue(row.rateValue, row.unit) }] : [];
    });
    const count = await this.engine.referenceInputsChanged(changes, scope);
    const warnings = await this.warnings(scope.tx, latest);
    const divergent = warnings.some((w) => w.code === 'FX_DIVERGENCE');
    scope.afterCommit(() => {
      for (const row of fresh) {
        this.events.publish('fx-rate.updated', {
          rateKind: row.rateKind as FxRateKind,
          currency: row.currency as FxCurrency,
          fxRateId: row.id,
          warningCode: divergent ? 'FX_DIVERGENCE' : null,
        });
      }
    });
    return count;
  }

  /** 자동 행 넣기(ON CONFLICT DO NOTHING — uq_fx_rate_auto). 이미 있으면 null */
  private async insertAuto(scope: StepEngineTx, row: CollectedFxRate): Promise<FxRate | null> {
    const raw = JSON.stringify(row.rawResponse ?? null);
    const inserted = await scope.tx.$queryRaw<{ id: number }[]>`
      INSERT INTO fx_rate (rate_kind, currency, rate_value, unit, source, reference_at, collected_at, raw_response)
      VALUES (${row.rateKind}, ${row.currency}, ${row.rateValue.toFixed()}::numeric, ${row.unit}::smallint,
              ${row.source}, ${row.referenceAt}::timestamptz, ${scope.now}::timestamptz, ${raw}::jsonb)
      ON CONFLICT DO NOTHING
      RETURNING id`;
    const id = inserted[0]?.id;
    return id === undefined ? null : scope.tx.fxRate.findUniqueOrThrow({ where: { id } });
  }
}

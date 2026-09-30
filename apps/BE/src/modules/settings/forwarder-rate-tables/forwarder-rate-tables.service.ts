import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { FileStorageService } from '../../../common/files/file-storage.service.js';
import { parsePageRequest, toPage } from '../../../common/paging/page-request.js';
import type {
  ForwarderRateTable,
  ForwarderRateTier,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import type {
  ForwarderRateTableDetailDto,
  ForwarderRateTableImportResultDto,
  ForwarderRateTablePageDto,
  ForwarderRateTableSummaryDto,
  ForwarderRateTierDto,
  ImportForwarderRateTableFieldsDto,
  ListForwarderRateTablesQueryDto,
} from './dto/forwarder-rate-table.dto.js';
import {
  decodeRateTableCsv,
  looksBinary,
  parseRateTableCsv,
  type ParsedRateTier,
  type RateTableCurrency,
} from './rate-table-csv.parser.js';
import { RATE_TABLE_INPUT_KEY, rateTableInputValue } from './rate-table-input.js';
import {
  RATE_TABLE_RERUN_PROPAGATOR,
  type ReferenceInputsPropagator,
} from './rate-table-rerun.port.js';

/** 업로드 상한 5MB(05-2 x-decision §7.1-6). 넘으면 multer → 413 PAYLOAD_TOO_LARGE */
export const RATE_TABLE_MAX_BYTES = 5 * 1024 * 1024;

/** 원본 CSV 폴더(APP_DATA_DIR 아래, Proposed — 06-4 §2.1): forwarder-rate-tables/<sha256>.csv */
export const RATE_TABLE_FILES_DIR = 'forwarder-rate-tables';

/** user_action_log SETTING_CHANGED detail의 `setting` */
export const RATE_TABLE_AUDIT_SETTING = 'FORWARDER_RATE_TABLE';

/** 가져오기를 한 번에 하나씩(프로세스 사이까지) 막는 advisory lock 키 */
export const RATE_TABLE_IMPORT_LOCK_KEY = 8020401;

/** multer가 넘기는 파일(메모리 저장) */
export interface UploadedCsvFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** ③ 판정(P2-05)이 읽는 활성 요금표 */
export interface ActiveRateTable {
  id: number;
  forwarderName: string | null;
  tiers: {
    id: number;
    weightMaxKg: Prisma.Decimal;
    fee: number;
    currency: RateTableCurrency;
    volumetricDivisor: number | null;
    volumetricAppliesWhen: string | null;
  }[];
}

type Db = Prisma.TransactionClient;
type TableWithTiers = ForwarderRateTable & { tiers: ForwarderRateTier[] };

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toTierDto(tier: ForwarderRateTier): ForwarderRateTierDto {
  return {
    id: tier.id,
    weightMaxKg: tier.weightMaxKg.toNumber(),
    fee: tier.fee,
    currency: tier.currency as RateTableCurrency,
    volumetricDivisor: tier.volumetricDivisor,
    volumetricAppliesWhen: tier.volumetricAppliesWhen,
  };
}

function toSummaryDto(table: ForwarderRateTable): ForwarderRateTableSummaryDto {
  return {
    id: table.id,
    forwarderName: table.forwarderName,
    sourceFileName: table.sourceFileName,
    sourceFileSha256: table.sourceFileSha256,
    rowCount: table.rowCount,
    isActive: table.isActive,
    importedAt: table.importedAt.toISOString(),
    activatedAt: iso(table.activatedAt),
  };
}

function toDetailDto(table: TableWithTiers): ForwarderRateTableDetailDto {
  const tiers = [...table.tiers].sort((a, b) => a.weightMaxKg.comparedTo(b.weightMaxKg));
  return { ...toSummaryDto(table), tiers: tiers.map(toTierDto) };
}

/** CSV 파일인가(확장자 `.csv`, Proposed — 브라우저·OS마다 MIME이 달라 이름으로 본다) */
export function isCsvFileName(name: string): boolean {
  return /\.csv$/i.test(name.trim());
}

/** 원본 파일 이름(255자, 경로 부분 제거) */
function fileNameOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return (base.trim() || 'rate-table.csv').slice(0, 255);
}

function unsupported(): ApiException {
  return new ApiException('UNSUPPORTED_FILE_TYPE', {
    message: formatErrorMessage('UNSUPPORTED_FILE_TYPE', { 형식: 'CSV' }),
    details: { allowed: ['CSV'] },
  });
}

/**
 * 배대지 요금표(F-ST-04, P2-04 규칙 11~15).
 * - 가져오기: 파일 검사(5MB는 multer, CSV 이름·바이너리 아님) → 해시 → 같은 해시면 새 행 없이 그 버전을 다시 켠다(200 reused),
 *   아니면 UTF-8 해석 → CSV 규칙 → 원본을 `forwarder-rate-tables/<sha>.csv`에 쓰고 → 한 트랜잭션에서 버전 1행 + 구간 N행,
 *   **기존 활성을 먼저 끄고** 새 버전을 켠다(uq_forwarder_rate_table_one_active), 활성이 바뀌었으면 ③ 재실행 필요 전파
 *   (`forwarder.rateTable`)와 감사 기록(SETTING_CHANGED). 가져오기는 프로세스 안 직렬 + advisory lock.
 * - 요금표는 지우지 않고(forwarder_rate_table_no_delete), 구간은 추가만(forwarder_rate_tier_append_only)이다.
 * - 원본 CSV 경로는 응답에 넣지 않는다.
 */
@Injectable()
export class ForwarderRateTablesService {
  private readonly logger = new Logger(ForwarderRateTablesService.name);
  private propagator: ReferenceInputsPropagator;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
    private readonly audit: UserActionLogService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RATE_TABLE_RERUN_PROPAGATOR) propagator: ReferenceInputsPropagator,
  ) {
    this.propagator = propagator;
  }

  /** step-engine이 onModuleInit에서 실제 전파를 끼운다(settings → step-engine 의존 없이, 프로필 포트와 같은 방식) */
  setRerunPropagator(propagator: ReferenceInputsPropagator): void {
    this.propagator = propagator;
  }

  /** 가져오기. `created`면 201 + Location, 아니면 200(reused) */
  import(
    file: UploadedCsvFile | undefined,
    fields: ImportForwarderRateTableFieldsDto,
  ): Promise<{ created: boolean; result: ForwarderRateTableImportResultDto }> {
    return this.serialized(() => this.importOnce(file, fields));
  }

  async list(query: ListForwarderRateTablesQueryDto): Promise<ForwarderRateTablePageDto> {
    const request = parsePageRequest('/forwarder-rate-tables', query);
    const where: Prisma.ForwarderRateTableWhereInput =
      query.active === undefined ? {} : { isActive: query.active };
    const direction = request.sort[0]!.direction;
    const [rows, total] = await Promise.all([
      this.prisma.forwarderRateTable.findMany({
        where,
        orderBy: [{ importedAt: direction }, { id: direction }],
        skip: request.skip,
        take: request.take,
      }),
      this.prisma.forwarderRateTable.count({ where }),
    ]);
    return toPage(rows.map(toSummaryDto), request, total);
  }

  async get(id: number): Promise<ForwarderRateTableDetailDto> {
    const table = await this.prisma.forwarderRateTable.findUnique({
      where: { id },
      include: { tiers: true },
    });
    if (!table) throw new ApiException('RATE_TABLE_NOT_FOUND', { details: { rateTableId: id } });
    return toDetailDto(table);
  }

  /**
   * ③ 판정이 쓰는 활성 요금표(P2-05). 없으면 null → ③은 기본 15,000원 가정값(F-PJ-07). 구간은 무게 오름차순.
   * 트랜잭션 안에서도 부를 수 있게 db를 받는다.
   */
  async activeForJudgement(db: Db = this.prisma): Promise<ActiveRateTable | null> {
    const table = await db.forwarderRateTable.findFirst({
      where: { isActive: true },
      include: { tiers: { orderBy: { weightMaxKg: 'asc' } } },
    });
    if (!table) return null;
    return {
      id: table.id,
      forwarderName: table.forwarderName,
      tiers: table.tiers.map((t) => ({
        id: t.id,
        weightMaxKg: t.weightMaxKg,
        fee: t.fee,
        currency: t.currency as RateTableCurrency,
        volumetricDivisor: t.volumetricDivisor,
        volumetricAppliesWhen: t.volumetricAppliesWhen,
      })),
    };
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async importOnce(
    file: UploadedCsvFile | undefined,
    fields: ImportForwarderRateTableFieldsDto,
  ): Promise<{ created: boolean; result: ForwarderRateTableImportResultDto }> {
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new ApiException('VALIDATION_FAILED', {
        fieldErrors: [{ field: 'file', message: '가져올 CSV 파일을 넣어 주세요.' }],
      });
    }
    if (!isCsvFileName(file.originalname) || looksBinary(file.buffer)) throw unsupported();

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.forwarderRateTable.findUnique({
      where: { sourceFileSha256: sha256 },
    });
    let tiers: ParsedRateTier[] | null = null;
    let sourceFilePath: string | null = null;
    if (!existing) {
      tiers = this.parse(file.buffer);
      sourceFilePath = `${RATE_TABLE_FILES_DIR}/${sha256}.csv`;
      await this.files.writeIfAbsent(sourceFilePath, file.buffer);
    }

    const afterCommit: (() => void)[] = [];
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RATE_TABLE_IMPORT_LOCK_KEY})`;
      const now = this.clock.now();
      const before = await tx.forwarderRateTable.findFirst({ where: { isActive: true } });
      let table = await tx.forwarderRateTable.findUnique({ where: { sourceFileSha256: sha256 } });
      let created = false;
      if (!table) {
        const parsed = tiers ?? this.parse(file.buffer);
        table = await tx.forwarderRateTable.create({
          data: {
            forwarderName: fields.forwarderName?.trim() || null,
            sourceFileName: fileNameOf(file.originalname),
            sourceFilePath: sourceFilePath ?? `${RATE_TABLE_FILES_DIR}/${sha256}.csv`,
            sourceFileSha256: sha256,
            rowCount: parsed.length,
            isActive: false,
            importedAt: now,
          },
        });
        await tx.forwarderRateTier.createMany({
          data: parsed.map((tier) => ({
            forwarderRateTableId: table!.id,
            weightMaxKg: tier.weightMaxKg,
            fee: tier.fee,
            currency: tier.currency,
            volumetricDivisor: tier.volumetricDivisor,
            volumetricAppliesWhen: tier.volumetricAppliesWhen,
          })),
        });
        created = true;
      }

      let rerunRequiredStepCount = 0;
      const activeChanged = before?.id !== table.id;
      if (activeChanged) {
        // 활성은 하나뿐(uq_forwarder_rate_table_one_active) — 기존 활성을 먼저 끈다
        if (before) {
          await tx.forwarderRateTable.update({
            where: { id: before.id },
            data: { isActive: false },
          });
        }
        table = await tx.forwarderRateTable.update({
          where: { id: table.id },
          data: { isActive: true, activatedAt: now },
        });
        rerunRequiredStepCount = await this.propagator(
          [{ inputKey: RATE_TABLE_INPUT_KEY, value: rateTableInputValue(table.id) }],
          tx,
          (fn) => afterCommit.push(fn),
        );
        await this.audit.record(
          {
            eventType: 'SETTING_CHANGED',
            occurredAt: now,
            detail: {
              setting: RATE_TABLE_AUDIT_SETTING,
              rateTableId: table.id,
              previousRateTableId: before?.id ?? null,
              reused: !created,
            },
          },
          tx,
        );
      }
      const detail = await tx.forwarderRateTable.findUniqueOrThrow({
        where: { id: table.id },
        include: { tiers: true },
      });
      return { created, activeChanged, rerunRequiredStepCount, detail };
    });
    for (const fn of afterCommit) {
      try {
        fn();
      } catch (e) {
        this.logger.error({ err: e }, '요금표 가져오기 뒤 작업(SSE)이 실패했습니다');
      }
    }
    if (outcome.activeChanged) {
      this.logger.log(
        `배대지 요금표 #${outcome.detail.id} 활성(${outcome.created ? '새 버전' : '같은 파일 다시 켬'}), 재실행 필요 ${outcome.rerunRequiredStepCount}개`,
      );
    }
    return {
      created: outcome.created,
      result: {
        rateTable: toDetailDto(outcome.detail),
        reused: !outcome.created,
        rerunRequiredStepCount: outcome.rerunRequiredStepCount,
      },
    };
  }

  /** 바이트 → 구간(UTF-8 아님·CSV 규칙 위반은 422) */
  private parse(bytes: Buffer): ParsedRateTier[] {
    const text = decodeRateTableCsv(bytes);
    if (text === null) {
      throw new ApiException('IMPORT_PARSE_FAILED', {
        fieldErrors: [
          {
            field: 'file',
            message: "UTF-8로 저장한 CSV만 읽습니다. 엑셀에서는 'CSV UTF-8'로 저장해 주세요.",
          },
        ],
      });
    }
    const parsed = parseRateTableCsv(text);
    if (!parsed.ok) {
      throw new ApiException(parsed.code, {
        fieldErrors: parsed.fieldErrors.length > 0 ? parsed.fieldErrors : undefined,
      });
    }
    return parsed.tiers;
  }
}

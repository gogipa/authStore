import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import {
  parsePageRequest,
  toPage,
  type PageEnvelope,
  type PageQueryInput,
} from '../../common/paging/page-request.js';
import type { Prisma, Registration } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CandidateGuardService } from '../step-engine/candidates/candidate-guard.service.js';
import type { RegistrationDetailDto, RegistrationSummaryDto } from './dto/registration.dto.js';
import { smartstoreProductUrl } from './register/registration-record.js';

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

type FailureKind = RegistrationSummaryDto['failureKind'];

/** 등록 기록 한 행 → 이력 한 줄(05-2 RegistrationSummary) */
export function toRegistrationSummary(
  row: Registration & { stepRun: { version: number } },
): RegistrationSummaryDto {
  return {
    registrationId: row.id,
    stepRunId: row.stepRunId,
    stepRunVersion: row.stepRun.version,
    status: row.status as RegistrationSummaryDto['status'],
    sellerManagementCode: row.sellerManagementCode,
    optionType: row.optionType as RegistrationSummaryDto['optionType'],
    displayStatusType: row.displayStatusType as RegistrationSummaryDto['displayStatusType'],
    approvedAt: row.approvedAt.toISOString(),
    registeredAt: iso(row.registeredAt),
    originProductNo: row.originProductNo,
    httpStatus: row.httpStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    failedAt: iso(row.failedAt),
    failureKind: (row.failureKind as FailureKind) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 등록 기록 한 행 → 상세(05-2 RegistrationDetail — request_json 키를 넣지 않는다) */
export function toRegistrationDetail(
  row: Registration & { stepRun: { candidateId: number } },
): RegistrationDetailDto {
  return {
    registrationId: row.id,
    candidateId: row.stepRun.candidateId,
    stepRunId: row.stepRunId,
    priceJudgementId: row.priceJudgementId,
    uploadResultId: row.uploadResultId,
    status: row.status as RegistrationDetailDto['status'],
    itemCode: row.itemCode,
    selectedColor: row.selectedColor,
    colorCode: row.colorCode,
    sellerManagementCode: row.sellerManagementCode,
    displayStatusType: row.displayStatusType as RegistrationDetailDto['displayStatusType'],
    optionType: row.optionType as RegistrationDetailDto['optionType'],
    validationResult: (row.validationResult ?? {}) as Record<string, unknown>,
    approvedAt: row.approvedAt.toISOString(),
    requestSentAt: iso(row.requestSentAt),
    responseReceivedAt: iso(row.responseReceivedAt),
    lastResultCheckAt: iso(row.lastResultCheckAt),
    registeredAt: iso(row.registeredAt),
    originProductNo: row.originProductNo,
    channelProductNo: row.channelProductNo,
    httpStatus: row.httpStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    invalidInputs: row.invalidInputs ?? null,
    traceId: row.traceId,
    failedAt: iso(row.failedAt),
    failureKind: (row.failureKind as FailureKind) ?? null,
    smartstoreProductUrl: smartstoreProductUrl(row.originProductNo),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 정렬 필드 → 컬럼 */
const SORT_COLUMN = { approvedAt: 'approvedAt', createdAt: 'createdAt' } as const;

/**
 * 등록 기록 조회(P4-03 규칙 14, F-AP-33·34, 05-2 `listCandidateRegistrations`·`getRegistration`). 기록은 지우지 않는다
 * (`registration_no_delete`). 목록은 05-1 §1.4 페이징(`page` 0부터·`size` 기본 20 최대 100·`sort` approvedAt·createdAt, 기본
 * approvedAt,desc — 같은 값이면 id 같은 방향, 어기면 422 `INVALID_QUERY_PARAMETER`). 상세는 `request_json`을 빼고(M2 내려받기) 준다.
 */
@Injectable()
export class RegistrationQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: CandidateGuardService,
  ) {}

  async list(
    candidateId: number,
    query: PageQueryInput & Record<string, unknown>,
  ): Promise<PageEnvelope<RegistrationSummaryDto>> {
    const unknownKeys = Object.keys(query).filter((k) => !['page', 'size', 'sort'].includes(k));
    if (unknownKeys.length > 0) {
      throw new ApiException('INVALID_QUERY_PARAMETER', {
        fieldErrors: unknownKeys.map((field) => ({ field, message: '받지 않는 조건입니다.' })),
      });
    }
    const request = parsePageRequest('/candidates/{candidateId}/registrations', query);
    await this.guard.findOr404(this.prisma, candidateId);
    const where: Prisma.RegistrationWhereInput = { stepRun: { candidateId } };
    const orderBy: Prisma.RegistrationOrderByWithRelationInput[] = [
      ...request.sort.map((s) => ({
        [SORT_COLUMN[s.field as keyof typeof SORT_COLUMN]]: s.direction,
      })),
      { id: request.sort[0]?.direction ?? 'desc' },
    ];
    const [rows, total] = await Promise.all([
      this.prisma.registration.findMany({
        where,
        orderBy,
        skip: request.skip,
        take: request.take,
        include: { stepRun: { select: { version: true } } },
      }),
      this.prisma.registration.count({ where }),
    ]);
    return toPage(rows.map(toRegistrationSummary), request, total);
  }

  async get(registrationId: number): Promise<RegistrationDetailDto> {
    const row = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: { stepRun: { select: { candidateId: true } } },
    });
    if (!row) throw new ApiException('REGISTRATION_NOT_FOUND');
    return toRegistrationDetail(row);
  }
}

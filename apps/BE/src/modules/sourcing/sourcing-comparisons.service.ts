import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  type ComparisonSort,
  type ComparisonSortField,
  sortRows,
  toComparisonDetail,
} from './sourcing-comparison.view.js';

const SORT_FIELDS: readonly ComparisonSortField[] = [
  'effectivePriceYen',
  'searchRank',
  'fetchOrder',
];

function invalidQuery(field: string, message: string): ApiException {
  return new ApiException('INVALID_QUERY_PARAMETER', { fieldErrors: [{ field, message }] });
}

/** 쿼리 파싱(05-2 getSourcingComparison: stepRunId·includeNoMatch·sort) — 어기면 422 INVALID_QUERY_PARAMETER */
export function parseComparisonQuery(query: Record<string, unknown>): {
  stepRunId: number | null;
  includeNoMatch: boolean;
  sort: ComparisonSort[];
} {
  const allowed = new Set(['stepRunId', 'includeNoMatch', 'sort']);
  for (const key of Object.keys(query)) {
    if (!allowed.has(key)) throw invalidQuery(key, '받지 않는 조건입니다.');
  }
  let stepRunId: number | null = null;
  if (query.stepRunId !== undefined) {
    const raw = typeof query.stepRunId === 'string' ? query.stepRunId : '';
    if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > 2_147_483_647) {
      throw invalidQuery('stepRunId', '1 이상의 정수여야 합니다.');
    }
    stepRunId = Number(raw);
  }
  let includeNoMatch = false;
  if (query.includeNoMatch !== undefined) {
    if (query.includeNoMatch !== 'true' && query.includeNoMatch !== 'false') {
      throw invalidQuery('includeNoMatch', "'true' 또는 'false'여야 합니다.");
    }
    includeNoMatch = query.includeNoMatch === 'true';
  }
  const sortValues =
    query.sort === undefined ? [] : Array.isArray(query.sort) ? query.sort : [query.sort];
  const sort = sortValues.map((value): ComparisonSort => {
    const m = /^([a-zA-Z]+),(asc|desc)$/.exec(String(value));
    if (!m || !SORT_FIELDS.includes(m[1] as ComparisonSortField)) {
      throw invalidQuery('sort', `허용 정렬: ${SORT_FIELDS.join('·')}(,asc|desc)`);
    }
    return { field: m[1] as ComparisonSortField, direction: m[2] as 'asc' | 'desc' };
  });
  return { stepRunId, includeNoMatch, sort };
}

/**
 * ② 비교표 조회(05-2 getSourcingComparison). P2-02는 머리 행·행을 있는 그대로 준다(앵커 분류·재고·실질가 값은 P2-03이 채운다).
 * 현재 버전(candidate_step.current_step_run_id) 또는 `?stepRunId=` 버전. 없는 후보 404 CANDIDATE_NOT_FOUND, 없는 실행
 * 404 STEP_RUN_NOT_FOUND, 다른 후보·단계의 실행 422 INVALID_QUERY_PARAMETER, 산출물 없음 404 STEP_OUTPUT_NOT_FOUND.
 */
@Injectable()
export class SourcingComparisonsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(candidateId: number, rawQuery: Record<string, unknown>) {
    const query = parseComparisonQuery(rawQuery);
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { id: true },
    });
    if (!candidate) throw new ApiException('CANDIDATE_NOT_FOUND');
    const step = await this.prisma.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId, stepCode: 'SOURCING' } },
      select: { currentStepRunId: true },
    });
    const runId = query.stepRunId ?? step?.currentStepRunId ?? null;
    if (runId === null) throw outputNotFound();
    const run = await this.prisma.stepRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiException('STEP_RUN_NOT_FOUND');
    if (run.candidateId !== candidateId || run.stepCode !== 'SOURCING') {
      throw invalidQuery('stepRunId', '이 여정의 ② 소싱 실행이 아닙니다.');
    }
    const head = await this.prisma.sourcingComparison.findUnique({ where: { stepRunId: run.id } });
    if (!head) throw outputNotFound();
    const rows = await this.prisma.sourcingComparisonRow.findMany({
      where: {
        sourcingComparisonId: head.id,
        ...(query.includeNoMatch
          ? {}
          : { OR: [{ anchorMatch: null }, { anchorMatch: { not: 'NO_MATCH' } }] }),
      },
      include: {
        rakutenItem: { select: { collectedAt: true, saleStartsAt: true, saleEndsAt: true } },
      },
    });
    return toComparisonDetail({
      head,
      run,
      isCurrent: step?.currentStepRunId === run.id,
      rows: sortRows(rows, query.sort),
    });
  }
}

function outputNotFound(): ApiException {
  return new ApiException('STEP_OUTPUT_NOT_FOUND', {
    message: formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: '② 소싱' }),
    details: { stepCode: 'SOURCING' },
  });
}

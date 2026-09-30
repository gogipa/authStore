import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import { parseContentQuery, resolveContentRun } from '../content-query.js';
import type { ContentFactOutputDto, ContentStepStatus } from '../dto/content.dto.js';
import { draftOf, fieldsOf, type FieldDraft } from '../fields/content-field.store.js';
import { sortFields, toFieldItem } from '../fields/content-field.view.js';
import { FACT_FIELD_KEYS, ORIGIN_FIELD_KEY } from '../fields/field-keys.js';
import { factOutputNotFound } from './fact-owner-edit.handler.js';
import { originSettled } from './recheck.js';

/**
 * 입력 대기 중인 ⑥-2의 남은 대기 입력(05-2 `pendingInputs` — 계산). ⑥-2의 입력 대기 이유는 원산지뿐이라(규칙 12), 원산지 행이
 * 오너 입력으로 확정(값 있음·재확인 풀림)되지 않았으면 `fact.origin`
 */
export function storedPendingInputs(rows: readonly FieldDraft[]): string[] {
  const origin = rows.find((row) => row.fieldKey === ORIGIN_FIELD_KEY);
  return origin?.valueSource === 'OWNER_INPUT' && originSettled(origin) ? [] : [ORIGIN_FIELD_KEY];
}

/**
 * ⑥-2 고시 원자료와 원문 근거 대조(05-2 `getCandidateContentFact`, F-CT-09~13·15): 머리 행(근거 itemCode·출처 URL·선택 색상
 * 원문)과 사실 필드 다섯 행(값·원문 발췌·출처 URL·방법·재확인 필요, 필드 키 순서). `pendingInputs`는 입력 대기일 때만.
 */
@Injectable()
export class ContentFactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: CandidateGuardService,
  ) {}

  async get(candidateId: number, rawQuery: Record<string, unknown>): Promise<ContentFactOutputDto> {
    const query = parseContentQuery(rawQuery);
    await this.guard.findOr404(this.prisma, candidateId);
    const { run, isCurrent } = await resolveContentRun(
      this.prisma,
      candidateId,
      'NOTICE_RAW',
      query.stepRunId,
      factOutputNotFound,
    );
    const head = await this.prisma.contentDraftFact.findUnique({ where: { stepRunId: run.id } });
    if (!head) throw factOutputNotFound();
    const rows = sortFields(await fieldsOf(this.prisma, run.id), FACT_FIELD_KEYS);
    return {
      stepRunId: run.id,
      candidateId,
      version: run.version,
      stepRunStatus: run.status as ContentStepStatus,
      isCurrent,
      contentDraftFactId: head.id,
      sourceItemCode: head.sourceItemCode,
      sourcePageUrl: head.sourcePageUrl,
      selectedColorRaw: head.selectedColorRaw,
      createdAt: head.createdAt.toISOString(),
      fields: rows.map(toFieldItem),
      pendingInputs: run.status === 'WAITING_INPUT' ? storedPendingInputs(rows.map(draftOf)) : [],
    };
  }
}

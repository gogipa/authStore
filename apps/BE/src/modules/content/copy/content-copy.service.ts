import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import { parseContentQuery, resolveContentRun } from '../content-query.js';
import type { ContentCopyOutputDto, ContentStepStatus } from '../dto/content.dto.js';
import { fieldsOf } from '../fields/content-field.store.js';
import { sortFields, toFieldItem } from '../fields/content-field.view.js';
import { COPY_FIELD_KEYS } from '../fields/field-keys.js';
import { copyOutputNotFound, readCopyRow } from './copy-owner-edit.handler.js';

/**
 * ⑥-1 카피 산출물 조회(05-2 `getCandidateContentCopy`, F-CT-05·07·08). `generatedCopy`(AI 원 결과)·`copy`(유효 카피 —
 * `source_facts_used` 포함)·오너가 고치거나 고른 `copy.*` 필드 행. `keepAsIsAllowed` = 이 버전이 현재 버전이고 ⑥-1이
 * RERUN_REQUIRED(계산). 'AI 생성 · 엔진'은 화면이 실행 기록(`GET /step-runs/{id}`의 aiEngine·aiModel)으로 붙인다(D-16).
 */
@Injectable()
export class ContentCopyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: CandidateGuardService,
  ) {}

  async get(candidateId: number, rawQuery: Record<string, unknown>): Promise<ContentCopyOutputDto> {
    const query = parseContentQuery(rawQuery);
    await this.guard.findOr404(this.prisma, candidateId);
    const { run, isCurrent, stepStatus } = await resolveContentRun(
      this.prisma,
      candidateId,
      'COPY',
      query.stepRunId,
      copyOutputNotFound,
    );
    const row = await readCopyRow(this.prisma, run.id);
    if (!row) throw copyOutputNotFound();
    const fields = sortFields(await fieldsOf(this.prisma, run.id), COPY_FIELD_KEYS);
    return {
      stepRunId: run.id,
      candidateId,
      version: run.version,
      stepRunStatus: run.status as ContentStepStatus,
      isCurrent,
      contentDraftCopyId: row.id,
      generatedCopy: { ...row.generated },
      copy: { ...row.copy },
      createdAt: row.createdAt.toISOString(),
      fields: fields.map(toFieldItem),
      keepAsIsAllowed: isCurrent && stepStatus === 'RERUN_REQUIRED',
    };
  }
}

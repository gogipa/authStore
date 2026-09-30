import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import { draftOf, fieldsOf, insertFields } from '../fields/content-field.store.js';
import { applyCopyEdits, type CopyEditInput } from './copy-fields.js';
import { copyJson, isCopyDraft, type CopyDraft } from './copy.schema.js';

type Tx = Prisma.TransactionClient;

/** ⑥-1 산출물 없음(05-2 getCandidateContentCopy 404, details.stepCode=COPY) */
export function copyOutputNotFound(): ApiException {
  return new ApiException('STEP_OUTPUT_NOT_FOUND', {
    message: formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: '⑥-1 카피' }),
    details: { stepCode: 'COPY' },
  });
}

/** 버전의 카피 행(AI 원 결과·유효 카피). 모양이 깨졌으면 앱 오류 */
export async function readCopyRow(
  db: Tx,
  stepRunId: number,
): Promise<{ id: number; generated: CopyDraft; copy: CopyDraft; createdAt: Date } | null> {
  const row = await db.contentDraftCopy.findUnique({ where: { stepRunId } });
  if (!row) return null;
  if (!isCopyDraft(row.generatedCopy) || !isCopyDraft(row.copy)) {
    throw new Error(`content_draft_copy #${row.id}의 카피 모양이 맞지 않습니다`);
  }
  return { id: row.id, generated: row.generatedCopy, copy: row.copy, createdAt: row.createdAt };
}

/**
 * ⑥-1 COPY 오너 수정 산출물 복사(P3-03 규칙 6~8, P1-05 `StepRunner.copyOutput` — step-engine owner-edits가 부른다).
 * - EDIT(`{fields}`): 바탕 버전의 AI 원 결과는 그대로 가져가고, 필드 편집·나란히 고르기를 적용한 필드 행과 유효 카피를 쓴다
 *   (검사 실패는 422 — 트랜잭션이 되돌린다)
 * - KEEP_AS_IS·RESTORE_VERSION(편집 없음): 카피 행과 필드 행을 그대로 새 버전으로 복사한다(새 지문은 엔진이 남긴다)
 */
@Injectable()
export class CopyOwnerEditHandler {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  async copy(tx: Tx, fromStepRunId: number, toStepRunId: number, edit?: unknown): Promise<void> {
    const base = await readCopyRow(tx, fromStepRunId);
    if (!base) throw copyOutputNotFound();
    const fields = (await fieldsOf(tx, fromStepRunId)).map(draftOf);
    if (edit === undefined) {
      await tx.contentDraftCopy.create({
        data: {
          stepRunId: toStepRunId,
          generatedCopy: copyJson(base.generated),
          copy: copyJson(base.copy),
        },
      });
      await insertFields(tx, toStepRunId, fields);
      return;
    }
    const edits = (edit as { fields?: CopyEditInput[] }).fields ?? [];
    const result = applyCopyEdits({ generated: base.generated, fields }, edits, this.clock.now());
    await tx.contentDraftCopy.create({
      data: {
        stepRunId: toStepRunId,
        generatedCopy: copyJson(base.generated),
        copy: copyJson(result.copy),
      },
    });
    await insertFields(tx, toStepRunId, result.fields);
  }
}

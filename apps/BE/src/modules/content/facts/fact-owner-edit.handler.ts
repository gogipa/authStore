import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import {
  draftOf,
  fieldsOf,
  insertFields,
  recheckOpen,
  type FieldDraft,
  type FieldJson,
} from '../fields/content-field.store.js';
import {
  FACT_FIELD_KEYS,
  isFactFieldKey,
  ORIGIN_FIELD_KEY,
  type FactFieldKey,
} from '../fields/field-keys.js';
import { evidenceUrlOf, OriginInputResolver } from './origin-input.resolver.js';
import { recheckReasonFor, resolveRecheck } from './recheck.js';

type Tx = Prisma.TransactionClient;

/** ⑥-2 산출물 없음(05-2 getCandidateContentFact 404, details.stepCode=NOTICE_RAW) */
export function factOutputNotFound(): ApiException {
  return new ApiException('STEP_OUTPUT_NOT_FOUND', {
    message: formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: '⑥-2 원산지·소재' }),
    details: { stepCode: 'NOTICE_RAW' },
  });
}

/** 오너 수정 EDIT의 필드 하나(05-2 OwnerEditFieldInput) */
interface FactEditInput {
  fieldKey: string;
  value?: unknown;
  evidenceUrl?: string;
  choose?: 'OWNER' | 'GENERATED';
  recheckConfirmed?: boolean;
}

/** 소재 값(오너): 글 1~100자 또는 null('정보 없음') */
function materialValue(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text !== '' && text.length <= 100 ? text : undefined;
}

/** 굽높이 값(오너): `{value: 0 초과 숫자, unit: cm(≤30)|mm(≤300)}` 또는 null */
function heightValue(value: unknown): FieldJson | undefined {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as { value?: unknown; unit?: unknown };
  const keys = Object.keys(v);
  if (keys.some((k) => k !== 'value' && k !== 'unit')) return undefined;
  if (typeof v.value !== 'number' || !Number.isFinite(v.value) || v.value <= 0) return undefined;
  if (v.unit !== 'cm' && v.unit !== 'mm') return undefined;
  if ((v.unit === 'cm' && v.value > 30) || (v.unit === 'mm' && v.value > 300)) return undefined;
  return { value: v.value, unit: v.unit };
}

/**
 * ⑥-2 NOTICE_RAW 오너 수정 산출물 복사(P3-03 규칙 13·14, 05-1 표 B — step-engine owner-edits가 부른다). 머리 행과 사실 필드
 * 다섯 행을 새 버전으로 옮긴다.
 * - EDIT(`{fields}`): 허용 키 = `fact.*` 다섯 개(밖이면 422 FIELD_NOT_EDITABLE). 필드마다 `value`(오너 입력 — 원산지는
 *   `evidenceUrl` 필수 422 EVIDENCE_URL_REQUIRED, 모르는 나라 422 ORIGIN_COUNTRY_UNKNOWN) 또는 `recheckConfirmed: true`
 *   (현재 근거로 다시 확인 — 완료 뒤 '재확인 필요' 해소는 이 새 OWNER_EDIT 버전으로 한다, 05-1 §7.4-32 제안). 저장:
 *   `value_source=OWNER_INPUT`·`owner_confirmed_at`·`basis_item_code`=현재 itemCode·재확인 표시가 있으면 `recheck_resolved_at`.
 *   사실 필드의 `choose`는 받지 않는다(근거가 필요해 값을 다시 넣거나 재확인한다 — Proposed)
 * - RESTORE_VERSION(편집 없음): 그대로 옮기되, 오너 입력 필드의 근거 itemCode가 현재와 다르면 `ITEM_CODE_CHANGED`를 붙인다(규칙 14)
 */
@Injectable()
export class FactOwnerEditHandler {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly origins: OriginInputResolver,
  ) {}

  async copy(tx: Tx, fromStepRunId: number, toStepRunId: number, edit?: unknown): Promise<void> {
    const head = await tx.contentDraftFact.findUnique({ where: { stepRunId: fromStepRunId } });
    if (!head) throw factOutputNotFound();
    const fields = (await fieldsOf(tx, fromStepRunId)).map(draftOf);
    const run = await tx.stepRun.findUniqueOrThrow({ where: { id: toStepRunId } });
    const candidate = await tx.candidate.findUniqueOrThrow({
      where: { id: run.candidateId },
      select: { itemCode: true },
    });
    const itemCode = candidate.itemCode ?? head.sourceItemCode ?? '';
    const rows =
      edit === undefined
        ? fields.map((row) => this.restored(row, itemCode))
        : await this.edited(fields, (edit as { fields?: FactEditInput[] }).fields ?? [], itemCode);
    await tx.contentDraftFact.create({
      data: {
        stepRunId: toStepRunId,
        sourceItemCode: head.sourceItemCode,
        sourcePageUrl: head.sourcePageUrl,
        selectedColorRaw: head.selectedColorRaw,
      },
    });
    await insertFields(tx, toStepRunId, rows);
  }

  private restored(row: FieldDraft, itemCode: string): FieldDraft {
    if (row.valueSource !== 'OWNER_INPUT' || recheckOpen(row)) return row;
    const reason = recheckReasonFor(row.basisItemCode, itemCode);
    return reason ? { ...row, recheckReason: reason, recheckResolvedAt: null } : row;
  }

  private async edited(
    fields: readonly FieldDraft[],
    edits: readonly FactEditInput[],
    itemCode: string,
  ): Promise<FieldDraft[]> {
    for (const edit of edits) {
      if (!isFactFieldKey(edit.fieldKey)) {
        throw new ApiException('FIELD_NOT_EDITABLE', {
          details: { fieldKey: edit.fieldKey, stepCode: 'NOTICE_RAW' },
        });
      }
    }
    const now = this.clock.now();
    const errors: FieldError[] = [];
    const seen = new Set<string>();
    const rows = new Map<string, FieldDraft>(fields.map((row) => [row.fieldKey, { ...row }]));
    const origins: { index: number; edit: FactEditInput }[] = [];
    edits.forEach((edit, index) => {
      const at = `fields[${index}]`;
      const key = edit.fieldKey as FactFieldKey;
      if (seen.has(key)) {
        errors.push({ field: `${at}.fieldKey`, message: '같은 항목을 두 번 고쳤습니다.' });
        return;
      }
      seen.add(key);
      if (edit.choose !== undefined) {
        errors.push({
          field: `${at}.choose`,
          message: '원산지·소재·굽높이는 고르기 대신 값을 다시 넣거나 재확인해 주세요.',
          rejectedValue: edit.choose,
        });
        return;
      }
      if (edit.evidenceUrl !== undefined && evidenceUrlOf(edit.evidenceUrl) === null) {
        errors.push({
          field: `${at}.evidenceUrl`,
          message: '근거 URL은 http·https 주소여야 합니다.',
          rejectedValue: edit.evidenceUrl,
        });
        return;
      }
      const row = rows.get(key);
      if (!row) {
        errors.push({ field: `${at}.fieldKey`, message: '이 버전에 없는 항목입니다.' });
        return;
      }
      const hasValue = Object.hasOwn(edit, 'value') && edit.value !== undefined;
      if (!hasValue) {
        if (edit.recheckConfirmed !== true) {
          errors.push({
            field: at,
            message: '새 값(value) 또는 재확인(recheckConfirmed: true)이 필요합니다.',
          });
        } else if (!recheckOpen(row)) {
          errors.push({
            field: `${at}.recheckConfirmed`,
            message: "'재확인 필요' 표시가 없는 항목입니다.",
          });
        } else {
          rows.set(key, resolveRecheck(row, now, itemCode));
        }
        return;
      }
      if (key === ORIGIN_FIELD_KEY) {
        origins.push({ index, edit });
        return;
      }
      const value =
        key === 'fact.heel_height' ? heightValue(edit.value) : materialValue(edit.value);
      if (value === undefined) {
        errors.push({
          field: `${at}.value`,
          message:
            key === 'fact.heel_height'
              ? "굽높이는 {value: 숫자, unit: 'cm'|'mm'} 또는 null이어야 합니다."
              : '소재는 글(100자 이하) 또는 null이어야 합니다.',
          rejectedValue: edit.value,
        });
        return;
      }
      rows.set(key, this.ownerInput(row, value, evidenceUrlOf(edit.evidenceUrl), now, itemCode));
    });
    if (errors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors: errors });
    for (const { index, edit } of origins) {
      const url = evidenceUrlOf(edit.evidenceUrl);
      if (url === null) throw new ApiException('EVIDENCE_URL_REQUIRED');
      const countries = await this.origins.resolve(edit.value, `fields[${index}].value`);
      rows.set(
        ORIGIN_FIELD_KEY,
        this.ownerInput(rows.get(ORIGIN_FIELD_KEY)!, countries, url, now, itemCode),
      );
    }
    return FACT_FIELD_KEYS.map((key) => rows.get(key)).filter(
      (row): row is FieldDraft => row !== undefined,
    );
  }

  /** 오너 입력 행(추출 값·방법은 `generated_value`·`extraction_method`로 남는다) */
  private ownerInput(
    row: FieldDraft,
    value: FieldJson | null,
    evidenceUrl: string | null,
    now: Date,
    itemCode: string,
  ): FieldDraft {
    return {
      ...row,
      value,
      valueSource: 'OWNER_INPUT',
      evidenceUrl,
      evidenceQuote: null,
      evidenceImageAssetId: null,
      basisItemCode: itemCode,
      ownerConfirmedAt: now,
      choicePending: false,
      recheckResolvedAt: row.recheckReason !== null ? now : null,
    };
  }
}

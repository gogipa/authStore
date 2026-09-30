import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import { SettingsService } from '../../settings/settings.service.js';
import { INPUT_KEYS } from '../../step-engine/domain/input-keys.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import {
  draftOf,
  fieldsOf,
  insertFields,
  recheckOpen,
  type FieldDraft,
  type FieldJson,
} from '../fields/content-field.store.js';
import {
  materialBasisSha256,
  originBasisSha256,
  sizeBasisSha256,
  type AssemblyFacts,
} from './assembly-facts.js';
import {
  ASSEMBLY_RECHECK,
  basisOf,
  isAssemblyFieldKey,
  isNoticeFieldKey,
  NOTICE_FIELD_PROPS,
  ORIGIN_AREA_FIELD_KEY,
  PRODUCT_NAME_FIELD_KEY,
  type AssemblyBasis,
  type AssemblyOverrides,
  type OriginAreaValue,
} from './assembly-fields.js';
import { readAssemblyFacts } from './assembly-sources.js';
import { assemblyRowOf, findAssembly, insertAssembly } from './assembly.store.js';
import { applyEditToRow, type AssemblyRow } from './assemble.js';
import {
  OriginCodeResolver,
  parseOriginAreaChoice,
  resolveOwnerOriginArea,
} from './notice/origin-code.resolver.js';

type Tx = Prisma.TransactionClient;

/** ⑥-3 산출물 없음(05-2 getCandidateContentAssembly 404, details.stepCode=NOTICE_HTML) */
export function assemblyOutputNotFound(): ApiException {
  return new ApiException('STEP_OUTPUT_NOT_FOUND', {
    message: formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: '⑥-3 고시·HTML' }),
    details: { stepCode: 'NOTICE_HTML' },
  });
}

/** 오너 수정 EDIT 필드 하나(05-2 OwnerEditFieldInput) */
interface AssemblyEditInput {
  fieldKey: string;
  value?: unknown;
  evidenceUrl?: string;
  choose?: 'OWNER' | 'GENERATED';
  recheckConfirmed?: boolean;
}

/** 상품명 저장 칸 상한(ERD `product_name varchar(255)`) — 100자 초과는 저장하고 경고만(규칙 14) */
export const PRODUCT_NAME_STORE_MAX = 255;
/** 고시 문구 한 칸 상한(Proposed — 커머스API 필드 길이는 M0 S3) */
export const NOTICE_TEXT_MAX = 500;

function textValue(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text !== '' && [...text].length <= max ? text : undefined;
}

/**
 * ⑥-3 NOTICE_HTML 오너 수정 산출물 복사(P3-04 규칙 3·9·14·15, 05-1 표 B — step-engine owner-edits가 실행기 `copyOutput`으로 부른다).
 * - EDIT(`{fields}`): 허용 키 = `product_name`·`notice.*` 13개·`notice.origin_area`(밖이면 — 고지 블록 키 포함 — 422
 *   FIELD_NOT_EDITABLE). 값: 상품명 1~255자(100자 초과는 저장하고 응답 경고), `notice.height` 글 또는 null(키 빼기), 그 밖 고시
 *   글 1~500자, 원산지 코드(수입산 02 계열·`"03"`·`"04"` 코드 글자 또는 `{code, content?, plural?}`)(03·04는 사양 블록에 실제 나라가 있어야 —
 *   422 ORIGIN_CODE_NOT_ALLOWED). `recheckConfirmed: true`는 재확인 표시가 있는 notice.size·material·origin_area만. `choose`·
 *   `evidenceUrl`은 받지 않는다(422 VALIDATION_FAILED). 저장: 필드 행 `OWNER_INPUT`·`basis_sha256`(규칙 15 근거)·
 *   `owner_confirmed_at`, 조립 행은 바탕 버전 값에 오너 값을 덮어쓴다(고시 material·size는 사양 블록 같은 행도 — HTML 다시 해시)
 * - RESTORE_VERSION(편집 없음): 그대로 옮기되, 재확인 대상 오너 값의 근거가 지금(③·⑥-2 현재 완료 버전)과 다르면 표시를 붙인다
 */
@Injectable()
export class AssemblyOwnerEditHandler {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly api: StepEngineApi,
    private readonly settings: SettingsService,
    private readonly origins: OriginCodeResolver,
  ) {}

  async copy(tx: Tx, fromStepRunId: number, toStepRunId: number, edit?: unknown): Promise<void> {
    const base = await findAssembly(tx, fromStepRunId);
    if (!base) throw assemblyOutputNotFound();
    const row = assemblyRowOf(base);
    const fields = (await fieldsOf(tx, fromStepRunId)).map(draftOf);
    const run = await tx.stepRun.findUniqueOrThrow({ where: { id: toStepRunId } });
    if (edit === undefined) {
      const current = await this.currentBasis(tx, run.candidateId);
      await insertAssembly(tx, toStepRunId, row);
      await insertFields(
        tx,
        toStepRunId,
        fields.map((f) => (current ? this.restored(f, current) : f)),
      );
      return;
    }
    const candidate = await tx.candidate.findUniqueOrThrow({
      where: { id: run.candidateId },
      select: { itemCode: true },
    });
    const edits = (edit as { fields?: AssemblyEditInput[] }).fields ?? [];
    const { overrides, rows } = await this.edited(tx, fromStepRunId, row, fields, edits, {
      itemCode: candidate.itemCode,
    });
    await insertAssembly(tx, toStepRunId, applyEditToRow(row, overrides));
    await insertFields(tx, toStepRunId, rows);
  }

  /** 지금 근거(③·⑥-2 현재 완료 버전). 둘 중 하나라도 없으면 null(표시하지 않는다) */
  private async currentBasis(tx: Tx, candidateId: number): Promise<AssemblyBasis | null> {
    const pricing = await this.api.currentCompletedRun(candidateId, 'PRICING', tx);
    const fact = await this.api.currentCompletedRun(candidateId, 'NOTICE_RAW', tx);
    if (!pricing || !fact) return null;
    const sizes = await this.api.readPricingSaleSizes(pricing.id, tx);
    const facts = await readAssemblyFacts(tx, fact.id);
    if (!sizes || !facts) return null;
    return basisOfValues(sizes.saleSizesMm, facts);
  }

  private restored(row: FieldDraft, current: AssemblyBasis): FieldDraft {
    const reason = ASSEMBLY_RECHECK[row.fieldKey];
    if (!reason || row.valueSource !== 'OWNER_INPUT' || recheckOpen(row)) return row;
    const basis = basisOf(row.fieldKey, current);
    return basis !== null && row.basisSha256 !== basis
      ? { ...row, recheckReason: reason, recheckResolvedAt: null }
      : row;
  }

  /** 바탕 버전의 근거(그 버전이 읽은 ⑥-2 결과 + 고시 사이즈) — 오너 입력의 `basis_sha256` */
  private async baseContext(
    tx: Tx,
    baseStepRunId: number,
    row: AssemblyRow,
  ): Promise<{ basis: AssemblyBasis; facts: AssemblyFacts | null }> {
    const input = await tx.stepRunInput.findFirst({
      where: { stepRunId: baseStepRunId, inputKey: INPUT_KEYS.noticeRawFacts },
      select: { sourceStepRunId: true },
    });
    const facts =
      input?.sourceStepRunId != null ? await readAssemblyFacts(tx, input.sourceStepRunId) : null;
    const origin = facts ?? { origin: [], materials: { upper: null, lining: null, sole: null } };
    return {
      basis: {
        size: sizeBasisSha256(row.noticeSizesMm),
        material: materialBasisSha256(origin),
        origin: originBasisSha256(origin),
      },
      facts,
    };
  }

  private async edited(
    tx: Tx,
    baseStepRunId: number,
    row: AssemblyRow,
    fields: readonly FieldDraft[],
    edits: readonly AssemblyEditInput[],
    candidate: { itemCode: string | null },
  ): Promise<{ overrides: AssemblyOverrides; rows: FieldDraft[] }> {
    for (const edit of edits) {
      if (!isAssemblyFieldKey(edit.fieldKey)) {
        throw new ApiException('FIELD_NOT_EDITABLE', {
          details: { fieldKey: edit.fieldKey, stepCode: 'NOTICE_HTML' },
        });
      }
    }
    const now = this.clock.now();
    const { basis, facts } = await this.baseContext(tx, baseStepRunId, row);
    const errors: FieldError[] = [];
    const seen = new Set<string>();
    const byKey = new Map(fields.map((f) => [f.fieldKey, f]));
    const overrides: AssemblyOverrides = { notice: {} };
    const origins: { index: number; value: unknown }[] = [];
    const ownerRow = (key: string, value: FieldJson | null, generated: FieldJson | null) => {
      const prev = byKey.get(key);
      const reason = prev?.recheckReason ?? null;
      const draft: FieldDraft = {
        fieldKey: key,
        value,
        generatedValue: prev?.valueSource === 'OWNER_INPUT' ? prev.generatedValue : generated,
        valueSource: 'OWNER_INPUT',
        extractionMethod: null,
        evidenceQuote: null,
        evidenceUrl: null,
        evidenceImageAssetId: null,
        basisItemCode: candidate.itemCode,
        basisSha256: basisOf(key, basis),
        ownerConfirmedAt: now,
        choicePending: false,
        recheckReason: reason,
        recheckResolvedAt: reason !== null ? now : null,
      };
      byKey.set(key, draft);
    };
    edits.forEach((edit, index) => {
      const at = `fields[${index}]`;
      if (seen.has(edit.fieldKey)) {
        errors.push({ field: `${at}.fieldKey`, message: '같은 항목을 두 번 고쳤습니다.' });
        return;
      }
      seen.add(edit.fieldKey);
      if (edit.choose !== undefined) {
        errors.push({
          field: `${at}.choose`,
          message: '⑥-3 항목은 고르기 대신 값을 다시 넣어 주세요.',
          rejectedValue: edit.choose,
        });
        return;
      }
      if (edit.evidenceUrl !== undefined) {
        errors.push({
          field: `${at}.evidenceUrl`,
          message: '⑥-3 항목에는 근거 URL을 넣지 않습니다.',
          rejectedValue: edit.evidenceUrl,
        });
        return;
      }
      const hasValue = Object.hasOwn(edit, 'value') && edit.value !== undefined;
      if (!hasValue) {
        const prev = byKey.get(edit.fieldKey);
        if (edit.recheckConfirmed !== true) {
          errors.push({
            field: at,
            message: '새 값(value) 또는 재확인(recheckConfirmed: true)이 필요합니다.',
          });
        } else if (!prev || !recheckOpen(prev)) {
          errors.push({
            field: `${at}.recheckConfirmed`,
            message: "'재확인 필요' 표시가 없는 항목입니다.",
          });
        } else {
          byKey.set(edit.fieldKey, {
            ...prev,
            basisItemCode: candidate.itemCode,
            basisSha256: basisOf(edit.fieldKey, basis),
            ownerConfirmedAt: now,
            recheckResolvedAt: now,
          });
        }
        return;
      }
      if (edit.fieldKey === ORIGIN_AREA_FIELD_KEY) {
        origins.push({ index, value: edit.value });
        return;
      }
      if (edit.fieldKey === PRODUCT_NAME_FIELD_KEY) {
        const name = textValue(edit.value, PRODUCT_NAME_STORE_MAX);
        if (name === undefined) {
          errors.push({
            field: `${at}.value`,
            message: `상품명은 1~${PRODUCT_NAME_STORE_MAX}자 글이어야 합니다(100자를 넘으면 경고만 합니다).`,
            rejectedValue: edit.value,
          });
          return;
        }
        overrides.productName = name;
        ownerRow(edit.fieldKey, name, row.productName);
        return;
      }
      if (isNoticeFieldKey(edit.fieldKey)) {
        const prop = NOTICE_FIELD_PROPS[edit.fieldKey];
        const value =
          prop === 'height' && edit.value === null ? null : textValue(edit.value, NOTICE_TEXT_MAX);
        if (value === undefined) {
          errors.push({
            field: `${at}.value`,
            message:
              prop === 'height'
                ? `굽높이는 글(1~${NOTICE_TEXT_MAX}자) 또는 null(항목 빼기)이어야 합니다.`
                : `고시 문구는 1~${NOTICE_TEXT_MAX}자 글이어야 합니다.`,
            rejectedValue: edit.value,
          });
          return;
        }
        overrides.notice[prop] = value;
        ownerRow(edit.fieldKey, value, row.noticeFields[prop] ?? null);
      }
    });
    if (errors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors: errors });
    for (const { index, value } of origins) {
      const field = `fields[${index}].value`;
      const choice = parseOriginAreaChoice(value);
      if (!choice) {
        throw new ApiException('VALIDATION_FAILED', {
          fieldErrors: [
            {
              field,
              message:
                '원산지 코드는 수입산 02 계열·03·04 코드 글자 또는 {code, content?, plural?}이어야 합니다.',
              rejectedValue: value,
            },
          ],
        });
      }
      const resolved = await resolveOwnerOriginArea(choice, {
        field,
        specOriginLabel: row.specOriginLabel,
        countries: facts?.origin ?? [],
        dictionary: this.settings.current().content.originCountries,
        findCode: (code) => this.origins.findCode(code),
      });
      const stored: OriginAreaValue = {
        code: resolved.code,
        content: resolved.content,
        plural: resolved.plural,
      };
      overrides.origin = stored;
      ownerRow(
        ORIGIN_AREA_FIELD_KEY,
        { ...stored },
        {
          code: row.originAreaCode,
          content: row.originAreaContent,
          plural: row.originAreaPlural,
        },
      );
    }
    const rows = [...byKey.values()].filter((f) => isAssemblyFieldKey(f.fieldKey));
    return { overrides, rows };
  }
}

/** 근거 요약값(판매 사이즈 + ⑥-2 결과) */
export function basisOfValues(sizes: readonly number[], facts: AssemblyFacts): AssemblyBasis {
  return {
    size: sizeBasisSha256(sizes),
    material: materialBasisSha256(facts),
    origin: originBasisSha256(facts),
  };
}

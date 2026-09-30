import { Prisma, type ContentDraftField } from '../../../generated/prisma/client.js';
import type { ExtractionMethod, RecheckReason } from './field-keys.js';

type Db = Prisma.TransactionClient;

/** JSON 값(content_draft_field.value·generated_value) */
export type FieldJson = Prisma.JsonValue;

/**
 * content_draft_field 한 행의 쓸 값(ERD §3.8). 행은 그 실행이 열려 있는 동안만 고치고(`trg_output_frozen`), 완료 뒤 고치기는
 * 오너 수정 새 버전에 새 행으로 쓴다.
 */
export interface FieldDraft {
  fieldKey: string;
  /** 유효 값. null = '정보 없음' */
  value: FieldJson | null;
  /** 이 버전에서 단계가 계산·추출한 값 */
  generatedValue: FieldJson | null;
  valueSource: 'GENERATED' | 'OWNER_INPUT';
  extractionMethod: ExtractionMethod | null;
  evidenceQuote: string | null;
  evidenceUrl: string | null;
  evidenceImageAssetId: number | null;
  basisItemCode: string | null;
  basisSha256: string | null;
  ownerConfirmedAt: Date | null;
  choicePending: boolean;
  recheckReason: RecheckReason | null;
  recheckResolvedAt: Date | null;
}

/** nullable jsonb에 쓰는 값(null은 SQL NULL) */
function jsonInput(value: FieldJson | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : value;
}

/** 행 → 쓸 값(다음 버전으로 옮길 때) */
export function draftOf(row: ContentDraftField): FieldDraft {
  return {
    fieldKey: row.fieldKey,
    value: row.value ?? null,
    generatedValue: row.generatedValue ?? null,
    valueSource: row.valueSource as FieldDraft['valueSource'],
    extractionMethod: row.extractionMethod as ExtractionMethod | null,
    evidenceQuote: row.evidenceQuote,
    evidenceUrl: row.evidenceUrl,
    evidenceImageAssetId: row.evidenceImageAssetId,
    basisItemCode: row.basisItemCode,
    basisSha256: row.basisSha256,
    ownerConfirmedAt: row.ownerConfirmedAt,
    choicePending: row.choicePending,
    recheckReason: row.recheckReason as RecheckReason | null,
    recheckResolvedAt: row.recheckResolvedAt,
  };
}

/** '재확인 필요' 표시가 풀리지 않았는가(ERD: recheck_reason IS NOT NULL AND recheck_resolved_at IS NULL) */
export function recheckOpen(row: Pick<FieldDraft, 'recheckReason' | 'recheckResolvedAt'>): boolean {
  return row.recheckReason !== null && row.recheckResolvedAt === null;
}

/** 버전의 필드 행(키 순서는 부르는 쪽이 정한다) */
export function fieldsOf(db: Db, stepRunId: number): Promise<ContentDraftField[]> {
  return db.contentDraftField.findMany({ where: { stepRunId }, orderBy: { id: 'asc' } });
}

/** 필드 행 여러 개를 새로 쓴다(열린 실행 또는 오너 수정 새 버전) */
export async function insertFields(
  tx: Db,
  stepRunId: number,
  drafts: readonly FieldDraft[],
): Promise<void> {
  if (drafts.length === 0) return;
  await tx.contentDraftField.createMany({
    data: drafts.map((draft) => ({
      stepRunId,
      fieldKey: draft.fieldKey,
      value: jsonInput(draft.value),
      generatedValue: jsonInput(draft.generatedValue),
      valueSource: draft.valueSource,
      extractionMethod: draft.extractionMethod,
      evidenceQuote: draft.evidenceQuote,
      evidenceUrl: draft.evidenceUrl,
      evidenceImageAssetId: draft.evidenceImageAssetId,
      basisItemCode: draft.basisItemCode,
      basisSha256: draft.basisSha256,
      ownerConfirmedAt: draft.ownerConfirmedAt,
      choicePending: draft.choicePending,
      recheckReason: draft.recheckReason,
      recheckResolvedAt: draft.recheckResolvedAt,
    })),
  });
}

/** 열린 실행의 필드 행 하나를 고친다(오너 입력 — `trg_output_frozen`이 닫힌 실행을 막는다) */
export function updateField(
  tx: Db,
  id: number,
  draft: FieldDraft,
  now: Date,
): Promise<ContentDraftField> {
  return tx.contentDraftField.update({
    where: { id },
    data: {
      value: jsonInput(draft.value),
      generatedValue: jsonInput(draft.generatedValue),
      valueSource: draft.valueSource,
      extractionMethod: draft.extractionMethod,
      evidenceQuote: draft.evidenceQuote,
      evidenceUrl: draft.evidenceUrl,
      evidenceImageAssetId: draft.evidenceImageAssetId,
      basisItemCode: draft.basisItemCode,
      basisSha256: draft.basisSha256,
      ownerConfirmedAt: draft.ownerConfirmedAt,
      choicePending: draft.choicePending,
      recheckReason: draft.recheckReason,
      recheckResolvedAt: draft.recheckResolvedAt,
      updatedAt: now,
    },
  });
}

/**
 * 이 후보·단계에서 `beforeVersion`보다 앞 버전 가운데 산출물(`has`)이 있는 가장 최근 버전 id(다시 실행이 오너 입력을 가져올 바탕 —
 * 재실행 필요 버전도 포함). 없으면 null
 */
export async function latestVersionWithOutput(
  db: Db,
  candidateId: number,
  stepCode: 'COPY' | 'NOTICE_RAW' | 'NOTICE_HTML',
  beforeVersion: number,
): Promise<number | null> {
  const runs = await db.stepRun.findMany({
    where: { candidateId, stepCode, version: { lt: beforeVersion } },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      contentDraftCopy: { select: { id: true } },
      contentDraftFact: { select: { id: true } },
      contentDraftAssembly: { select: { id: true } },
    },
    take: 50,
  });
  const found = runs.find((run) =>
    stepCode === 'COPY'
      ? run.contentDraftCopy !== null
      : stepCode === 'NOTICE_RAW'
        ? run.contentDraftFact !== null
        : run.contentDraftAssembly !== null,
  );
  return found?.id ?? null;
}

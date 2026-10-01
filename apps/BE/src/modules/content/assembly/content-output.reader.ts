import type { Prisma } from '../../../generated/prisma/client.js';
import type { Db } from '../../step-engine/candidates/step-engine-tx.js';
import type {
  ContentAssemblyView,
  ContentCopyView,
  ContentFactsView,
  ContentOutputReader,
  ContentRecheckView,
} from '../../step-engine/ports/step-output-readers.port.js';
import { readCopyRow } from '../copy/copy-owner-edit.handler.js';
import { fieldsOf } from '../fields/content-field.store.js';
import { ORIGIN_FIELD_KEY } from '../fields/field-keys.js';
import { assemblyFactsOf } from './assembly-facts.js';
import { assemblyRowOf, findAssembly } from './assembly.store.js';
import { SHOES_NOTICE_KEYS } from './notice/shoes-notice.mapper.js';
import { parseSaleSizes } from './notice/size-format.js';
import { parseSpecRows } from './spec-block.renderer.js';

/**
 * ⑥ 산출물 읽기(P4-02 Proposed — step-engine 창구 `StepEngineApi.readContentAssembly`·`readContentFacts`·`readContentCopy`, C4 §3.1).
 * 최종 승인 미리보기·요청 초안·사전 검증(registration)이 읽는다 — registration은 content를 import하지 않는다(03-ADR-003). content가
 * 자기 표기 규칙으로 해석한 값만 더해 준다:
 * - `specSizesMm`: 사양 블록 사이즈 행(`250~265·275mm (JP …)`)을 `parseSaleSizes`로 되읽은 mm(사전 검증 `OPTIONS` — 고시·사양·옵션
 *   사이즈 집합 비교)
 * - `noticeRequiredKeys`: SHOES 고시에서 비면 안 되는 키(`SHOES_NOTICE_KEYS` − `height` — 굽높이는 넣지 않는 신발이 있다. 사전 검증
 *   `REQUIRED_FIELDS`)
 * - `rechecks`: 그 버전 필드 행의 풀리지 않은 '재확인 필요' 표시(사전 검증 `ORIGIN` — 소재·굽높이·고시도 여기서 막힌다, P3-03·P3-04)
 */

/** SHOES 고시 필수 키(굽높이 빼고) */
export const NOTICE_REQUIRED_KEYS: readonly string[] = SHOES_NOTICE_KEYS.filter(
  (key) => key !== 'height',
);

function rechecksOf(
  rows: readonly {
    fieldKey: string;
    recheckReason: string | null;
    recheckResolvedAt: Date | null;
  }[],
): ContentRecheckView[] {
  // ERD '재확인 필요' = recheck_reason 있고 recheck_resolved_at 없음(content-field.store `recheckOpen`과 같은 조건)
  return rows.flatMap((row) =>
    row.recheckReason !== null && row.recheckResolvedAt === null
      ? [{ fieldKey: row.fieldKey, recheckReason: row.recheckReason }]
      : [],
  );
}

function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[key] = v;
  }
  return out;
}

export async function readContentAssembly(
  db: Db,
  noticeHtmlStepRunId: number,
): Promise<ContentAssemblyView | null> {
  const row = await findAssembly(db, noticeHtmlStepRunId);
  if (!row) return null;
  const assembly = assemblyRowOf(row);
  const sizeRow = parseSpecRows(assembly.specBlockHtml).find((r) => r.key === 'SIZE');
  const fields = await fieldsOf(db, noticeHtmlStepRunId);
  return {
    noticeHtmlStepRunId,
    productName: assembly.productName,
    noticeFields: stringRecord(assembly.noticeFields),
    noticeRequiredKeys: [...NOTICE_REQUIRED_KEYS],
    noticeSizesMm: [...assembly.noticeSizesMm].sort((a, b) => a - b),
    specSizesMm: sizeRow ? parseSaleSizes(sizeRow.value) : null,
    originAreaCode: assembly.originAreaCode,
    originAreaPlural: assembly.originAreaPlural,
    originAreaContent: assembly.originAreaContent,
    importer: assembly.importer,
    specOriginLabel: assembly.specOriginLabel,
    disclosureBlocks: assembly.disclosureBlocks.map((block) => ({
      blockId: block.block_id,
      sha256: block.sha256,
      conditional: block.conditional,
    })),
    rechecks: rechecksOf(fields),
  };
}

function countriesOf(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value)
    ? value.filter((c): c is string => typeof c === 'string' && c.trim() !== '')
    : [];
}

export async function readContentFacts(
  db: Db,
  noticeRawStepRunId: number,
): Promise<ContentFactsView | null> {
  const head = await db.contentDraftFact.findUnique({ where: { stepRunId: noticeRawStepRunId } });
  if (!head) return null;
  const fields = await fieldsOf(db, noticeRawStepRunId);
  const facts = assemblyFactsOf(fields, head.selectedColorRaw);
  const origin = fields.find((field) => field.fieldKey === ORIGIN_FIELD_KEY);
  return {
    noticeRawStepRunId,
    sourceItemCode: head.sourceItemCode,
    origin: origin
      ? {
          countries: countriesOf(origin.value),
          valueSource: origin.valueSource === 'OWNER_INPUT' ? 'OWNER_INPUT' : 'GENERATED',
          extractionMethod: origin.extractionMethod,
          evidenceUrl: origin.evidenceUrl,
          basisItemCode: origin.basisItemCode,
          ownerConfirmedAt: origin.ownerConfirmedAt,
        }
      : null,
    materials: facts.materials,
    rechecks: rechecksOf(fields),
  };
}

export async function readContentCopy(
  db: Db,
  copyStepRunId: number,
): Promise<ContentCopyView | null> {
  const row = await readCopyRow(db, copyStepRunId);
  if (!row) return null;
  const copy = row.copy;
  return {
    copyStepRunId,
    texts: [
      copy.headline,
      ...copy.selling_points,
      copy.body,
      copy.fit_and_styling,
      copy.size_guide,
    ],
  };
}

export const contentOutputReader: ContentOutputReader = {
  readAssembly: readContentAssembly,
  readFacts: readContentFacts,
  readCopy: readContentCopy,
};

import type { ContentDraftAssembly, Prisma } from '../../../generated/prisma/client.js';
import type { AssemblyRow } from './assemble.js';
import type { DisclosureBlockRecord } from './disclosure/disclosure-renderer.js';
import { orderedNotice, type ShoesNoticeFields } from './notice/shoes-notice.mapper.js';

type Db = Prisma.TransactionClient;

/**
 * `content_draft_assembly` 읽기/쓰기(ERD §3.8, P3-04). ⑥-3 버전의 1:1 행이고 `trg_output_frozen` 대상이라, 실행이 열려 있을 때(끝
 * 트랜잭션 `persist`) 또는 오너 수정 새 버전(`copyOutput` — 새 버전이 아직 이 트랜잭션 안)에서만 쓴다. 완료 뒤 UPDATE는 트리거가
 * 막는다.
 */

/** YYYY-MM-DD → @db.Date 값(UTC 자정 — DB 세션 TimeZone=UTC, P1-01) */
export function dateValue(text: string): Date {
  return new Date(`${text}T00:00:00.000Z`);
}

export function dateText(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function insertAssembly(tx: Db, stepRunId: number, row: AssemblyRow): Promise<number> {
  const created = await tx.contentDraftAssembly.create({
    data: {
      stepRunId,
      productName: row.productName,
      noticeFields: row.noticeFields as unknown as Prisma.InputJsonObject,
      noticeSizesMm: row.noticeSizesMm,
      originAreaCode: row.originAreaCode,
      originAreaPlural: row.originAreaPlural,
      originAreaContent: row.originAreaContent,
      importer: row.importer,
      specBlockHtml: row.specBlockHtml,
      specOriginLabel: row.specOriginLabel,
      disclosureTemplateVersion: row.disclosureTemplateVersion,
      disclosureTemplateDate: dateValue(row.disclosureTemplateDate),
      disclosureBlockIds: row.disclosureBlockIds,
      disclosureBlocks: row.disclosureBlocks as unknown as Prisma.InputJsonArray,
      html: row.html,
      htmlSha256: row.htmlSha256,
    },
  });
  return created.id;
}

function blocksOf(value: Prisma.JsonValue): DisclosureBlockRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const v = item as Record<string, unknown> | null;
    return v && typeof v.block_id === 'string' && typeof v.sha256 === 'string'
      ? [{ block_id: v.block_id, sha256: v.sha256, conditional: v.conditional === true }]
      : [];
  });
}

/** DB 행 → 조립 값 */
export function assemblyRowOf(row: ContentDraftAssembly): AssemblyRow {
  return {
    productName: row.productName,
    noticeFields: orderedNotice(row.noticeFields as unknown as ShoesNoticeFields),
    noticeSizesMm: [...row.noticeSizesMm],
    originAreaCode: row.originAreaCode,
    originAreaPlural: row.originAreaPlural,
    originAreaContent: row.originAreaContent,
    importer: row.importer,
    specBlockHtml: row.specBlockHtml,
    specOriginLabel: row.specOriginLabel,
    disclosureTemplateVersion: row.disclosureTemplateVersion,
    disclosureTemplateDate: dateText(row.disclosureTemplateDate),
    disclosureBlockIds: [...row.disclosureBlockIds],
    disclosureBlocks: blocksOf(row.disclosureBlocks),
    html: row.html,
    htmlSha256: row.htmlSha256,
  };
}

export function findAssembly(db: Db, stepRunId: number): Promise<ContentDraftAssembly | null> {
  return db.contentDraftAssembly.findUnique({ where: { stepRunId } });
}

import type {
  Prisma,
  TagCompetitorInput,
  TagCompetitorItem,
} from '../../../generated/prisma/client.js';
import type { CompetitorTagRow } from '../pipeline/tag-pipeline.types.js';
import type { ParsedCompetitorInput } from './parsers/parsed-input.js';

type Db = Prisma.TransactionClient;

/** tag_competitor_input.source_type(ck_tag_ci_source) */
export const COMPETITOR_SOURCE_TYPES = ['SELLERFINDER', 'BROWSER_RESPONSE', 'FREE_TEXT'] as const;
export type CompetitorSourceType = (typeof COMPETITOR_SOURCE_TYPES)[number];

export type CompetitorInputWithItems = TagCompetitorInput & { items: TagCompetitorItem[] };

/**
 * 경쟁 태그 입력 저장·읽기(P3-05, ERD `tag_competitor_input`·`tag_competitor_item`). 입력은 지우지 않고(`removed_at`만,
 * 삭제 금지 트리거) 줄은 추가만(append-only 트리거). 저장하는 값은 파서가 준 태그·순위·상품 ID·빈도뿐이다.
 */

/** 후보의 활성 입력(빼지 않은 것) — 입력 순서(imported_at → id) */
export function activeInputs(db: Db, candidateId: number): Promise<CompetitorInputWithItems[]> {
  return db.tagCompetitorInput.findMany({
    where: { candidateId, removedAt: null },
    orderBy: [{ importedAt: 'asc' }, { id: 'asc' }],
    include: { items: { orderBy: { seq: 'asc' } } },
  });
}

/** 활성 입력 id(오름차순 — ⑦ 시작 조건 값) */
export async function activeInputIds(db: Db, candidateId: number): Promise<number[]> {
  const rows = await db.tagCompetitorInput.findMany({
    where: { candidateId, removedAt: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** 입력들의 경쟁 태그 줄(입력 순서 → seq). 다른 후보의 입력은 읽지 않는다(ERD §7.2-13 — 앱이 검사) */
export async function competitorRowsOf(
  db: Db,
  candidateId: number,
  inputIds: readonly number[],
): Promise<CompetitorTagRow[]> {
  if (inputIds.length === 0) return [];
  const inputs = await db.tagCompetitorInput.findMany({
    where: { id: { in: [...inputIds] }, candidateId },
    orderBy: [{ importedAt: 'asc' }, { id: 'asc' }],
    include: { items: { orderBy: { seq: 'asc' } } },
  });
  return inputs.flatMap((input) =>
    input.items.map((item) => ({
      tagText: item.tagText,
      sourceRank: item.sourceRank,
      frequency: input.hasFrequency ? item.frequency : null,
    })),
  );
}

export async function insertCompetitorInput(
  tx: Db,
  candidateId: number,
  sourceType: CompetitorSourceType,
  parsed: ParsedCompetitorInput,
  importedAt: Date,
): Promise<CompetitorInputWithItems> {
  const input = await tx.tagCompetitorInput.create({
    data: {
      candidateId,
      sourceType,
      hasFrequency: parsed.hasFrequency,
      itemCount: parsed.tags.length,
      importedAt,
    },
  });
  await tx.tagCompetitorItem.createMany({
    data: parsed.tags.map((tag, index) => ({
      tagCompetitorInputId: input.id,
      seq: index + 1,
      tagText: tag.tagText,
      sourceRank: tag.sourceRank,
      naverProductId: tag.naverProductId,
      frequency: parsed.hasFrequency ? tag.frequency : null,
    })),
  });
  const items = await tx.tagCompetitorItem.findMany({
    where: { tagCompetitorInputId: input.id },
    orderBy: { seq: 'asc' },
  });
  return { ...input, items };
}

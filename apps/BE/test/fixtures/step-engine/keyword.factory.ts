import type { Keyword } from '../../../src/generated/prisma/client.js';
import type { PrismaService } from '../../../src/prisma/prisma.service.js';

/** 키워드 한 줄의 상태: G1에서 고름 · 안 고름 · 아동화 제외(CHILD, ck_keyword_excluded_not_selected라 고를 수 없다) */
export type KeywordFixtureState = 'SELECTED' | 'NOT_SELECTED' | 'CHILD_EXCLUDED';

let rankSeq = 0;

/** keyword_snapshot 1행(붙여넣기 수집, 완료) */
export async function createKeywordSnapshot(prisma: PrismaService): Promise<number> {
  const row = await prisma.keywordSnapshot.create({
    data: { method: 'PASTE', status: 'COMPLETED' },
    select: { id: true },
  });
  return row.id;
}

/**
 * keyword 1행. 스냅샷을 주지 않으면 새로 만든다. 예시 키워드는 화면시안_명세 §4(남성신발 순위)에서 가져왔다.
 */
export async function createKeyword(
  prisma: PrismaService,
  input: { state?: KeywordFixtureState; keyword?: string; snapshotId?: number } = {},
): Promise<Keyword> {
  const snapshotId = input.snapshotId ?? (await createKeywordSnapshot(prisma));
  const state = input.state ?? 'SELECTED';
  rankSeq += 1;
  return prisma.keyword.create({
    data: {
      keywordSnapshotId: snapshotId,
      cid: '50000169',
      rank: rankSeq,
      keyword: input.keyword ?? (state === 'CHILD_EXCLUDED' ? '키즈 운동화' : '아식스 젤카야노14'),
      excludedReason: state === 'CHILD_EXCLUDED' ? 'CHILD' : null,
      selectedAt: state === 'SELECTED' ? new Date('2026-09-28T00:00:00Z') : null,
    },
  });
}

import type { Db } from '../step-engine/candidates/step-engine-tx.js';
import type {
  FinalTagsView,
  TagsOutputReader,
} from '../step-engine/ports/step-output-readers.port.js';
import { sellerTagsOf } from './pipeline/request-format.js';

/**
 * ⑦ 최종 태그 읽기(P4-02 Proposed — step-engine 창구 `StepEngineApi.readFinalTags`, C4 §3.1). 최종 승인 미리보기(`tags`)·요청 초안
 * (`seoInfo.sellerTags` — tags 전송 형식 `sellerTagsOf` 그대로)·사전 검증 `TAGS`(개수·restricted-tags 재검증)가 읽는다.
 * 최종 태그 = 그 ⑦ 버전의 `tag_candidate` outcome=SELECTED를 `final_order` 순으로(P3-05 남은 일). registration은 tags를 import하지
 * 않는다(03-ADR-003). 산출물이 없으면 null.
 */
export async function readFinalTags(db: Db, tagsStepRunId: number): Promise<FinalTagsView | null> {
  const set = await db.tagSet.findUnique({
    where: { stepRunId: tagsStepRunId },
    select: { id: true },
  });
  if (!set) return null;
  const rows = await db.tagCandidate.findMany({
    where: { tagSetId: set.id, outcome: 'SELECTED', finalOrder: { not: null } },
    orderBy: { finalOrder: 'asc' },
    select: { text: true, code: true, finalOrder: true },
  });
  const tags = rows.map((row) => ({ text: row.text, code: row.code, finalOrder: row.finalOrder! }));
  return { tagsStepRunId, tags, sellerTags: sellerTagsOf(tags) };
}

export const tagsOutputReader: TagsOutputReader = { readFinalTags };

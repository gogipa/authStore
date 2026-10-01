import type { Db } from '../../step-engine/candidates/step-engine-tx.js';
import type {
  NoticeHtmlReader,
  NoticeHtmlView,
} from '../../step-engine/ports/step-output-readers.port.js';
import { findAssembly } from './assembly.store.js';

/**
 * ⑥-3 상세 HTML 읽기(P4-01 Proposed — step-engine 창구 `StepEngineApi.readNoticeHtml`, C4 §3.1). ⑧ 업로드가 시작 조건
 * (`noticeHtml.html` = `html_sha256`)과 최종 `detailContent`의 재료(자리표시자 그대로의 `html`)로 읽는다 — registration은 content를
 * import하지 않는다(03-ADR-003). ⑥-3 버전에 산출물이 없으면 null.
 */
export async function readNoticeHtml(
  db: Db,
  noticeHtmlStepRunId: number,
): Promise<NoticeHtmlView | null> {
  const row = await findAssembly(db, noticeHtmlStepRunId);
  if (!row) return null;
  return { noticeHtmlStepRunId, html: row.html, htmlSha256: row.htmlSha256 };
}

export const noticeHtmlReader: NoticeHtmlReader = { readHtml: readNoticeHtml };

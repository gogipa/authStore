import {
  extractDisclosureBlocks,
  renderedBlockSha256,
  renderedMatchesTemplate,
} from '../../../../common/rules/detail-html.js';
import { needsLeatherNotice } from '../../../../common/rules/disclosure-conditions.js';
import { REQUIRED_NOTICE_BLOCKS } from '../../../settings/safety/builtin-safety-lists.js';
import { noticeBlockSha256 } from '../../../settings/safety/safety-floor.validator.js';
import type { NoticeBlockCondition } from '../../../settings/schema/settings.types.js';
import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { resultOf, type CheckProblem } from './check-helpers.js';

/** 고지 블록 화면 이름(사유 글) */
export const DISCLOSURE_BLOCK_LABEL: Readonly<Record<string, string>> = {
  AGENCY: '구매대행 안내',
  DELIVERY: '배송',
  CUSTOMS_DUTY: '관부가세',
  COMBINED_TAX: '합산 과세',
  PERSONAL_CUSTOMS_CODE: '개인통관고유부호',
  WITHDRAWAL: '취소·반품',
  ORIGIN: '원산지',
  LEATHER_SAFETY: '안전관리대상(가죽 소재)',
  AI_IMAGE: 'AI 생성 이미지',
};

function label(blockId: string): string {
  return `${DISCLOSURE_BLOCK_LABEL[blockId] ?? blockId}(${blockId})`;
}

/** 이번 상품에 켜진 조건부 블록 조건(⑥-2 소재·설정 — ⑥-3 기록을 믿지 않는다) */
export function requiredConditions(ctx: PreValidationContext): Set<NoticeBlockCondition> {
  const out = new Set<NoticeBlockCondition>();
  const materials = ctx.inputs.facts?.materials ?? { upper: null, lining: null, sole: null };
  if (needsLeatherNotice(materials, ctx.inputs.settings.notice.leatherTerms)) {
    out.add('LEATHER_OR_UNKNOWN_MATERIAL');
  }
  if (ctx.inputs.settings.notice.aiImageLabel) out.add('AI_IMAGE_LABEL');
  return out;
}

/**
 * `NOTICE_BLOCK`(F-AP-15, US-16 AC2·AC3, P4-02 규칙 7): ⑥-3의 `disclosure_blocks` 기록을 믿지 않고, 최종 `detailContent`(⑧)에서
 * 고지 블록을 다시 잘라(`extractDisclosureBlocks`) 본다(P3-04 계약 `common/rules/detail-html.ts`):
 * (a) 필수 블록(앱 내장 `REQUIRED_NOTICE_BLOCKS` — 조건 없는 7개 + 이번 상품에 켜진 조건부 블록)이 모두 있다. 조건부: 소재가 가죽·
 *     겉감 '정보 없음'이면 LEATHER_SAFETY(⑥-2 소재와 설정 `notice.leatherTerms` — 공용 `needsLeatherNotice`), `notice.aiImageLabel`이면
 *     AI_IMAGE
 * (b) 설정 템플릿 문장이 앱 내장 해시와 같고(`noticeBlockSha256`), 블록 글이 그 템플릿에서 나왔다(`renderedMatchesTemplate`)
 * (c) 블록 글의 해시(`renderedBlockSha256`)가 ⑥-3이 만들 때 남긴 해시와 같다 — 자리표시자 값(상호 등)만 고친 편집도 잡는다
 * 어느 하나라도 어기면(빠짐·편집) 실패다.
 */
export function noticeBlockCheck(ctx: PreValidationContext): PreValidationCheck {
  const detail = ctx.inputs.upload?.detailContent ?? null;
  if (!detail) {
    return resultOf('NOTICE_BLOCK', [
      { message: '최종 상세 본문이 없어 구매대행 고지를 확인하지 못했습니다', stepCode: 'UPLOAD' },
    ]);
  }
  const extracted = extractDisclosureBlocks(detail);
  const conditions = requiredConditions(ctx);
  const templates = ctx.inputs.settings.notice.blocks;
  const recorded = ctx.inputs.assembly?.disclosureBlocks ?? null;
  const missing: string[] = [];
  const edited: string[] = [];
  const problems: CheckProblem[] = [];
  for (const required of REQUIRED_NOTICE_BLOCKS) {
    if (required.when !== null && !conditions.has(required.when)) continue;
    const blocks = extracted.filter((block) => block.blockId === required.id);
    if (blocks.length === 0) {
      missing.push(label(required.id));
      continue;
    }
    const template = templates.find((block) => block.id === required.id);
    const record = recorded?.find((block) => block.blockId === required.id);
    const intact =
      template !== undefined &&
      noticeBlockSha256(template.text) === required.sha256 &&
      blocks.every(
        (block) =>
          renderedMatchesTemplate(template.text, block.text) &&
          (recorded === null ||
            (record !== undefined && record.sha256 === renderedBlockSha256(block.text))),
      );
    if (!intact) edited.push(label(required.id));
  }
  if (missing.length > 0) {
    problems.push({
      message: `구매대행 고지 블록이 빠졌습니다: ${missing.join(', ')}`,
      stepCode: 'NOTICE_HTML',
    });
  }
  if (edited.length > 0) {
    problems.push({
      message: `구매대행 고지 블록이 원본 템플릿과 다릅니다(편집됨): ${edited.join(', ')}`,
      stepCode: 'NOTICE_HTML',
    });
  }
  return resultOf('NOTICE_BLOCK', problems);
}

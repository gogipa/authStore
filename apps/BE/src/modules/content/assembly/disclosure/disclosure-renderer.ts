import { renderedBlockSha256 } from '../../../../common/rules/detail-html.js';
import { REQUIRED_NOTICE_BLOCKS } from '../../../settings/safety/builtin-safety-lists.js';
import { noticeBlockSha256 } from '../../../settings/safety/safety-floor.validator.js';
import type {
  NoticeBlockCondition,
  NoticeSettings,
} from '../../../settings/schema/settings.types.js';
import { escapeHtml } from '../html/html-text.js';

/**
 * 구매대행 고지 렌더러(P3-04 규칙 3·4, F-CT-02·04, US-16 AC1·AC2, PRD §8.5 CT-04 템플릿). 설정 템플릿(`notice.blocks`)을 프로필·
 * 설정 값으로 채워 상세 HTML의 **첫 구획**으로 만든다. 문구를 코드에 박지 않는다(법률 검토 E-3·E-9 전 초안 — 기준일이 붙은 설정
 * 템플릿). 대신 필수 블록은 설정 글을 그대로 믿지 않고 앱 내장 해시(P1-03 `REQUIRED_NOTICE_BLOCKS`, F-BS-05)와 맞는지 다시 본다.
 * - 블록 마크업: `<p data-block-id="{ID}">{채운 글, 이스케이프}</p>`(머리글 HEADER만 `<strong>`), 전체는
 *   `<div data-autostore-section="DISCLOSURE">`
 * - 블록 기록(`disclosure_blocks`, ERD): `{block_id, sha256, conditional}` — sha256은 채운 글의 해시(`renderedBlockSha256`,
 *   common/rules/detail-html.ts 정의), conditional = 넣는 조건이 있는 블록
 * - 자리표시자: `{상호}`·`{배송기간_최소}`·`{배송기간_최대}`·`{최대수량}`·`{반품비}`·`{교환정책}`·`{A/S 안내}`·`{템플릿_기준일}`.
 *   넣는 블록에 채우지 못한 자리표시자가 남으면 던진다(⑥-3 시작 전 빈칸 검사가 먼저 막는다)
 */

export interface DisclosureValues {
  businessName: string;
  deliveryDaysMin: number;
  deliveryDaysMax: number;
  maxPurchaseQuantityPerOrder: number;
  returnFeeKrw: number;
  exchangePolicy: string;
  afterServiceGuide: string;
  basisDate: string;
}

/** `disclosure_blocks` 원소(ERD 모양 그대로 snake_case) */
export interface DisclosureBlockRecord {
  block_id: string;
  sha256: string;
  conditional: boolean;
}

export interface RenderedDisclosure {
  html: string;
  blockIds: string[];
  blocks: DisclosureBlockRecord[];
  /** 채운 블록 글(화면 '구매대행 고지 미리보기') */
  texts: { blockId: string; text: string; conditional: boolean }[];
  templateVersion: string;
  templateDate: string;
}

/** 템플릿이 앱 내장 기준과 다르거나 채울 수 없음 — ⑥-3 실패(설정 검사가 먼저 막으므로 보통 오지 않는다) */
export class DisclosureTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DisclosureTemplateError';
  }
}

/** 설정 템플릿의 필수 블록이 앱 내장 해시·조건과 같은가(다르면 문제 목록) */
export function requiredBlockProblems(blocks: NoticeSettings['blocks']): string[] {
  const problems: string[] = [];
  for (const required of REQUIRED_NOTICE_BLOCKS) {
    const block = blocks.find((b) => b.id === required.id);
    if (!block) problems.push(`${required.id}: 없음`);
    else if (block.when !== required.when) problems.push(`${required.id}: 조건이 다름`);
    else if (noticeBlockSha256(block.text) !== required.sha256)
      problems.push(`${required.id}: 문장이 다름`);
  }
  return problems;
}

/** 금액(원) 글자: 7,000 */
function krw(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 자리표시자 → 값 */
export function placeholderValues(values: DisclosureValues): Readonly<Record<string, string>> {
  return {
    상호: values.businessName,
    배송기간_최소: String(values.deliveryDaysMin),
    배송기간_최대: String(values.deliveryDaysMax),
    최대수량: String(values.maxPurchaseQuantityPerOrder),
    반품비: krw(values.returnFeeKrw),
    교환정책: values.exchangePolicy,
    'A/S 안내': values.afterServiceGuide,
    템플릿_기준일: values.basisDate,
  };
}

/** 템플릿 한 줄 채우기. 모르는 자리표시자는 `missing`에 */
export function fillTemplate(
  text: string,
  values: Readonly<Record<string, string>>,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const filled = text.replace(/\{([^{}]+)\}/g, (whole, name: string) => {
    const value = values[name];
    if (value === undefined || value.trim() === '') {
      missing.push(name);
      return whole;
    }
    return value;
  });
  return { text: filled, missing };
}

/** 고지 렌더(규칙 3·4). 조건 블록은 `conditions`에 든 것만 넣는다 */
export function renderDisclosure(
  notice: Pick<NoticeSettings, 'blocks' | 'basisDate' | 'templateVersion'>,
  values: DisclosureValues,
  conditions: ReadonlySet<NoticeBlockCondition>,
): RenderedDisclosure {
  const problems = requiredBlockProblems(notice.blocks);
  if (problems.length > 0) {
    throw new DisclosureTemplateError(
      `고지 필수 블록이 앱 기준과 다릅니다(${problems.join(', ')})`,
    );
  }
  const vars = placeholderValues(values);
  const texts: RenderedDisclosure['texts'] = [];
  const paragraphs: string[] = [];
  for (const block of notice.blocks) {
    if (block.when !== null && !conditions.has(block.when)) continue;
    const { text, missing } = fillTemplate(block.text, vars);
    if (missing.length > 0) {
      throw new DisclosureTemplateError(
        `고지 블록 ${block.id}의 자리표시자를 채우지 못했습니다(${missing.join(', ')})`,
      );
    }
    const body = escapeHtml(text);
    paragraphs.push(
      `<p data-block-id="${block.id}">${block.id === 'HEADER' ? `<strong>${body}</strong>` : body}</p>`,
    );
    texts.push({ blockId: block.id, text, conditional: block.when !== null });
  }
  return {
    html: `<div data-autostore-section="DISCLOSURE">${paragraphs.join('')}</div>`,
    blockIds: texts.map((t) => t.blockId),
    blocks: texts.map((t) => ({
      block_id: t.blockId,
      sha256: renderedBlockSha256(t.text),
      conditional: t.conditional,
    })),
    texts,
    templateVersion: notice.templateVersion,
    templateDate: notice.basisDate,
  };
}

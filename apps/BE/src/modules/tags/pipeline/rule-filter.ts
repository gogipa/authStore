import type { TagRuleSettings } from '../../settings/schema/settings.types.js';
import { compactOf } from './normalize.js';
import type { TagFilterReason } from './tag-pipeline.types.js';

/**
 * ⑦ 규칙 필터(F-TG-08, PRD §8.6 4, P3-05 규칙 8). 순수 함수 — 사전은 설정 `tags.rules`에서 받고 AI는 쓰지 않는다.
 * 비교는 정규화 + 공백 없앤 글자의 '포함'(카테고리 경로 단어만 '같음')이다. 처음 걸린 사유 하나만 남긴다(순서 아래).
 * 1. CATEGORY_TOKEN: ④ 리프 전체 경로의 한 조각과 같은 태그(예 리프 '러닝화' → 태그 '러닝화'). 리프가 없으면(④ 전) 보지 않는다
 * 2. BRAND_NAME: 브랜드 사전의 다른 브랜드 말이 든 태그(예 '나이키운동화'). 상품 자체 브랜드 말이 든 태그는
 *    `keepOwnBrandRecommended`이고 추천(사전) 태그와 같으면 남기고, 아니면 뺀다(Proposed — 시안 '아식스운동화'는 추천·경쟁)
 * 3. STORE_NAME: 판매처·스토어명, 4. PROMOTION: 가격·혜택·배송·홍보 문구(예 '무료배송')
 * 5. ATTRIBUTE_MISMATCH: 아동 말(M1 상품은 성인화뿐) → 반대 성별 말 → 상품 맥락(시드 키워드·상품유형·리프 경로)에 없는 용도·시즌 말
 * `filter_detail`은 시안 사유 글 + 걸린 사전 말(200자까지).
 */

export interface TagRuleContext {
  /** ④ 리프 전체 경로('패션잡화>남성신발>운동화>러닝화'). null = 카테고리 미확정 */
  categoryPath: string | null;
  /** 후보 성별 */
  gender: 'MALE' | 'FEMALE' | null;
  /** 상품 자체 브랜드(브랜드 사전 `name`). 모르면 null */
  ownBrand: string | null;
  /** 용도·시즌 말을 맞춰 볼 상품 맥락 글(시드 키워드·상품유형·리프 경로) */
  productContext: string;
  rules: TagRuleSettings;
}

export interface TagFilterResult {
  reason: TagFilterReason;
  detail: string;
}

const DETAIL_MAX = 200;

function detail(text: string): string {
  return text.length > DETAIL_MAX ? text.slice(0, DETAIL_MAX) : text;
}

/** 말 목록에서 태그(공백 없앤 글자)에 든 첫 말 */
function findWord(compactTag: string, words: readonly string[]): string | null {
  for (const word of words) {
    const w = compactOf(word);
    if (w.length > 0 && compactTag.includes(w)) return word;
  }
  return null;
}

/** 카테고리 경로 조각(공백 정리) */
export function categorySegments(path: string | null): string[] {
  if (!path) return [];
  return path
    .split('>')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * 상품 자체 브랜드: 브랜드 사전 순서대로, 비교 말이 글(시드 키워드·② 브랜드 속성·② 상품명 순) 가운데 하나에 들어 있는 첫 항목.
 * 없으면 null(그때는 모든 브랜드 말 태그가 '다른 브랜드명'이 된다)
 */
export function resolveOwnBrand(
  sources: readonly (string | null | undefined)[],
  brands: TagRuleSettings['brands'],
): string | null {
  const texts = sources
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map(compactOf);
  if (texts.length === 0) return null;
  for (const brand of brands) {
    for (const term of brand.terms) {
      const t = compactOf(term);
      if (t.length > 0 && texts.some((text) => text.includes(t))) return brand.name;
    }
  }
  return null;
}

export function filterTag(
  tag: { textKey: string; inRecommend: boolean },
  ctx: TagRuleContext,
): TagFilterResult | null {
  const compact = compactOf(tag.textKey);
  if (compact.length === 0) return null;
  const { rules } = ctx;

  // 1. 카테고리 경로 단어(④ 리프 기준)
  for (const segment of categorySegments(ctx.categoryPath)) {
    if (compactOf(segment) === compact) {
      return { reason: 'CATEGORY_TOKEN', detail: detail(`카테고리 이름(${segment})과 같음`) };
    }
  }

  // 2. 브랜드명(다른 브랜드 먼저, 그다음 상품 자체 브랜드)
  let ownBrandHit: string | null = null;
  for (const brand of rules.brands) {
    const hit = findWord(compact, brand.terms);
    if (!hit) continue;
    if (ctx.ownBrand !== null && brand.name === ctx.ownBrand) {
      ownBrandHit = brand.name;
      continue;
    }
    return { reason: 'BRAND_NAME', detail: detail(`다른 브랜드명(${brand.name})`) };
  }
  if (ownBrandHit !== null && !(rules.keepOwnBrandRecommended && tag.inRecommend)) {
    return {
      reason: 'BRAND_NAME',
      detail: detail(
        rules.keepOwnBrandRecommended
          ? `상품 브랜드명(${ownBrandHit}) · 추천 태그가 아님`
          : `상품 브랜드명(${ownBrandHit})`,
      ),
    };
  }

  // 3. 판매처·스토어명
  const store = findWord(compact, rules.storeWords);
  if (store) return { reason: 'STORE_NAME', detail: detail(`판매처·스토어명(${store})`) };

  // 4. 가격·혜택·배송·홍보 문구
  const promotion = findWord(compact, rules.promotionWords);
  if (promotion) return { reason: 'PROMOTION', detail: detail(`홍보·배송 문구(${promotion})`) };

  // 5. 성별·용도·시즌이 상품과 맞지 않음
  const child = findWord(compact, rules.childWords);
  if (child) {
    return {
      reason: 'ATTRIBUTE_MISMATCH',
      detail: detail(`아동 단어(${child}) · 성별·용도 불일치`),
    };
  }
  if (ctx.gender !== null) {
    const opposite = ctx.gender === 'MALE' ? rules.genderWords.FEMALE : rules.genderWords.MALE;
    const word = findWord(compact, opposite);
    if (word) return { reason: 'ATTRIBUTE_MISMATCH', detail: detail(`성별 불일치(${word})`) };
  }
  const context = compactOf(ctx.productContext);
  for (const word of rules.useSeasonWords) {
    const w = compactOf(word);
    if (w.length > 0 && compact.includes(w) && !context.includes(w)) {
      return { reason: 'ATTRIBUTE_MISMATCH', detail: detail(`용도·시즌 불일치(${word})`) };
    }
  }
  return null;
}

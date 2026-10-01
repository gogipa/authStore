import type { Prisma } from '../../generated/prisma/client.js';
import { recommendCacheKey } from '../integrations/naver-commerce/commerce-tags.http-adapter.js';
import type { StepInput } from '../step-engine/contracts/step-runner.js';
import { INPUT_KEYS } from '../step-engine/domain/input-keys.js';
import { categorySegments } from './pipeline/rule-filter.js';

type Db = Prisma.TransactionClient;

/**
 * ⑦ 입력 읽기 도우미(P3-05 규칙 1·2). ② 값은 step-engine 창구(`readSourcingItemContent`·`readSourcingGenre`)로만 읽고,
 * ④ 리프 경로는 엔진이 넘기는 후보 값(④ 현재 버전이 완료일 때만)으로 받는다 — 다른 단계 모듈을 import하지 않는다.
 */

/** 입력 `sourcing.modelInfo`(② 모델명·상품유형 + 상품 자체 브랜드) */
export interface TagsModelInfo {
  /** 型番 원문(없으면 null) */
  modelCode: string | null;
  /** ② 상품유형(rakuten_item.product_type — M1은 늘 null일 수 있다, ERD §7.1-6) */
  productType: string | null;
  /** 상품 자체 브랜드(설정 브랜드 사전 이름 — 시드 키워드·② 브랜드 속성·② 상품명에서 찾음). 모르면 null */
  brand: string | null;
}

/** 입력 `category.leafPath`(④ 완료일 때만) */
export interface TagsLeafPath {
  leafCategoryId: string;
  wholeCategoryName: string | null;
}

/** 후보의 ① 선택 키워드 글(키워드 후보만). 없으면 null */
export async function selectedKeywordOf(
  db: Db,
  sourceKeywordId: number | null,
): Promise<string | null> {
  if (sourceKeywordId === null) return null;
  const row = await db.keyword.findUnique({
    where: { id: sourceKeywordId },
    select: { keyword: true },
  });
  const text = row?.keyword.trim();
  return text ? text : null;
}

const BRAND_ATTRIBUTE_NAMES = ['ブランド', 'ブランド名', 'メーカー', 'brand', '브랜드'];

function attributeKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/** ② 상품 속성(`[{name, value}]` 원문 — M0 S2 전 가정)에서 브랜드 값. 없으면 null */
export function brandAttributeOf(itemAttributes: unknown): string | null {
  if (!Array.isArray(itemAttributes)) return null;
  const names = new Set(BRAND_ATTRIBUTE_NAMES.map(attributeKey));
  for (const attr of itemAttributes) {
    if (!attr || typeof attr !== 'object') continue;
    const { name, value } = attr as { name?: unknown; value?: unknown };
    if (typeof name !== 'string' || !names.has(attributeKey(name))) continue;
    const text = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string').join(' ')
      : typeof value === 'string'
        ? value
        : '';
    if (text.trim()) return text.normalize('NFKC').trim().slice(0, 100);
  }
  return null;
}

/** 시드 키워드와 그 출처(규칙 1 — ① 선택 키워드 → ② 검색어 → ② 型番, P3-05 Proposed) */
export interface SeedKeyword {
  value: string | null;
  source: 'KEYWORD' | 'RAKUTEN_QUERY' | 'MODEL_CODE' | null;
}

export function seedKeywordOf(
  keyword: string | null,
  rakutenQuery: string | null,
  modelCode: string | null,
): SeedKeyword {
  if (keyword?.trim()) return { value: keyword.trim().slice(0, 100), source: 'KEYWORD' };
  if (rakutenQuery?.trim()) {
    return { value: rakutenQuery.trim().slice(0, 100), source: 'RAKUTEN_QUERY' };
  }
  if (modelCode?.trim()) return { value: modelCode.trim().slice(0, 100), source: 'MODEL_CODE' };
  return { value: null, source: null };
}

/** 상품유형: ② 상품유형, 없으면 ④ 리프 경로 마지막 조각(예 '러닝화' — P3-05 Proposed) */
export function productTypeOf(
  modelInfo: TagsModelInfo | null,
  leaf: TagsLeafPath | null,
): string | null {
  if (modelInfo?.productType?.trim()) return modelInfo.productType.trim();
  const segments = categorySegments(leaf?.wholeCategoryName ?? null);
  return segments.length > 0 ? segments[segments.length - 1]! : null;
}

/**
 * 추천 태그 조회 키워드(규칙 2): 시드 키워드 → 모델명 → 상품유형 → 용도어(설정 `tags.useWords`). NFKC·소문자·공백 정리로 같은
 * 키워드는 한 번만, 100자를 넘는 것은 뺀다(tag_set.recommend_keywords varchar(100))
 */
export function recommendKeywordsOf(parts: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const text = part?.trim().replace(/\s+/g, ' ') ?? '';
    if (text.length === 0 || text.length > 100) continue;
    const key = recommendCacheKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** 실행 문맥의 입력 값 */
export function inputValueOf(inputs: readonly StepInput[], key: string): unknown {
  return inputs.find((input) => input.inputKey === key)?.value ?? null;
}

export function isModelInfo(value: unknown): value is TagsModelInfo {
  const v = value as Partial<TagsModelInfo> | null;
  return !!v && typeof v === 'object' && 'modelCode' in v && 'productType' in v && 'brand' in v;
}

export function isLeafPath(value: unknown): value is TagsLeafPath {
  const v = value as Partial<TagsLeafPath> | null;
  return !!v && typeof v === 'object' && typeof v.leafCategoryId === 'string';
}

/** ⑦ 실행 문맥에서 꺼낸 값 */
export interface TagsRunInputs {
  seed: string | null;
  modelInfo: TagsModelInfo | null;
  gender: 'MALE' | 'FEMALE' | null;
  leaf: TagsLeafPath | null;
  competitorInputIds: number[];
}

export function tagsRunInputsOf(inputs: readonly StepInput[]): TagsRunInputs {
  const seed = inputValueOf(inputs, INPUT_KEYS.candidateSeedKeyword);
  const modelInfo = inputValueOf(inputs, INPUT_KEYS.sourcingModelInfo);
  const gender = inputValueOf(inputs, INPUT_KEYS.candidateGender);
  const leaf = inputValueOf(inputs, INPUT_KEYS.categoryLeafPath);
  const competitor = inputValueOf(inputs, INPUT_KEYS.ownerCompetitorTags);
  return {
    seed: typeof seed === 'string' ? seed : null,
    modelInfo: isModelInfo(modelInfo) ? modelInfo : null,
    gender: gender === 'MALE' || gender === 'FEMALE' ? gender : null,
    leaf: isLeafPath(leaf) ? leaf : null,
    competitorInputIds: Array.isArray(competitor)
      ? competitor.filter((id): id is number => Number.isInteger(id))
      : [],
  };
}

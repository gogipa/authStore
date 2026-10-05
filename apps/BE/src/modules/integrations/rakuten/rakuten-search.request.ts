import { createHash } from 'node:crypto';
import type { SourcingSettings } from '../../settings/schema/settings.types.js';
import { RAKUTEN_KEY_PARAM_NAMES, RAKUTEN_SEARCH_FIXED_PARAMS } from './rakuten.constants.js';
import { apiImageUrlsOf } from './rakuten-image.port.js';
import type { RakutenKeys } from './rakuten-keys.js';
import type { RakutenSearchItem, RakutenSearchQuery } from './rakuten-search.port.js';

/** 요청 파라미터(글자 값). 키는 넣지 않는다 */
export type RakutenSearchParams = Record<string, string>;

/**
 * Item Search 요청 파라미터를 만든다(PRD §8.2 RK-01, P2-02 규칙 1). 순수 함수. 키(applicationId·accessKey)는 넣지 않는다.
 * - ② 소싱 검색(기본): `keyword`, `genreId`(설정 558885), `sort=+itemPrice`, `hits`(설정 30), `availability=1`,
 *   `imageFlag=1`, `field=1`, `formatVersion=2`, `purchaseType=0`, `carrier=0`, `minPrice`(설정), `NGKeyword`(설정 제외어를
 *   공백으로 이어서), `page`. `query.sort`가 있으면 `sort`를 그 값으로 덮어쓴다(기본은 `+itemPrice`)
 * - 보완 조회(`sourcingFilters=false`): `formatVersion=2`, `hits`, `page` + `itemCode`·`shopCode`·`keyword` 중 준 것
 */
export function buildRakutenSearchParams(
  query: RakutenSearchQuery,
  sourcing: Pick<SourcingSettings, 'genreId' | 'minPriceYen' | 'ngKeywords' | 'rakutenApi'>,
): RakutenSearchParams {
  const params: RakutenSearchParams = {};
  const keyword = query.keyword?.trim();
  if (keyword) params.keyword = keyword;
  if (query.shopCode) params.shopCode = query.shopCode;
  if (query.itemCode) params.itemCode = query.itemCode;
  params.page = String(query.page ?? 1);
  params.hits = String(sourcing.rakutenApi.hits);
  params.formatVersion = RAKUTEN_SEARCH_FIXED_PARAMS.formatVersion;
  if (query.sourcingFilters ?? true) {
    Object.assign(params, RAKUTEN_SEARCH_FIXED_PARAMS);
    if (query.sort) params.sort = query.sort;
    params.genreId = String(sourcing.genreId);
    params.minPrice = String(sourcing.minPriceYen);
    const ng = sourcing.ngKeywords.map((w) => w.trim()).filter((w) => w !== '');
    if (ng.length > 0) params.NGKeyword = ng.join(' ');
  }
  return params;
}

/** 키 정렬 JSON(캐시 키·request_params 사본의 원문) */
export function canonicalParams(params: RakutenSearchParams): string {
  const sorted = Object.keys(params)
    .filter((k) => !(RAKUTEN_KEY_PARAM_NAMES as readonly string[]).includes(k))
    .sort()
    .map((k) => [k, params[k]] as const);
  return JSON.stringify(Object.fromEntries(sorted));
}

/** 캐시 키: 키 정렬 JSON(page 포함, 비밀값 제외)의 SHA-256(ERD rakuten_search_cache.query_hash) */
export function rakutenSearchQueryHash(params: RakutenSearchParams): string {
  return createHash('sha256').update(canonicalParams(params), 'utf8').digest('hex');
}

/** 비밀값을 뺀 파라미터 사본(rakuten_search_cache.request_params — ck_rsc_no_secret) */
export function paramsWithoutSecrets(params: RakutenSearchParams): RakutenSearchParams {
  return JSON.parse(canonicalParams(params)) as RakutenSearchParams;
}

/** 요청 URL(키 포함). 관문만 받고, 기록에는 가린 URL만 남는다(call_log.url_masked) */
export function buildRakutenApiUrl(
  endpoint: string,
  keys: RakutenKeys,
  params: RakutenSearchParams,
): string {
  const url = new URL(endpoint);
  url.searchParams.set('applicationId', keys.applicationId);
  url.searchParams.set('accessKey', keys.accessKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** 상품 사진 주소: 응답 이미지 주소 중 http(s)로 시작하는 첫 값(없으면 null). 사진 칸은 `<img src>`에 쓰이므로 다른 모양은 버린다 */
function firstImageUrl(raw: Record<string, unknown>): string | null {
  return apiImageUrlsOf(raw).find((url) => /^https?:\/\//i.test(url)) ?? null;
}

/** 샵 코드: shopCode, 없으면 itemCode의 ':' 앞 */
function shopCodeOf(raw: Record<string, unknown>, itemCode: string): string {
  return str(raw.shopCode) ?? itemCode.split(':')[0] ?? '';
}

/**
 * 응답 Items 한 건(formatVersion=2 평탄형, formatVersion=1의 `{ Item: {...} }` 감싸기도 받는다)을 꺼낸다.
 * itemCode·itemName·itemUrl이 없으면 null(행으로 쓸 수 없다).
 */
export function toSearchItem(value: unknown): RakutenSearchItem | null {
  if (!value || typeof value !== 'object') return null;
  const wrapped = value as { Item?: unknown };
  const raw = (wrapped.Item && typeof wrapped.Item === 'object' ? wrapped.Item : value) as Record<
    string,
    unknown
  >;
  const itemCode = str(raw.itemCode);
  const itemName = str(raw.itemName);
  const itemUrl = str(raw.itemUrl);
  if (!itemCode || !itemName || !itemUrl) return null;
  return {
    itemCode,
    itemName,
    itemUrl,
    shopCode: shopCodeOf(raw, itemCode),
    shopName: str(raw.shopName),
    itemPrice: num(raw.itemPrice),
    itemPriceMin3: num(raw.itemPriceMin3),
    pointRate: num(raw.pointRate),
    postageFlag: num(raw.postageFlag),
    reviewCount: num(raw.reviewCount),
    reviewAverage: num(raw.reviewAverage),
    shipOverseasFlag: num(raw.shipOverseasFlag),
    genreId: num(raw.genreId),
    imageUrl: firstImageUrl(raw),
    raw,
  };
}

/** 응답 본문(JSON)에서 Items 배열과 count. 모양이 다르면 null */
export function parseSearchResponse(
  bodyText: string,
): { items: unknown[]; totalCount: number | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const body = parsed as { Items?: unknown; items?: unknown; count?: unknown };
  const items = Array.isArray(body.Items)
    ? body.Items
    : Array.isArray(body.items)
      ? body.items
      : null;
  if (!items) return null;
  return { items, totalCount: num(body.count) };
}

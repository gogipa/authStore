import {
  decodeRakutenPage,
  isRakutenMaintenancePage,
} from '../integrations/rakuten/rakuten-page.http-adapter.js';
import {
  AXIS_WORDS,
  COLOR_CODE_ATTRIBUTE_NAMES,
  ITEM_INFO_ROOTS,
  ITEM_PATHS,
  ITEM_PATHS_MEASURED,
  MODEL_CODE_ATTRIBUTE_NAMES,
  PAGE_JSON_SCRIPT_ID,
  PURCHASE_INFO_ROOTS,
  PURCHASE_PATHS,
  REQUIRED_PAGE_KEYS,
} from './page-json.constants.js';
import { sizeLabelToMm } from './size-label.js';

/**
 * 라쿠텐 상품 페이지 JSON 읽기(F-SO-13·F-SO-14, P2-02 규칙 9·10). 순수 함수(파일·DB·네트워크 없음).
 * 1. 받은 바이트를 EUC-JP로 푼다(`TextDecoder('euc-jp')`, Node full ICU) — `response.text()`는 UTF-8로 풀어 깨진다
 * 2. 'ページが表示できません'이 있으면 점검·삭제 페이지(HTTP 200이어도 실패)
 * 3. `<script … id="item-page-app-data">` JSON → 루트 `newApi.itemInfoSku`, 없으면 `api.data.itemInfoSku`
 * 4. SKU = `itemInfoSku.sku[]` ⋈ `purchaseInfo.variantMappedInventories[]`(variantId). 짝 없는 재고 행은 버린다
 * 5. 키가 빠져도 멈추지 않고 읽은 것만 돌려주며, 빠진 키·cm 아닌 사이즈 라벨을 '수동 확인'으로 넘긴다
 * 파싱 자체가 실패하면(스크립트·JSON·루트·상품명 없음) PARSE_FAILED — 부르는 쪽은 rakuten_item 행을 만들지 않는다.
 * 경로 가정은 page-json.constants.ts 한 곳에 있다(M0 S2).
 */

export interface ParsedSku {
  variantId: string;
  colorLabel: string | null;
  colorCode: string | null;
  sizeLabel: string | null;
  /** JP cm → mm. cm가 아닌 라벨은 null(수동 확인) */
  sizeMm: number | null;
  widthLabel: string | null;
  taxIncludedPriceYen: number | null;
  /** 재고 수. 재고 행이 없으면 null(재고 정보 없음) */
  quantity: number | null;
  hidden: boolean;
  /** 取り寄せ(SKU 값, 없으면 상품 backOrderFlag) */
  backOrder: boolean | null;
  stockCondition: string | null;
  articleNumber: string | null;
  postageIncluded: boolean | null;
  singleItemShipping: boolean | null;
  /** selectorValues 원문 */
  selectorValues: unknown;
  /** SKU attributes 원문(없으면 null) */
  attributes: unknown;
}

export interface ParsedItemPage {
  shopCode: string | null;
  itemManageNumber: string | null;
  /** API 형식 `샵코드:상품관리번호`(둘 다 있을 때). 없으면 null → F-BS-37 보완 */
  itemCode: string | null;
  itemName: string;
  shopName: string | null;
  genreId: number | null;
  modelCode: string | null;
  modelCodeNorm: string | null;
  attributes: unknown;
  variantSelectors: unknown;
  imageUrls: string[];
  descriptionHtml: string | null;
  descriptionText: string | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  backOrderFlag: boolean | null;
  unlimitedInventory: boolean | null;
  allSkuSamePrice: boolean | null;
  skus: ParsedSku[];
  /** 읽지 못한 필수 키(REQUIRED_PAGE_KEYS 모양) */
  missingKeys: string[];
  manualCheckRequired: boolean;
  /** 수동 확인 사유(500자까지) */
  manualCheckNote: string | null;
}

export type PageParseResult =
  | { kind: 'PARSED'; page: ParsedItemPage }
  | { kind: 'MAINTENANCE' }
  | { kind: 'PARSE_FAILED'; reason: string };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function at(root: unknown, path: string | readonly string[]): unknown {
  const parts = typeof path === 'string' ? path.split('.') : path;
  let value: unknown = root;
  for (const part of parts) {
    if (!isObject(value)) return undefined;
    value = value[part];
  }
  return value;
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function int(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function date(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 여러 경로 가운데 값이 있는 첫 것(실측 경로를 먼저, 가정 경로를 뒤에) */
function atFirst(root: unknown, ...paths: string[]): unknown {
  for (const path of paths) {
    const value = at(root, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** 型番 정규화(RK-03 2): NFKC → 대문자 → 공백·하이픈 제거 */
export function normalizeModelCode(code: string | null): string | null {
  if (!code) return null;
  const norm = code
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-‐‑‒–—―]/g, '');
  return norm === '' ? null : norm.slice(0, 128);
}

/** 설명 HTML → 글자(NFKC·공백 정리, §5.3 규칙 1 입력 지문 재료) */
export function htmlToText(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .normalize('NFKC')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text === '' ? null : text;
}

/** script 요소 안 JSON 글자. 없으면 null */
export function extractPageJson(html: string): string | null {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const attrs = m[1] ?? '';
    if (new RegExp(`\\bid\\s*=\\s*["']${PAGE_JSON_SCRIPT_ID}["']`).test(attrs)) {
      return (m[2] ?? '').trim();
    }
  }
  return null;
}

type Axis = 'color' | 'size' | 'width';

function axisOf(selector: unknown): Axis | null {
  if (!isObject(selector)) return null;
  const name = `${str(selector.key) ?? ''} ${str(selector.label) ?? ''}`;
  for (const axis of ['color', 'width', 'size'] as const) {
    if (AXIS_WORDS[axis].some((w) => name.includes(w))) return axis;
  }
  return null;
}

/** selectorValues(배열이면 variantSelectors 순서, 객체면 키 이름)에서 축별 값 */
function axisValues(
  selectorValues: unknown,
  selectors: readonly unknown[],
): Record<Axis, string | null> {
  const out: Record<Axis, string | null> = { color: null, size: null, width: null };
  if (Array.isArray(selectorValues)) {
    selectorValues.forEach((value, i) => {
      const axis = axisOf(selectors[i]);
      const text = isObject(value) ? str(value.value) : str(value);
      if (axis && out[axis] === null) out[axis] = text;
    });
  } else if (isObject(selectorValues)) {
    for (const [key, value] of Object.entries(selectorValues)) {
      const axis = axisOf({ key });
      if (axis && out[axis] === null) out[axis] = str(value);
    }
  }
  return out;
}

function attributeValue(attributes: unknown, names: readonly string[]): string | null {
  if (!Array.isArray(attributes)) return null;
  for (const attr of attributes) {
    if (!isObject(attr)) continue;
    const name = str(attr.name) ?? str(attr.key);
    if (name && names.includes(name)) {
      const value = attr.value ?? attr.values;
      return Array.isArray(value) ? str(value[0]) : str(value);
    }
  }
  return null;
}

/** 색상 코드(M0 S2 가정): SKU 속성, 없으면 라벨 끝 괄호 코드('(108)'·'（108）') */
export function colorCodeOf(label: string | null, attributes: unknown): string | null {
  const fromAttr = attributeValue(attributes, COLOR_CODE_ATTRIBUTE_NAMES);
  if (fromAttr) return fromAttr.normalize('NFKC').slice(0, 64);
  if (!label) return null;
  const m = /[(（]\s*([A-Za-z0-9]{1,16})\s*[)）]\s*$/.exec(label.normalize('NFKC'));
  return m ? m[1]!.slice(0, 64) : null;
}

function imageUrlsOf(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images
    .map((img) => (isObject(img) ? (str(img.location) ?? str(img.url)) : str(img)))
    .filter((url): url is string => url !== null);
}

/** 바이트 → 결과(점검 페이지·파싱 실패·읽은 페이지) */
export function parseItemPage(bytes: Buffer): PageParseResult {
  if (isRakutenMaintenancePage(bytes)) return { kind: 'MAINTENANCE' };
  const html = decodeRakutenPage(bytes);
  const jsonText = extractPageJson(html);
  if (jsonText === null) return { kind: 'PARSE_FAILED', reason: 'SCRIPT_NOT_FOUND' };
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return { kind: 'PARSE_FAILED', reason: 'JSON_INVALID' };
  }
  const info = ITEM_INFO_ROOTS.map((path) => at(data, path)).find(isObject);
  if (!info) return { kind: 'PARSE_FAILED', reason: 'ROOT_NOT_FOUND' };
  const itemName = str(at(info, ITEM_PATHS.title));
  if (!itemName) return { kind: 'PARSE_FAILED', reason: 'TITLE_NOT_FOUND' };
  const purchase = PURCHASE_INFO_ROOTS.map((path) => at(data, path)).find(isObject) ?? null;
  return { kind: 'PARSED', page: readPage(info, purchase, itemName) };
}

function readPage(info: Json, purchase: Json | null, itemName: string): ParsedItemPage {
  const missing = new Set<string>();
  const selectorsRaw = at(info, ITEM_PATHS.variantSelectors);
  const selectors = Array.isArray(selectorsRaw) ? selectorsRaw : [];
  if (!Array.isArray(selectorsRaw)) missing.add('itemInfoSku.variantSelectors');
  const skuRaw = at(info, ITEM_PATHS.sku);
  if (!Array.isArray(skuRaw)) missing.add('itemInfoSku.sku');
  const imagesRaw = at(info, ITEM_PATHS.images);
  if (!Array.isArray(imagesRaw)) missing.add('itemInfoSku.media.images');
  const genreId = int(at(info, ITEM_PATHS.genreId));
  if (genreId === null) missing.add('itemInfoSku.genreId');
  const descriptionHtml = str(
    atFirst(info, ITEM_PATHS_MEASURED.descriptionHtml, ITEM_PATHS.descriptionHtml),
  );
  if (descriptionHtml === null) missing.add('itemInfoSku.productDescription');
  const inventoriesRaw = purchase ? at(purchase, PURCHASE_PATHS.inventories) : undefined;
  if (!Array.isArray(inventoriesRaw)) missing.add('purchaseInfo.variantMappedInventories');

  const quantityByVariant = new Map<string, number | null>();
  for (const row of Array.isArray(inventoriesRaw) ? inventoriesRaw : []) {
    if (!isObject(row)) continue;
    const variantId = str(row.sku) ?? str(row.variantId);
    if (variantId) quantityByVariant.set(variantId, int(row.quantity));
  }
  const stockConditionByVariant = new Map<string, string>();
  const purchaseSkus = purchase ? at(purchase, PURCHASE_PATHS.purchaseSkus) : undefined;
  for (const row of Array.isArray(purchaseSkus) ? purchaseSkus : []) {
    if (!isObject(row)) continue;
    const variantId = str(row.variantId) ?? str(row.sku);
    const condition = str(at(row, 'newPurchaseSku.stockCondition'));
    if (variantId && condition) stockConditionByVariant.set(variantId, condition.slice(0, 32));
  }

  const backOrderFlag = bool(at(info, ITEM_PATHS.backOrderFlag));
  const seen = new Set<string>();
  const skus: ParsedSku[] = [];
  const nonCmLabels = new Set<string>();
  for (const raw of Array.isArray(skuRaw) ? skuRaw : []) {
    if (!isObject(raw)) continue;
    const variantId = str(raw.variantId);
    // 같은 variantId가 둘이면 앞의 것만(rakuten_sku UNIQUE)
    if (!variantId || seen.has(variantId)) continue;
    seen.add(variantId);
    const axes = axisValues(raw.selectorValues, selectors);
    const sizeMm = sizeLabelToMm(axes.size);
    if (axes.size !== null && sizeMm === null) nonCmLabels.add(axes.size);
    const price = int(raw.taxIncludedPrice);
    skus.push({
      variantId: variantId.slice(0, 64),
      colorLabel: axes.color?.slice(0, 128) ?? null,
      colorCode: colorCodeOf(axes.color, raw.attributes),
      sizeLabel: axes.size?.slice(0, 64) ?? null,
      sizeMm,
      widthLabel: axes.width?.slice(0, 64) ?? null,
      taxIncludedPriceYen: price !== null && price >= 0 ? price : null,
      // 짝이 되는 재고 행이 없으면 null(재고 정보 없음). 재고 행만 있고 SKU가 없는 고아 행은 버린다
      quantity: quantityByVariant.has(variantId)
        ? (quantityByVariant.get(variantId) ?? null)
        : null,
      hidden: bool(raw.hidden) ?? false,
      backOrder: bool(raw.backOrder) ?? bool(raw.backOrderFlag) ?? backOrderFlag,
      stockCondition: stockConditionByVariant.get(variantId) ?? null,
      articleNumber: str(raw.articleNumber)?.slice(0, 32) ?? null,
      postageIncluded: bool(at(raw, 'shipping.postageIncluded')),
      singleItemShipping: bool(at(raw, 'shipping.singleItemShipping')),
      selectorValues: raw.selectorValues ?? null,
      attributes: raw.attributes ?? null,
    });
  }

  const shopCode = str(at(info, ITEM_PATHS.shopCode));
  const itemManageNumber = str(
    atFirst(info, ITEM_PATHS_MEASURED.itemManageNumber, ITEM_PATHS.itemManageNumber),
  );
  const attributes = at(info, ITEM_PATHS.attributes) ?? null;
  const modelCode =
    attributeValue(attributes, MODEL_CODE_ATTRIBUTE_NAMES) ??
    skus.map((s) => attributeValue(s.attributes, MODEL_CODE_ATTRIBUTE_NAMES)).find((v) => v) ??
    null;
  const missingKeys = REQUIRED_PAGE_KEYS.filter((key) => missing.has(key));
  const notes: string[] = [];
  if (missingKeys.length > 0) notes.push(`읽지 못한 키: ${missingKeys.join(', ')}`);
  if (nonCmLabels.size > 0) {
    notes.push(`cm가 아닌 사이즈 라벨: ${[...nonCmLabels].slice(0, 10).join(', ')}`);
  }
  const note = notes.join(' / ');

  return {
    shopCode: shopCode?.slice(0, 64) ?? null,
    itemManageNumber,
    itemCode: shopCode && itemManageNumber ? `${shopCode}:${itemManageNumber}`.slice(0, 128) : null,
    itemName,
    shopName: str(at(info, ITEM_PATHS.shopName))?.slice(0, 255) ?? null,
    genreId: genreId !== null && genreId > 0 ? genreId : null,
    modelCode: modelCode?.slice(0, 128) ?? null,
    modelCodeNorm: normalizeModelCode(modelCode),
    attributes,
    variantSelectors: Array.isArray(selectorsRaw) ? selectorsRaw : null,
    imageUrls: imageUrlsOf(imagesRaw),
    descriptionHtml,
    descriptionText: htmlToText(descriptionHtml),
    saleStartsAt: date(at(info, ITEM_PATHS.saleStart)),
    saleEndsAt: date(at(info, ITEM_PATHS.saleEnd)),
    backOrderFlag,
    unlimitedInventory: bool(
      atFirst(info, ITEM_PATHS_MEASURED.unlimitedInventoryFlag, ITEM_PATHS.unlimitedInventoryFlag),
    ),
    allSkuSamePrice: bool(at(info, ITEM_PATHS.standardPriceIdentical)),
    skus,
    missingKeys,
    manualCheckRequired: note !== '',
    manualCheckNote: note === '' ? null : note.slice(0, 500),
  };
}

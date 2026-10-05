/**
 * 라쿠텐 상품 페이지 JSON(`<script type="application/json" id="item-page-app-data">`) 경로 상수(PRD §8.2 RK-04, F-SO-13).
 * **M0 S2 전 가정을 이 파일 한 곳에 모은다.** 실측 페이지(M0 S2)로 fixture를 바꾸면 이 상수만 고친다
 * (test/fixtures/rakuten/README.md). PRD 표에 경로가 있는 것은 그대로, '경로는 M0 S2에서 확정'인 것은 Proposed 가정이다.
 */

/** JSON을 담은 script 요소 id */
export const PAGE_JSON_SCRIPT_ID = 'item-page-app-data';

/** 루트 후보(PRD: `newApi.itemInfoSku`, 같은 데이터가 `api.data.itemInfoSku`에도 있어 대체 루트로 쓴다) */
export const ITEM_INFO_ROOTS = [
  ['newApi', 'itemInfoSku'],
  ['api', 'data', 'itemInfoSku'],
] as const;

/**
 * 구매 정보(재고) 루트 후보. 실제 상품 페이지(2026-10-05 실측)에서는 `itemInfoSku` 안에 있다(`newApi.itemInfoSku.purchaseInfo`) —
 * 이 경로를 못 읽으면 모든 SKU 재고가 비어('재고 없음') 후보가 재고 부족으로 제외된다. 아래 두 줄은 M0 S2 전 가정(Proposed)이라
 * 합성 fixture용으로 뒤에 남긴다.
 */
export const PURCHASE_INFO_ROOTS = [
  ['newApi', 'itemInfoSku', 'purchaseInfo'],
  ['api', 'data', 'itemInfoSku', 'purchaseInfo'],
  ['newApi', 'purchaseInfo'],
  ['api', 'data', 'purchaseInfo'],
] as const;

/**
 * 실측(2026-10-05, 실제 라쿠텐 상품 페이지)에서 확인한 `itemInfoSku` 안의 경로. 같은 값의 가정 경로(`ITEM_PATHS`)보다 먼저 본다.
 * 실제 페이지에는 `itemManageNumber`·`productDescription`·`identicalVariants.unlimitedInventoryFlag`가 없고 아래 경로에 있다.
 */
export const ITEM_PATHS_MEASURED = {
  /** 상품 관리 번호(예: `38s12600034`) */
  itemManageNumber: 'manageNumber',
  /** 설명 HTML(PC용) */
  descriptionHtml: 'pcFields.productDescription',
  /** 무제한 재고 여부 */
  unlimitedInventoryFlag: 'unlimitedInventoryFlag',
} as const;

/** itemInfoSku 안의 경로(PRD 표) */
export const ITEM_PATHS = {
  variantSelectors: 'variantSelectors',
  sku: 'sku',
  images: 'media.images',
  standardPriceIdentical: 'identicalVariants.standardPrice.identical',
  backOrderFlag: 'identicalVariants.backOrderFlag',
  unlimitedInventoryFlag: 'identicalVariants.unlimitedInventoryFlag',
  // ── 아래는 M0 S2 전 가정(Proposed) ──
  /** 샵 코드(URL의 샵 이름, itemCode 앞부분) */
  shopCode: 'shopUrlName',
  /** 상품 관리 번호(itemCode 뒷부분 — API 형식 `샵코드:상품관리번호`) */
  itemManageNumber: 'itemManageNumber',
  shopName: 'shopName',
  title: 'title',
  /** 장르 ID(URL 입구의 아동화 신호). 없으면 itemCode로 Item Search를 부른다(F-SO-07) */
  genreId: 'genreId',
  /** 설명 HTML(`productDescription` 후보) */
  descriptionHtml: 'productDescription',
  /** 세일 기간 */
  saleStart: 'salePeriod.start',
  saleEnd: 'salePeriod.end',
  /** 상품 속성([{name, value}]) */
  attributes: 'attributes',
} as const;

/** purchaseInfo 안의 경로(PRD 표) */
export const PURCHASE_PATHS = {
  /** [{sku: variantId, quantity}] — variantId로 조인(고아 행은 버린다) */
  inventories: 'variantMappedInventories',
  /** [{variantId, newPurchaseSku: {stockCondition}}] — sold-out·almost-out일 때만 붙는 조건부 키 */
  purchaseSkus: 'sku',
} as const;

/** 옵션 축 이름(variantSelectors[].key·label에 이 글자가 들면 그 축) */
export const AXIS_WORDS = {
  color: ['カラー', '色'],
  size: ['サイズ'],
  width: ['ウイズ', 'ワイズ', '幅'],
} as const;

/** メーカー型番 속성 이름(앵커 型番, RK-03 5) */
export const MODEL_CODE_ATTRIBUTE_NAMES: readonly string[] = [
  'メーカー型番',
  'メーカー品番',
  '型番',
];

/**
 * 색상 코드 출처(M0 S2 전 가정, Proposed — ERD §7.3-1): SKU 속성 'カラーコード'·'カラー番号', 없으면 색상 라벨 끝의 괄호
 * 코드('クリーム×ブラック(108)' → '108'). 못 얻으면 null(앵커를 확정하지 못한다)
 */
export const COLOR_CODE_ATTRIBUTE_NAMES: readonly string[] = [
  'カラーコード',
  'カラー番号',
  '色番号',
];

/** 빠진 키를 '수동 확인'으로 넘길 때 보는 필수 경로(F-SO-14). 없어도 멈추지 않고 읽은 것만 저장한다 */
export const REQUIRED_PAGE_KEYS = [
  'itemInfoSku.sku',
  'itemInfoSku.variantSelectors',
  'itemInfoSku.media.images',
  'itemInfoSku.genreId',
  'itemInfoSku.productDescription',
  'purchaseInfo.variantMappedInventories',
] as const;

/**
 * URL 경로와 API 경로의 itemCode가 같은가(M0 S2 전 가정 true — ERD §7.3-2). false로 바꾸면 URL 입구가 늘 Item Search
 * 보완 조회(F-BS-37: 샵 코드 + 型番·상품명, itemUrl 일치)로 itemCode를 얻는다. true여도 페이지 JSON에 itemCode가 없으면 보완한다
 */
export const PAGE_ITEM_CODE_MATCHES_API = true;

import type { StepCode } from '@/shared/lib/steps';

/**
 * 체험 예시 이야기(D-31): 여정 하나가 ①~⑨를 거쳐 등록됐다. 값은 흐름 테스트(e2e flow-keyword·BE flow fixture)와 FE fixture가 쓰는
 * 값을 그대로 쓴다 — 아식스 젤카야노14(アシックス ゲルカヤノ14 1201A019) · 색상 108 크림/블랙 · ショップA(shop-a:10000123)
 * ¥12,000 · 국내 기준가 169,000원 → 판매가 167,300원 · 러닝화.
 *
 * 시각은 체험을 켠 때에서 몇 분 전으로 적는다(고정 날짜면 '오늘 조회 수'·토큰 만료·판정 유효시간이 지난 값처럼 보인다).
 */
export interface DemoClock {
  /** 체험을 켠 시각(ms) */
  readonly now: number;
  /** n분 전(ISO). 음수면 n분 뒤 */
  ago(minutes: number): string;
  /** 이야기 시각 `minutes`(몇 분 전)의 `plusMinutes`분 뒤(ISO) — 판정 유효시간처럼 어떤 일에서 일정 시간 뒤인 값 */
  after(minutes: number, plusMinutes: number): string;
  /** n분 전의 한국 날짜(YYYY-MM-DD) */
  kstDate(minutesAgo?: number): string;
}

const MINUTE_MS = 60_000;
const KST_OFFSET_MS = 9 * 60 * MINUTE_MS;

/** 고정 시계(체험을 켠 때에서 몇 분 전으로 적는다). 따라 하기(D-32)는 `world/clock.ts`의 시계를 쓴다 */
export function demoClock(now: number = Date.now()): DemoClock {
  return {
    now,
    ago: (minutes) => new Date(now - minutes * MINUTE_MS).toISOString(),
    after: (minutes, plusMinutes) =>
      new Date(now - minutes * MINUTE_MS + plusMinutes * MINUTE_MS).toISOString(),
    kstDate: (minutesAgo = 0) =>
      new Date(now - minutesAgo * MINUTE_MS + KST_OFFSET_MS).toISOString().slice(0, 10),
  };
}

/** 이야기의 시각표(몇 분 전). 위에서 아래로 일어난 순서다 */
export const MINUTES_AGO = {
  secretsSaved: 240,
  metaSynced: 235,
  profileSaved: 230,
  rateTableImported: 228,
  appStarted: 215,
  aiTestClaude: 212,
  aiTestAgy: 211,
  aiEngineSaved: 210,
  fxCollected: 200,
  keywordsPasted: 160,
  keywordSelected: 159,
  candidateCreated: 158,
  sourcingStarted: 158,
  anchorFixed: 156,
  pageCollected: 154,
  sourcingDone: 152,
  domesticPriceEntered: 151,
  judged: 150,
  g2Passed: 149,
  categoryStarted: 148,
  categoryDecided: 147,
  thumbnailStarted: 146,
  referencesConfirmed: 145,
  competitorTagsImported: 144,
  generationStarted: 143,
  generationDone: 141,
  g3Passed: 139,
  chainStarted: 138,
  copyDone: 137,
  noticeRawDone: 136,
  noticeHtmlDone: 135,
  tagsDone: 134,
  uploadDone: 133,
  dryRunApproved: 128,
  switchOff: 126,
  approved: 124,
  registered: 123,
  switchOn: 121,
  authChecked: 60,
  storageMeasured: 1,
} as const;

/** 이야기 시각표의 키 */
export type StoryKey = keyof typeof MINUTES_AGO;

/** 예시 id(05-2 응답에 나오는 값). FE fixture가 쓰는 번호를 되도록 그대로 쓴다 */
export const DEMO_IDS = {
  candidate: 1,
  keywordSnapshot: 7,
  /** G1으로 고른 키워드(아식스 젤카야노14) */
  sourceKeyword: 101,
  sourcingComparison: 41,
  /** 고른 상품(ショップA)의 페이지 스냅샷 */
  rakutenItem: 55,
  domesticPrice: 1,
  priceJudgement: 7,
  categoryDecision: 21,
  stepChain: 1,
  thumbnailSelection: 1,
  tagSet: 7,
  competitorInput: 31,
  uploadResult: 1,
  /** 차단 켬으로 승인한 드라이런 기록(검증완료) */
  dryRunRegistration: 30,
  /** 차단을 끄고 다시 승인한 등록 기록(등록됨) */
  registration: 31,
  gatePass: { G1: 10, G2: 11, G3: 12, G4: 13 },
  settingsSnapshot: 3,
  forwarderRateTable: 1,
} as const;

/** 단계별 현재 실행 id(fixture 레일과 같은 100번대 — ⑨는 드라이런 v1(109) 뒤의 v2) */
export const STEP_RUN_ID: Readonly<Record<StepCode, number>> = {
  SOURCING: 100,
  PRICING: 101,
  CATEGORY: 102,
  THUMBNAIL: 103,
  COPY: 104,
  NOTICE_RAW: 105,
  NOTICE_HTML: 106,
  TAGS: 107,
  UPLOAD: 108,
  REGISTER: 110,
};

/** ⑨ 드라이런(차단 켬) 실행 v1 */
export const DRY_RUN_STEP_RUN_ID = 109;

/** 흐름 순서 단계 코드 10개 */
export const STEP_CODES: readonly StepCode[] = [
  'SOURCING',
  'PRICING',
  'CATEGORY',
  'THUMBNAIL',
  'COPY',
  'NOTICE_RAW',
  'NOTICE_HTML',
  'TAGS',
  'UPLOAD',
  'REGISTER',
];

/** 이야기에 쓰는 글자 값(화면 여러 곳에 같은 값이 보인다) */
export const STORY = {
  sourceKeyword: '아식스 젤카야노14',
  rakutenQuery: 'アシックス ゲルカヤノ14 1201A019',
  displayName: '아식스 젤카야노14 · 크림/블랙',
  itemCode: 'shop-a:10000123',
  shopCode: 'shop-a',
  shopName: 'ショップA',
  itemName: 'アシックス ゲルカヤノ 14 1201A019-108 クリーム×ブラック メンズ スニーカー',
  /** 스킴 없는 주소(소스 규칙 15 — 앱 소스에 외부 주소 글자를 두지 않는다. fixture와 같은 방식) */
  itemUrl: 'item.rakuten.co.jp/shop-a/asics-1201a019-108/',
  modelCode: '1201A019',
  modelCodeNorm: '1201A019',
  colorCode: '108',
  colorLabelJa: 'クリーム×ブラック(108)',
  selectedColor: '크림/블랙',
  sellerManagementCode: 'RKT:shop-a:10000123:108',
  productName: '아식스 젤카야노14 1201A019-108 러닝화 크림 남성',
  leafCategoryId: '50000830',
  wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
  domesticPriceKrw: 169_000,
  salePriceKrw: 167_300,
  /** 판매 사이즈(③ 판정 · ⑥-3 고시 · 승인 옵션) */
  saleSizesMm: [250, 255, 260, 265, 275],
  originProductNo: '10000000001',
  channelProductNo: '10000000002',
} as const;

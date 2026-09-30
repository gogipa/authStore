/**
 * 설정 JSON(비밀 아님)의 타입. 원본은 `APP_DATA_DIR/settings/settings.json` 한 파일이고, 검사를 통과한 내용의
 * 사본이 `settings_snapshot.content`다(ERD §3.11, F-ST-01). 다른 모듈은 파일을 직접 읽지 않고
 * `SettingsService.current()`로 이 타입을 받는다(P1-03 §4 규칙 14).
 *
 * 표기(Proposed, ERD §7.4-1·06-4 §2.2 — 한 번 정하면 P2-05 가격 엔진이 그대로 읽는다)
 * - 비율은 **퍼센트 수**다: 2.5 = 2.5%(0.025가 아니다). 키 이름 끝을 `Pct`로 둔다. 소수는 셋째 자리까지(multipleOf 0.001).
 *   계산하는 쪽은 부동소수 오차를 피하려고 정수 천분율(`Math.round(pct * 1000)`)이나 decimal로 바꿔 쓴다(05-1 §7.1-4).
 * - 금액은 단위를 키 이름 끝에 둔다: `Krw`(원, 정수), `Yen`(엔, 정수), `Usd`(달러).
 * - 사이즈는 `Mm`(KR mm, 정수), 시간은 `Hours`.
 * - 개인 값(상호·A/S·반품비·배송기간·importer·배대지 주소·요금표·파일 경로)은 두지 않거나 `null`·`{자리표시자}`로만 둔다(F-BS-03).
 */
import type { AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';

/** 설정 JSON Schema 버전(settings_snapshot.schema_version) */
export type SettingsSchemaVersion = '1';

/** Npay 결제 수수료 등급(PRD §8.3 등급표: 영세·중소1·중소2·중소3·일반) */
export const NPAY_FEE_GRADES = ['MICRO', 'SMALL_1', 'SMALL_2', 'SMALL_3', 'GENERAL'] as const;
export type NpayFeeGrade = (typeof NPAY_FEE_GRADES)[number];

/** 셀러 부가세 모드(PRD §8.3 계산 순서 5) */
export const VAT_MODES = ['A', 'B', 'C'] as const;
export type VatMode = (typeof VAT_MODES)[number];

/**
 * 가격 책정 규칙(PRD §8.3 '가격 책정 규칙', Proposed 코드)
 * - REF_DISCOUNT: floor100(P_ref × (1 − refDiscountPct%)) — 기본
 * - REF_MINUS_100: P_ref − 100원
 * - MAX_SKU_SINGLE: 가장 비싼 SKU 기준 단일가
 * - OPTION_PRICE: 옵션가 방식
 */
export const PRICE_RULE_METHODS = [
  'REF_DISCOUNT',
  'REF_MINUS_100',
  'MAX_SKU_SINGLE',
  'OPTION_PRICE',
] as const;
export type PriceRuleMethod = (typeof PRICE_RULE_METHODS)[number];

/**
 * 실질가 포인트 내림 방식(PRD §8.2 RK-06, P2-03 — F-SO-23)
 * - PER_PROGRAM: 프로그램별 내림 Σ floor(base × r / 100) — 기본
 * - SIMPLE: 단순식 floor((SKU가_대표 − 쿠폰) × Σr / 110)
 */
export const POINT_ROUNDINGS = ['PER_PROGRAM', 'SIMPLE'] as const;
export type PointRounding = (typeof POINT_ROUNDINGS)[number];

/** 관세율 표의 HS 4단위(PRD §8.3: 6401 8%, 6402~6405 13%) */
export const DUTY_HS_HEADINGS = ['6401', '6402', '6403', '6404', '6405'] as const;
export type DutyHsHeading = (typeof DUTY_HS_HEADINGS)[number];

/** 성별 코드(ERD ck_candidate_gender) */
export const SETTINGS_GENDERS = ['MALE', 'FEMALE'] as const;
export type SettingsGender = (typeof SETTINGS_GENDERS)[number];

/**
 * 고지 블록을 넣는 조건(PRD §8.5 '조건부 블록', Proposed 코드). null이면 늘 넣는다.
 * - LEATHER_OR_UNKNOWN_MATERIAL: 소재에 천연·인조 가죽이 있거나 소재가 '정보 없음'
 * - AI_IMAGE_LABEL: AI 표시(②-15)를 켰을 때
 * - MODE_A_PRICE_BREAKDOWN: 모드 A 요건(PR-07)을 켰을 때
 */
export const NOTICE_BLOCK_CONDITIONS = [
  'LEATHER_OR_UNKNOWN_MATERIAL',
  'AI_IMAGE_LABEL',
  'MODE_A_PRICE_BREAKDOWN',
] as const;
export type NoticeBlockCondition = (typeof NOTICE_BLOCK_CONDITIONS)[number];

/** 셀러라이프 배대지 쿠폰(F-ST-05) */
export interface SellerlifeCouponSettings {
  /** 기본 false */
  enabled: boolean;
  /** 쿠폰 1장 금액(원). 기본 2,000 */
  amountKrw: number;
  /** 한 달에 쓸 수 있는 장수. 기본 0(Proposed: 켜도 오너가 한도를 넣기 전에는 빼지 않는다 — 보수적) */
  monthlyLimit: number;
}

/** 비용 기본값(F-ST-03, PRD §8.3 '기본 파라미터') */
export interface CostSettings {
  /** 카드 가산율 k_card. 2.5 */
  cardSurchargePct: number;
  /** 판매수수료 r_sale. 3.0 */
  saleFeePct: number;
  /** 마케팅·광고 유입 판매수수료. 1.0 */
  saleFeeAdInflowPct: number;
  /** 판매수수료가 배송비에도 붙는지. 기본 true(보수적) */
  saleFeeIncludesShipping: boolean;
  /** 이 스토어의 Npay 수수료 등급. 기본 GENERAL(3.63%) */
  npayFeeGrade: NpayFeeGrade;
  /** Npay 수수료 등급표 r_order(결제수단 무관) */
  npayFeePctByGrade: Record<NpayFeeGrade, number>;
  /** 기타비용 C_misc(포장·반품 적립). 3,000 */
  miscCostKrw: number;
  /** 목표 마진 m. 10 */
  targetMarginPct: number;
  /** 최소 이익 Π_min. 5,000 */
  minProfitKrw: number;
  /** 판정 여유 δ_judge. 1 */
  judgementMarginPct: number;
  /** 반올림 단위. 100 */
  roundingUnitKrw: number;
  /** 판정용 포인트 환산 k_margin(0~1). 0 */
  pointValueFactorForMargin: number;
  /** 셀러 부가세 모드. A(모드 B 순이익 ≥ 0 게이트를 함께 적용) */
  vatMode: VatMode;
  sellerlifeCoupon: SellerlifeCouponSettings;
}

export interface ShoeBoxSettings {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
}

export interface PriceRuleSettings {
  method: PriceRuleMethod;
  /** REF_DISCOUNT의 할인율. 1 → floor100(P_ref × 0.99) */
  refDiscountPct: number;
}

export interface SimplifiedDutySettings {
  /** 간이세율 모드. 기본 false */
  enabled: boolean;
  /** 18 */
  ratePct: number;
}

/**
 * 배대지 검수·포장비(F-PJ-06 '검수·포장비를 더해 배대지 비용을 내며, 포함 여부는 설정(기본 포함)', P2-05 Proposed —
 * 금액 키는 문서에 없어 새로 뒀다). 요금표 운임에 검수·포장이 빠진 배대지면 오너가 금액을 넣는다(기본 0원이라 PRD §8.3
 * 예시·시안 값이 그대로 나온다). 요금표가 없을 때의 기본 배대지비(15,000원)는 검수·포장을 포함한 가정값이라 더하지 않는다
 */
export interface ForwarderHandlingFeeSettings {
  /** 검수·포장비를 배대지 비용 C_fwd에 더한다. 기본 true */
  included: boolean;
  /** 검수·포장비(원, 1켤레). 기본 0 */
  amountKrw: number;
}

/** 판정 가정값(PRD §8.3) + 과세 사이즈 판매(F-ST-02) */
export interface PricingSettings {
  /** 면세 기준(미화). 150 */
  dutyFreeLimitUsd: number;
  /** 안전 버퍼(미화). 5 → 145달러까지 면세로 본다 */
  dutyFreeBufferUsd: number;
  /** 활성 요금표가 없을 때 배대지 비용 C_fwd. 15,000 + '가정값' 배지 */
  defaultForwarderFeeKrw: number;
  /** 신발 박스 기본 33×22×12cm, 1.2kg(가정) */
  shoeBox: ShoeBoxSettings;
  /** 관세율 */
  dutyRatePctByHsHeading: Record<DutyHsHeading, number>;
  /**
   * 과세 사이즈 관세에 쓸 HS 4단위(P2-05 Proposed — 상품별 HS 판정 방법이 문서에 없다, ERD §7.1-8). 기본 6404
   * (고무·플라스틱 밑창 + 섬유 갑피, 13%). 판정 스냅샷 params에 적용 값이 남는다
   */
  dutyHsHeading: DutyHsHeading;
  /** 검수·포장비(P2-05 Proposed) */
  forwarderHandlingFee: ForwarderHandlingFeeSettings;
  /** FTA·RCEP 협정세율 적용. 기본 false(원산지 증빙 필요) */
  applyFtaRates: boolean;
  simplifiedDuty: SimplifiedDutySettings;
  priceRule: PriceRuleSettings;
  /** 과세 사이즈도 관부가세를 판매가에 넣어 판다(D-03). 기본 false = 면세만 판매. 관세사 확인(E-2) 뒤 켠다 */
  sellTaxableSizes: boolean;
}

export interface SizeRangeMm {
  min: number;
  max: number;
}

/** 소싱 기본값(F-BS-39, PRD §8.2·§8.8) */
export interface SourcingSettings {
  /** 라쿠텐 장르 ID. 558885(靴) */
  genreId: number;
  /** 검색 minPrice(엔). 3,000 */
  minPriceYen: number;
  /** 검색 NGKeyword(공백으로 이어 보낸다). 내장 아동 단어 キッズ·ジュニア·ベビー는 뺄 수 없다 */
  ngKeywords: string[];
  /** 페이지 조회: 재고 통과 후보가 이 수가 되면 멈춘다(K). 3 */
  pageFetchTargetCandidates: number;
  /** 페이지 조회: 이 페이지 수에 닿으면 멈춘다(M). 10 */
  pageFetchMaxPages: number;
  /** 성별 목표 사이즈(mm). 남 250~290, 여 220~260 */
  targetSizeMm: Record<SettingsGender, SizeRangeMm>;
  /** 재고 있는 사이즈 최소 수. 3 */
  minSizeCount: number;
  /** 기본 폭. '2E (標準)' */
  defaultWidth: string;
  /** 取り寄せ(backOrderFlag) 제외. 기본 true */
  excludeBackOrder: boolean;
  /** 송료를 모를 때 기본 송료(엔). 800 */
  defaultShippingYen: number;
  /** 라쿠텐 상품 페이지 하루 조회 상한(RAKUTEN_PAGE, KST 0시 초기화). 110 */
  pageFetchDailyLimit: number;
  /** 라쿠텐 API(Item Search·IchibaGenre) 호출 값(P2-02 Proposed — 06-4 §2.2) */
  rakutenApi: RakutenApiSettings;
  /** 실질가 포인트 계산 기준값(F-SO-23, P2-03 Proposed — 06-4 §2.2) */
  points: SourcingPointSettings;
}

/**
 * 실질가 포인트 계산 기준값(PRD §8.2 RK-06·§17 표, F-SO-22·23, P2-03). 순위용이다 — 마진 판정의 포인트 가치(k_margin)는
 * `costs.pointValueFactorForMargin`(0 고정)이라 여기 없다. 배율은 '배'(1.5 = 1.5배), 소수 넷째 자리까지(numeric(7,4)).
 */
export interface SourcingPointSettings {
  /** API `pointRate`에 기본 1배가 들어 있다고 본다(true면 상품 추가분 = pointRate − 1). 기본 true(보수적, M0 S2 확인) */
  pointRateIncludesBase: boolean;
  /** 포인트 내림 방식. 기본 PER_PROGRAM */
  rounding: PointRounding;
  /** SPU 배율(오너 설정, 카드 계열은 근사). 기본 0 */
  spuMultiplier: number;
  /** 순위용 포인트 가치 k_rank(0~1). 기본 0.5(②-5) */
  kRank: number;
}

/**
 * 라쿠텐 API 호출 값(PRD §8.2 RK-01, F-BS-34·35, P2-02 Proposed — 06-4 §2.2).
 * 호출 간격(Item Search 1.5초·상품 페이지 3초)·24시간 쉼·앱 UA는 여기 두지 않는다: 외부 호출 관문 상수다(P1-01 Proposed —
 * 느슨하게 풀 수 없게). URL 입구 제외어는 따로 두지 않고 `ngKeywords`를 그대로 쓴다(PRD §5.3 '검색 경로의 NGKeyword를
 * 상품명에 적용'). 키(applicationId·accessKey)는 키체인에만 둔다.
 */
export interface RakutenApiSettings {
  /** Item Search 주소(버전 20260701). 호스트는 관문 허용 목록(openapi.rakuten.co.jp)만 */
  itemSearchUrl: string;
  /** IchibaGenre Search 주소(경로 M0 S2에서 확정). 호스트는 같다 */
  genreSearchUrl: string;
  /** 한 페이지 건수(hits). 30 */
  hits: number;
  /** 같은 검색의 캐시 시간(시간). 6 */
  searchCacheHours: number;
  /** 429·503 다시 보내기 최대 횟수(지수 백오프). 3 */
  maxRetries: number;
  /** 장르 캐시를 다시 받는 주기(일). 30 */
  genreCacheDays: number;
}

/**
 * 데이터랩 인기검색어 요청(PRD §8.1, F-BS-33, P2-01 Proposed — 06-4 §2.2).
 * Referer·UA는 여기 두지 않는다: Referer는 외부 호출 관문이 허용한 값 하나(`DATALAB_REFERER`)만 받고,
 * UA는 위장을 막으려고 코드 상수(`APP_USER_AGENT`)다(P1-01 Proposed). 24시간 쉼도 관문 상수(`COOLDOWN_MS`)다.
 */
export interface DatalabSettings {
  /** 순위 요청 주소(내부 엔드포인트). 호스트는 관문 허용 목록(datalab.naver.com)이어야 한다 */
  rankUrl: string;
  /** 한 페이지 크기(form `count`). 20 */
  pageSize: number;
  /** cid당 최대 페이지. 25(= 500위) */
  maxPage: number;
  /** 요청 사이 간격(초). 2 — 2보다 짧게 할 수 없다(F-BS-33) */
  requestIntervalSeconds: number;
  /** 버튼 수집 기본 cid(여성신발·남성신발). 한 요청에 cid 하나(콤마 금지) */
  defaultCids: string[];
}

/** 키워드 수집(① 데이터랩) */
export interface KeywordSettings {
  /** 데이터랩 하루 요청 상한(DATALAB). 100(06-2 §9 P1-01) */
  datalabDailyLimit: number;
  /** 데이터랩 순위 요청(P2-01) */
  datalab: DatalabSettings;
}

/** 안전 기준(F-BS-05). 하한·상한과 내장 목록은 safety/builtin-safety-lists.ts */
export interface SafetySettings {
  /** 상품 전체 사이즈의 최댓값이 이 값 이하면 '아동화 의심'. 235 미만으로 낮출 수 없다 */
  childShoeMaxSizeMm: number;
  /** 판정 유효 시간(RG-08). 6시간보다 길게 할 수 없다 */
  judgementValidityHours: number;
  /** 아동 키워드(KW-01). 내장 단어는 뺄 수 없고 더하기만 된다. 키워드 화면 '단어 더하기'(P2-01)가 여기에 더한다 */
  childKeywords: string[];
  /** 바퀴 달린 운동화 단어(F-BS-12, P2-01 Proposed). 내장 단어는 뺄 수 없고 더하기만 된다 */
  wheeledShoeWords: string[];
  /** 고령자용 신발 단어(F-BS-12, P2-01 Proposed). 내장 단어는 뺄 수 없고 더하기만 된다 */
  seniorShoeWords: string[];
  /** 실존 인물·그룹·연예인 차단어(IM-07). 내장 단어는 뺄 수 없고 더하기만 된다 */
  personBlockWords: string[];
  /**
   * 아동 카테고리 말(P2-06 Proposed, F-CA-07): 네이버 카테고리 이름·경로에 들어 있으면 ④에서 고를 수 없다(후보 목록에서도
   * 뺀다). 내장 말(common/rules/category-words.ts)은 뺄 수 없고 더하기만 된다
   */
  childCategoryWords: string[];
  /**
   * CON-08 판매 제외 품목 카테고리 말(P2-06 Proposed, F-CA-09 — 바퀴 달린 운동화·고령자용 신발). 들어 있으면 ④에서 고를 수
   * 없다. 내장 말은 뺄 수 없고 더하기만 된다
   */
  excludedCategoryWords: string[];
}

/** 구매대행 고지 블록 한 줄(PRD §8.5 CT-04) */
export interface NoticeBlock {
  /** 블록 ID(대문자·숫자·밑줄). 필수 블록은 safety/builtin-safety-lists.ts */
  id: string;
  /** 넣는 조건. null이면 늘 넣는다 */
  when: NoticeBlockCondition | null;
  /** 문장 템플릿. `{상호}` 같은 자리표시자는 ⑥-3이 프로필·아래 values로 채운다 */
  text: string;
}

/** 고지 템플릿 변수 가운데 프로필 화면에 없는 값(ERD §3.11, §7.2-18) */
export interface NoticeValues {
  /** `{배송기간_최소}`(영업일). null = 자리표시자 그대로 — 오너가 넣는다(F-BS-03, 오너 검토: ERD는 10) */
  deliveryDaysMin: number | null;
  /** `{배송기간_최대}`(영업일). null = 자리표시자 그대로(오너 검토: ERD는 20) */
  deliveryDaysMax: number | null;
  /** `{교환정책}` */
  exchangePolicy: string;
}

export interface NoticeSettings {
  /** `{템플릿_기준일}`(YYYY-MM-DD). 템플릿을 고치면 함께 고친다(F-CT-02, 04 기능리스트 판단 17) */
  basisDate: string;
  blocks: NoticeBlock[];
  values: NoticeValues;
}

/** 엔진 하나의 텍스트·비전 모델(05-2 AiEngineModelPair). 정하지 않았으면 null */
export interface AiEngineModelPair {
  text: string | null;
  vision: string | null;
}

/**
 * 발송 택배사 코드 한 줄(F-ST-09, RG-03, P1-09 Proposed). 동기화하지 않고 설정 파일에 적는다.
 * 출처(`source`)를 밝힌 코드만 둔다. 해외 출고에 쓸 수 있는 코드는 M0 S3에서 확인한다.
 */
export interface DispatchDeliveryCompanySetting {
  /** 커머스API `deliveryInfo.deliveryCompany`에 넣을 코드(영문·숫자·`_`·`-`·`.`, 40자까지) */
  code: string;
  /** 화면 이름 */
  name: string;
  /** 코드 출처(문서 이름·확인 날짜 등). 비울 수 없다 */
  source: string;
}

/** 배송(구매대행 프로필이 고르는 코드 목록, P1-09 Proposed). 기본 템플릿은 빈 목록이다(출처 있는 코드가 아직 없다) */
export interface DeliverySettings {
  dispatchCompanies: DispatchDeliveryCompanySetting[];
}

/** AI 엔진 선택(D-16). 이 섹션을 파일에 쓰는 것은 PUT /settings/ai-engine(P1-11)뿐이다 */
export interface AiSettings {
  engine: AiEngineCode;
  models: Record<AiEngineCode, AiEngineModelPair>;
}

/**
 * 매핑표 한 줄(P2-06 Proposed, PRD §8.7 카테고리 확정 1 '설정 매핑표(라쿠텐 장르·상품유형 → 네이버 리프 후보)').
 * ② 상품의 장르(또는 그 조상 장르)가 `genreId`이고, `productType`이 있으면 ② 상품유형도 같을 때 맞는다.
 */
export interface CategoryLeafMapping {
  /** 라쿠텐 장르 id(② `rakuten_item.genre_id` 또는 장르 경로의 조상). 가장 가까운(깊은) 장르의 줄을 쓴다 */
  genreId: number;
  /** ② 상품유형(`rakuten_item.product_type`). 없거나 null이면 상품유형과 관계없이 맞는다 */
  productType?: string | null;
  /**
   * 네이버 리프 카테고리 id(`commerce_category.category_id`, 메타 동기화 뒤 SCR-11·`GET /commerce-categories`에서 찾는다).
   * 두 성별을 섞어 넣어도 된다 — ④가 후보 성별 경로(패션잡화>남성신발>… / …여성신발>…)로 거른다
   */
  leafCategoryIds: string[];
}

/** ④ 카테고리(P2-06 Proposed — 06-4 §2.2). 아동·제외 품목 말은 안전 목록이라 `safety`에 둔다 */
export interface CategorySettings {
  /** 매핑표. 비었거나 맞는 줄이 없으면 성별 경로의 신발 리프 전체를 후보로 보인다(F-CA-04) */
  leafMapping: CategoryLeafMapping[];
}

/** 얼굴 노출 수준(ERD `ck_gen_face`, 05-2 ThumbnailFaceOption, IM-07). 기본 FULL_FACE(①-4) */
export const THUMBNAIL_FACE_OPTIONS = ['FULL_FACE', 'CHIN_CROP', 'HANDS_UPPER_BODY'] as const;
export type ThumbnailFaceOption = (typeof THUMBNAIL_FACE_OPTIONS)[number];

/**
 * 이미지 생성 공급자(ERD `ck_gen_provider`, PRD §8.4 공급자 표, IM-09). M0 S1에서 하나로 정한다. 정하기 전에는 가짜 공급자
 * (`integrations/image-gen/fake-image-gen.provider.ts`)가 이 코드로 기록한다(P3-02 Proposed). 선택 AI 엔진(`ai.engine`)과 섞지 않는다
 */
export const THUMBNAIL_IMAGE_PROVIDERS = ['AGY', 'GEMINI_API', 'OPENAI_API', 'CODEX'] as const;
export type ThumbnailImageProvider = (typeof THUMBNAIL_IMAGE_PROVIDERS)[number];

/** 생성 한 건 하드 타임아웃 상한(초, P3-02 규칙 5 — 15분). 설정은 이 값 이하로만 줄인다 */
export const THUMBNAIL_GENERATION_TIMEOUT_MAX_SECONDS = 900;

/**
 * ⑤ 썸네일(P3-01 — ERD `generation_run` '⑤ 입력 기록 규칙', PRD §8.4 '기본 프롬프트 골격', 06-4 §2.2).
 * `promptTemplate`·`faceOptionDefault`만 ⑤ 시작 조건(입력 지문)이다. 후보 수·해상도는 P3-01 Proposed 키 이름이다.
 * 실존 인물 차단어 추가분은 안전 목록 `safety.personBlockWords`(내장 목록은 뺄 수 없다)를 그대로 쓴다.
 */
export interface ThumbnailSettings {
  /**
   * 영어 프롬프트 골격(이미지 모델에 영어가 안정적 — PRD §8.4). `{resolution}`(해상도 px)과 `{face_option}`(얼굴 노출 문장)을
   * 반드시 한 번 이상 담는다(스키마 pattern). 오너 조정 문구는 골격 뒤에 붙는다
   */
  promptTemplate: string;
  /** 얼굴 노출 기본값(F-TH-11). 기본 FULL_FACE */
  faceOptionDefault: ThumbnailFaceOption;
  /** 생성 후보 수 N(IM-03 기본 2, P3-02가 쓴다). 1~4 */
  candidateCount: number;
  /** 생성 해상도 px(PRD §16 ③ 2K = 2048, M0 S1에서 확정). 512~4096 */
  resolutionPx: number;
  /** 이미지 생성 공급자(P3-02 Proposed 키 — M0 S1에서 확정). 기본 AGY */
  imageProvider: ThumbnailImageProvider;
  /** 생성 한 건 타임아웃(초, P3-02 Proposed 키). 1~900, 기본 900(15분 — 하드 상한). 테스트는 짧게 둔다 */
  generationTimeoutSeconds: number;
}

/**
 * 원산지 나라 사전 한 줄(P3-03 Proposed — PRD §8.5 원산지 코드 규칙 '일본어 국가명 → 대륙 > 국가 사전(설정 파일)', P3-04가 같은
 * 사전으로 원산지 코드를 찾는다). `raw`는 라쿠텐 표기(일본어·영문 — NFKC·대문자·공백 무시로 비교), `area`는 '대륙 > 국가'
 * (커머스API 원산지 이름과 같은 모양, 예 '아시아 > 베트남'). ⑥-2는 `area`의 마지막 조각(국가)을 한국어 값으로 쓴다
 */
export interface OriginCountryEntry {
  raw: string;
  area: string;
}

/** 소재 말 사전 한 줄(P3-03 Proposed — ⑥-2 값의 한국어 정리). `raw` 일본어(NFKC 비교) → `ko` 한국어 */
export interface MaterialTermEntry {
  raw: string;
  ko: string;
}

/**
 * ⑥-2 설명문·속성 항목 이름(P3-03 Proposed — PRD §8.5 CT-02 '설명문 패턴'). 정규식이 아니라 항목 이름 목록이다(앱이 NFKC 뒤
 * 글자에 맞춰 경계를 붙인다 — 'インソール'은 'ソール'로 잡히지 않는다). 속성 이름(`原産国／製造国` 등)도 같은 목록으로 본다
 */
export interface FactLabelSettings {
  /** 원산지(原産国·生産国·製造国·MADE IN) */
  origin: string[];
  /** 겉감(アッパー) */
  upper: string[];
  /** 안감(ライニング) */
  lining: string[];
  /** 밑창(ソール·アウトソール) */
  sole: string[];
  /** 소재 전체(素材 — 안에 겉감·밑창이 없으면 겉감으로 본다) */
  material: string[];
  /** 굽·밑창 높이(ヒール高さ·ソール高·厚底) */
  heelHeight: string[];
}

/**
 * ⑥-2 AI 추출용 스펙 이미지 고르기(P3-03 Proposed — F-CT-10 '고르는 규칙은 M0 S2에서 정한다', 그 전 설정값). 설명 HTML의
 * `<img>` 가운데 라쿠텐 이미지 호스트만 앞에서부터 `maxCount`장, 한 장 `maxBytes` 이하
 */
export interface SpecImageSettings {
  maxCount: number;
  maxBytes: number;
}

/** ⑥ 상세 콘텐츠(P3-03 Proposed — 06-4 §2.2). 모두 ⑥-2 시작 조건(입력 지문)이다 */
export interface ContentSettings {
  originCountries: OriginCountryEntry[];
  materialTerms: MaterialTermEntry[];
  factLabels: FactLabelSettings;
  specImages: SpecImageSettings;
}

/** 설정 JSON 전체(schemaVersion "1") */
export interface AppSettings {
  schemaVersion: SettingsSchemaVersion;
  costs: CostSettings;
  pricing: PricingSettings;
  sourcing: SourcingSettings;
  keywords: KeywordSettings;
  safety: SafetySettings;
  /** P2-06: ④ 카테고리 매핑표 */
  category: CategorySettings;
  /** P3-01: ⑤ 썸네일 프롬프트 골격·얼굴 노출 기본값·후보 수·해상도. P3-02: 이미지 생성 공급자·생성 타임아웃 */
  thumbnail: ThumbnailSettings;
  /** P3-03: ⑥-2 원산지 나라 사전·소재 말 사전·설명문 항목 이름·스펙 이미지 고르기 */
  content: ContentSettings;
  notice: NoticeSettings;
  /** P1-09: 발송 택배사 코드 목록(GET /dispatch-delivery-companies) */
  delivery: DeliverySettings;
  ai: AiSettings;
}

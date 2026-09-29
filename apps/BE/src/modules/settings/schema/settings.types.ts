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
}

/** 키워드 수집(① 데이터랩) */
export interface KeywordSettings {
  /** 데이터랩 하루 요청 상한(DATALAB). 100(06-2 §9 P1-01) */
  datalabDailyLimit: number;
}

/** 안전 기준(F-BS-05). 하한·상한과 내장 목록은 safety/builtin-safety-lists.ts */
export interface SafetySettings {
  /** 상품 전체 사이즈의 최댓값이 이 값 이하면 '아동화 의심'. 235 미만으로 낮출 수 없다 */
  childShoeMaxSizeMm: number;
  /** 판정 유효 시간(RG-08). 6시간보다 길게 할 수 없다 */
  judgementValidityHours: number;
  /** 아동 키워드(KW-01). 내장 단어는 뺄 수 없고 더하기만 된다 */
  childKeywords: string[];
  /** 실존 인물·그룹·연예인 차단어(IM-07). 내장 단어는 뺄 수 없고 더하기만 된다 */
  personBlockWords: string[];
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

/** AI 엔진 선택(D-16). 이 섹션을 파일에 쓰는 것은 PUT /settings/ai-engine(P1-11)뿐이다 */
export interface AiSettings {
  engine: AiEngineCode;
  models: Record<AiEngineCode, AiEngineModelPair>;
}

/** 설정 JSON 전체(schemaVersion "1") */
export interface AppSettings {
  schemaVersion: SettingsSchemaVersion;
  costs: CostSettings;
  pricing: PricingSettings;
  sourcing: SourcingSettings;
  keywords: KeywordSettings;
  safety: SafetySettings;
  notice: NoticeSettings;
  ai: AiSettings;
}

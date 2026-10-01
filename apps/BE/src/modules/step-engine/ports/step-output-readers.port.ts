import type { Db } from '../candidates/step-engine-tx.js';

/**
 * 앞 단계 산출물 읽기 창구(P3-04 Proposed — C4 §3.1 '② 소싱 선택 읽기'와 같은 방식). 산출물을 가진 단계 모듈이 앱 시작 때 읽기
 * 함수를 등록하고(`StepEngineApi.register…`), 읽는 단계 모듈은 step-engine을 거쳐 이것만 쓴다 — 단계 모듈끼리 import하지 않는다
 * (03-ADR-003).
 */

/** ③ 버전의 판매 사이즈(⑥-3 시작 조건 '③ 판매 사이즈 집합' — `price_judgement_size.is_sellable`, mm 오름차순) */
export interface PricingSaleSizesView {
  pricingStepRunId: number;
  saleSizesMm: number[];
}

/** ③ 판정 스냅샷의 사이즈 한 줄(`price_judgement_size` — 금액은 원·엔 정수, 비율은 number) */
export interface PricingJudgementSizeView {
  sizeMm: number;
  rakutenSkuId: number | null;
  skuPriceYen: number;
  cGoodsKrw: number;
  vUsd: number;
  isDutyFree: boolean;
  isBoundary: boolean;
  cTaxKrw: number;
  pMinKrw: number | null;
  optionPriceKrw: number;
  sizeSalePriceKrw: number | null;
  cMktKrw: number | null;
  vatAKrw: number | null;
  vatBKrw: number | null;
  profitAKrw: number | null;
  profitBKrw: number | null;
  marginRateA: number | null;
  isSellable: boolean;
  unsellableReason: string | null;
}

/**
 * ③ 버전 하나의 판정 스냅샷 전체(P4-02 — 최종 승인 미리보기·사전 검증 `NEGATIVE_MARGIN`·`JUDGEMENT_FRESHNESS`·요청 초안). 열 뜻은
 * ERD `price_judgement` 그대로다(P2-05가 바꾸지 않았다). `targetMarginRate`는 문자열 decimal(정확한 비교용 — numeric(7,4))이다.
 */
export interface PricingJudgementView {
  priceJudgementId: number;
  pricingStepRunId: number;
  rakutenItemId: number | null;
  /** 판정에 쓴 라쿠텐 페이지 수집 시각(③만 다시 실행해도 바뀌지 않는다) */
  rakutenPageCollectedAt: Date | null;
  judgedAt: Date;
  isSaleCandidate: boolean;
  salePriceKrw: number | null;
  couponYen: number;
  shippingYen: number;
  shippingEstimated: boolean;
  cShipIntlKrw: number | null;
  cFwdKrw: number;
  fwdCouponKrw: number;
  fwdAssumed: boolean;
  vatMode: string;
  pricingRule: string;
  /** numeric(7,4) 원문(예 '0.1000') */
  targetMarginRate: string;
  minProfitKrw: number;
  /** mm 오름차순 */
  sizes: PricingJudgementSizeView[];
}

/** ③ 판정 읽기(pricing이 등록) */
export interface PricingOutputReader {
  /** ③ 버전 하나(step_run id)의 판매 사이즈. 판정이 없으면 null */
  readSaleSizes(db: Db, pricingStepRunId: number): Promise<PricingSaleSizesView | null>;
  /** ③ 버전 하나의 판정 스냅샷 전체(P4-02, 선택 메서드). 판정이 없으면 null */
  readJudgement?(db: Db, pricingStepRunId: number): Promise<PricingJudgementView | null>;
}

/**
 * ④ 버전 하나의 카테고리 결정(P4-02 — 사전 검증 `CATEGORY`, F-AP-24). `category_decision` 그대로. 입력 대기(고르기 전)면 리프가
 * null이다.
 */
export interface CategoryDecisionView {
  categoryStepRunId: number;
  gender: string;
  leafCategoryId: string | null;
  wholeCategoryName: string | null;
  genderPathMatch: boolean | null;
  /** PASS·KC_EXEMPT·BLOCKED(M1은 BLOCKED를 쓰지 않는다 — P2-06) 또는 null(결정 전) */
  exceptionDecision: string | null;
  certificationExcludeContent: unknown;
  kcExemptAdultConfirmedAt: Date | null;
  decidedAt: Date | null;
}

/** ④ 카테고리 결정 읽기(category가 등록, P4-02) */
export interface CategoryOutputReader {
  readDecision(db: Db, categoryStepRunId: number): Promise<CategoryDecisionView | null>;
}

/** 후보의 지금 G3 선택본(⑤ 현재 버전의 `thumbnail_selection_image`, 순서대로) */
export interface ThumbnailSelectionView {
  thumbnailStepRunId: number;
  images: { imageAssetId: number; role: 'REPRESENTATIVE' | 'ADDITIONAL'; sortOrder: number }[];
}

/** ⑤ 버전의 레퍼런스 한 장(출처 앵커 필드 — `image_asset`) */
export interface ThumbnailReferenceSourceView {
  imageAssetId: number;
  sourceItemCode: string | null;
  sourceModelCodeNorm: string | null;
  sourceColorCode: string | null;
}

/**
 * ⑤ 버전 하나의 G3 선택 기록(P4-02 — 사전 검증 `REPRESENTATIVE_IMAGE_SOURCE`, F-AP-22). 체크리스트 해석은 thumbnails가 한다
 * (`uncheckedChecklistKeys` — 버전의 체크리스트 키 가운데 true가 아닌 것). 레퍼런스는 sort_order 순.
 */
export interface ThumbnailSelectionDetailView {
  thumbnailStepRunId: number;
  checklistVersion: string | null;
  uncheckedChecklistKeys: string[];
  sameProductColorConfirmedAt: Date | null;
  references: ThumbnailReferenceSourceView[];
}

/**
 * ⑤ G3 선택본 읽기(thumbnails가 등록). ⑥-3 미리보기가 자리표시자를 채울 때(⑥-3 입력이 아니다 — 규칙 1·12), ⑧ 업로드가 시작
 * 조건·실행 입력으로 읽을 때(P4-01) 쓴다
 */
export interface ThumbnailSelectionReader {
  /** ⑤ 현재 버전의 선택본. ⑤ 미실행·선택 전이면 null */
  readCurrentSelection(db: Db, candidateId: number): Promise<ThumbnailSelectionView | null>;
  /** ⑤ 버전 하나(step_run id)의 선택본(P4-01 — ⑧ 입력). 선택이 없으면 null */
  readSelection(db: Db, thumbnailStepRunId: number): Promise<ThumbnailSelectionView | null>;
  /** ⑤ 버전 하나의 G3 체크리스트·'같은 상품·색상' 확인·레퍼런스 출처(P4-02, 선택 메서드). 선택이 없으면 null */
  readSelectionDetail?(
    db: Db,
    thumbnailStepRunId: number,
  ): Promise<ThumbnailSelectionDetailView | null>;
}

/** ⑥-3 버전의 상세 HTML(자리표시자 그대로 — `content_draft_assembly.html`·`html_sha256`) */
export interface NoticeHtmlView {
  noticeHtmlStepRunId: number;
  html: string;
  htmlSha256: string;
}

/** ⑥-3 상세 HTML 읽기(content가 등록, P4-01 Proposed). ⑧ 업로드가 시작 조건(`noticeHtml.html`)·최종 본문 재료로 읽는다 */
export interface NoticeHtmlReader {
  /** ⑥-3 버전 하나(step_run id)의 HTML. 산출물이 없으면 null */
  readHtml(db: Db, noticeHtmlStepRunId: number): Promise<NoticeHtmlView | null>;
}

/** ⑥ 필드 하나의 풀리지 않은 '재확인 필요' 표시(recheck_reason 있고 recheck_resolved_at 없음) */
export interface ContentRecheckView {
  fieldKey: string;
  recheckReason: string;
}

/**
 * ⑥-3 버전 하나의 조립 결과(P4-02 — 최종 승인 미리보기·요청 초안·사전 검증). `content_draft_assembly` 그대로에 content가 해석한 값
 * 둘을 더한다: `specSizesMm`(사양 블록 사이즈 행을 content 표기 규칙으로 되읽은 mm 목록 — 읽지 못하면 null),
 * `noticeRequiredKeys`(SHOES 고시에서 비면 안 되는 키 — 굽높이 `height`는 넣지 않는 신발이 있어 빠진다).
 */
export interface ContentAssemblyView {
  noticeHtmlStepRunId: number;
  productName: string;
  /** SHOES 고시 객체(키 순서 = 등록 본문 순서) */
  noticeFields: Record<string, string>;
  noticeRequiredKeys: string[];
  noticeSizesMm: number[];
  specSizesMm: number[] | null;
  originAreaCode: string;
  originAreaPlural: boolean;
  originAreaContent: string | null;
  importer: string;
  specOriginLabel: string;
  /** ⑥-3이 기록한 고지 블록 해시(믿지 않고 비교용으로만 쓴다 — P4-02 규칙 7) */
  disclosureBlocks: { blockId: string; sha256: string; conditional: boolean }[];
  /** 이 버전 오너 필드(상품명·고시)의 풀리지 않은 재확인 표시 */
  rechecks: ContentRecheckView[];
}

/** ⑥-2 원산지 필드(fact.origin) 한 행 */
export interface ContentOriginFactView {
  /** 한국어 나라 이름(정보 없음이면 빈 배열) */
  countries: string[];
  valueSource: 'GENERATED' | 'OWNER_INPUT';
  extractionMethod: string | null;
  evidenceUrl: string | null;
  basisItemCode: string | null;
  ownerConfirmedAt: Date | null;
}

/** ⑥-2 버전 하나의 사실(P4-02 — 사전 검증 `ORIGIN`·`JAPAN_WORDING`·`NOTICE_BLOCK` 가죽 판정) */
export interface ContentFactsView {
  noticeRawStepRunId: number;
  sourceItemCode: string | null;
  origin: ContentOriginFactView | null;
  materials: { upper: string | null; lining: string | null; sole: string | null };
  rechecks: ContentRecheckView[];
}

/** ⑥-1 버전 하나의 유효 카피 글(헤드라인·셀링포인트·본문·착화감·사이즈 — 근거 원문은 빼고) */
export interface ContentCopyView {
  copyStepRunId: number;
  texts: string[];
}

/** ⑥ 산출물 읽기(content가 등록, P4-02) */
export interface ContentOutputReader {
  readAssembly(db: Db, noticeHtmlStepRunId: number): Promise<ContentAssemblyView | null>;
  readFacts(db: Db, noticeRawStepRunId: number): Promise<ContentFactsView | null>;
  readCopy(db: Db, copyStepRunId: number): Promise<ContentCopyView | null>;
}

/** 최종 태그 한 개(05-2 FinalTagItem) */
export interface FinalTagView {
  text: string;
  code: string | null;
  finalOrder: number;
}

/**
 * ⑦ 버전 하나의 최종 태그(P4-02 — 미리보기·요청 초안 `seoInfo.sellerTags`·사전 검증 `TAGS`). `tag_candidate` outcome=SELECTED를
 * `final_order` 순으로. `sellerTags`는 tags 전송 형식(`sellerTagsOf` — 추천과 같으면 `{code, text}`, 아니면 `{text}`)이다.
 */
export interface FinalTagsView {
  tagsStepRunId: number;
  tags: FinalTagView[];
  sellerTags: ({ code: string; text: string } | { text: string })[];
}

/** ⑦ 최종 태그 읽기(tags가 등록, P4-02) */
export interface TagsOutputReader {
  readFinalTags(db: Db, tagsStepRunId: number): Promise<FinalTagsView | null>;
}

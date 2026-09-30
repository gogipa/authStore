/**
 * 커머스API 메타데이터 동기화 상수(P1-08, F-BS-48·RG-03). 대상·경로·범위 규칙을 한곳에 둔다.
 * 응답 구조(목록 감싸는 키·필드 이름·주소록 유형·원산지 계층)는 M0 S3 전 추정이다(ERD §7.3-9). 실제 응답을 받으면
 * 이 파일의 경로와 mappers/*.ts만 고친다.
 */

import { GENDER_SHOE_PATH_PREFIX } from '../../../common/rules/category-gender.js';
import {
  BUILTIN_CHILD_CATEGORY_WORDS,
  BUILTIN_EXCLUDED_CATEGORY_WORDS,
} from '../../../common/rules/category-words.js';

/** 동기화 대상 8개(05-2 CommerceMetaSyncTarget enum 순서 = 실행 순서. CATEGORY가 맨 앞이라 먼저 돈다) */
export const META_SYNC_TARGETS = [
  'CATEGORY',
  'CATEGORY_DETAIL',
  'STANDARD_OPTIONS',
  'PRODUCT_ATTRIBUTES',
  'ORIGIN_AREA',
  'ADDRESSBOOK',
  'PROVIDED_NOTICE',
  'RETURN_DELIVERY_COMPANY',
] as const;
export type MetaSyncTarget = (typeof META_SYNC_TARGETS)[number];

export function isMetaSyncTarget(value: unknown): value is MetaSyncTarget {
  return typeof value === 'string' && (META_SYNC_TARGETS as readonly string[]).includes(value);
}

/** commerce_meta_sync_run.status(ck_cmsr_status) */
export const META_SYNC_RUN_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type MetaSyncRunStatus = (typeof META_SYNC_RUN_STATUSES)[number];

/** 대상 이름(오류 문구·로그용). 화면 줄 이름은 FE model/metaSyncRows.ts가 따로 둔다 */
export const META_SYNC_TARGET_LABEL: Readonly<Record<MetaSyncTarget, string>> = {
  CATEGORY: '카테고리 목록',
  CATEGORY_DETAIL: '카테고리 상세',
  STANDARD_OPTIONS: '표준옵션',
  PRODUCT_ATTRIBUTES: '상품 속성',
  ORIGIN_AREA: '원산지 코드',
  ADDRESSBOOK: '주소록',
  PROVIDED_NOTICE: '상품정보제공고시(신발)',
  RETURN_DELIVERY_COMPANY: '반품 택배사',
};

/** 카테고리 하나씩 부르는 대상(캐시의 성별 신발 리프만 돈다, 규칙 1 Proposed) */
export const CATEGORY_SCOPED_TARGETS = [
  'CATEGORY_DETAIL',
  'STANDARD_OPTIONS',
  'PRODUCT_ATTRIBUTES',
] as const satisfies readonly MetaSyncTarget[];

/** ALREADY_IN_PROGRESS details.job(05-3) */
export const META_SYNC_JOB = 'META_SYNC';
/** ALREADY_IN_PROGRESS `{작업}` 자리 */
export const META_SYNC_JOB_LABEL = '메타데이터 동기화';

/** 202 Location(진행 조회 경로) */
export const META_SYNC_LATEST_LOCATION = '/api/v1/commerce-meta-sync-runs/latest';

export type ShoeGender = 'MALE' | 'FEMALE';
export const SHOE_GENDERS = ['MALE', 'FEMALE'] as const satisfies readonly ShoeGender[];

/**
 * 성별 신발 경로(PRD §8.7 RG-04, F-CA-02·04). `whole_category_name`이 이 글자로 시작하는 리프만 쓴다.
 * 원본은 공용 규칙 `common/rules/category-gender.ts`(P2-06 — ④·최종 승인 검사가 같은 표를 쓴다)
 */
export const GENDER_PATH_PREFIX: Readonly<Record<ShoeGender, string>> = GENDER_SHOE_PATH_PREFIX;

/** commerce_meta_document.kind(ck_cmd_kind) */
export const META_DOCUMENT_KINDS = [
  'CATEGORY_DETAIL',
  'STANDARD_OPTIONS',
  'PRODUCT_ATTRIBUTES',
  'PROVIDED_NOTICE',
] as const;
export type MetaDocumentKind = (typeof META_DOCUMENT_KINDS)[number];

/** PROVIDED_NOTICE 문서의 범위 키(상품정보제공고시 상품군) */
export const PROVIDED_NOTICE_SCOPE = 'SHOES';

/** 아동 인증 예외 유형(R04 C2, F-CA-07). 이 값이 있는 리프는 목록에서 뺀다 */
export const CHILD_CERTIFICATION = 'CHILD_CERTIFICATION';

/**
 * CON-08 제외 품목·아동 카테고리를 이름으로 거르는 말(Proposed P1-08 — 목록의 출처가 문서에 없다, 오너 검토).
 * 카테고리 **이름·전체 경로**에 들어 있으면 `listCommerceCategories`에서 뺀다. ID가 아니라 말이라 개편에도 버틴다.
 * - 아동: 아동화(만 13세 이하)는 구매대행 금지(CON-08, 어린이제품법)
 * - 바퀴 달린 운동화·고령자용 신발: 보수적 기본 제외(PRD §8 CON-08 표)
 */
export const CATEGORY_BLOCK_WORDS: Readonly<
  Record<'CHILD_CATEGORY' | 'CON08_EXCLUDED', readonly string[]>
> = {
  // 원본은 공용 `common/rules/category-words.ts`(P2-06 — 설정 safety.childCategoryWords·excludedCategoryWords의 내장 목록)
  CHILD_CATEGORY: BUILTIN_CHILD_CATEGORY_WORDS,
  CON08_EXCLUDED: BUILTIN_EXCLUDED_CATEGORY_WORDS,
};

export type CategoryBlockReason = 'CHILD_CERTIFICATION' | keyof typeof CATEGORY_BLOCK_WORDS;

/**
 * 커머스API 경로(PRD §8.7 등록 호출 순서 2, R04 C1~C5). 모두 GET.
 * ORIGIN_SUB·ADDRESSBOOKS의 쿼리 이름(code·page·size)은 M0 S3 전 추정이다.
 */
export const COMMERCE_META_PATHS = {
  CATEGORIES: '/v1/categories',
  categoryDetail: (categoryId: string) => `/v1/categories/${encodeURIComponent(categoryId)}`,
  STANDARD_OPTIONS: '/v1/options/standard-options',
  PRODUCT_ATTRIBUTES: '/v1/product-attributes/attributes',
  PRODUCT_ATTRIBUTE_VALUES: '/v1/product-attributes/attribute-values',
  ORIGIN_AREAS: '/v1/product-origin-areas',
  ORIGIN_SUB_AREAS: '/v1/product-origin-areas/sub-origin-areas',
  ADDRESSBOOKS: '/v1/seller/addressbooks-for-page',
  PROVIDED_NOTICE: `/v1/products-for-provided-notice/${PROVIDED_NOTICE_SCOPE}`,
  RETURN_DELIVERY_COMPANIES: '/v2/product-delivery-info/return-delivery-companies',
} as const;

/** 주소록 한 페이지 크기(Proposed)와 페이지 넘김 상한(끝없는 페이지 방지) */
export const ADDRESSBOOK_PAGE_SIZE = 100;
export const ADDRESSBOOK_MAX_PAGES = 50;

/** 하위 원산지가 없을 때 커머스API가 줄 수 있는 상태(오류로 보지 않고 '하위 없음', Proposed) */
export const ORIGIN_SUB_EMPTY_STATUSES: readonly number[] = [400, 404];

/**
 * 호출 속도(R04 A11, NFR-05 — 수치는 비공개라 Proposed):
 * - 응답의 `GNCP-GW-RateLimit-Remaining`이 0 이하면 `1000 / Replenish-Rate` ms(없으면 1초) 쉬고 다음을 부른다.
 * - 429 `GW.RATE_LIMIT`이면 `Retry-After`(초, 없으면 1·2·4초) 뒤 같은 요청을 다시(최대 3번).
 */
export const RATE_LIMIT_HEADERS = {
  REMAINING: 'GNCP-GW-RateLimit-Remaining',
  REPLENISH_RATE: 'GNCP-GW-RateLimit-Replenish-Rate',
  BURST_CAPACITY: 'GNCP-GW-RateLimit-Burst-Capacity',
} as const;
export const RATE_LIMIT_ERROR_CODE = 'GW.RATE_LIMIT';
export const RATE_LIMIT_DEFAULT_WAIT_MS = 1000;
export const RATE_LIMIT_BACKOFF_MS: readonly number[] = [1000, 2000, 4000];
/** Retry-After가 너무 크면 이만큼만 기다리고 다시 해 본다 */
export const RATE_LIMIT_MAX_WAIT_MS = 60_000;

/** 앱을 다시 켤 때 RUNNING으로 남은 행에 쓰는 사유(규칙 10) */
export const META_SYNC_INTERRUPTED_MESSAGE = '앱이 다시 시작되어 동기화가 중단되었습니다.';

/** error_message 최대 길이(text 열이지만 화면·SSE에 싣는 한 줄) */
export const META_SYNC_ERROR_MESSAGE_MAX = 500;

/**
 * 하루 1회 자동 실행(Proposed P1-08, 05-1 §2.13 — 오너 검토):
 * - '하루'는 한국 날짜. 대상마다 오늘(KST) 끝난 SUCCEEDED가 없으면 돌린다.
 * - 앱을 켜고 `initialDelayMs` 뒤 한 번, 그 뒤 `intervalMs`마다 본다.
 * - 실패한 대상은 `failedRetryAfterMs`가 지나야 자동으로 다시 해 본다(수동 '지금 동기화'는 언제든).
 */
export const META_AUTO_SYNC_DEFAULTS = {
  initialDelayMs: 10_000,
  intervalMs: 60 * 60 * 1000,
  failedRetryAfterMs: 6 * 60 * 60 * 1000,
} as const;

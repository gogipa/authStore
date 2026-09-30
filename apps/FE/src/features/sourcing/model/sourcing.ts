import type { components } from '@/shared/api/schema';

/** sourcing 응답 타입(05-2 schema.d.ts에서 파생). 명세가 바뀌면 타입이 따라온다. */
export type RakutenQueryValidation = components['schemas']['RakutenQueryValidation'];
export type RakutenQueryViolation = components['schemas']['RakutenQueryViolation'];
export type RakutenItemSnapshot = components['schemas']['RakutenItemSnapshot'];
export type RakutenSkuVariant = components['schemas']['RakutenSkuVariant'];
export type RakutenItemEntryChecks = components['schemas']['RakutenItemEntryChecks'];
export type RakutenItemFetchResult = components['schemas']['RakutenItemFetchResult'];
export type SourcingComparisonDetail = components['schemas']['SourcingComparisonDetail'];
export type AdultProductConfirmation = components['schemas']['AdultProductConfirmation'];

/** 검색어 최대 길이(반각, 05-2 RakutenQueryValidation.maxHalfWidthLength) */
export const RAKUTEN_QUERY_MAX_HALF_WIDTH = 128;

/** 장르 기본값(설정 sourcing.genreId — 검사 결과가 오기 전에 보인다) */
export const DEFAULT_RAKUTEN_GENRE_ID = 558885;
/** 장르 이름(Sourcing 보드 '장르 · 고정 靴 558885') */
export const RAKUTEN_GENRE_NAME = '靴';

/** 아동화 필터 안내(Sourcing 보드 검색 조건 아래 문구 그대로, F-SO-04) */
export const CHILD_FILTER_NOTE =
  '모든 검색에 장르 靴와 제외어(中古·キッズ·ジュニア·ベビー 등)를 붙이고, 상품명에 아동 단어가 있으면 한 번 더 뺍니다. 검색이 막히면 이유를 한국어로 알립니다.';

/** URL 붙여넣기 머리 캡션(보드 그대로) */
export const URL_PASTE_CAPTION = '건당 페이지 1회 조회 · 하루 조회에 포함';

/** URL 붙여넣기 안내(보드 그대로, F-SO-31·33·35) */
export const URL_PASTE_NOTE =
  "'수동' 행도 재고·실질가·선택을 다른 행과 같은 방식으로 다룹니다. 바로 만든 후보는 비교표 없이 ②를 마치고 '비교 안 함' 배지가 붙습니다. 제외어(中古·インソール·キッズ 등)가 든 상품은 넣지 않고, 같은 상품·색상의 진행 중 후보가 있으면 그 후보를 엽니다.";

/** URL 입력칸 자리 글(소스에 https 주소를 두지 않는다 — FE 규칙 15) */
export const URL_PLACEHOLDER = 'item.rakuten.co.jp/{샵}/{상품}/';

/** '비교표에 넣기'가 꺼진 이유(P2-02 Proposed — 비교표·앵커는 P2-03이 붙인다) */
export const TABLE_MODE_NOT_READY = '비교표에 넣기는 아직 준비 중입니다';

/** '성인용 상품 확인' 라벨(보드 그대로, F-SO-06) */
export const ADULT_CONFIRM_LABEL = '성인용 상품 확인';

/** 성인용 확인 설명(보드 문구. 기준 mm는 그 버전의 설정 사본, 없으면 235) */
export function adultConfirmDescription(maxMm = 235): string {
  return `아동화 의심(최대 ${maxMm}mm 이하)·대상 외 장르로 멈춘 상품만 체크합니다`;
}

/** 넣는 방법(보드 라디오): 비교표에 넣기(수동 행, P2-03) · 바로 후보 만들기(URL_CREATE) */
export type UrlPasteMode = 'TABLE' | 'CREATE';

/**
 * 검사 결과 한 줄(보드 '반각 32/128자 · 형식 맞음'). 위반이면 가장 앞 위반의 요약. 검사 전이면 null
 */
export function queryCheckSummary(
  result: Pick<RakutenQueryValidation, 'valid' | 'halfWidthLength' | 'violations'> | undefined,
): { valid: boolean; count: string; text: string } | null {
  if (!result) return null;
  const count = `${result.halfWidthLength}/${RAKUTEN_QUERY_MAX_HALF_WIDTH}`;
  if (result.valid) return { valid: true, count, text: '형식 맞음' };
  const first = result.violations[0];
  const text =
    first?.rule === 'TOO_LONG'
      ? '너무 깁니다'
      : first?.rule === 'WORD_TOO_SHORT'
        ? '짧은 단어가 있습니다'
        : '검색어를 넣어 주세요';
  return { valid: false, count, text };
}

/** 위반 문구 모음(칸 아래 오류 글) */
export function queryViolationText(
  result: Pick<RakutenQueryValidation, 'violations'> | undefined,
): string | undefined {
  if (!result || result.violations.length === 0) return undefined;
  return result.violations.map((v) => v.message).join(' ');
}

/** 05-3 RAKUTEN_ITEM_EXCLUDED_WORD 문구('상품명에 제외어(中古·キッズ)가 있어 쓸 수 없습니다.') */
export function excludedWordsText(words: readonly string[]): string {
  return `상품명에 제외어(${words.join('·')})가 있어 쓸 수 없습니다.`;
}

/** 입구 검사로 성인용 확인이 필요하다는 안내(후보를 만든 뒤 ②가 입력 대기로 멈춘다) */
export function entryCheckNotice(checks: RakutenItemEntryChecks): string | null {
  if (!checks.adultConfirmationRequired) return null;
  const reasons: string[] = [];
  if (checks.childSizeSuspect) reasons.push('아동화 의심(사이즈)');
  if (checks.genreScope === 'OUT_OF_SCOPE') reasons.push('대상 외 장르');
  if (checks.genreScope === 'NOT_FOUND') reasons.push('장르 확인 안 됨');
  return `${reasons.join('·')} 상품입니다. 후보를 만든 뒤 '${ADULT_CONFIRM_LABEL}'을 체크해야 ②가 끝납니다.`;
}

const COLOR_AXIS_WORDS = ['カラー', '色'];

function selectorColorValues(selectors: unknown): string[] {
  if (!Array.isArray(selectors)) return [];
  for (const selector of selectors) {
    if (!selector || typeof selector !== 'object') continue;
    const { key, label, values } = selector as { key?: unknown; label?: unknown; values?: unknown };
    const name = `${typeof key === 'string' ? key : ''} ${typeof label === 'string' ? label : ''}`;
    if (!COLOR_AXIS_WORDS.some((word) => name.includes(word)) || !Array.isArray(values)) continue;
    return values
      .map((v) =>
        typeof v === 'string'
          ? v
          : v && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'string'
            ? (v as { value: string }).value
            : null,
      )
      .filter((v): v is string => v !== null && v.trim() !== '');
  }
  return [];
}

/**
 * 색상 고르기 목록(F-SO-35): 스냅샷 SKU의 색상 라벨(나온 순서, 중복 없이). SKU에 색상이 없으면 `variantSelectors`의
 * 색상 축 값. 둘 다 없으면 빈 목록(색상이 하나뿐인 상품 — 화면이 상품명을 색상으로 쓰지 않는다)
 */
export function colorOptionsOf(
  item: Pick<RakutenItemSnapshot, 'skus' | 'variantSelectors'> | undefined,
): string[] {
  if (!item) return [];
  const fromSkus = [...new Set(item.skus.map((s) => s.colorLabel).filter((c): c is string => !!c))];
  if (fromSkus.length > 0) return fromSkus;
  return [...new Set(selectorColorValues(item.variantSelectors))];
}

/** 성인용 확인 상태(현재 ② 버전 머리 행) */
export interface AdultConfirmationState {
  /** 아동화 의심·대상 외 장르·장르 모름 */
  required: boolean;
  /** 체크한 시각(ISO). 없으면 null */
  confirmedAt: string | null;
  /** 지금 체크할 수 있다(필요하고, 아직 안 했고, ② 현재 버전이 입력 대기) */
  canConfirm: boolean;
  /** 설명에 쓸 기준 mm(그 버전의 설정 사본) */
  maxMm: number;
}

export function adultConfirmationOf(
  head:
    | Pick<
        SourcingComparisonDetail,
        | 'childSizeSuspect'
        | 'genreScope'
        | 'adultProductConfirmedAt'
        | 'stepStatus'
        | 'isCurrent'
        | 'params'
      >
    | undefined,
): AdultConfirmationState {
  const maxRaw = head?.params.childShoeMaxSizeMm;
  const maxMm = typeof maxRaw === 'number' && Number.isInteger(maxRaw) ? maxRaw : 235;
  if (!head) return { required: false, confirmedAt: null, canConfirm: false, maxMm };
  const required =
    head.childSizeSuspect === true ||
    head.genreScope === 'OUT_OF_SCOPE' ||
    head.genreScope === 'NOT_FOUND';
  const confirmedAt = head.adultProductConfirmedAt ?? null;
  const canConfirm =
    required && confirmedAt === null && head.isCurrent && head.stepStatus === 'WAITING_INPUT';
  return { required, confirmedAt, canConfirm, maxMm };
}

/** 비교 칸 요약 글(P2-02: 행 수·탐색 모드·URL 후보. 비교표 행은 P2-03이 그린다) */
export function comparisonSummaryText(
  head: Pick<SourcingComparisonDetail, 'comparisonPerformed' | 'exploreMode' | 'rows'> | undefined,
): string {
  if (!head) return '② 소싱을 실행하면 라쿠텐 검색 결과가 여기에 나옵니다.';
  if (!head.comparisonPerformed) {
    return 'URL로 만든 후보라 비교표 없이 ②를 마쳤습니다. 다시 실행하면 이 상품을 앵커로 검색·비교합니다.';
  }
  const count = `검색 결과 ${head.rows.length}건 · 상품명에 아동 단어가 있는 상품은 뺐습니다.`;
  return head.exploreMode
    ? `${count} 앵커(型番·색상)를 정하면 같은 상품만 모아 비교합니다.`
    : count;
}

/**
 * 409 CANDIDATE_DUPLICATE의 `details.existingCandidateId`(진행 중인 같은 상품·색상 후보 — 화면이 그 후보를 연다, F-SO-35).
 * 그 밖 오류면 null
 */
export function existingCandidateIdOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const { code, envelope } = error as { code?: unknown; envelope?: { details?: unknown } };
  if (code !== 'CANDIDATE_DUPLICATE') return null;
  const details = envelope?.details;
  const id =
    details && typeof details === 'object'
      ? (details as { existingCandidateId?: unknown }).existingCandidateId
      : undefined;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

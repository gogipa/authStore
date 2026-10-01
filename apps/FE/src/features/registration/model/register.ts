import type { components } from '@/shared/api/schema';
import { formatKstMonthDayTime } from '@/shared/lib/format';

/** 05-2 RegistrationCreateRequest */
export type RegistrationCreateRequest = components['schemas']['RegistrationCreateRequest'];
/** 05-2 RegistrationAccepted(202) */
export type RegistrationAccepted = components['schemas']['RegistrationAccepted'];
/** 05-2 RegistrationSummary·Page */
export type RegistrationSummary = components['schemas']['RegistrationSummary'];
export type RegistrationSummaryPage = components['schemas']['RegistrationSummaryPage'];
/** 05-2 RegistrationDetail(request_json 없음) */
export type RegistrationDetail = components['schemas']['RegistrationDetail'];
/** 05-2 RegistrationResultCheck */
export type RegistrationResultCheck = components['schemas']['RegistrationResultCheck'];
/** 05-2 RegistrationSwitchState·Changed */
export type RegistrationSwitchState = components['schemas']['RegistrationSwitchState'];
export type RegistrationSwitchChanged = components['schemas']['RegistrationSwitchChanged'];
/** 05-2 ApprovalDuplicateInfo */
export type ApprovalDuplicateInfo = components['schemas']['ApprovalDuplicateInfo'];
/** 05-2 ApprovalWarning */
export type ApprovalWarning = components['schemas']['ApprovalWarning'];

// ── 문구(시안 Approval.dc.html '⑨ 등록'·차단 스위치 띠·내비 상태 상자 — P4-03) ──
export const REGISTER_MODE_LABEL = '등록 모드';
export const LAST_RESULT_LABEL = '직전 결과';
export const REQUEST_JSON_LABEL = '요청 JSON';
export const NO_APPROVAL_TEXT = '아직 승인하지 않았습니다';
export const REGISTER_GUIDE =
  "차단이 켜져 있으면 승인할 때 등록하지 않고 요청 내용과 검증 결과만 저장해 '검증완료'로 둡니다. 오류는 이유·추적 번호와 함께 보여 주고, 응답이 없으면 '결과확인필요'로 둡니다.";
export const SWITCH_LABEL = '등록 API 차단';
export const SWITCH_ON_TEXT =
  '등록 API 차단이 켜져 있어 드라이런만 합니다. 실제로 등록하려면 끄세요.';
/** 꺼져 있을 때(보드에 없음 — Proposed) */
export const SWITCH_OFF_TEXT =
  '등록 API 차단이 꺼져 있습니다. 승인하면 실제 스마트스토어에 등록합니다.';
export const NAV_SWITCH_ON = '등록 API 차단 켜짐 · 드라이런';
/** 꺼짐·모름(보드에 없음 — Proposed) */
export const NAV_SWITCH_OFF = '등록 API 차단 꺼짐 · 실제 등록';
export const NAV_SWITCH_UNKNOWN = '등록 API 차단 · 확인 전';
/** 드라이런 뒤(VALIDATED — 승인 미리보기가 409) 안내(Proposed, 작업 지시 §8) */
export const VALIDATED_NOTE =
  '검증완료(드라이런)로 저장했습니다. 등록 API 차단을 끄면 승인대기로 돌아가 다시 승인할 수 있습니다.';
export const RESULT_CHECK_LABEL = '결과 확인';
export const EXISTING_PRODUCT_LABEL = '기존 상품 보기';
export const STANDARD_OPTION_LABEL = '표준형으로 바꾸기';
export const COMBINATION_OPTION_LABEL = '조합형으로 바꾸기';
export const APPROVING_LABEL = '승인하는 중…';

/** 등록 모드 줄('처음 10건은 전시중지로 등록 (3/10)' + 안내) */
export interface RegisterModeView {
  text: string;
  count: string | null;
  note: string;
}

export function registerModeView(input: {
  displayStatusType: 'SUSPENSION' | 'ON';
  liveRegistrationCount?: number | null;
  initialSuspensionCount?: number | null;
}): RegisterModeView {
  const n = input.initialSuspensionCount ?? 10;
  const count =
    input.liveRegistrationCount != null
      ? `(${Math.min(input.liveRegistrationCount, n)}/${n})`
      : null;
  if (input.displayStatusType === 'SUSPENSION') {
    return {
      text: `처음 ${n}건은 전시중지로 등록`,
      count,
      note: '이 상품은 전시중지로 올라갑니다. 스마트스토어에서 모습을 확인한 뒤 전시를 켭니다(G5).',
    };
  }
  return {
    text: '즉시 전시로 등록',
    count,
    note: `처음 ${n}건을 넘어 이 상품은 바로 전시됩니다.`,
  };
}

export type LastResultTone = 'done' | 'failed' | 'running' | 'waiting' | 'idle' | 'neutral';

/** 직전 결과(등록 기록 맨 앞 — 등록 기록 상태를 ⑨ 단계 상태보다 먼저 보인다, ERD `registration` 대응) */
export interface LastResultView {
  /** 상태 글(검증완료·등록요청중·결과확인필요·등록됨·…로 종결). 기록이 없으면 null */
  status: string | null;
  tone: LastResultTone;
  /** 설명(한국어 오류·상품 번호·안내) */
  message: string | null;
  /** GNCP-GW-Trace-ID */
  traceId: string | null;
  /** '결과 확인' 버튼(결과확인필요이고 종결 전) */
  canCheck: boolean;
}

type RegistrationLike = Pick<
  RegistrationSummary,
  'status' | 'failureKind' | 'failedAt' | 'errorMessage' | 'originProductNo' | 'registeredAt'
> & { traceId?: string | null };

export function lastResultView(row: RegistrationLike | null | undefined): LastResultView {
  if (!row) {
    return { status: null, tone: 'idle', message: null, traceId: null, canCheck: false };
  }
  const traceId = row.traceId ?? null;
  if (row.failureKind === 'INVALID_INPUT_4XX') {
    return {
      status: '입력 오류로 종결',
      tone: 'failed',
      message: row.errorMessage ?? null,
      traceId,
      canCheck: false,
    };
  }
  if (row.failureKind === 'NOT_FOUND_ON_CHECK') {
    return {
      status: '조회 결과 없음으로 종결',
      tone: 'neutral',
      message: '판매자관리코드로 찾지 못해 승인대기로 돌아갔습니다. 다시 승인할 수 있습니다.',
      traceId,
      canCheck: false,
    };
  }
  switch (row.status) {
    case 'VALIDATED':
      return {
        status: '검증완료',
        tone: 'done',
        message: VALIDATED_NOTE,
        traceId,
        canCheck: false,
      };
    case 'REGISTERING':
      return {
        status: '등록요청중',
        tone: 'running',
        message: '커머스API에 등록을 요청했습니다. 결과가 오면 바뀝니다.',
        traceId,
        canCheck: false,
      };
    case 'RESULT_CHECK_REQUIRED':
      return {
        status: '결과확인필요',
        tone: 'waiting',
        message: row.errorMessage ?? null,
        traceId,
        canCheck: row.failedAt == null,
      };
    case 'REGISTERED':
      return {
        status: '등록됨',
        tone: 'done',
        message: [
          row.originProductNo ? `상품 번호 ${row.originProductNo}` : null,
          row.registeredAt ? `${formatKstMonthDayTime(row.registeredAt)} 등록` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        traceId,
        canCheck: false,
      };
    default:
      return { status: row.status, tone: 'neutral', message: null, traceId, canCheck: false };
  }
}

/** '기존 상품 보기' 상자 글('상품 번호 10000000001 · 2026-09-30 10:00 등록') */
export function existingProductText(duplicate: ApprovalDuplicateInfo): string {
  const parts = [
    duplicate.originProductNo ? `상품 번호 ${duplicate.originProductNo}` : '상품 번호 모름',
    duplicate.registeredAt ? `${formatKstMonthDayTime(duplicate.registeredAt)} 등록` : null,
    duplicate.source === 'COMMERCE_API' ? '커머스API에서 찾음' : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** 화면에 보일 중복 정보: 사전 검증(로컬 + SELLER_CODE)이 있으면 그것, 없으면 미리보기(로컬) */
export function duplicateOf(
  previewDuplicate: ApprovalDuplicateInfo | null | undefined,
  resultDuplicate: ApprovalDuplicateInfo | null | undefined,
): ApprovalDuplicateInfo | null {
  if (previewDuplicate?.duplicated) return previewDuplicate;
  if (resultDuplicate?.duplicated) return resultDuplicate;
  return null;
}

/** 내비 상태 상자 칩 */
export function navSwitchText(state: RegistrationSwitchState | undefined): string {
  if (!state) return NAV_SWITCH_UNKNOWN;
  return state.apiBlocked ? NAV_SWITCH_ON : NAV_SWITCH_OFF;
}

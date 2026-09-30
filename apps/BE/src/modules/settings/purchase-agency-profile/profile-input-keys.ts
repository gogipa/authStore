import {
  PROFILE_FIELDS,
  type ProfileField,
  type PurchaseAgencyProfileValues,
} from './profile-values.js';

/**
 * 단계가 프로필을 읽을 때 쓰는 입력 이름(step_run_input.input_key, P1-09 Proposed — 05-1 §2.12).
 *
 * - 이름: `profile.<필드>`(예 `profile.importer`). 64자 이하. 출처는 `source_type=SETTINGS`(프로필은 설정의 한 갈래,
 *   ERD step_run_input.source_type CHECK에 따로 값이 없다), 시작 조건(`isStartCondition=true`)이다.
 * - 단계 모듈(⑥-3 P3-04, ⑨ P4-03)은 실행기 `readInputs`에서 `profileStepInputs(stepCode, values)`를 더해 낸다.
 *   step-engine이 그 값의 해시를 남기고, 프로필 저장(PUT)은 값이 실제로 바뀐 키만 이 이름으로 바꿔
 *   재실행 필요 전파(PROFILE_RERUN_PROPAGATOR, P1-05 step-engine이 끼운다)에 넘긴다.
 * - ⑧ UPLOAD는 프로필을 직접 읽지 않는다(P4-01 시작 조건은 ⑤ G3 선택본·⑥-3 HTML). 프로필이 바뀌면 ⑥-3이 재실행
 *   필요가 되고, ⑥-3을 다시 돌려 HTML이 바뀌면 P1-05 전파가 ⑧을 재실행 필요로 만든다(05-1 §2.12 '⑥-3·⑧·⑨'의 ⑧).
 * - 이 작업(P1-09)은 단계 모듈이 아니라 step-engine에 실행기를 등록하지 않는다.
 */
export const PROFILE_INPUT_PREFIX = 'profile.';

/** 프로필을 읽는 단계(05-1 §2.12). ⑧은 ⑥-3을 거쳐 영향을 받는다(위 설명) */
export const PROFILE_READER_STEPS = ['NOTICE_HTML', 'UPLOAD', 'REGISTER'] as const;
export type ProfileReaderStep = (typeof PROFILE_READER_STEPS)[number];

/** 필드 → 입력 이름 */
export function profileInputKey(field: ProfileField): string {
  return `${PROFILE_INPUT_PREFIX}${field}`;
}

/** 입력 이름 → 필드(프로필 입력이 아니면 null) */
export function profileFieldOf(inputKey: string): ProfileField | null {
  if (!inputKey.startsWith(PROFILE_INPUT_PREFIX)) return null;
  const field = inputKey.slice(PROFILE_INPUT_PREFIX.length);
  return (PROFILE_FIELDS as readonly string[]).includes(field) ? (field as ProfileField) : null;
}

/** 12개 필드의 입력 이름(PROFILE_FIELDS 순서) */
export const PROFILE_INPUT_KEYS: readonly string[] = PROFILE_FIELDS.map(profileInputKey);

/**
 * 단계별로 읽는 프로필 필드(Proposed). ⑥-3은 구매대행 고지(상호·반품비·주문당 수량·A/S)와 고시(수입자·고정 문구·
 * A/S 책임자)를, ⑨는 등록 요청 본문의 배송·반품·A/S·원산지(수입자)·구매수량을 읽는다(R04 §2.11, PRD §8.7).
 */
export const PROFILE_FIELDS_BY_STEP: Readonly<Record<ProfileReaderStep, readonly ProfileField[]>> =
  {
    NOTICE_HTML: [
      'returnFeeKrw',
      'exchangeFeeKrw',
      'businessName',
      'afterServicePhone',
      'afterServiceGuide',
      'importer',
      'noticeFixedTexts',
      'maxPurchaseQuantityPerOrder',
    ],
    UPLOAD: [],
    REGISTER: [
      'overseasShippingCommerceAddressbookId',
      'returnCommerceAddressbookId',
      'dispatchDeliveryCompanyCode',
      'commerceReturnDeliveryCompanyId',
      'returnFeeKrw',
      'exchangeFeeKrw',
      'afterServicePhone',
      'afterServiceGuide',
      'importer',
      'maxPurchaseQuantityPerOrder',
    ],
  };

/** 입력 이름 → 화면 이름('재실행 필요' 사유). step-engine INPUT_KEY_LABEL·FE inputLabels.ts가 같은 표를 쓴다 */
export const PROFILE_INPUT_KEY_LABEL: Readonly<Record<string, string>> = {
  'profile.overseasShippingCommerceAddressbookId': '프로필 해외 출고지',
  'profile.returnCommerceAddressbookId': '프로필 반품·교환지',
  'profile.dispatchDeliveryCompanyCode': '프로필 발송 택배사',
  'profile.commerceReturnDeliveryCompanyId': '프로필 반품 택배사',
  'profile.returnFeeKrw': '프로필 반품비',
  'profile.exchangeFeeKrw': '프로필 교환비',
  'profile.businessName': '프로필 상호',
  'profile.afterServicePhone': '프로필 A/S 연락처',
  'profile.afterServiceGuide': '프로필 A/S 안내',
  'profile.importer': '프로필 수입자',
  'profile.noticeFixedTexts': '프로필 고시 고정 문구',
  'profile.maxPurchaseQuantityPerOrder': '프로필 주문당 최대 구매수량',
};

/**
 * 단계 실행기의 `readInputs`가 낼 프로필 입력(P1-05 StepInput과 같은 모양). 시작 조건이고 출처는 SETTINGS다.
 * `required`는 false로 둔다: 빈칸 검사는 단계가 따로 한다(⑥-3 409 PROFILE_INCOMPLETE, G4 사전 검증).
 */
export interface ProfileStepInput {
  inputKey: string;
  sourceType: 'SETTINGS';
  isStartCondition: true;
  required: false;
  value: unknown;
}

export function profileStepInputs(
  stepCode: ProfileReaderStep,
  values: PurchaseAgencyProfileValues,
): ProfileStepInput[] {
  return PROFILE_FIELDS_BY_STEP[stepCode].map((field) => ({
    inputKey: profileInputKey(field),
    sourceType: 'SETTINGS',
    isStartCondition: true,
    required: false,
    value: values[field],
  }));
}

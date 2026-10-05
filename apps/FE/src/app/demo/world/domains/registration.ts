import { formatKstTime } from '@/shared/lib/format';
import type { DemoWorld } from '../../demoWorld';
import { get, post, put, read, type DemoRoute } from '../../router';
import {
  approvalPreviewOf,
  preValidation,
  registrationAccepted,
  registrationOf,
  registrationSummaryOf,
  uploadResultIdOf,
  NO_DUPLICATE,
} from '../../sample/registration';
import { priceJudgementOf } from '../../sample/pricing';
import { finalTags } from '../../sample/tags';
import { DEMO_IDS, STORY } from '../../sample/story';
import type { Ok, Schema } from '../../sample/types';
import { pageOf } from '../../sample/util';
import { closeStepRun, currentRun, gateValid, openStepRun, setCandidateStatus } from '../engine';
import { httpError, withObject, type DemoHttpError } from '../errors';
import { hasCurrentOutput, iso, stepNotRun } from './outputs';
import type { CandidateStatus, RegistrationRec } from '../state';

/**
 * G4 최종 승인·⑨ 등록(BE `modules/registration`): 승인 미리보기 · 사전 검증 · 승인(드라이런 또는 실등록) · 등록 기록 이력 · 등록 API
 * 차단 스위치. 승인은 이 웹 화면의 [승인·등록]으로만 한다.
 * - 승인 미리보기·사전 검증은 승인대기 여정만 받는다. 아니면 200이 아니라 409 `CANDIDATE_STATUS_INVALID`다(드라이런 뒤 검증완료·
 *   등록요청중·등록됨 포함). 승인대기 여정의 미리보기는 승인 버튼 켜짐(`approveEnabled`)과 꺼진 이유를 함께 준다.
 * - 차단 켬(기본) = 드라이런: 같은 요청 안에서 등록 기록 VALIDATED · ⑨ v(n) COMPLETED · 여정 검증완료까지 끝난다(202 `VALIDATED`).
 * - 차단 끔 = 실등록: 202 `REGISTERING` · ⑨ v(n) RUNNING · 여정 등록요청중 → 지연 뒤 등록됨(상품 번호 가공) · ⑨ COMPLETED · 여정 등록됨
 * - 스위치를 끄면 검증완료 여정이 승인대기로 돌아온다(`BLOCK_SWITCH_OFF`). 켜면 여정은 그대로다.
 * - 결과 확인(`result-checks`)은 만들지 않는다(체험에는 결과확인필요가 없다)
 */

const ALLOWED_STATUSES = ['AWAITING_APPROVAL'] as const;
const HOUR_MS = 3_600_000;
/** 판정 유효 시간(설정 `safety.judgementValidityHours` 기본 6) */
const VALIDITY_HOURS = 6;
/** 처음 N건은 전시중지(설정 `registration.initialSuspensionCount` 기본 10) */
const INITIAL_SUSPENSION_COUNT = 10;
type OptionType = Schema<'RegistrationOptionType'>;
const OPTION_TYPES: readonly OptionType[] = ['COMBINATION', 'STANDARD'];

const STATUS_TEXT: Readonly<Record<CandidateStatus, string>> = {
  TEMP: '임시',
  WORKING: '작업중',
  EXCLUDED: '제외',
  AWAITING_APPROVAL: '승인대기',
  VALIDATED: '검증완료',
  REGISTERING: '등록요청중',
  RESULT_CHECK_REQUIRED: '결과확인필요',
  REGISTERED: '등록됨',
};

/** 사전 검증 항목 한국어 이름(422 `PRE_VALIDATION_FAILED` 문구의 {항목}) */
const CHECK_LABEL: Readonly<Partial<Record<Schema<'PreValidationCheck'>['checkCode'], string>>> = {
  REQUIRED_FIELDS: '필수 항목',
  IMAGES: '이미지',
  OPTIONS: '사이즈 옵션',
  TAGS: '태그',
  NOTICE_BLOCK: '구매대행 고지',
  ORIGIN: '원산지',
  JAPAN_WORDING: "'일본산' 표현",
  MIN_BLOCK_WORDS: '최소 차단어',
  NEGATIVE_MARGIN: '역마진',
  EXTRA_CHARGE_WORDING: '추가 청구 표현',
  JUDGEMENT_FRESHNESS: '판정 유효 시간',
  REPRESENTATIVE_IMAGE_SOURCE: '대표이미지 출처',
  STEP_FRESHNESS: '단계 최신성',
  CATEGORY: '카테고리',
  DUPLICATE: '중복',
};

const GATE_TEXT = { G2: 'G2 판정 확정', G3: 'G3 썸네일 선택' } as const;

const STANDARD_UNSUPPORTED =
  '이 상품은 표준형 옵션으로 등록할 수 없습니다. 조합형으로 승인해 주세요.';
const OPTION_TYPE_MESSAGE = 'COMBINATION·STANDARD 중 하나여야 합니다.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIVE_STATUSES: readonly RegistrationRec['status'][] = [
  'REGISTERING',
  'RESULT_CHECK_REQUIRED',
  'REGISTERED',
];
const IN_PROGRESS_STATUSES: readonly RegistrationRec['status'][] = [
  'REGISTERING',
  'RESULT_CHECK_REQUIRED',
];

// ── 읽기 도우미 ─────────────────────────────────────────────────────────────

const recordsOf = (w: DemoWorld): RegistrationRec[] => w.s.registration.records;
const liveRecords = (w: DemoWorld) => recordsOf(w).filter((r) => LIVE_STATUSES.includes(r.status));

/** 처음 N건 셈: 진행 중·등록됨 기록 수(드라이런은 세지 않는다) */
export const liveRegistrationCount = (w: DemoWorld): number => liveRecords(w).length;

const displayStatusTypeOf = (count: number): 'SUSPENSION' | 'ON' =>
  count < INITIAL_SUSPENSION_COUNT ? 'SUSPENSION' : 'ON';

/** 판정에 쓴 라쿠텐 페이지 수집 시각(ms) — ③ 판정 조회(`price-judgement`)와 같은 값 */
function pageCollectedAt(w: DemoWorld): number {
  return w.s.times.pageCollected ?? currentRun(w, 'PRICING')?.startedAt ?? w.now();
}

/** ③ 현재 판정(국내 기준가에 따른 판매가·사이즈 표). ③이 끝나지 않았으면 null — ③ 조회와 같은 builder라 숫자가 같다 */
function judgementOf(w: DemoWorld): Ok<'/candidates/{candidateId}/price-judgement'> | null {
  const run = currentRun(w, 'PRICING');
  if (!run || run.status !== 'COMPLETED') return null;
  const snapshot = w.s.pricing.judgement;
  return priceJudgementOf(w.clock, {
    stepRunId: run.id,
    version: run.version,
    stepStatus: 'COMPLETED',
    isCurrent: true,
    candidateId: w.candidate().id,
    pageCollectedAt: pageCollectedAt(w),
    domesticPriceId: snapshot?.domesticPriceId ?? DEMO_IDS.domesticPrice,
    pRefKrw: snapshot?.pRefKrw ?? STORY.domesticPriceKrw,
    judgedAt: run.endedAt ?? w.now(),
  });
}

const judgementExpired = (w: DemoWorld): boolean =>
  w.now() > pageCollectedAt(w) + VALIDITY_HOURS * HOUR_MS;

/** 지금 ⑧ 현재 산출물이 있는가 */
const uploadRun = (w: DemoWorld) =>
  hasCurrentOutput(w, 'UPLOAD', w.s.upload.outputs) ? currentRun(w, 'UPLOAD') : null;

// ── 검사 ────────────────────────────────────────────────────────────────────

/** 승인대기가 아니면 409 `CANDIDATE_STATUS_INVALID`(details.allowed) */
function assertAwaitingApproval(w: DemoWorld): void {
  const candidate = w.candidate();
  if (candidate.status === 'AWAITING_APPROVAL') return;
  throw httpError(
    409,
    'CANDIDATE_STATUS_INVALID',
    `지금 여정 상태(${STATUS_TEXT[candidate.status]})에서는 할 수 없습니다.`,
    { details: { status: candidate.status, allowed: [...ALLOWED_STATUSES] } },
  );
}

function invalidQuery(field: string, message: string) {
  return httpError(422, 'INVALID_QUERY_PARAMETER', '목록 조건이 올바르지 않습니다.', {
    fieldErrors: [{ field, message }],
  });
}

function optionTypeValue(value: unknown): value is OptionType {
  return typeof value === 'string' && (OPTION_TYPES as readonly string[]).includes(value);
}

/** 미리보기 쿼리: `optionType`만(없으면 조합형) */
function parseApprovalQuery(query: URLSearchParams): OptionType {
  for (const key of query.keys()) {
    if (key !== 'optionType') throw invalidQuery(key, '받지 않는 조건입니다.');
  }
  const raw = query.get('optionType');
  if (raw === null) return 'COMBINATION';
  if (!optionTypeValue(raw)) throw invalidQuery('optionType', OPTION_TYPE_MESSAGE);
  return raw;
}

/** 진행 중 기록(등록요청중·결과확인필요)이 있으면 409 `REGISTRATION_IN_PROGRESS` */
function inProgressBlock(w: DemoWorld): DemoHttpError | null {
  const record = recordsOf(w).find((r) => IN_PROGRESS_STATUSES.includes(r.status));
  if (!record) return null;
  return httpError(
    409,
    'REGISTRATION_IN_PROGRESS',
    '이 여정의 등록이 진행 중이거나 결과 확인이 필요합니다.',
    { details: { registrationId: record.id, status: record.status } },
  );
}

/**
 * 승인 API의 로컬 검사(순서 그대로): G2·G3 무효 → 판정 유효 시간 초과 → 로컬 중복 → 표준형을 쓸 수 없음.
 * 승인 미리보기의 꺼진 이유(`approveDisabledReason`)도 같은 순서·같은 코드다.
 */
function localBlock(w: DemoWorld, optionType: OptionType): DemoHttpError | null {
  for (const gate of ['G2', 'G3'] as const) {
    if (!gateValid(w, gate)) {
      return httpError(
        409,
        'GATE_NOT_PASSED',
        `${withObject(GATE_TEXT[gate])} 먼저 통과해 주세요.`,
        { details: { gate, changedBasisKeys: [] } },
      );
    }
  }
  if (judgementExpired(w)) {
    return httpError(
      409,
      'JUDGEMENT_EXPIRED',
      `판정에 쓴 라쿠텐 페이지가 ${VALIDITY_HOURS}시간이 넘었습니다. '재조회'로 다시 판정해 주세요.`,
      { details: { rakutenPageCollectedAt: iso(pageCollectedAt(w)) } },
    );
  }
  const duplicate = liveRecords(w)[0];
  if (duplicate) {
    return httpError(
      409,
      'DUPLICATE_REGISTRATION',
      '같은 상품·색상이 이미 등록돼 있습니다. 기존 상품을 확인해 주세요.',
      {
        details: {
          source: 'LOCAL',
          existingRegistrationId: duplicate.id,
          originProductNo: duplicate.originProductNo,
        },
      },
    );
  }
  if (optionType === 'STANDARD') {
    return httpError(422, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', {
      fieldErrors: [{ field: 'optionType', message: '표준형 옵션을 쓸 수 없습니다.' }],
    });
  }
  return null;
}

/** 미리보기에 실을 '승인 버튼이 꺼진 이유' — 승인 API가 돌려줄 코드와 같다. 켜져 있으면 null */
function disabledReasonOf(
  w: DemoWorld,
  optionType: OptionType,
): { code: string; message: string } | null {
  const block = inProgressBlock(w) ?? localBlock(w, optionType);
  if (!block) return null;
  return {
    code: block.code,
    message: block.code === 'VALIDATION_FAILED' ? STANDARD_UNSUPPORTED : block.message,
  };
}

// ── 승인 미리보기 · 사전 검증 ─────────────────────────────────────────────────

/** 현재 버전 산출물이 없는 단계는 404 `STEP_OUTPUT_NOT_FOUND`(③ 판정·⑥-3 조립·⑧ 업로드) */
function requiredOutputs(w: DemoWorld) {
  const judgement = judgementOf(w);
  if (!judgement) throw stepNotRun('PRICING');
  if (!hasCurrentOutput(w, 'NOTICE_HTML', w.s.content.outputs.NOTICE_HTML)) {
    throw stepNotRun('NOTICE_HTML');
  }
  const upload = uploadRun(w);
  if (!upload) throw stepNotRun('UPLOAD');
  const tags = currentRun(w, 'TAGS');
  if (!tags) throw stepNotRun('TAGS');
  return { upload, tags, judgement };
}

function approvalPreview(w: DemoWorld, optionType: OptionType) {
  assertAwaitingApproval(w);
  const { upload, tags, judgement } = requiredOutputs(w);
  const count = liveRegistrationCount(w);
  const local = liveRecords(w)[0];
  return approvalPreviewOf(w, {
    optionType,
    apiBlocked: w.s.registration.apiBlocked,
    upload: { run: upload, resultId: uploadResultIdOf(upload) },
    tags: finalTags(w, tags),
    judgement,
    liveRegistrationCount: count,
    displayStatusType: displayStatusTypeOf(count),
    duplicate: local
      ? {
          ...NO_DUPLICATE,
          duplicated: true,
          existingRegistrationId: local.id,
          originProductNo: local.originProductNo,
          channelProductNo: local.channelProductNo,
          source: 'LOCAL',
          registeredAt: local.registeredAt === null ? null : iso(local.registeredAt),
        }
      : NO_DUPLICATE,
    approveDisabledReason: disabledReasonOf(w, optionType),
  });
}

/** 사전 검증 15개: 모두 통과. 판정 유효 시간이 지났으면 그 항목만 실패(고칠 곳 = ② 재조회) */
function preValidationOf(w: DemoWorld, optionType: OptionType) {
  assertAwaitingApproval(w);
  void optionType;
  if (!judgementExpired(w)) return preValidation(w);
  const collected = pageCollectedAt(w);
  return preValidation(w, {
    JUDGEMENT_FRESHNESS: {
      reason: `라쿠텐 페이지를 받은 지 ${VALIDITY_HOURS}시간이 넘었습니다(${formatKstTime(new Date(collected))} 받음 · ${formatKstTime(new Date(collected + VALIDITY_HOURS * HOUR_MS))}까지 유효). '재조회'로 다시 판정해 주세요`,
      stepCode: 'SOURCING',
    },
  });
}

// ── 승인 ────────────────────────────────────────────────────────────────────

const positiveInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647
    ? value
    : null;

interface ApprovalBody {
  optionType: OptionType;
  expectedUploadResultId: number;
  expectedPriceJudgementId: number;
}

/** 승인 본문: 정의 밖 칸·빠진 칸·형식 → 422 `VALIDATION_FAILED` */
function parseApprovalBody(raw: Record<string, unknown>): ApprovalBody {
  const errors: { field: string; message: string }[] = [];
  for (const key of Object.keys(raw)) {
    if (!['optionType', 'expectedUploadResultId', 'expectedPriceJudgementId'].includes(key)) {
      errors.push({ field: key, message: '받지 않는 칸입니다.' });
    }
  }
  if (!optionTypeValue(raw.optionType)) {
    errors.push({ field: 'optionType', message: OPTION_TYPE_MESSAGE });
  }
  const upload = positiveInt(raw.expectedUploadResultId);
  if (upload === null) {
    errors.push({ field: 'expectedUploadResultId', message: '1 이상의 정수여야 합니다.' });
  }
  const judgement = positiveInt(raw.expectedPriceJudgementId);
  if (judgement === null) {
    errors.push({ field: 'expectedPriceJudgementId', message: '1 이상의 정수여야 합니다.' });
  }
  if (errors.length > 0) {
    throw httpError(422, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', { fieldErrors: errors });
  }
  return {
    optionType: raw.optionType as OptionType,
    expectedUploadResultId: upload!,
    expectedPriceJudgementId: judgement!,
  };
}

/**
 * `Idempotency-Key`(BE `parseIdempotencyKey`): 없거나 비었으면 400 `IDEMPOTENCY_KEY_REQUIRED`, UUID가 아니면 422.
 * 이 키를 요구하는 라우트는 승인(`POST …/registrations`) 하나뿐이다(여정 만들기·단계 실행·연속 실행·게이트 통과·국내 기준가는 요구하지 않는다).
 */
function parseIdempotencyKey(header: string | null): string {
  const value = header?.trim() ?? '';
  if (value === '') {
    throw httpError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      '요청 번호가 빠졌습니다. 화면을 새로 고친 뒤 다시 해 주세요.',
    );
  }
  if (!UUID.test(value)) {
    throw httpError(422, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', {
      fieldErrors: [{ field: 'Idempotency-Key', message: 'UUID 형식이어야 합니다.' }],
    });
  }
  return value.toLowerCase();
}

/** 같은 키 기록이 있으면 첫 응답, 다른 본문이면 422 `IDEMPOTENCY_KEY_REUSED` */
function replayOf(
  w: DemoWorld,
  key: string,
  body: ApprovalBody,
): Schema<'RegistrationAccepted'> | null {
  const found = recordsOf(w).find((r) => r.idempotencyKey === key);
  if (!found) return null;
  const same =
    found.optionType === body.optionType &&
    found.uploadResultId === body.expectedUploadResultId &&
    found.priceJudgementId === body.expectedPriceJudgementId;
  if (!same) {
    throw httpError(
      422,
      'IDEMPOTENCY_KEY_REUSED',
      '같은 요청 번호로 다른 내용을 보냈습니다. 화면을 새로 고친 뒤 다시 해 주세요.',
      { details: { registrationId: found.id } },
    );
  }
  return registrationAccepted(w, found);
}

/** 등록 호출이 2xx로 돌아왔다 → 등록됨 */
function finishRegistration(w: DemoWorld, registrationId: number): void {
  const record = recordsOf(w).find((r) => r.id === registrationId);
  if (!record || record.status !== 'REGISTERING') return;
  const run = w.s.steps.REGISTER.runs.find((r) => r.id === record.stepRunId);
  const now = w.now();
  record.status = 'REGISTERED';
  record.registeredAt = now;
  record.responseReceivedAt = now;
  record.originProductNo = STORY.originProductNo;
  record.channelProductNo = STORY.channelProductNo;
  record.httpStatus = 200;
  record.traceId = 'demo-trace-register-200';
  if (run) closeStepRun(w, 'REGISTER', run);
  setCandidateStatus(w, 'REGISTERED', 'REGISTER_SUCCEEDED', {
    stepRunId: record.stepRunId,
    registrationId: record.id,
  });
  w.mark('registered', now);
}

/**
 * G4 최종 승인·등록(`POST …/registrations`). 검사 순서는 BE와 같다: 키·본문 → 같은 키 재생 → 진행 중 기록 → 승인대기 아님 → 화면이 본
 * 버전과 다름 → G2·G3 → 판정 유효 시간 → 로컬 중복 → 표준형 불가 → 사전 검증(BLOCK 실패)
 */
function approve(
  w: DemoWorld,
  keyHeader: string | null,
  rawBody: Record<string, unknown>,
): Schema<'RegistrationAccepted'> {
  const key = parseIdempotencyKey(keyHeader);
  const body = parseApprovalBody(rawBody);
  const replay = replayOf(w, key, body);
  if (replay) return replay;

  const inProgress = inProgressBlock(w);
  if (inProgress) throw inProgress;
  assertAwaitingApproval(w);
  const currentUpload = uploadRun(w);
  const currentUploadId = currentUpload ? uploadResultIdOf(currentUpload) : null;
  const currentJudgementId = judgementOf(w)?.id ?? null;
  if (
    currentUploadId !== body.expectedUploadResultId ||
    currentJudgementId !== body.expectedPriceJudgementId
  ) {
    throw httpError(
      409,
      'VERSION_NOT_CURRENT',
      '화면을 연 뒤 값이 바뀌었습니다. 새로 고친 뒤 다시 해 주세요.',
      {
        details: {
          expectedUploadResultId: body.expectedUploadResultId,
          currentUploadResultId: currentUploadId,
          expectedPriceJudgementId: body.expectedPriceJudgementId,
          currentPriceJudgementId: currentJudgementId,
        },
      },
    );
  }
  const local = localBlock(w, body.optionType);
  if (local) throw local;
  const checks = preValidation(w);
  if (!checks.approvable) {
    const failed = checks.checks.filter((check) => !check.passed);
    throw httpError(
      422,
      'PRE_VALIDATION_FAILED',
      `승인 전 검사를 통과하지 못했습니다: ${failed.map((c) => CHECK_LABEL[c.checkCode] ?? c.checkCode).join(', ')}.`,
      { details: { checks: checks.checks } },
    );
  }

  const registration = w.s.registration;
  const dryRun = registration.apiBlocked;
  // 승인 시각은 기록마다 달라야 이력·G4가 최근 기록을 가린다(같은 밀리초에 두 번 눌러도)
  const now = Math.max(w.now(), ...registration.records.map((r) => r.approvedAt + 1));
  const run = openStepRun(w, 'REGISTER', 'STEP');
  const record: RegistrationRec = {
    id: w.s.next.registration++,
    stepRunId: run.id,
    version: run.version,
    status: dryRun ? 'VALIDATED' : 'REGISTERING',
    optionType: body.optionType,
    approvedAt: now,
    registeredAt: null,
    originProductNo: null,
    channelProductNo: null,
    httpStatus: null,
    traceId: null,
    priceJudgementId: body.expectedPriceJudgementId,
    uploadResultId: body.expectedUploadResultId,
    displayStatusType: displayStatusTypeOf(liveRegistrationCount(w)),
    idempotencyKey: key,
    requestSentAt: dryRun ? null : now,
    responseReceivedAt: null,
  };
  registration.records.push(record);
  const links = { stepRunId: run.id, registrationId: record.id };
  if (dryRun) {
    // 차단 켬: 커머스API를 부르지 않고 요청 내용과 검증 결과만 저장한다 — ⑨는 곧바로 COMPLETED
    closeStepRun(w, 'REGISTER', run);
    setCandidateStatus(w, 'VALIDATED', 'G4_APPROVED_BLOCKED', links);
    w.mark('dryRunApproved', now);
  } else {
    setCandidateStatus(w, 'REGISTERING', 'G4_APPROVED', links);
    w.mark('approved', now);
    w.schedule('medium', () => finishRegistration(w, record.id));
  }
  return registrationAccepted(w, record);
}

// ── 등록 API 차단 스위치 ─────────────────────────────────────────────────────

function switchView(w: DemoWorld) {
  const state = w.s.registration;
  return { apiBlocked: state.apiBlocked, changedAt: iso(state.switchChangedAt) };
}

/**
 * 스위치 켜기·끄기. 바뀌면 시각을 새로 적고, **끌 때** 검증완료 여정을 승인대기로 되돌린다(`BLOCK_SWITCH_OFF`). 같은 값이면
 * 아무것도 바꾸지 않는다.
 */
function putSwitch(w: DemoWorld, apiBlocked: unknown): Schema<'RegistrationSwitchChanged'> {
  if (typeof apiBlocked !== 'boolean') {
    throw httpError(422, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', {
      fieldErrors: [{ field: 'apiBlocked', message: 'true·false 중 하나여야 합니다.' }],
    });
  }
  const state = w.s.registration;
  if (state.apiBlocked === apiBlocked) return { ...switchView(w), revertedCandidateIds: [] };
  state.apiBlocked = apiBlocked;
  state.switchChangedAt = w.now();
  const reverted: number[] = [];
  const candidate = w.s.candidate;
  if (!apiBlocked && candidate?.status === 'VALIDATED') {
    const last = [...state.records].reverse().find((r) => r.status === 'VALIDATED');
    setCandidateStatus(w, 'AWAITING_APPROVAL', 'BLOCK_SWITCH_OFF', {
      stepRunId: last?.stepRunId ?? null,
      registrationId: last?.id ?? null,
    });
    reverted.push(candidate.id);
  }
  w.mark(apiBlocked ? 'switchOn' : 'switchOff', state.switchChangedAt);
  return { ...switchView(w), revertedCandidateIds: reverted };
}

// ── 등록 기록 ───────────────────────────────────────────────────────────────

const notFoundRegistration = () =>
  httpError(404, 'REGISTRATION_NOT_FOUND', '등록 기록을 찾을 수 없습니다.');

/** 이력(approvedAt 내림차순 — `sort=approvedAt,asc`면 오름차순). 목록 조건 밖 키는 422 `INVALID_QUERY_PARAMETER` */
function registrationPage(w: DemoWorld, query: URLSearchParams) {
  for (const key of query.keys()) {
    if (!['page', 'size', 'sort'].includes(key)) throw invalidQuery(key, '받지 않는 조건입니다.');
  }
  const page = Number(query.get('page') ?? 0) || 0;
  const size = Number(query.get('size') ?? 20) || 20;
  const asc = query
    .getAll('sort')
    .flatMap((s) => s.split(','))
    .join(',')
    .replace(/\s/g, '')
    .includes('asc');
  const sorted = [...recordsOf(w)].sort((a, b) => b.approvedAt - a.approvedAt || b.id - a.id);
  const ordered = asc ? sorted.reverse() : sorted;
  return pageOf(
    ordered.map((rec) => registrationSummaryOf(w, rec)),
    page,
    size,
  );
}

export const registrationRoutes: DemoRoute[] = [
  get('/candidates/{candidateId}/approval', ({ world, query }) =>
    approvalPreview(world, parseApprovalQuery(query)),
  ),
  // 상태를 바꾸지 않는 계산 POST — 화면이 조회처럼 부른다(`read` = 변경 알림 없음)
  read('/candidates/{candidateId}/pre-validations', async ({ world, json }) => {
    const body = await json<{ optionType: unknown }>();
    if (body.optionType !== undefined && !optionTypeValue(body.optionType)) {
      throw httpError(422, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', {
        fieldErrors: [{ field: 'optionType', message: OPTION_TYPE_MESSAGE }],
      });
    }
    return preValidationOf(world, body.optionType ?? 'COMBINATION');
  }),
  post('/candidates/{candidateId}/registrations', 202, async ({ world, request, json }) =>
    approve(
      world,
      request.headers.get('Idempotency-Key'),
      (await json<Record<string, unknown>>()) as Record<string, unknown>,
    ),
  ),
  get('/candidates/{candidateId}/registrations', ({ world, query }) =>
    registrationPage(world, query),
  ),
  get('/registrations/{registrationId}', ({ world, params }) => {
    const text = params.registrationId ?? '';
    if (!/^[1-9]\d{0,9}$/.test(text)) throw notFoundRegistration();
    const record = recordsOf(world).find((r) => r.id === Number(text));
    if (!record) throw notFoundRegistration();
    return registrationOf(world, record);
  }),
  get('/registration-switch', ({ world }) => switchView(world)),
  put('/registration-switch', 200, async ({ world, json }) => {
    const body = await json<{ apiBlocked: unknown }>();
    return putSwitch(world, body.apiBlocked);
  }),
];

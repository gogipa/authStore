/**
 * 공통 오류 코드(05-3 §5.1 '공통'). HTTP 상태·화면 문구는 05-3 표 그대로다.
 * 도메인 코드(후보·단계·게이트 등)는 해당 모듈을 만들 때 여기에 더한다(09 API 개발).
 */
export const ERROR_CODES = {
  HOST_NOT_ALLOWED: {
    status: 403,
    message: '이 앱은 이 PC 주소(127.0.0.1·localhost)로만 열 수 있습니다.',
  },
  ORIGIN_NOT_ALLOWED: { status: 403, message: '앱 화면 밖에서 온 요청이라 막았습니다.' },
  CLIENT_HEADER_REQUIRED: { status: 403, message: '앱 화면 밖에서 온 요청이라 막았습니다.' },
  MALFORMED_REQUEST: {
    status: 400,
    message: '요청을 읽을 수 없습니다. 화면을 새로 고친 뒤 다시 해 주세요.',
  },
  VALIDATION_FAILED: { status: 422, message: '입력값을 확인해 주세요.' },
  INVALID_QUERY_PARAMETER: { status: 422, message: '목록 조건이 올바르지 않습니다.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: '파일(또는 붙여 넣은 글)이 너무 큽니다.' },
  /**
   * Proposed(05-3에 없음): 없는 경로·메서드. 05-3 §5.1에 일반 404 코드가 없어 더했다.
   * 05-3·05-2에 반영할지 오너 검토 대상(06-2 §8).
   */
  ROUTE_NOT_FOUND: { status: 404, message: '요청한 주소를 찾을 수 없습니다.' },
  /** 05-3 §5.1: call_log 오늘 집계가 상한. details.target·dailyLimit, Retry-After */
  DAILY_LIMIT_REACHED: {
    status: 409,
    message: '오늘 {대상} 조회 한도({n}건)를 다 썼습니다. 내일 0시(한국 시간)에 다시 됩니다.',
  },
  /** 05-3 §5.1: 403·418·429 뒤 24시간 쉼. details.target·blockedUntil, Retry-After */
  EXTERNAL_CALL_COOLDOWN: {
    status: 409,
    message: '{대상}이 요청을 막아 {시각}까지 쉽니다. 그동안은 붙여넣기·직접 입력을 써 주세요.',
  },
  /** 05-3 §5.1: 동기로 부른 외부 호출 실패(details.target·reason·traceId) */
  EXTERNAL_API_ERROR: {
    status: 502,
    message: '{대상} 응답을 받지 못했습니다({사유}). 잠시 뒤 다시 해 주세요.',
  },
  /**
   * Proposed(05-3에 없음, P1-01): 외부 호출 관문이 허용하지 않은 요청(허용 목록 밖 호스트·https 아님·
   * 금지 헤더). 앱 코드의 잘못이라 500으로 둔다. details.target·reason(06-2 §9).
   */
  EXTERNAL_REQUEST_NOT_ALLOWED: {
    status: 500,
    message: '허용하지 않은 외부 요청이라 보내지 않았습니다.',
  },
  // ── 비밀정보·커머스API 인증(P1-07, 05-3 §5.1 문구 그대로) ──
  /** 05-3 §5.1: 필요한 비밀 키가 키체인에 없음(details.secretKeys, {키 이름}은 SECRET_KEY_LABEL — Proposed) */
  SECRET_NOT_CONFIGURED: {
    status: 409,
    message: '{키 이름}이 아직 없습니다. 시스템 상태 화면에서 넣어 주세요.',
  },
  /** 05-3 §5.1(system): 허용 목록 밖 secretKey */
  SECRET_KEY_UNKNOWN: { status: 404, message: '알 수 없는 키 이름입니다.' },
  /** 05-3 §5.1: 키체인 읽기·쓰기 실패 */
  KEYCHAIN_UNAVAILABLE: {
    status: 503,
    message: 'macOS 키체인을 열 수 없습니다. 키체인 접근을 허용한 뒤 다시 해 주세요.',
  },
  /** 05-3 §5.1: 토큰 발급 실패(details.causeCategory·errorCode·httpStatus·traceId) */
  COMMERCE_AUTH_FAILED: {
    status: 502,
    message: '네이버 커머스API 인증에 실패했습니다({원인}). 시스템 상태 화면의 안내를 따라 주세요.',
  },
  // ── 커머스API 메타 동기화(P1-08, 05-3 §5.1 문구 그대로) ──
  /** 05-3 §5.1: 같은 작업 진행 중(details.job: META_SYNC 등, P1-08은 details.targets도 준다) */
  ALREADY_IN_PROGRESS: {
    status: 409,
    message: '{작업}이 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
  },
  /** 05-3 §5.1: 메타 캐시가 비어 있음(details.target: CATEGORY·ORIGIN_AREA) */
  COMMERCE_META_NOT_SYNCED: {
    status: 409,
    message:
      "네이버 {카테고리·원산지} 정보가 아직 없습니다. 시스템 상태에서 '지금 동기화'를 눌러 주세요.",
  },
  /** 05-3 §5.1: 이미지 id 없음 */
  IMAGE_ASSET_NOT_FOUND: { status: 404, message: '이미지를 찾을 수 없습니다.' },
  /** 05-3 §5.1: DB 행은 있으나 파일 없음 */
  IMAGE_FILE_MISSING: { status: 404, message: '이미지 파일이 데이터 폴더에 없습니다.' },
  /** 05-3 §5.1: 시작 검증 실패로 로드된 설정 스냅샷이 없음(fieldErrors에 검사 오류) */
  SETTINGS_INVALID: {
    status: 503,
    message:
      '설정 파일에 오류가 있어 설정을 읽지 못했습니다. 설정 화면의 검사 결과를 확인해 주세요.',
  },
  /** 05-3 §5.1: JSON Schema 위반(fieldErrors에 JSON 경로) */
  SETTINGS_SCHEMA_INVALID: { status: 422, message: '설정 형식이 맞지 않습니다: {위치}.' },
  /** 05-3 §5.1: 차단어·아동 단어 삭제, 필수 고지 삭제, 판정 유효시간 6시간 초과 등(F-BS-05). details.violations */
  SAFETY_SETTING_RELAXATION_REJECTED: {
    status: 422,
    message: '안전 기준은 느슨하게 바꿀 수 없습니다({항목}).',
  },
  // ── AI 엔진 설정(P1-11, 05-3 §5.1 '설정·시스템' 문구 그대로) ──
  /** 05-3 §5.1: 저장할 엔진·텍스트 모델로 10분 안에 통과한 연결 테스트가 없음(details.engineCode·model, D-16 R8) */
  AI_ENGINE_NOT_VERIFIED: {
    status: 409,
    message:
      '{엔진}({모델})으로 연결 테스트를 먼저 통과해 주세요. 통과한 지 10분이 지났으면 다시 해 주세요.',
  },
  /** 05-3 §5.1: 목록 밖 모델(직접 입력 불가 엔진) 또는 비어 있는 모델(fieldErrors에 models.{엔진}.text|vision, R12) */
  AI_MODEL_INVALID: { status: 422, message: '{엔진}에서 쓸 수 없는 모델입니다: {모델}.' },
  // ── 구매대행 프로필(P1-09, 05-3 §5.1 '설정·시스템' 문구 그대로) ──
  /** 05-3 §5.1: 주소록 id 없음·지워짐(removed_at). fieldErrors에 해당 칸 */
  ADDRESSBOOK_NOT_FOUND: { status: 404, message: '주소록 항목을 찾을 수 없습니다.' },
  /** 05-3 §5.1: 해외 출고지로 고른 주소록이 is_overseas=false */
  ADDRESS_NOT_OVERSEAS: { status: 422, message: '해외 출고지 주소가 아닙니다.' },
  /** 05-3 §5.1: 발송 택배사 코드가 현재 설정 스냅샷의 목록(delivery.dispatchCompanies) 밖 */
  DELIVERY_COMPANY_NOT_ALLOWED: { status: 422, message: '쓸 수 없는 발송 택배사입니다.' },
  /**
   * Proposed(P1-09, 05-3에 없던 코드): 반품 택배사 id가 동기화 목록(commerce_return_delivery_company)에 없거나
   * 최신 동기화에서 사라짐(removed_at). 주소록과 같게 404로 둔다(05-3·05-1 §5.1에 더했다, 오너 검토).
   */
  RETURN_DELIVERY_COMPANY_NOT_FOUND: {
    status: 404,
    message: '반품 택배사를 찾을 수 없습니다. 동기화한 목록에서 다시 골라 주세요.',
  },
  // ── step-engine 후보(P1-04, 05-3 §5.1 문구 그대로) ──
  /** 05-3 §5.1: 후보 id 없음 */
  CANDIDATE_NOT_FOUND: { status: 404, message: '후보를 찾을 수 없습니다.' },
  /** 05-3 §5.1: 진행 중 후보에 같은 itemCode+색상(uq_candidate_active_item_color, details.existingCandidateId) */
  CANDIDATE_DUPLICATE: {
    status: 409,
    message: '같은 상품·색상으로 진행 중인 후보가 있습니다. 그 후보를 열어 주세요.',
  },
  /** 05-3 §5.1: 등록요청중·결과확인필요·등록됨(F-CW-07, details.status) */
  CANDIDATE_LOCKED: {
    status: 409,
    message: '등록을 진행 중이거나 끝난 후보라 바꿀 수 없습니다.',
  },
  /** 05-3 §5.1: 후보 상태 EXCLUDED */
  CANDIDATE_EXCLUDED: {
    status: 409,
    message: "제외된 후보입니다. '다시 작업'을 먼저 눌러 주세요.",
  },
  /** 05-3 §5.1: 그 동작에 맞지 않는 상태(details.allowed[]) */
  CANDIDATE_STATUS_INVALID: {
    status: 409,
    message: '지금 후보 상태({상태})에서는 할 수 없습니다.',
  },
  /** 05-3 §5.1: 이 단계가 읽거나 이 단계를 읽는 단계가 실행 중(F-CW-18), 실행 중 제외·성별 변경(details.stepCode) */
  STEP_LOCKED_BY_RUNNING_STEP: {
    status: 409,
    message: '{단계}가 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.',
  },
  /** 05-3 §5.1: 확정된 앵커 키와 다른 앵커·행·② 버전(F-CW-03) */
  ANCHOR_KEY_MISMATCH: {
    status: 409,
    message: '이 후보의 기준 모델·색상과 다릅니다. 다른 모델·색상은 새 후보로 만들어 주세요.',
  },
  // ── step-engine 단계 실행(P1-05, 05-3 §5.1 문구 그대로) ──
  /** 05-3 §5.1: 실행 id 없음 */
  STEP_RUN_NOT_FOUND: { status: 404, message: '실행 기록을 찾을 수 없습니다.' },
  /** 05-3 §5.1: 후보의 그 단계 산출물 없음(details.stepCode) */
  STEP_OUTPUT_NOT_FOUND: { status: 404, message: '아직 {단계}를 실행하지 않았습니다.' },
  /** 05-3 §5.1: 알 수 없는 stepCode, REGISTER, 그 동작이 없는 단계(실행기가 없는 단계 포함, P1-05 Proposed) */
  INVALID_STEP_CODE: {
    status: 422,
    message: '이 단계는 여기서 실행하거나 고칠 수 없습니다.',
  },
  /** 05-3 §5.1: (M2) TEMP 후보의 ⑧·⑨·승인 */
  TEMP_CANDIDATE_NOT_ALLOWED: {
    status: 409,
    message: '임시 후보는 업로드·등록할 수 없습니다. 먼저 라쿠텐 상품에 연결해 주세요.',
  },
  /** 05-3 §5.1: 시작 조건 미충족(fieldErrors에 입력 키, details.stepCode) */
  STEP_START_CONDITION_UNMET: { status: 409, message: '시작에 필요한 값이 없습니다: {빠진 입력}.' },
  /** 05-3 §5.1: 같은 후보·단계에 열린 실행(실행중·입력대기, uq_step_run_one_open) */
  STEP_ALREADY_RUNNING: { status: 409, message: '이 단계가 이미 실행 중입니다.' },
  /** 05-3 §5.1: 필요한 단계·고른 버전이 완료·최신이 아님(details.stepCode·status) */
  STEP_NOT_COMPLETED: {
    status: 409,
    message: '{단계}가 아직 완료되지 않았습니다(지금: {상태}).',
  },
  /** 05-3 §5.1: 비교 보기·그대로 유지 대상이 아님 */
  STEP_NOT_RERUN_REQUIRED: {
    status: 409,
    message: "'재실행 필요' 상태인 단계에서만 할 수 있습니다.",
  },
  /** 05-3 §5.1: 실행 중 오너 입력을 닫힌·실행중 버전에 보냄 */
  STEP_RUN_NOT_WAITING_INPUT: {
    status: 409,
    message: '이 실행은 입력을 기다리고 있지 않습니다. 바꾸려면 다시 실행하거나 수정해 주세요.',
  },
  /** 05-3 §5.1: 현재 버전을 다시 고름 */
  STEP_RUN_ALREADY_CURRENT: { status: 409, message: '이미 지금 쓰고 있는 버전입니다.' },
  /** 05-3 §5.1: baseStepRunId·basisStepRunId·expected*가 현재 버전과 다름 */
  VERSION_NOT_CURRENT: {
    status: 409,
    message: '화면을 연 뒤 값이 바뀌었습니다. 새로 고친 뒤 다시 해 주세요.',
  },
  /** 05-3 §5.1: COPY가 아닌 단계(ck_step_run_keep_copy_only) */
  KEEP_AS_IS_NOT_ALLOWED: {
    status: 422,
    message: "'그대로 유지'는 ⑥-1 카피에서만 쓸 수 있습니다.",
  },
  /** 05-3 §5.1: 허용 목록 밖 필드 키 */
  FIELD_NOT_EDITABLE: { status: 422, message: '이 항목은 직접 고칠 수 없습니다.' },
  /** 05-3 §5.1: 필요한 게이트가 없거나 무효(details.gate) */
  GATE_NOT_PASSED: { status: 409, message: '{게이트}를 먼저 통과해 주세요.' },
  /** 05-3 §5.1: G2 유효 전 연속 실행 시작이 SOURCING·PRICING이 아님(F-CW-15). 레일 continuousRun 꺼진 이유(P1-06 API) */
  CONTINUOUS_RUN_BEFORE_G2: {
    status: 409,
    message:
      '소싱 확정(G2) 전에는 ②·③부터만 연속 실행할 수 있습니다. 다른 단계는 하나씩 실행해 주세요.',
  },
  // ── step-engine 연속 실행·게이트(P1-06, 05-3 §5.1 문구 그대로) ──
  /** 05-3 §5.1: step_chain id 없음 */
  CONTINUOUS_RUN_NOT_FOUND: { status: 404, message: '연속 실행 기록을 찾을 수 없습니다.' },
  /** 05-3 §5.1: 후보에 열린 step_chain(details.stepChainId) */
  CONTINUOUS_RUN_ALREADY_OPEN: {
    status: 409,
    message: '이 후보의 연속 실행이 이미 진행 중입니다.',
  },
  /** 05-3 §5.1: RERUN_STALE인데 재실행 필요 단계 없음 */
  NO_RERUN_REQUIRED_STEPS: { status: 409, message: '다시 실행할 단계가 없습니다.' },
  /** 05-3 §5.1: G2·G3 외 게이트 통과 요청(공급자가 없는 게이트도, P1-06 Proposed) */
  INVALID_GATE_CODE: {
    status: 422,
    message: '여기서는 G2·G3만 통과할 수 있습니다. 최종 승인은 승인 화면에서 해 주세요.',
  },
  /** 05-3 §5.1: G2 조건 — ③ 판정 결과가 판매 후보 아님 */
  NOT_SALE_CANDIDATE: {
    status: 409,
    message: "판정 결과가 '판매 후보 아님'이라 소싱 확정을 할 수 없습니다.",
  },
  /** 05-3 §5.1: G2 조건 — 비교하지 않은 URL 후보인데 '비교 없이 확정' 없음(F-PJ-02) */
  NO_COMPARISON_NOT_CONFIRMED: {
    status: 409,
    message: "비교하지 않은 URL 후보입니다. '비교 없이 확정'을 체크해 주세요.",
  },
  /** 05-3 §5.1: AI 엔진을 쓰는 단계·연속 실행 시작 때 선택 엔진을 쓸 수 없음(details.engineCode·reason·settingsPath, P1-10 훅) */
  AI_ENGINE_UNAVAILABLE: {
    status: 409,
    message:
      "선택한 AI 엔진({엔진})을 지금 쓸 수 없습니다({사유}). 'AI 엔진' 설정에서 확인해 주세요.",
  },
  /** 05-3 §5.1: 키워드 id 없음 */
  KEYWORD_NOT_FOUND: { status: 404, message: '키워드를 찾을 수 없습니다.' },
  /** 05-3 §5.1: keyword.selected_at 없음 */
  KEYWORD_NOT_SELECTED: {
    status: 409,
    message: '키워드 화면에서 고른 키워드만 후보로 만들 수 있습니다.',
  },
  /** 05-3 §5.1: keyword.excluded_reason 있음 */
  KEYWORD_EXCLUDED: { status: 409, message: '아동화로 빠진 키워드는 고를 수 없습니다.' },
  /** 05-3 §5.1: 검색어 규칙 위반(fieldErrors에 규칙) */
  RAKUTEN_QUERY_INVALID: {
    status: 422,
    message: '라쿠텐 검색어 형식이 맞지 않습니다(반각 128자 이내, 너무 짧은 단어 없이).',
  },
  /** 05-3 §5.1: rakutenItemId 없음 */
  RAKUTEN_ITEM_NOT_FOUND: { status: 404, message: '읽어 온 라쿠텐 상품을 찾을 수 없습니다.' },
  INTERNAL_ERROR: {
    status: 500,
    message: '앱 안에서 오류가 났습니다. 다시 해 보고, 계속되면 로그를 확인해 주세요.',
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * 05-3 문구의 `{…}` 자리를 채운다(05-3 §5 '{…}는 details로 채운다').
 * 값이 없는 자리는 그대로 둔다. 자리 바로 뒤의 조사 '이/가'·'을/를'·'은/는'은 값의 끝 글자 받침에 맞춘다
 * (예: '{대상}이' → '데이터랩이', '라쿠텐 상품 페이지가', '{게이트}를' → 'G3 썸네일 선택을').
 */
export function formatErrorMessage(
  code: ErrorCode,
  vars: Record<string, string | number> = {},
): string {
  return ERROR_CODES[code].message.replace(
    /\{([^{}]+)\}(이|가|을|를|은|는)?/g,
    (whole, key: string, particle: string | undefined) => {
      if (!(key in vars)) return whole;
      const value = String(vars[key]);
      return particle ? value + subjectParticle(value, particle) : value;
    },
  );
}

/** 받침 있음·없음에 쓰는 조사 짝 */
const PARTICLE_PAIRS: Record<string, readonly [withFinal: string, withoutFinal: string]> = {
  이: ['이', '가'],
  가: ['이', '가'],
  을: ['을', '를'],
  를: ['을', '를'],
  은: ['은', '는'],
  는: ['은', '는'],
};

/** 한글 끝 글자에 받침이 있으면 '이·을·은', 없으면 '가·를·는'. 한글이 아니면 문구의 조사를 그대로 쓴다. */
function subjectParticle(value: string, fallback: string): string {
  const last = value.charCodeAt(value.length - 1);
  const pair = PARTICLE_PAIRS[fallback];
  if (!pair || last < 0xac00 || last > 0xd7a3) return fallback;
  return (last - 0xac00) % 28 === 0 ? pair[1] : pair[0];
}

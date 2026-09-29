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
  /** 05-3 §5.1: 이미지 id 없음 */
  IMAGE_ASSET_NOT_FOUND: { status: 404, message: '이미지를 찾을 수 없습니다.' },
  /** 05-3 §5.1: DB 행은 있으나 파일 없음 */
  IMAGE_FILE_MISSING: { status: 404, message: '이미지 파일이 데이터 폴더에 없습니다.' },
  INTERNAL_ERROR: {
    status: 500,
    message: '앱 안에서 오류가 났습니다. 다시 해 보고, 계속되면 로그를 확인해 주세요.',
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * 05-3 문구의 `{…}` 자리를 채운다(05-3 §5 '{…}는 details로 채운다').
 * 값이 없는 자리는 그대로 둔다. 자리 바로 뒤의 조사 '이/가'는 값의 끝 글자 받침에 맞춘다
 * (예: '{대상}이' → '데이터랩이', '라쿠텐 상품 페이지가').
 */
export function formatErrorMessage(
  code: ErrorCode,
  vars: Record<string, string | number> = {},
): string {
  return ERROR_CODES[code].message.replace(
    /\{([^{}]+)\}(이|가)?/g,
    (whole, key: string, particle: string | undefined) => {
      if (!(key in vars)) return whole;
      const value = String(vars[key]);
      return particle ? value + subjectParticle(value, particle) : value;
    },
  );
}

/** 한글 끝 글자에 받침이 있으면 '이', 없으면 '가'. 한글이 아니면 문구의 조사를 그대로 쓴다. */
function subjectParticle(value: string, fallback: string): string {
  const last = value.charCodeAt(value.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return fallback;
  return (last - 0xac00) % 28 === 0 ? '가' : '이';
}

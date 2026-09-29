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
  INTERNAL_ERROR: {
    status: 500,
    message: '앱 안에서 오류가 났습니다. 다시 해 보고, 계속되면 로그를 확인해 주세요.',
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

import { ERROR_CODES, formatErrorMessage } from './error-codes.js';

describe('error-codes', () => {
  it('P1-01 코드 네 개는 05-3 §5.1 문구·상태 그대로다', () => {
    expect(ERROR_CODES.DAILY_LIMIT_REACHED).toEqual({
      status: 409,
      message: '오늘 {대상} 조회 한도({n}건)를 다 썼습니다. 내일 0시(한국 시간)에 다시 됩니다.',
    });
    expect(ERROR_CODES.EXTERNAL_CALL_COOLDOWN).toEqual({
      status: 409,
      message: '{대상}이 요청을 막아 {시각}까지 쉽니다. 그동안은 붙여넣기·직접 입력을 써 주세요.',
    });
    expect(ERROR_CODES.IMAGE_ASSET_NOT_FOUND).toEqual({
      status: 404,
      message: '이미지를 찾을 수 없습니다.',
    });
    expect(ERROR_CODES.IMAGE_FILE_MISSING).toEqual({
      status: 404,
      message: '이미지 파일이 데이터 폴더에 없습니다.',
    });
  });

  it('P1-03 설정 코드 세 개는 05-3 §5.1 문구·상태 그대로다', () => {
    expect(ERROR_CODES.SETTINGS_INVALID).toEqual({
      status: 503,
      message:
        '설정 파일에 오류가 있어 설정을 읽지 못했습니다. 설정 화면의 검사 결과를 확인해 주세요.',
    });
    expect(ERROR_CODES.SETTINGS_SCHEMA_INVALID).toEqual({
      status: 422,
      message: '설정 형식이 맞지 않습니다: {위치}.',
    });
    expect(ERROR_CODES.SAFETY_SETTING_RELAXATION_REJECTED).toEqual({
      status: 422,
      message: '안전 기준은 느슨하게 바꿀 수 없습니다({항목}).',
    });
    expect(
      formatErrorMessage('SAFETY_SETTING_RELAXATION_REJECTED', { 항목: '판정 유효 시간 늘리기' }),
    ).toBe('안전 기준은 느슨하게 바꿀 수 없습니다(판정 유효 시간 늘리기).');
  });

  it('P1-04 후보 코드 12개는 05-3 §5.1 문구·상태 그대로다', () => {
    const expected: Record<string, { status: number; message: string }> = {
      CANDIDATE_NOT_FOUND: { status: 404, message: '후보를 찾을 수 없습니다.' },
      CANDIDATE_DUPLICATE: {
        status: 409,
        message: '같은 상품·색상으로 진행 중인 후보가 있습니다. 그 후보를 열어 주세요.',
      },
      CANDIDATE_LOCKED: {
        status: 409,
        message: '등록을 진행 중이거나 끝난 후보라 바꿀 수 없습니다.',
      },
      CANDIDATE_EXCLUDED: {
        status: 409,
        message: "제외된 후보입니다. '다시 작업'을 먼저 눌러 주세요.",
      },
      CANDIDATE_STATUS_INVALID: {
        status: 409,
        message: '지금 후보 상태({상태})에서는 할 수 없습니다.',
      },
      ANCHOR_KEY_MISMATCH: {
        status: 409,
        message: '이 후보의 기준 모델·색상과 다릅니다. 다른 모델·색상은 새 후보로 만들어 주세요.',
      },
      STEP_LOCKED_BY_RUNNING_STEP: {
        status: 409,
        message: '{단계}가 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.',
      },
      KEYWORD_NOT_FOUND: { status: 404, message: '키워드를 찾을 수 없습니다.' },
      KEYWORD_NOT_SELECTED: {
        status: 409,
        message: '키워드 화면에서 고른 키워드만 후보로 만들 수 있습니다.',
      },
      KEYWORD_EXCLUDED: { status: 409, message: '아동화로 빠진 키워드는 고를 수 없습니다.' },
      RAKUTEN_QUERY_INVALID: {
        status: 422,
        message: '라쿠텐 검색어 형식이 맞지 않습니다(반각 128자 이내, 너무 짧은 단어 없이).',
      },
      RAKUTEN_ITEM_NOT_FOUND: { status: 404, message: '읽어 온 라쿠텐 상품을 찾을 수 없습니다.' },
    };
    for (const [code, def] of Object.entries(expected)) {
      expect(ERROR_CODES[code as keyof typeof ERROR_CODES]).toEqual(def);
    }
    expect(formatErrorMessage('STEP_LOCKED_BY_RUNNING_STEP', { 단계: '③ 판정' })).toBe(
      '③ 판정이 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.',
    );
    expect(formatErrorMessage('STEP_LOCKED_BY_RUNNING_STEP', { 단계: '⑥-2 원산지·소재' })).toMatch(
      /^⑥-2 원산지·소재가 실행 중이라/,
    );
    expect(formatErrorMessage('CANDIDATE_STATUS_INVALID', { 상태: '검증완료' })).toBe(
      '지금 후보 상태(검증완료)에서는 할 수 없습니다.',
    );
  });

  it('P1-05 단계 실행 코드는 05-3 §5.1 문구·상태 그대로다', () => {
    const expected: Record<string, { status: number; message: string }> = {
      STEP_RUN_NOT_FOUND: { status: 404, message: '실행 기록을 찾을 수 없습니다.' },
      STEP_OUTPUT_NOT_FOUND: { status: 404, message: '아직 {단계}를 실행하지 않았습니다.' },
      INVALID_STEP_CODE: { status: 422, message: '이 단계는 여기서 실행하거나 고칠 수 없습니다.' },
      TEMP_CANDIDATE_NOT_ALLOWED: {
        status: 409,
        message: '임시 후보는 업로드·등록할 수 없습니다. 먼저 라쿠텐 상품에 연결해 주세요.',
      },
      STEP_START_CONDITION_UNMET: {
        status: 409,
        message: '시작에 필요한 값이 없습니다: {빠진 입력}.',
      },
      STEP_ALREADY_RUNNING: { status: 409, message: '이 단계가 이미 실행 중입니다.' },
      STEP_NOT_COMPLETED: {
        status: 409,
        message: '{단계}가 아직 완료되지 않았습니다(지금: {상태}).',
      },
      STEP_NOT_RERUN_REQUIRED: {
        status: 409,
        message: "'재실행 필요' 상태인 단계에서만 할 수 있습니다.",
      },
      STEP_RUN_NOT_WAITING_INPUT: {
        status: 409,
        message: '이 실행은 입력을 기다리고 있지 않습니다. 바꾸려면 다시 실행하거나 수정해 주세요.',
      },
      STEP_RUN_ALREADY_CURRENT: { status: 409, message: '이미 지금 쓰고 있는 버전입니다.' },
      VERSION_NOT_CURRENT: {
        status: 409,
        message: '화면을 연 뒤 값이 바뀌었습니다. 새로 고친 뒤 다시 해 주세요.',
      },
      KEEP_AS_IS_NOT_ALLOWED: {
        status: 422,
        message: "'그대로 유지'는 ⑥-1 카피에서만 쓸 수 있습니다.",
      },
      FIELD_NOT_EDITABLE: { status: 422, message: '이 항목은 직접 고칠 수 없습니다.' },
      GATE_NOT_PASSED: { status: 409, message: '{게이트}를 먼저 통과해 주세요.' },
      CONTINUOUS_RUN_BEFORE_G2: {
        status: 409,
        message:
          '소싱 확정(G2) 전에는 ②·③부터만 연속 실행할 수 있습니다. 다른 단계는 하나씩 실행해 주세요.',
      },
    };
    for (const [code, def] of Object.entries(expected)) {
      expect(ERROR_CODES[code as keyof typeof ERROR_CODES]).toEqual(def);
    }
  });

  it('P1-06 연속 실행·게이트 코드는 05-3 §5.1 문구·상태 그대로다', () => {
    const expected: Record<string, { status: number; message: string }> = {
      CONTINUOUS_RUN_NOT_FOUND: { status: 404, message: '연속 실행 기록을 찾을 수 없습니다.' },
      CONTINUOUS_RUN_ALREADY_OPEN: {
        status: 409,
        message: '이 후보의 연속 실행이 이미 진행 중입니다.',
      },
      NO_RERUN_REQUIRED_STEPS: { status: 409, message: '다시 실행할 단계가 없습니다.' },
      INVALID_GATE_CODE: {
        status: 422,
        message: '여기서는 G2·G3만 통과할 수 있습니다. 최종 승인은 승인 화면에서 해 주세요.',
      },
      NOT_SALE_CANDIDATE: {
        status: 409,
        message: "판정 결과가 '판매 후보 아님'이라 소싱 확정을 할 수 없습니다.",
      },
      NO_COMPARISON_NOT_CONFIRMED: {
        status: 409,
        message: "비교하지 않은 URL 후보입니다. '비교 없이 확정'을 체크해 주세요.",
      },
      AI_ENGINE_UNAVAILABLE: {
        status: 409,
        message:
          "선택한 AI 엔진({엔진})을 지금 쓸 수 없습니다({사유}). 'AI 엔진' 설정에서 확인해 주세요.",
      },
    };
    for (const [code, def] of Object.entries(expected)) {
      expect(ERROR_CODES[code as keyof typeof ERROR_CODES]).toEqual(def);
    }
  });

  it('P1-11 AI 엔진 설정 코드는 05-3 §5.1 문구·상태 그대로다', () => {
    expect(ERROR_CODES.AI_ENGINE_NOT_VERIFIED).toEqual({
      status: 409,
      message:
        '{엔진}({모델})으로 연결 테스트를 먼저 통과해 주세요. 통과한 지 10분이 지났으면 다시 해 주세요.',
    });
    expect(ERROR_CODES.AI_MODEL_INVALID).toEqual({
      status: 422,
      message: '{엔진}에서 쓸 수 없는 모델입니다: {모델}.',
    });
    expect(
      formatErrorMessage('AI_ENGINE_NOT_VERIFIED', {
        엔진: 'Antigravity CLI',
        모델: 'gemini-3.8-flash-medium',
      }),
    ).toBe(
      'Antigravity CLI(gemini-3.8-flash-medium)으로 연결 테스트를 먼저 통과해 주세요. 통과한 지 10분이 지났으면 다시 해 주세요.',
    );
    expect(formatErrorMessage('ALREADY_IN_PROGRESS', { 작업: 'AI 엔진 점검' })).toBe(
      'AI 엔진 점검이 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
    );
  });

  it('P1-07 비밀정보·인증 코드는 05-3 §5.1 문구·상태 그대로다', () => {
    const expected: Record<string, { status: number; message: string }> = {
      SECRET_NOT_CONFIGURED: {
        status: 409,
        message: '{키 이름}이 아직 없습니다. 시스템 상태 화면에서 넣어 주세요.',
      },
      SECRET_KEY_UNKNOWN: { status: 404, message: '알 수 없는 키 이름입니다.' },
      KEYCHAIN_UNAVAILABLE: {
        status: 503,
        message: 'macOS 키체인을 열 수 없습니다. 키체인 접근을 허용한 뒤 다시 해 주세요.',
      },
      COMMERCE_AUTH_FAILED: {
        status: 502,
        message:
          '네이버 커머스API 인증에 실패했습니다({원인}). 시스템 상태 화면의 안내를 따라 주세요.',
      },
      EXTERNAL_API_ERROR: {
        status: 502,
        message: '{대상} 응답을 받지 못했습니다({사유}). 잠시 뒤 다시 해 주세요.',
      },
    };
    for (const [code, def] of Object.entries(expected)) {
      expect(ERROR_CODES[code as keyof typeof ERROR_CODES]).toEqual(def);
    }
    expect(
      formatErrorMessage('SECRET_NOT_CONFIGURED', { '키 이름': '커머스API client_id 키' }),
    ).toBe('커머스API client_id 키가 아직 없습니다. 시스템 상태 화면에서 넣어 주세요.');
  });

  it('P1-08 메타 동기화 코드는 05-3 §5.1 문구·상태 그대로다', () => {
    expect(ERROR_CODES.ALREADY_IN_PROGRESS).toEqual({
      status: 409,
      message: '{작업}이 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
    });
    expect(ERROR_CODES.COMMERCE_META_NOT_SYNCED).toEqual({
      status: 409,
      message:
        "네이버 {카테고리·원산지} 정보가 아직 없습니다. 시스템 상태에서 '지금 동기화'를 눌러 주세요.",
    });
    expect(formatErrorMessage('ALREADY_IN_PROGRESS', { 작업: '메타데이터 동기화' })).toBe(
      '메타데이터 동기화가 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
    );
    expect(formatErrorMessage('COMMERCE_META_NOT_SYNCED', { '카테고리·원산지': '원산지' })).toBe(
      "네이버 원산지 정보가 아직 없습니다. 시스템 상태에서 '지금 동기화'를 눌러 주세요.",
    );
  });

  it('P1-09 프로필 코드는 05-3 §5.1 문구·상태 그대로다(반품 택배사 404는 Proposed)', () => {
    expect(ERROR_CODES.ADDRESSBOOK_NOT_FOUND).toEqual({
      status: 404,
      message: '주소록 항목을 찾을 수 없습니다.',
    });
    expect(ERROR_CODES.ADDRESS_NOT_OVERSEAS).toEqual({
      status: 422,
      message: '해외 출고지 주소가 아닙니다.',
    });
    expect(ERROR_CODES.DELIVERY_COMPANY_NOT_ALLOWED).toEqual({
      status: 422,
      message: '쓸 수 없는 발송 택배사입니다.',
    });
    expect(ERROR_CODES.RETURN_DELIVERY_COMPANY_NOT_FOUND.status).toBe(404);
  });

  it("조사 '을/를'·'은/는'도 받침에 맞춘다(한글이 아니면 문구 그대로)", () => {
    expect(formatErrorMessage('GATE_NOT_PASSED', { 게이트: 'G3 썸네일 선택' })).toBe(
      'G3 썸네일 선택을 먼저 통과해 주세요.',
    );
    expect(formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: '② 소싱' })).toBe(
      '아직 ② 소싱을 실행하지 않았습니다.',
    );
    expect(formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: '⑦ 태그' })).toBe(
      '아직 ⑦ 태그를 실행하지 않았습니다.',
    );
    expect(formatErrorMessage('GATE_NOT_PASSED', { 게이트: 'G3' })).toBe(
      'G3를 먼저 통과해 주세요.',
    );
  });

  it('P2-01 키워드 코드 8개는 05-3 §5.1 문구·상태 그대로다', () => {
    const expected: Record<string, { status: number; message: string }> = {
      KEYWORD_NOT_FOUND: { status: 404, message: '키워드를 찾을 수 없습니다.' },
      KEYWORD_SNAPSHOT_NOT_FOUND: { status: 404, message: '키워드 수집 결과를 찾을 수 없습니다.' },
      KEYWORD_NOT_SELECTED: {
        status: 409,
        message: '키워드 화면에서 고른 키워드만 후보로 만들 수 있습니다.',
      },
      KEYWORD_EXCLUDED: { status: 409, message: '아동화로 빠진 키워드는 고를 수 없습니다.' },
      KEYWORD_IN_USE: {
        status: 409,
        message: '이 키워드로 만든 후보가 있어 선택을 취소할 수 없습니다.',
      },
      CHILD_TERM_ALREADY_EXISTS: { status: 409, message: '이미 있는 아동 단어입니다.' },
      IMPORT_PARSE_FAILED: {
        status: 422,
        message: '파일(또는 붙여 넣은 글)에서 필요한 열이나 형식을 찾지 못했습니다.',
      },
      IMPORT_EMPTY: { status: 422, message: '읽을 수 있는 줄이 없습니다.' },
    };
    for (const [code, value] of Object.entries(expected)) {
      expect(ERROR_CODES[code as keyof typeof ERROR_CODES]).toEqual(value);
    }
    expect(formatErrorMessage('ALREADY_IN_PROGRESS', { 작업: '데이터랩 수집' })).toBe(
      '데이터랩 수집이 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
    );
  });

  it('P3-01 썸네일 코드 3개는 05-3 §5.1 문구·상태 그대로다', () => {
    expect(ERROR_CODES.NO_PERSON_CONFIRMATION_REQUIRED).toEqual({
      status: 422,
      message: "'사람·얼굴 없음'을 체크해 주세요.",
    });
    expect(ERROR_CODES.IMAGE_COUNT_INVALID).toEqual({
      status: 422,
      message: '고른 이미지 수가 맞지 않습니다(레퍼런스 1~3장, 추가이미지 9장까지).',
    });
    expect(ERROR_CODES.IMAGE_NOT_ALLOWED).toEqual({
      status: 422,
      message: '이 이미지는 여기에 쓸 수 없습니다({이유}).',
    });
    expect(formatErrorMessage('IMAGE_NOT_ALLOWED', { 이유: '다른 상품의 원본' })).toBe(
      '이 이미지는 여기에 쓸 수 없습니다(다른 상품의 원본).',
    );
  });

  it('P3-02 썸네일 생성·G3 코드 5개는 05-3 §5.1 문구·상태 그대로다', () => {
    const expected: Record<string, { status: number; message: string }> = {
      GENERATION_RUN_NOT_FOUND: { status: 404, message: '썸네일 생성 기록을 찾을 수 없습니다.' },
      REFERENCES_NOT_CONFIRMED: {
        status: 409,
        message: "레퍼런스 컷을 고르고 '사람·얼굴 없음'을 체크해 주세요.",
      },
      REAL_PERSON_NAME_BLOCKED: {
        status: 422,
        message: '프롬프트에 실존 인물 이름({단어})이 있어 만들 수 없습니다.',
      },
      CHECKLIST_INCOMPLETE: { status: 422, message: '체크리스트를 모두 확인해 주세요.' },
      SAME_PRODUCT_COLOR_CONFIRMATION_REQUIRED: {
        status: 422,
        message: "다른 상품·색상의 레퍼런스를 썼습니다. '같은 상품·색상'을 확인해 주세요.",
      },
    };
    for (const [code, value] of Object.entries(expected)) {
      expect(ERROR_CODES[code as keyof typeof ERROR_CODES]).toEqual(value);
    }
    expect(formatErrorMessage('REAL_PERSON_NAME_BLOCKED', { 단어: 'BTS' })).toBe(
      '프롬프트에 실존 인물 이름(BTS)이 있어 만들 수 없습니다.',
    );
  });

  it('P3-03 콘텐츠 코드 2개는 05-3 §5.1 문구·상태 그대로다', () => {
    expect(ERROR_CODES.EVIDENCE_URL_REQUIRED).toEqual({
      status: 422,
      message: '원산지는 근거 주소와 함께 넣어 주세요.',
    });
    expect(ERROR_CODES.ORIGIN_COUNTRY_UNKNOWN).toEqual({
      status: 422,
      message: '원산지 목록에서 찾을 수 없는 나라입니다.',
    });
  });

  it('P3-04 ⑥-3 코드 2개는 05-3 §5.1 문구·상태 그대로다', () => {
    expect(ERROR_CODES.PROFILE_INCOMPLETE).toEqual({
      status: 409,
      message: '구매대행 프로필에 빈칸({항목})이 있습니다. 설정에서 채워 주세요.',
    });
    expect(ERROR_CODES.ORIGIN_CODE_NOT_ALLOWED).toEqual({
      status: 422,
      message: '사양 블록에 실제 나라 표기가 없어 이 원산지 코드를 쓸 수 없습니다.',
    });
    expect(formatErrorMessage('PROFILE_INCOMPLETE', { 항목: '수입자' })).toBe(
      '구매대행 프로필에 빈칸(수입자)이 있습니다. 설정에서 채워 주세요.',
    );
  });

  it('P3-05 ⑦ 코드 2개는 05-3 §5.1 문구·상태 그대로다(가져오기 코드는 P2-01·P2-04가 이미 더했다)', () => {
    expect(ERROR_CODES.COMPETITOR_INPUT_NOT_FOUND).toEqual({
      status: 404,
      message: '경쟁 태그 입력을 찾을 수 없습니다.',
    });
    expect(ERROR_CODES.FINAL_TAG_LIMIT_EXCEEDED).toEqual({
      status: 422,
      message: '최종 태그는 10개까지입니다. 하나를 지운 뒤 넣어 주세요.',
    });
    expect(ERROR_CODES.IMPORT_EMPTY.status).toBe(422);
    expect(ERROR_CODES.IMPORT_PARSE_FAILED.status).toBe(422);
    expect(ERROR_CODES.UNSUPPORTED_FILE_TYPE.status).toBe(422);
    expect(ERROR_CODES.PAYLOAD_TOO_LARGE.status).toBe(413);
  });

  it('formatErrorMessage는 {…} 자리를 채우고 모르는 자리는 그대로 둔다', () => {
    expect(formatErrorMessage('DAILY_LIMIT_REACHED', { 대상: '라쿠텐 상품 페이지', n: 110 })).toBe(
      '오늘 라쿠텐 상품 페이지 조회 한도(110건)를 다 썼습니다. 내일 0시(한국 시간)에 다시 됩니다.',
    );
    expect(formatErrorMessage('EXTERNAL_CALL_COOLDOWN', { 대상: '데이터랩', 시각: 'X' })).toMatch(
      /^데이터랩이 요청을 막아 X까지/,
    );
    expect(
      formatErrorMessage('EXTERNAL_CALL_COOLDOWN', { 대상: '라쿠텐 상품 페이지', 시각: 'X' }),
    ).toMatch(/^라쿠텐 상품 페이지가 요청을 막아/);
    expect(formatErrorMessage('EXTERNAL_API_ERROR', { 대상: '데이터랩' })).toBe(
      '데이터랩 응답을 받지 못했습니다({사유}). 잠시 뒤 다시 해 주세요.',
    );
  });
});

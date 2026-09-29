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

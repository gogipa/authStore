import {
  BadRequestException,
  type ArgumentsHost,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { ApiException } from './api.exception.js';
import { formatTimestamp } from './error-response.js';

function mockHost(url = '/api/v1/x') {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ url, originalUrl: url }),
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  // 500 로그를 테스트 출력에서 숨긴다(ESM 모드라 jest.spyOn 대신 직접 바꾼다)
  const originalError = Logger.prototype.error;
  beforeAll(() => {
    Logger.prototype.error = () => undefined;
  });
  afterAll(() => {
    Logger.prototype.error = originalError;
  });

  it('ApiException은 코드·상태·fieldErrors·details를 그대로 봉투에 담는다', () => {
    const { host, res } = mockHost('/api/v1/candidates?x=1');
    filter.catch(
      new ApiException('VALIDATION_FAILED', {
        fieldErrors: [{ field: 'name', message: 'name must be a string', rejectedValue: 1 }],
        details: { stepCode: 'PRICING' },
      }),
      host,
    );
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: '입력값을 확인해 주세요.',
      status: 422,
      path: '/api/v1/candidates?x=1',
      fieldErrors: [{ field: 'name', message: 'name must be a string', rejectedValue: 1 }],
      details: { stepCode: 'PRICING' },
    });
  });

  it('빈 fieldErrors·details는 봉투에서 뺀다', () => {
    const { host, res } = mockHost();
    filter.catch(new ApiException('HOST_NOT_ALLOWED'), host);
    expect(Object.keys(res.body as object).sort()).toEqual(
      ['code', 'message', 'path', 'status', 'timestamp'].sort(),
    );
  });

  it.each([
    [new NotFoundException('Cannot GET /x'), 404, 'ROUTE_NOT_FOUND'],
    [new BadRequestException('Unexpected token'), 400, 'MALFORMED_REQUEST'],
    [new PayloadTooLargeException(), 413, 'PAYLOAD_TOO_LARGE'],
    [new InternalServerErrorException(), 500, 'INTERNAL_ERROR'],
    [new Error('db password=secret leaked?'), 500, 'INTERNAL_ERROR'],
    ['string thrown', 500, 'INTERNAL_ERROR'],
  ])('%p → %i %s', (exception, status, code) => {
    const { host, res } = mockHost();
    filter.catch(exception, host);
    expect(res.statusCode).toBe(status);
    expect(res.body).toMatchObject({ code, status });
  });

  it('예상 못 한 오류의 내부 메시지는 응답에 넣지 않는다', () => {
    const { host, res } = mockHost();
    filter.catch(new Error('db password=secret'), host);
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect((res.body as { message: string }).message).toBe(
      '앱 안에서 오류가 났습니다. 다시 해 보고, 계속되면 로그를 확인해 주세요.',
    );
  });
});

describe('formatTimestamp', () => {
  it('지역 오프셋을 붙인 초 단위 ISO 8601', () => {
    expect(formatTimestamp(new Date('2026-09-27T05:02:11.500Z'))).toMatch(
      /^2026-09-2\dT\d{2}:02:11[+-]\d{2}:\d{2}$/,
    );
  });
});

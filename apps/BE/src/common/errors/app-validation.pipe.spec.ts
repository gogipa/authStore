import { IsInt, IsString, Min } from 'class-validator';
import { ApiException } from './api.exception.js';
import { AppValidationPipe } from './app-validation.pipe.js';

class BodyDto {
  @IsString()
  name!: string;
}

class QueryDto {
  @IsInt()
  @Min(0)
  page!: number;
}

describe('AppValidationPipe', () => {
  const pipe = new AppValidationPipe();

  it('본문 검증 실패는 422 VALIDATION_FAILED + fieldErrors', async () => {
    const err = await pipe
      .transform({ name: 1 }, { type: 'body', metatype: BodyDto })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiException);
    const e = err as ApiException;
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.getStatus()).toBe(422);
    expect(e.fieldErrors).toEqual([
      { field: 'name', message: 'name must be a string', rejectedValue: 1 },
    ]);
  });

  it('정의하지 않은 필드는 거부한다(forbidNonWhitelisted)', async () => {
    const err = (await pipe
      .transform({ name: 'a', extra: true }, { type: 'body', metatype: BodyDto })
      .catch((e: unknown) => e)) as ApiException;
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fieldErrors?.[0]?.field).toBe('extra');
  });

  it('쿼리 검증 실패는 422 INVALID_QUERY_PARAMETER', async () => {
    const err = (await pipe
      .transform({ page: -1 }, { type: 'query', metatype: QueryDto })
      .catch((e: unknown) => e)) as ApiException;
    expect(err.code).toBe('INVALID_QUERY_PARAMETER');
    expect(err.getStatus()).toBe(422);
  });

  it('통과하면 DTO 인스턴스로 바꾼다(transform)', async () => {
    const out = await pipe.transform({ name: 'ok' }, { type: 'body', metatype: BodyDto });
    expect(out).toBeInstanceOf(BodyDto);
  });
});

import {
  type ArgumentMetadata,
  Injectable,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import { ApiException } from './api.exception.js';
import type { FieldError } from './error-response.js';

/** `@OmitRejectedValue()`를 단 DTO 표시(메타데이터 키) */
const OMIT_REJECTED_VALUE = Symbol('omitRejectedValue');

/**
 * 이 본문 DTO의 검증 오류에는 `rejectedValue`를 넣지 않는다(비밀값이 응답에 돌아가지 않게, 05-2 saveSecret).
 * 정의 밖 필드(forbidNonWhitelisted)의 값도 넣지 않는다.
 */
export function OmitRejectedValue(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(OMIT_REJECTED_VALUE, true, target);
  };
}

export function omitsRejectedValue(metatype: unknown): boolean {
  return (
    typeof metatype === 'function' && Reflect.getMetadata(OMIT_REJECTED_VALUE, metatype) === true
  );
}

class ValidationErrors extends Error {
  constructor(readonly fieldErrors: FieldError[]) {
    super('validation failed');
  }
}

/** class-validator 오류를 05-2 FieldError 목록으로 편다(중첩은 a.b.c). */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  const out: FieldError[] = [];
  for (const e of errors) {
    const field = parent ? `${parent}.${e.property}` : e.property;
    for (const message of Object.values(e.constraints ?? {})) {
      out.push({ field, message, rejectedValue: e.value });
    }
    if (e.children && e.children.length > 0)
      out.push(...flattenValidationErrors(e.children, field));
  }
  return out;
}

/**
 * 전역 ValidationPipe(whitelist·forbidNonWhitelisted·transform).
 * 본문 검증 실패는 422 VALIDATION_FAILED, 쿼리 검증 실패는 422 INVALID_QUERY_PARAMETER(05-3).
 */
@Injectable()
export class AppValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => new ValidationErrors(flattenValidationErrors(errors)),
    });
  }

  override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    try {
      return (await super.transform(value, metadata)) as unknown;
    } catch (e) {
      if (e instanceof ValidationErrors) {
        const fieldErrors = omitsRejectedValue(metadata.metatype)
          ? e.fieldErrors.map(({ field, message }) => ({ field, message }))
          : e.fieldErrors;
        throw new ApiException(
          metadata.type === 'query' ? 'INVALID_QUERY_PARAMETER' : 'VALIDATION_FAILED',
          { fieldErrors },
        );
      }
      throw e;
    }
  }
}

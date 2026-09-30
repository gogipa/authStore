import type { PipeTransform } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import type { ErrorCode } from '../../common/errors/error-codes.js';

/** DB id(int4) 최댓값 */
const MAX_ID = 2_147_483_647;

/** 경로 id: 1 이상 정수 글자만. 아니면 null */
export function parseSourcingId(raw: unknown): number | null {
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text === 'string' && /^[1-9]\d{0,9}$/.test(text)) {
    const id = Number(text);
    if (id <= MAX_ID) return id;
  }
  return null;
}

/** 경로 id 파이프: 정수가 아니면 그 자원의 404(05-2 응답 목록에 422가 없다 — P1-01 이미지 id와 같은 규칙) */
export class NotFoundIdPipe implements PipeTransform<unknown, number> {
  constructor(private readonly code: ErrorCode) {}

  transform(value: unknown): number {
    const id = parseSourcingId(value);
    if (id === null) throw new ApiException(this.code);
    return id;
  }
}

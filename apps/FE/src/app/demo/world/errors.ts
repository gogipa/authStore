import type { StepCode } from '@/shared/lib/steps';

/** 05-3 오류 봉투에 더 실을 것 */
export interface DemoErrorExtra {
  details?: Record<string, unknown>;
  fieldErrors?: { field: string; message: string; rejectedValue?: unknown }[];
}

/**
 * 따라 하기 모델(D-32)이 실제 BE와 같은 오류로 답할 때 던진다. 코드·문구는 BE(`common/errors/error-codes.ts`)의 글을 그대로 쓴다.
 * 라우터가 05-3 봉투(`{code, message, status, timestamp, path, fieldErrors?, details?}`)로 바꿔 응답한다.
 */
export class DemoHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: DemoErrorExtra;

  constructor(status: number, code: string, message: string, extra: DemoErrorExtra = {}) {
    super(message);
    this.name = 'DemoHttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const httpError = (
  status: number,
  code: string,
  message: string,
  extra?: DemoErrorExtra,
): DemoHttpError => new DemoHttpError(status, code, message, extra);

/** 화면 위반 422 `VALIDATION_FAILED` + 칸 오류 */
export const validationFailed = (
  field: string,
  message: string,
  rejectedValue?: unknown,
): DemoHttpError =>
  httpError(422, 'VALIDATION_FAILED', '입력값을 확인해 주세요.', {
    fieldErrors: [{ field, message, ...(rejectedValue === undefined ? {} : { rejectedValue }) }],
  });

/** BE 메시지에 들어가는 단계 이름(`formatErrorMessage`의 {단계}) */
export const STEP_LABEL: Readonly<Record<StepCode, string>> = {
  SOURCING: '② 소싱',
  PRICING: '③ 판정',
  CATEGORY: '④ 카테고리',
  THUMBNAIL: '⑤ 썸네일',
  COPY: '⑥-1 카피',
  NOTICE_RAW: '⑥-2 원산지·소재',
  NOTICE_HTML: '⑥-3 고시·HTML',
  TAGS: '⑦ 태그',
  UPLOAD: '⑧ 이미지 업로드',
  REGISTER: '⑨ 등록',
};

/** 단계 상태 글자(BE `STEP_NOT_COMPLETED` 문구의 '지금: …') */
export const STEP_STATUS_TEXT: Readonly<Record<string, string>> = {
  NOT_RUN: '미실행',
  RUNNING: '실행중',
  WAITING_INPUT: '입력 대기',
  COMPLETED: '완료',
  FAILED: '실패',
  RERUN_REQUIRED: '재실행 필요',
};

/** `{이름}이/가` 조사 맞춤: 끝 글자가 한글이면 받침으로, 아니면 '가'(BE `formatErrorMessage`와 같다) */
export function withSubject(name: string): string {
  const last = name.charCodeAt(name.length - 1);
  const isHangul = last >= 0xac00 && last <= 0xd7a3;
  if (!isHangul) return `${name}가`;
  return `${name}${(last - 0xac00) % 28 === 0 ? '가' : '이'}`;
}

/** `{이름}을/를` 조사 맞춤 */
export function withObject(name: string): string {
  const last = name.charCodeAt(name.length - 1);
  const isHangul = last >= 0xac00 && last <= 0xd7a3;
  if (!isHangul) return `${name}를`;
  return `${name}${(last - 0xac00) % 28 === 0 ? '를' : '을'}`;
}

export const candidateNotFound = () =>
  httpError(404, 'CANDIDATE_NOT_FOUND', '여정을 찾을 수 없습니다.');

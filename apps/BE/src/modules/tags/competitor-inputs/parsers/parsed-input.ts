import { findPersonalValues } from '../../../../common/safety/safety-rules.js';
import { TAG_TEXT_MAX } from '../../pipeline/normalize.js';

/**
 * 경쟁 태그 파서 공통(F-TG-02~05, TG-01, CON-09, P3-05 규칙 3·4). 파서는 **태그·순위·네이버 상품 ID·빈도만** 돌려준다 — 붙여
 * 넣은 원본·파일 이름·Cookie·Authorization·판매자 연락처는 결과 객체에 담지 않고(키 목록이 아래 넷뿐), 로그·오류 응답에도 넣지
 * 않는다(오류는 행·열 위치만). 결과 객체는 `tag_competitor_input`·`tag_competitor_item`에 그대로 들어간다.
 */
export interface ParsedCompetitorTag {
  /** 태그 1개(정규화 전 — 앞뒤 공백만 뺀다, 100자 이하) */
  tagText: string;
  /** 입력원이 준 순위(1 이상) */
  sourceRank: number | null;
  /** 태그를 쓴 경쟁 상품 ID(숫자 글자, 20자 이하) */
  naverProductId: string | null;
  /** 입력원이 준 빈도(1 이상, 빈도 열이 있는 입력만) */
  frequency: number | null;
}

export interface ParsedCompetitorInput {
  /** 빈도 열을 찾았는지(M0 S5 전 — 파서가 빈도 열을 찾았는지로 정한다, x-decision §7.4-34) */
  hasFrequency: boolean;
  tags: ParsedCompetitorTag[];
}

export type CompetitorParseErrorCode =
  'IMPORT_PARSE_FAILED' | 'IMPORT_EMPTY' | 'UNSUPPORTED_FILE_TYPE';

/** 위치만 담은 오류 줄(값은 담지 않는다 — 원본이 응답·로그에 남지 않게) */
export interface ParseFieldError {
  field: string;
  message: string;
}

/** 파서 실패. 서비스가 같은 코드의 ApiException(422)으로 바꾼다 */
export class CompetitorParseError extends Error {
  constructor(
    readonly code: CompetitorParseErrorCode,
    readonly fieldErrors: ParseFieldError[] = [],
  ) {
    super(code);
    this.name = 'CompetitorParseError';
  }
}

/** 오류 위치는 앞 50건까지(P2-01·P2-04와 같다) */
export const MAX_PARSE_ERRORS = 50;

export function emptyInput(): never {
  throw new CompetitorParseError('IMPORT_EMPTY');
}

/** 태그로 받지 않는 글: 비었거나 개인 값 모양(이메일·전화·사업자번호 — 판매자 연락처, CON-09) */
export function isDroppedTag(text: string): boolean {
  return text.length === 0 || findPersonalValues(text).length > 0;
}

/** 결과 한 줄(키 넷만) */
export function tagRow(
  tagText: string,
  sourceRank: number | null,
  naverProductId: string | null,
  frequency: number | null,
): ParsedCompetitorTag {
  return { tagText, sourceRank, naverProductId, frequency };
}

export { TAG_TEXT_MAX };

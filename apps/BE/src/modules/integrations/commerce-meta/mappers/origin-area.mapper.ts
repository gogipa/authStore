import {
  clip,
  isObject,
  listOf,
  MetaMappingError,
  requiredText,
  textOf,
  uniqueBy,
} from './mapper-utils.js';

/** commerce_origin_area 한 줄 */
export interface OriginAreaRow {
  /** 원산지 코드(varchar(20)) */
  originAreaCode: string;
  name: string;
  /** 상위 코드(sub-origin-areas 계층). 맨 위는 null */
  parentCode: string | null;
}

const LIST_KEYS = ['originAreaCodeNames', 'originAreas', 'contents', 'content'] as const;

/**
 * 원산지 코드 목록 → 행(R04 F13). 응답은 `{ originAreaCodeNames: [{ code, name }] }` 또는 최상위 배열로 본다(M0 S3 전 추정).
 * 하위 목록(`sub-origin-areas?code=`)이면 `parentCode`에 그 상위 코드를 준다. 항목에 `parentCode` 칸이 있으면 그것을 쓴다.
 */
export function mapOriginAreas(data: unknown, parentCode: string | null): OriginAreaRow[] {
  const items = listOf(data, LIST_KEYS, '원산지 코드');
  const rows = items.map((item): OriginAreaRow => {
    if (!isObject(item)) throw new MetaMappingError('원산지 코드 항목이 객체가 아닙니다.');
    const code = requiredText(item, ['code', 'originAreaCode'], '원산지 코드 항목', 20);
    const ownParent = textOf(item, ['parentCode', 'parentOriginAreaCode']);
    const parent = ownParent ?? parentCode;
    if (parent !== null && parent.length > 20) {
      throw new MetaMappingError('원산지 코드 항목의 parentCode 값이 20자를 넘습니다.');
    }
    return {
      originAreaCode: code,
      name: clip(requiredText(item, ['name', 'originAreaName'], '원산지 코드 항목', 10_000), 100),
      parentCode: parent === code ? null : parent,
    };
  });
  return uniqueBy(rows, (r) => r.originAreaCode);
}

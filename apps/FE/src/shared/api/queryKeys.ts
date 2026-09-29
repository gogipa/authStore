import type { operations } from './schema';

/**
 * queryKey 규약(03-2 §6.2): `[태그, operationId, 파라미터?]`.
 * 태그는 05-2 OpenAPI 태그 그대로(= features 폴더 이름, 03-2 §3). operationId는 schema.d.ts의 연산 이름이라
 * 명세에 없는 이름을 쓰면 타입 오류가 난다. 태그 단위·연산 단위로 무효화할 수 있다.
 */
export const API_TAGS = [
  'step-engine',
  'keywords',
  'sourcing',
  'pricing',
  'category',
  'thumbnails',
  'content',
  'tags',
  'registration',
  'products',
  'dashboard',
  'settings',
  'system',
  'integrations',
  'common',
] as const;

export type ApiTag = (typeof API_TAGS)[number];
export type OperationId = keyof operations;
export type QueryKeyParams = Readonly<Record<string, unknown>>;

export function qk<T extends ApiTag, O extends OperationId>(
  tag: T,
  operationId: O,
): readonly [T, O];
export function qk<T extends ApiTag, O extends OperationId, const P extends QueryKeyParams>(
  tag: T,
  operationId: O,
  params: P,
): readonly [T, O, P];
export function qk(tag: ApiTag, operationId: OperationId, params?: QueryKeyParams) {
  return params === undefined
    ? ([tag, operationId] as const)
    : ([tag, operationId, params] as const);
}

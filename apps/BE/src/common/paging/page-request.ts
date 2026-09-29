import { ApiException } from '../errors/api.exception.js';
import type { FieldError } from '../errors/error-response.js';

/**
 * 목록·페이징 규약(05-1 §1.4, 05-3 §1). 요청 `page`(0부터)·`size`(기본 20, 최대 100)·`sort=필드,asc|desc`(여러 번),
 * 응답 `{ content[], page: { number, size, totalElements, totalPages } }`. 허용하지 않은 정렬은 422 INVALID_QUERY_PARAMETER.
 * 뒤 문서의 목록 API는 모두 이 파서와 `LIST_SORT_RULES`를 쓴다(경로를 더할 때 표에 한 줄 더한다).
 */

export const PAGE_DEFAULT_SIZE = 20;
export const PAGE_MAX_SIZE = 100;
/** 정렬 값 모양(05-2 components.parameters.Sort) */
export const SORT_PATTERN = /^[a-zA-Z]+,(asc|desc)$/;

export type SortDirection = 'asc' | 'desc';

export interface SortOrder<F extends string = string> {
  field: F;
  direction: SortDirection;
}

export interface SortRule<F extends string = string> {
  /** 허용 필드(05-3 §1 표 '`sort` 허용 필드') */
  fields: readonly F[];
  /** sort를 주지 않았을 때(05-3 §1 표 '기본 정렬') */
  defaultSort: readonly SortOrder<F>[];
}

function rule<F extends string>(fields: readonly F[], field: F, direction: SortDirection) {
  return { fields, defaultSort: [{ field, direction }] } satisfies SortRule<F>;
}

/**
 * 경로별 허용 정렬 필드·기본 정렬(05-3 §1 표의 M1 행 그대로). 키는 `/api/v1` 뒤 경로(05-1 표기).
 * 필터는 경로마다 요청 DTO가 검사한다.
 */
export const LIST_SORT_RULES = {
  '/candidates': rule(['statusChangedAt', 'createdAt', 'id'], 'statusChangedAt', 'desc'),
  '/candidate-steps': rule(['staleSince', 'updatedAt'], 'updatedAt', 'desc'),
  '/candidates/{candidateId}/steps/{stepCode}/runs': rule(['version'], 'version', 'desc'),
  '/candidates/{candidateId}/status-history': rule(['changedAt'], 'changedAt', 'desc'),
  '/candidates/{candidateId}/domestic-prices': rule(['enteredAt'], 'enteredAt', 'desc'),
  '/candidates/{candidateId}/registrations': rule(
    ['approvedAt', 'createdAt'],
    'approvedAt',
    'desc',
  ),
  '/keyword-snapshots': rule(['collectedAt'], 'collectedAt', 'desc'),
  '/keyword-snapshots/{keywordSnapshotId}/keywords': rule(['rank'], 'rank', 'asc'),
  '/commerce-categories': rule(['wholeCategoryName'], 'wholeCategoryName', 'asc'),
  '/commerce-origin-areas': rule(['name', 'originAreaCode'], 'name', 'asc'),
  '/commerce-addressbooks': rule(['name'], 'name', 'asc'),
  '/commerce-return-delivery-companies': rule(['name'], 'name', 'asc'),
  '/forwarder-rate-tables': rule(['importedAt'], 'importedAt', 'desc'),
  '/fx-rates': rule(['referenceAt', 'collectedAt'], 'referenceAt', 'desc'),
} as const satisfies Record<string, SortRule>;

export type ListPath = keyof typeof LIST_SORT_RULES;
export type SortFieldOf<P extends ListPath> = (typeof LIST_SORT_RULES)[P]['fields'][number];

export interface PageRequest<F extends string = string> {
  /** 0부터 */
  page: number;
  size: number;
  sort: SortOrder<F>[];
  /** DB offset(page × size) */
  skip: number;
  take: number;
}

/** 쿼리에서 받은 값(요청 DTO가 모양을 검사한 뒤, 또는 날것) */
export interface PageQueryInput {
  page?: unknown;
  size?: unknown;
  sort?: unknown;
}

function invalid(fieldErrors: FieldError[]): ApiException {
  return new ApiException('INVALID_QUERY_PARAMETER', { fieldErrors });
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function toList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * `page`·`size`·`sort`를 검사해 페이지 요청으로 바꾼다. 어긋나면 422 INVALID_QUERY_PARAMETER(fieldErrors에 칸).
 * - page: 0 이상 정수(기본 0) · size: 1~100 정수(기본 20)
 * - sort: `필드,asc|desc`. 허용 필드만, 같은 필드를 두 번 줄 수 없다. 없으면 경로의 기본 정렬.
 */
export function parsePageRequest<P extends ListPath>(
  path: P,
  query: PageQueryInput,
): PageRequest<SortFieldOf<P>> {
  const sortRule: SortRule<SortFieldOf<P>> = LIST_SORT_RULES[path];
  const errors: FieldError[] = [];

  let page = 0;
  if (query.page !== undefined) {
    const parsed = toInteger(query.page);
    if (parsed === null || parsed < 0) {
      errors.push({
        field: 'page',
        message: '0 이상의 정수여야 합니다.',
        rejectedValue: query.page,
      });
    } else {
      page = parsed;
    }
  }

  let size = PAGE_DEFAULT_SIZE;
  if (query.size !== undefined) {
    const parsed = toInteger(query.size);
    if (parsed === null || parsed < 1 || parsed > PAGE_MAX_SIZE) {
      errors.push({
        field: 'size',
        message: `1~${PAGE_MAX_SIZE} 사이의 정수여야 합니다.`,
        rejectedValue: query.size,
      });
    } else {
      size = parsed;
    }
  }

  const sort: SortOrder<SortFieldOf<P>>[] = [];
  const seen = new Set<string>();
  for (const raw of toList(query.sort)) {
    if (typeof raw !== 'string' || !SORT_PATTERN.test(raw)) {
      errors.push({
        field: 'sort',
        message: "'필드,asc' 또는 '필드,desc' 모양이어야 합니다.",
        rejectedValue: raw,
      });
      continue;
    }
    const [field, direction] = raw.split(',') as [string, SortDirection];
    if (!(sortRule.fields as readonly string[]).includes(field)) {
      errors.push({
        field: 'sort',
        message: `정렬할 수 없는 필드입니다. 쓸 수 있는 필드: ${sortRule.fields.join(', ')}`,
        rejectedValue: raw,
      });
      continue;
    }
    if (seen.has(field)) {
      errors.push({
        field: 'sort',
        message: '같은 필드를 두 번 줄 수 없습니다.',
        rejectedValue: raw,
      });
      continue;
    }
    seen.add(field);
    sort.push({ field, direction });
  }

  if (errors.length > 0) throw invalid(errors);
  return {
    page,
    size,
    sort: sort.length > 0 ? sort : [...sortRule.defaultSort],
    skip: page * size,
    take: size,
  };
}

/** 05-2 components.schemas.PageMeta */
export interface PageMeta {
  number: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

/** 05-1 §1.4 응답 봉투 `{ content, page }` */
export interface PageEnvelope<T> {
  content: T[];
  page: PageMeta;
}

export function toPageMeta(request: Pick<PageRequest, 'page' | 'size'>, total: number): PageMeta {
  return {
    number: request.page,
    size: request.size,
    totalElements: total,
    totalPages: total === 0 ? 0 : Math.ceil(total / request.size),
  };
}

export function toPage<T>(
  content: T[],
  request: Pick<PageRequest, 'page' | 'size'>,
  total: number,
): PageEnvelope<T> {
  return { content, page: toPageMeta(request, total) };
}

/** 메모리에서 한 페이지를 자른다(먼저 전부 걸러야 하는 목록: 입력 고르기 등) */
export function slicePage<T>(items: readonly T[], request: PageRequest): PageEnvelope<T> {
  return toPage(items.slice(request.skip, request.skip + request.take), request, items.length);
}

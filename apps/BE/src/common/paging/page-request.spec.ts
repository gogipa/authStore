import { ApiException } from '../errors/api.exception.js';
import { LIST_SORT_RULES, parsePageRequest, slicePage, toPageMeta } from './page-request.js';

function invalidFields(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiException);
    const err = e as ApiException;
    expect(err.code).toBe('INVALID_QUERY_PARAMETER');
    expect(err.getStatus()).toBe(422);
    return (err.fieldErrors ?? []).map((f) => f.field);
  }
  throw new Error('예외가 나지 않았습니다');
}

describe('parsePageRequest(05-1 §1.4, 05-3 §1)', () => {
  it('기본값: page 0 · size 20 · 경로의 기본 정렬', () => {
    const req = parsePageRequest('/candidates', {});
    expect(req).toEqual({
      page: 0,
      size: 20,
      sort: [{ field: 'statusChangedAt', direction: 'desc' }],
      skip: 0,
      take: 20,
    });
    expect(parsePageRequest('/candidate-steps', {}).sort).toEqual([
      { field: 'updatedAt', direction: 'desc' },
    ]);
    expect(parsePageRequest('/keyword-snapshots/{keywordSnapshotId}/keywords', {}).sort).toEqual([
      { field: 'rank', direction: 'asc' },
    ]);
  });

  it('문자열 쿼리 값을 받아 offset을 계산하고 여러 정렬을 순서대로 둔다', () => {
    const req = parsePageRequest('/candidates', {
      page: '2',
      size: '10',
      sort: ['createdAt,asc', 'id,desc'],
    });
    expect(req.skip).toBe(20);
    expect(req.take).toBe(10);
    expect(req.sort).toEqual([
      { field: 'createdAt', direction: 'asc' },
      { field: 'id', direction: 'desc' },
    ]);
  });

  it('size 101·0, page -1·문자, 허용 밖 정렬 필드, 모양이 틀린 정렬은 422 INVALID_QUERY_PARAMETER', () => {
    expect(invalidFields(() => parsePageRequest('/candidates', { size: '101' }))).toEqual(['size']);
    expect(invalidFields(() => parsePageRequest('/candidates', { size: 0 }))).toEqual(['size']);
    expect(invalidFields(() => parsePageRequest('/candidates', { page: '-1' }))).toEqual(['page']);
    expect(invalidFields(() => parsePageRequest('/candidates', { page: 'abc' }))).toEqual(['page']);
    expect(invalidFields(() => parsePageRequest('/candidates', { sort: 'foo,asc' }))).toEqual([
      'sort',
    ]);
    expect(invalidFields(() => parsePageRequest('/candidates', { sort: 'createdAt' }))).toEqual([
      'sort',
    ]);
    expect(
      invalidFields(() => parsePageRequest('/candidates', { sort: ['id,asc', 'id,desc'] })),
    ).toEqual(['sort']);
    // 다른 경로의 필드는 쓸 수 없다
    expect(
      invalidFields(() => parsePageRequest('/candidate-steps', { sort: 'statusChangedAt,desc' })),
    ).toEqual(['sort']);
  });

  it('M1 목록 경로의 허용 필드·기본 정렬은 05-3 §1 표와 같다', () => {
    expect(LIST_SORT_RULES['/candidates'].fields).toEqual(['statusChangedAt', 'createdAt', 'id']);
    expect(LIST_SORT_RULES['/candidate-steps'].fields).toEqual(['staleSince', 'updatedAt']);
    expect(LIST_SORT_RULES['/candidates/{candidateId}/status-history'].defaultSort).toEqual([
      { field: 'changedAt', direction: 'desc' },
    ]);
  });

  it('PageMeta: totalPages는 올림, 0건이면 0', () => {
    expect(toPageMeta({ page: 0, size: 20 }, 41)).toEqual({
      number: 0,
      size: 20,
      totalElements: 41,
      totalPages: 3,
    });
    expect(toPageMeta({ page: 0, size: 20 }, 0).totalPages).toBe(0);
    const req = parsePageRequest('/candidates', { page: 1, size: 2 });
    expect(slicePage([1, 2, 3, 4, 5], req)).toEqual({
      content: [3, 4],
      page: { number: 1, size: 2, totalElements: 5, totalPages: 3 },
    });
  });
});

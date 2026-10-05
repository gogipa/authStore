/** 쿼리 문자열 읽기 도우미(라우트가 쓴다) */
export const intOf = (value: string | null | undefined, fallback: number): number => {
  const n = value == null || value === '' ? NaN : Number(value);
  return Number.isInteger(n) ? n : fallback;
};

export const boolOf = (value: string | null): boolean | null =>
  value === 'true' ? true : value === 'false' ? false : null;

/** 여러 값 쿼리(status=A&status=B, 쉼표로 이은 값도) */
export const listOf = (query: URLSearchParams, name: string): string[] =>
  query
    .getAll(name)
    .flatMap((v) => v.split(','))
    .filter(Boolean);

export const pageQuery = (query: URLSearchParams, size = 20) => ({
  page: intOf(query.get('page'), 0),
  size: intOf(query.get('size'), size),
});

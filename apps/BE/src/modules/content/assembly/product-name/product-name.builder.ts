/**
 * 상품명 제안(P3-04 규칙 13, F-CT-32, US-17 AC2, PRD §8.5 CT-07 — D-11). 템플릿 `{브랜드} {시리즈} {모델명} {상품유형} {대표색상}
 * {성별}`, 100자 이내. 라쿠텐 상품명에 並行輸入品이 있으면 '병행'을 넣는다.
 *
 * 값의 출처(Proposed — 열린질문 P3-04 '② 입력·브랜드·시리즈 한국어 출처가 없다', 브랜드 사전은 M2):
 * - 브랜드·시리즈: 후보의 ① 선택 키워드(데이터랩 한국어 키워드, 예 `아식스 젤카야노14`)의 첫 낱말 = 브랜드, 나머지 = 시리즈.
 *   키워드가 없는 URL 후보는 ② 상품 속성 `ブランド`·`ブランド名`·`メーカー` 값(원문)을 브랜드로 두고 시리즈는 비운다
 * - 모델명: ② 고른 상품의 型番 원문(`rakuten_item.model_code`, 예 `1201A019-108`), 없으면 후보 앵커 型番
 * - 상품유형: ④ 리프 카테고리 경로의 마지막 조각(예 `러닝화`). ④ 전이면 뺀다(⑥-3의 선택 입력 — P1-05)
 * - 대표색상: ⑥-2 색상 한국어 표기의 첫 조각(`크림/블랙` → `크림`), 없으면 뺀다
 * - 성별: 후보 성별 `남성`·`여성`
 * - '병행': 맨 뒤(Proposed 위치)
 * 같은 낱말이 두 번 나오면 뒤의 것을 뺀다(제안이 반복 경고에 걸리지 않게). 100자를 넘으면 낱말 단위로 뒤에서부터 줄인다
 * (브랜드·모델명은 남긴다).
 */

export const PRODUCT_NAME_MAX = 100;
/** 並行輸入品 표기(PRD §16 ③) */
export const PARALLEL_IMPORT_WORD = '병행';
/** 라쿠텐 상품명의 병행수입 표시(NFKC 비교) */
export const PARALLEL_IMPORT_MARKS: readonly string[] = ['並行輸入品', '並行輸入'];
/** 브랜드로 읽는 ② 속성 이름(URL 후보 — 키워드가 없을 때) */
export const BRAND_ATTRIBUTE_NAMES: readonly string[] = ['ブランド', 'ブランド名', 'メーカー'];

export const GENDER_WORD: Readonly<Record<'MALE' | 'FEMALE', string>> = {
  MALE: '남성',
  FEMALE: '여성',
};

export interface ProductNameParts {
  brand: string | null;
  series: string | null;
  modelName: string | null;
  productType: string | null;
  color: string | null;
  gender: 'MALE' | 'FEMALE' | null;
  parallelImport: boolean;
}

/** 라쿠텐 상품명에 並行輸入品이 있는가 */
export function isParallelImport(itemName: string): boolean {
  const text = itemName.normalize('NFKC');
  return PARALLEL_IMPORT_MARKS.some((mark) => text.includes(mark.normalize('NFKC')));
}

/** 키워드 → 브랜드·시리즈(첫 낱말·나머지) */
export function brandSeriesOfKeyword(keyword: string | null): {
  brand: string | null;
  series: string | null;
} {
  const words = (keyword ?? '').normalize('NFKC').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { brand: null, series: null };
  return { brand: words[0]!, series: words.slice(1).join(' ') || null };
}

/** 리프 경로(`패션잡화>남성신발>운동화>러닝화`) → 상품유형(마지막 조각) */
export function productTypeOfPath(wholeCategoryName: string | null): string | null {
  const last = (wholeCategoryName ?? '').split('>').at(-1)?.trim();
  return last ? last : null;
}

/** 색상 표기 → 대표색상(첫 조각) */
export function representativeColor(colorKo: string | null): string | null {
  const first = (colorKo ?? '').split(/[/／·・,、&+]/)[0]?.trim();
  return first ? first : null;
}

function wordKey(word: string): string {
  return word.normalize('NFKC').toLowerCase();
}

/** 상품명 제안(템플릿 순서, 반복 낱말 빼기, 100자 안) */
export function buildProductName(parts: ProductNameParts): string {
  const pieces = [
    parts.brand,
    parts.series,
    parts.modelName,
    parts.productType,
    parts.color,
    parts.gender ? GENDER_WORD[parts.gender] : null,
    parts.parallelImport ? PARALLEL_IMPORT_WORD : null,
  ];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const piece of pieces) {
    for (const word of (piece ?? '').normalize('NFKC').trim().split(/\s+/)) {
      if (word === '' || seen.has(wordKey(word))) continue;
      seen.add(wordKey(word));
      words.push(word);
    }
  }
  const keep = new Set(
    [parts.brand, parts.modelName]
      .flatMap((p) => (p ?? '').normalize('NFKC').split(/\s+/))
      .filter(Boolean)
      .map(wordKey),
  );
  while ([...words.join(' ')].length > PRODUCT_NAME_MAX && words.length > 1) {
    const index = words.map(wordKey).findLastIndex((key) => !keep.has(key));
    if (index < 0) break;
    words.splice(index, 1);
  }
  const name = words.join(' ');
  return [...name].length > PRODUCT_NAME_MAX ? [...name].slice(0, PRODUCT_NAME_MAX).join('') : name;
}

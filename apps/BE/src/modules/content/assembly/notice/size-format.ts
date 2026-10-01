/**
 * 고시 `size`·사양 블록 사이즈 표기(P3-04 규칙 5, F-CT-18, PRD §8.5 CT-03). 국내 mm를 먼저, JP cm를 괄호에 적는다.
 * - 5mm 간격이 이어지는 구간은 `~`로 묶고, 끊긴 구간은 `·`로 잇는다(시안 Content.dc.html — PRD 예시는 이어진 범위뿐이라
 *   끊긴 표기는 Proposed: 열린질문 P3-04). 예 `[250,255,260,265,275]` → `250~265·275mm (JP 25.0~26.5·27.5cm)`
 * - JP cm = mm ÷ 10, 소수 한 자리
 */

/** 사이즈 간격(mm) — 판매 사이즈는 5mm 단위(② 목표 사이즈) */
export const SIZE_STEP_MM = 5;

/** 정렬·중복 제거한 사이즈를 이어진 구간으로 */
export function sizeRuns(sizes: readonly number[]): number[][] {
  const sorted = [...new Set(sizes)].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const size of sorted) {
    const run = runs.at(-1);
    if (run && size - run.at(-1)! === SIZE_STEP_MM) run.push(size);
    else runs.push([size]);
  }
  return runs;
}

function runsText(runs: readonly number[][], unit: (mm: number) => string): string {
  return runs
    .map((run) => (run.length === 1 ? unit(run[0]!) : `${unit(run[0]!)}~${unit(run.at(-1)!)}`))
    .join('·');
}

/** mm 한 칸의 JP cm 글자(`25.5`) */
export function jpCm(mm: number): string {
  return (mm / 10).toFixed(1);
}

/** `250~265·275mm (JP 25.0~26.5·27.5cm)`. 사이즈가 없으면 빈 글 */
export function formatSaleSizes(sizes: readonly number[]): string {
  const runs = sizeRuns(sizes);
  if (runs.length === 0) return '';
  return `${runsText(runs, String)}mm (JP ${runsText(runs, jpCm)}cm)`;
}

/**
 * `formatSaleSizes` 표기를 되읽는다(P4-02 — 최종 승인 사전 검증 `OPTIONS`가 사양 블록의 사이즈 집합을 옵션 사이즈와 비교할 때,
 * content 읽기 창구가 쓴다). `250~265·275mm (JP …)` → `[250,255,260,265,275]`. mm 부분만 읽고, 모양이 다르면 null.
 */
export function parseSaleSizes(text: string): number[] | null {
  const match = /^\s*([0-9~·\s]+)mm(?:\s*\(JP [^)]*\))?\s*$/u.exec(text);
  if (!match) return null;
  const sizes: number[] = [];
  for (const part of match[1]!.split('·')) {
    const range = /^\s*(\d{2,3})\s*(?:~\s*(\d{2,3})\s*)?$/.exec(part);
    if (!range) return null;
    const from = Number(range[1]);
    const to = range[2] !== undefined ? Number(range[2]) : from;
    if (to < from || (to - from) % SIZE_STEP_MM !== 0) return null;
    for (let mm = from; mm <= to; mm += SIZE_STEP_MM) sizes.push(mm);
  }
  return [...new Set(sizes)].sort((a, b) => a - b);
}

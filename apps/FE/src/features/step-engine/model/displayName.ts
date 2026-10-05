import type { CandidateDetail, CandidateSummary } from './types';

type NameSource = Pick<
  CandidateSummary,
  'id' | 'displayName' | 'anchorModelCode' | 'selectedColor'
>;

/**
 * 여정 이름. 서버 표시명(② 선택 상품명 · 색상, 그 전에는 검색어)이 있으면 그것, 없으면 型番 · 색상,
 * 그것도 없으면 '여정 #{id}'(P1-04 Proposed, 05-1 §7.2).
 */
export function candidateDisplayName(candidate: NameSource): string {
  if (candidate.displayName) return candidate.displayName;
  if (candidate.anchorModelCode) {
    return candidate.selectedColor
      ? `${candidate.anchorModelCode} · ${candidate.selectedColor}`
      : candidate.anchorModelCode;
  }
  return `여정 #${candidate.id}`;
}

/** 앵커 키 ID 칩 글자('1201A019108 · 크림/블랙'). 앵커가 없으면 null */
export function anchorKeyLabel(
  detail: Pick<
    CandidateDetail,
    'anchorModelCode' | 'anchorItemCode' | 'anchorColorCode' | 'selectedColor'
  >,
): string | null {
  const base = detail.anchorModelCode ?? detail.anchorItemCode;
  if (!base) return null;
  const color = detail.selectedColor ?? detail.anchorColorCode;
  return color ? `${base} · ${color}` : base;
}

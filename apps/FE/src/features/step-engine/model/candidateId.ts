/** 여정 id 상한(serial = int4) */
const MAX_CANDIDATE_ID = 2_147_483_647;

/**
 * 경로·검색 파라미터의 여정 id → 정수(1 이상). 정수가 아니면 null(그런 여정은 없다 — 부르지 않고 '여정을 찾을 수 없습니다',
 * 05-1 route맵 §3-3). BE도 같은 규칙으로 404 CANDIDATE_NOT_FOUND를 준다.
 */
export function parseCandidateId(raw: string | null | undefined): number | null {
  if (!raw || !/^[1-9]\d{0,9}$/.test(raw)) return null;
  const id = Number(raw);
  return id <= MAX_CANDIDATE_ID ? id : null;
}

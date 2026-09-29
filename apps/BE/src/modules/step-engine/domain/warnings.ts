/** 막지 않는 경고(05-2 CandidateWarning, 05-3 §5.2) */
export interface CandidateWarning {
  code: string;
  message: string;
}

/**
 * ANCHOR_KEY_DUPLICATE(05-3 §5.2 '앵커 키만 같은 진행 중 후보가 있다', F-CW-04). 05-3에 문구가 없어 정했다(Proposed).
 * 화면이 그 후보를 찾을 수 있게 후보 번호를 문구에 넣는다.
 */
export function anchorKeyDuplicateWarning(candidateIds: readonly number[]): CandidateWarning {
  return {
    code: 'ANCHOR_KEY_DUPLICATE',
    message: `모델·색상이 같은 진행 중 후보가 있습니다(후보 ${candidateIds.map((id) => `#${id}`).join(', ')}).`,
  };
}

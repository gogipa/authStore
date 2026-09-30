import { genderFromGenrePath, genderFromItemName } from './gender-signal.js';

/**
 * 후보 성별 자동 판정(PRD §8.2 RK-05·§5.3, F-SO-18·19, P2-03 규칙 5). 순수 함수.
 * - 신호: 키워드 cid(50000173 여 / 50000174 남) → 라쿠텐 장르 경로(メンズ靴 110983 / レディース靴 100480) → 상품명.
 *   세 신호가 다를 때는 **적힌 순서**(Proposed): 앞 신호가 판단하면 뒤 신호는 보지 않는다. 한 신호 안에서 남·여가 모두 나오면
 *   그 신호는 판단 불가(다음 신호로)
 * - 판단 불가(공용·신호 없음)면 null → ②는 성별 입력 대기(F-SO-19, `PUT /candidates/{id}/gender`)
 * - 오너 성별(candidate.gender_source=OWNER)은 덮어쓰지 않는다. 자동 판단이 다르면 '재확인 필요'
 *   (`resolveCandidateGender` — 후보에 쓰는 것은 step-engine `CandidateGenderService.applyStep2Gender`)
 */

export type Gender = 'MALE' | 'FEMALE';
export type GenderBasis = 'KEYWORD_CID' | 'GENRE_PATH' | 'ITEM_NAME';

/** 데이터랩 cid(PRD §8.1·§8.2 RK-05) */
export const GENDER_CIDS: Readonly<Record<string, Gender>> = {
  '50000173': 'FEMALE',
  '50000174': 'MALE',
};

export function genderFromCid(cid: string | null | undefined): Gender | null {
  if (!cid) return null;
  return GENDER_CIDS[cid.trim()] ?? null;
}

export interface GenderSignals {
  keywordCid: string | null;
  genreIdPath: readonly number[] | null;
  itemName: string | null;
}

export interface DetectedCandidateGender {
  gender: Gender;
  basis: GenderBasis;
}

/** cid → 장르 경로 → 상품명(적힌 순서, Proposed). 판단 불가면 null */
export function detectCandidateGender(signals: GenderSignals): DetectedCandidateGender | null {
  const byCid = genderFromCid(signals.keywordCid);
  if (byCid) return { gender: byCid, basis: 'KEYWORD_CID' };
  const byGenre = genderFromGenrePath(signals.genreIdPath);
  if (byGenre) return { gender: byGenre, basis: 'GENRE_PATH' };
  const byName = signals.itemName ? genderFromItemName(signals.itemName) : null;
  return byName ? { gender: byName, basis: 'ITEM_NAME' } : null;
}

export interface CandidateGenderState {
  gender: string | null;
  genderSource: string | null;
}

/**
 * 비교에 쓸 성별(목표 사이즈 범위)과 후보에 줄 자동 값.
 * - 오너 성별이 있으면 그 값을 쓴다(덮어쓰지 않음). 자동 판단이 다르면 `recheckRequired`
 * - 오너 성별이 없으면 자동 판단 → 없으면 ②에서 고른 성별(`ownerGenderInStep`) → 없으면 후보의 ② 자동 값
 * - `effective`가 null이면 성별 입력 대기
 */
export function resolveCandidateGender(input: {
  candidate: CandidateGenderState;
  detected: DetectedCandidateGender | null;
  /** sourcing_comparison.owner_gender(② 안에서 고른 성별) */
  ownerGenderInStep: string | null;
}): { effective: Gender | null; recheckRequired: boolean } {
  const asGender = (v: string | null): Gender | null => (v === 'MALE' || v === 'FEMALE' ? v : null);
  const owner = input.candidate.genderSource === 'OWNER' ? asGender(input.candidate.gender) : null;
  if (owner) {
    return {
      effective: owner,
      recheckRequired: input.detected !== null && input.detected.gender !== owner,
    };
  }
  const effective =
    input.detected?.gender ?? asGender(input.ownerGenderInStep) ?? asGender(input.candidate.gender);
  return { effective, recheckRequired: false };
}

import { BUILTIN_PERSON_BLOCK_WORDS } from '../../settings/safety/builtin-safety-lists.js';

/**
 * 앱 내장 실존 인물·그룹·연예인 차단어(IM-07, F-TH-10 — 내용은 P1-03 Proposed, 오너 검토). 원본은 설정 안전 기준
 * `BUILTIN_PERSON_BLOCK_WORDS` 하나다(목록이 둘로 갈라지지 않게 다시 내보낸다). 설정 파일 `safety.personBlockWords`는
 * 이 목록을 모두 담아야 하고(빼면 P1-03이 앱 시작·다시 읽기 때 422 `SAFETY_SETTING_RELAXATION_REJECTED`로 거부) 더하기만 된다.
 * 검사는 늘 **내장 ∪ 설정**으로 한다(`personBlockDictionary`) — 설정 검사를 우회한 값이 들어와도 내장 단어는 빠지지 않는다.
 */
export const REAL_PERSON_BUILTIN_TERMS: readonly string[] = BUILTIN_PERSON_BLOCK_WORDS;

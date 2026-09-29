import type { Db, StepEngineTx } from '../candidates/step-engine-tx.js';

/** 'URL로 만들기'(RAKUTEN_URL) 후보를 만들 때 넘기는 값 */
export interface UrlCandidateCreationInput {
  candidateId: number;
  /** POST /rakuten-items로 먼저 읽은 스냅샷(rakuten_item.id) */
  rakutenItemId: number;
  selectedColor: string;
}

/**
 * RAKUTEN_URL 후보 만들기의 ② 확장 자리(05-2 createCandidate: '② URL_CREATE 버전까지 같은 트랜잭션').
 * P2-02(F-SO-35)가 채운다: 제외어 검사(RAKUTEN_ITEM_EXCLUDED_WORD), ② step_run + sourcing_comparison(URL_CREATE,
 * 비교 안 함, 앵커 = URL 상품), 앵커 확정, 아동화 의심·대상 외 장르면 ② 입력 대기.
 *
 * 없으면(null, P1-04 기본) 후보는 ② 없이 만든다: candidate(source_url·item_code·selected_color) + candidate_step 10행 +
 * CREATED 이력. ②는 미실행이다.
 */
export interface CandidateCreationExtension {
  /** 트랜잭션 전 검사(제외어 등). 던지면 후보를 만들지 않는다 */
  validateUrlItem?(db: Db, input: Omit<UrlCandidateCreationInput, 'candidateId'>): Promise<void>;
  /** 후보를 만든 같은 트랜잭션에서 ② URL_CREATE 버전을 쓴다 */
  createUrlSourcingVersion(scope: StepEngineTx, input: UrlCandidateCreationInput): Promise<void>;
}

export const CANDIDATE_CREATION_EXTENSION = Symbol('CANDIDATE_CREATION_EXTENSION');

import type { StepCode } from '@/shared/lib/steps';
import type { StepFailureKind } from '@/shared/ui';
import type { CandidateExcludedReason, CandidateStatus } from './types';

/** 후보 상태 글자(PRD §5.2) */
export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  TEMP: '임시',
  WORKING: '작업중',
  EXCLUDED: '제외',
  AWAITING_APPROVAL: '승인대기',
  VALIDATED: '검증완료',
  REGISTERING: '등록요청중',
  RESULT_CHECK_REQUIRED: '결과확인필요',
  REGISTERED: '등록됨',
};

/** 제외 사유 글자(ERD candidate.excluded_reason) */
export const EXCLUDED_REASON_LABEL: Record<CandidateExcludedReason, string> = {
  ANCHOR_NO_MATCH: '앵커 일치 없음',
  INSUFFICIENT_STOCK: '재고 부족',
  NOT_SALE_CANDIDATE: '판매 후보 아님',
  OWNER_EXCLUDED: '직접 제외',
};

/** 단계 이름(단계 레일과 같은 번호·이름, 공통부품 §G) */
export const STEP_NAME: Record<StepCode, string> = {
  SOURCING: '② 소싱',
  PRICING: '③ 판정',
  CATEGORY: '④ 카테고리',
  THUMBNAIL: '⑤ 썸네일',
  COPY: '⑥-1 카피',
  NOTICE_RAW: '⑥-2 원산지·소재',
  NOTICE_HTML: '⑥-3 고시·HTML',
  TAGS: '⑦ 태그',
  UPLOAD: '⑧ 이미지 업로드',
  REGISTER: '⑨ 등록',
};

/**
 * 단계 화면 이름(대시보드 '이어 하기' 열: '③ 판정 열기', '⑥ 콘텐츠 열기', '최종 승인 열기'). ⑥-1~⑥-3은 한 화면,
 * ⑨는 G4 최종 승인 화면에서만 돈다(Main.dc.html).
 */
export const STEP_SCREEN_NAME: Record<StepCode, string> = {
  SOURCING: '② 소싱',
  PRICING: '③ 판정',
  CATEGORY: '④ 카테고리',
  THUMBNAIL: '⑤ 썸네일',
  COPY: '⑥ 콘텐츠',
  NOTICE_RAW: '⑥ 콘텐츠',
  NOTICE_HTML: '⑥ 콘텐츠',
  TAGS: '⑦ 태그',
  UPLOAD: '⑧ 이미지 업로드',
  REGISTER: '최종 승인',
};

/** 실패 종류 글자(05-2 StepFailureKind) */
export const FAILURE_KIND_LABEL: Record<StepFailureKind, string> = {
  EXTERNAL_API: '외부 API 오류',
  AI: 'AI 오류',
  INPUT_VALIDATION: '입력 검증 실패',
  INTERRUPTED: '앱 종료로 중단',
};

/** 바뀐 입력 이름(candidate_step.stale_inputs)의 글자. 모르는 키는 키 그대로 보인다 */
const INPUT_KEY_LABEL: Record<string, string> = {
  'candidate.gender': '성별',
  'candidate.rakutenQuery': '검색어',
  'candidate.sourceUrl': '상품 URL',
  'candidate.anchorKey': '앵커 키',
};

export function inputKeyLabel(key: string): string {
  return INPUT_KEY_LABEL[key] ?? key;
}

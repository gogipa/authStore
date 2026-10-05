import type { StepCode } from '@/shared/lib/steps';
import type { StepFailureKind } from '@/shared/ui';
import type { CandidateExcludedReason, CandidateStatus } from './types';

/** 여정 상태 글자(PRD §5.2) */
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
  ANCHOR_NO_MATCH: '기준 상품과 일치 없음',
  INSUFFICIENT_STOCK: '재고 부족',
  NOT_SALE_CANDIDATE: '판매 후보 아님',
  OWNER_EXCLUDED: '직접 삭제',
};

/** 제외된 여정 안내(단계 화면 맨 위 띠) — 왜 제외됐는지. 뒤에 '다시 하는 법'이 붙는다 */
export const EXCLUDED_NOTICE: Record<CandidateExcludedReason, string> = {
  ANCHOR_NO_MATCH: '기준 상품과 같은 상품이 하나도 없어 제외된 여정입니다.',
  INSUFFICIENT_STOCK:
    '재고가 모자라 제외된 여정입니다. 기준 상품의 목표 사이즈 중 재고 있는 사이즈가 기준 개수에 못 미쳤습니다.',
  NOT_SALE_CANDIDATE: '③ 판정에서 팔 수 없는 상품으로 나와 제외된 여정입니다.',
  OWNER_EXCLUDED: '직접 삭제한 여정입니다.',
};
export const EXCLUDED_NOTICE_NEXT =
  '다른 상품으로 다시 하려면 여정 목록에서 [다시 작업]을 누르세요.';

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

/** 입력 키 화면 이름(P1-05 model/inputLabels.ts로 옮겼다) */
export { inputKeyLabel, inputKeyLabels } from './inputLabels';

/**
 * 레퍼런스 이미지와 후보 앵커 키 비교(P3-01·P3-02). P4-02에서 함수 원본을 `common/rules/anchor-key.ts`로 옮겼다 — 최종 승인 사전
 * 검증(`REPRESENTATIVE_IMAGE_SOURCE`)이 같은 규칙을 쓴다. 이 파일은 기존 import 경로를 지키려고 같은 이름을 다시 내보낸다.
 */
export {
  isSameAnchor,
  needsSameProductColorConfirmation,
  normalizeAnchorCode,
  type AnchorKeyFields,
  type ImageAnchorFields,
} from '../../common/rules/anchor-key.js';

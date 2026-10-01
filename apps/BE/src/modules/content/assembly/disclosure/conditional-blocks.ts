import type {
  NoticeBlockCondition,
  NoticeSettings,
} from '../../../settings/schema/settings.types.js';
import { hasLeather, needsLeatherNotice } from '../../../../common/rules/disclosure-conditions.js';
import type { AssemblyMaterials } from '../assembly-facts.js';

/** 판정 함수 원본은 common/rules(P4-02 — 최종 승인 사전 검증이 같이 쓴다). 기존 이름을 다시 내보낸다 */
export { hasLeather, needsLeatherNotice };

/**
 * 구매대행 고지 조건부 블록(P3-04 규칙 4, F-CT-01·03, US-16 AC3, PRD §8.5 '조건부 블록', §16 ②-15).
 * - LEATHER_OR_UNKNOWN_MATERIAL: ⑥-2 소재(겉감·안감·밑창)에 천연·인조 가죽이 있거나 소재가 '정보 없음'이면 안전관리대상 문장.
 *   가죽 판정 = 설정 `notice.leatherTerms`의 말이 소재 글에 들어 있음(NFKC·대문자·공백 무시 — '합성가죽'·'인조가죽'·'合成皮革'도
 *   '가죽'·'革'에 걸린다). '정보 없음' 범위(Proposed) = **겉감이 정보 없음**(겉감·안감·밑창이 모두 없을 때를 포함한다). 안감·밑창만
 *   비어 있으면 붙이지 않는다(섬유 겉감 + 안감 없음 → 없음). 판정 근거는 ⑥-2 소재(근거)이고, ⑥-3에서 오너가 고시 문구를 고쳐도
 *   다시 판정하지 않는다
 * - AI_IMAGE_LABEL: 설정 `notice.aiImageLabel`(기본 켬, M1은 끄는 API 없음)
 * - MODE_A_PRICE_BREAKDOWN: 모드 A 판매가 구성(PR-07) — M1은 켜는 설정이 없어 넣지 않는다
 */

/** 이번 고지에서 켜진 조건 */
export function activeConditions(input: {
  materials: AssemblyMaterials;
  notice: Pick<NoticeSettings, 'leatherTerms' | 'aiImageLabel'>;
}): Set<NoticeBlockCondition> {
  const out = new Set<NoticeBlockCondition>();
  if (needsLeatherNotice(input.materials, input.notice.leatherTerms)) {
    out.add('LEATHER_OR_UNKNOWN_MATERIAL');
  }
  if (input.notice.aiImageLabel) out.add('AI_IMAGE_LABEL');
  return out;
}

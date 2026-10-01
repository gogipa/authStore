/**
 * 커머스API 태그 포트(P3-05 — PRD §8.6 TG-02·검증 ①, R04 2.7·R05 A1·A2). ⑦ tags 모듈이 이것으로만 추천·제한 태그를 부른다.
 * - `recommendTags(keyword)`: `GET /v2/tags/recommend-tags?keyword=` → 사전 태그 `{code, text}` 목록(응답 순서 그대로).
 *   응답은 프로세스 메모리에 짧게 캐시한다(키 = NFKC·소문자·공백 정리한 키워드, 시간은 호출자가 설정 `tags.recommendCacheMinutes`로
 *   준다 — DB에는 두지 않는다, ERD 부록 A). `code`는 int64라 숫자 그대로 읽지 않고 응답 원문 글자로 읽는다(정밀도 손실 방지)
 * - `restrictedTags(tags)`: `GET /v2/tags/restricted-tags?tags=a&tags=b`(반복 파라미터 — M0 S3 전 가정) → `{tag, restricted}`.
 *   1회 최대 개수는 M0 S3 전이라 호출자가 설정 `tags.restrictedBatchSize`로 나눠 부른다. 카테고리를 받지 않는다(TG-05)
 * 둘 다 P1-07 `CommerceApiClient`(토큰·401 재발급)와 P1-01 관문(`call_log.target=COMMERCE_API`)을 거친다. 앱은 네이버쇼핑에
 * 요청하지 않는다(CON-03 — 이 포트의 호스트는 api.commerce.naver.com 하나).
 * 실패(Proposed): 추천 400(키워드를 받지 않음)은 그 키워드의 추천 없음([])으로 본다. 그 밖의 2xx 아닌 응답·모양이 다른 200은
 * 502 `EXTERNAL_API_ERROR`(`details.reason` = `HTTP_<상태>`·`INVALID_RESPONSE`). 키가 없으면 409 `SECRET_NOT_CONFIGURED`,
 * 인증 실패는 502 `COMMERCE_AUTH_FAILED`(토큰 서비스가 던진다).
 */
export const COMMERCE_TAGS_PORT = Symbol('COMMERCE_TAGS_PORT');

/** 추천 태그 조회 경로 */
export const COMMERCE_RECOMMEND_TAGS_PATH = '/v2/tags/recommend-tags';
/** 제한 태그 조회 경로 */
export const COMMERCE_RESTRICTED_TAGS_PATH = '/v2/tags/restricted-tags';

/** 사전(추천) 태그 한 개. `code`는 숫자 글자(int64 — tag_candidate.code varchar(20)) */
export interface RecommendedTag {
  code: string;
  text: string;
}

/** 제한 태그 판정 한 개(보낸 글자 그대로의 `tag`) */
export interface RestrictedTagVerdict {
  tag: string;
  restricted: boolean;
}

/** 호출 기록 문맥(call_log.candidate_id·step_run_id) */
export interface CommerceTagsCallContext {
  candidateId?: number | null;
  stepRunId?: number | null;
}

export interface CommerceTagsPort {
  /** 추천 태그. `cacheTtlMs`가 0이면 캐시를 쓰지 않는다 */
  recommendTags(
    keyword: string,
    options: CommerceTagsCallContext & { cacheTtlMs: number },
  ): Promise<RecommendedTag[]>;
  /** 제한 태그 판정(빈 목록이면 부르지 않고 []) */
  restrictedTags(
    tags: readonly string[],
    context?: CommerceTagsCallContext,
  ): Promise<RestrictedTagVerdict[]>;
}

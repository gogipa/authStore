import type { ApiRuntime } from '@/shared/api/client';
import { DEMO_CANDIDATE_ID as CANDIDATE_ID, DemoWorld, type DemoWorldOptions } from './demoWorld';
import { demoImageUrl } from './images';
import { createDispatcher, type DemoRoute } from './router';
import { categoryRoutes } from './world/domains/category';
import { contentRoutes } from './world/domains/content';
import { keywordsRoutes } from './world/domains/keywords';
import { pricingRoutes } from './world/domains/pricing';
import { registrationRoutes } from './world/domains/registration';
import { sourcingRoutes } from './world/domains/sourcing';
import { tagsRoutes } from './world/domains/tags';
import { thumbnailRoutes } from './world/domains/thumbnail';
import { uploadRoutes } from './world/domains/upload';
import { engineRoutes } from './world/engineRoutes';
import { settingsRoutes } from './world/settingsRoutes';

/** 체험의 예시 여정 id(① [이 검색어로 소싱]으로 만든 뒤 이 번호다) */
export const DEMO_CANDIDATE_ID: number = CANDIDATE_ID;

/** 체험 API(메모리 모델). `installApiRuntime(createDemoApi())`로 켠다 */
export interface DemoApi extends ApiRuntime {
  /** 따라 하기 모델 — 띠가 진행을 읽고, 체험 앱이 변경을 구독해 화면이 다시 읽게 한다 */
  readonly world: DemoWorld;
  /** 404 'unknown' 봉투로 답한 요청('GET /path' — /api/v1 뒤 경로, 쿼리 없음). 빠진 예시를 찾는 테스트가 본다 */
  readonly unknownRequests: readonly string[];
  /**
   * 403 따라 하기 밖(`DEMO_READ_ONLY`)으로 답한 요청('POST /path'). 버튼을 누르지 않았는데 생기면 화면을 열기만 해도 체험 글이 오류처럼
   * 뜬다는 뜻이다 — 화면을 훑는 테스트가 본다
   */
  readonly readOnlyRequests: readonly string[];
  /** 모델이 예상 밖 오류로 500을 준 요청 — 테스트는 늘 비어 있어야 한다 */
  readonly serverErrors: readonly string[];
}

/** 경로표: step-engine → 단계별 도메인 → 설정·시스템 */
const ROUTES: readonly DemoRoute[] = [
  ...engineRoutes,
  ...keywordsRoutes,
  ...sourcingRoutes,
  ...pricingRoutes,
  ...categoryRoutes,
  ...thumbnailRoutes,
  ...contentRoutes,
  ...tagsRoutes,
  ...uploadRoutes,
  ...registrationRoutes,
  ...settingsRoutes,
];

/**
 * 체험 API를 만든다(D-32). 화면·훅이 쓰는 `api`(openapi-fetch)의 전송을 이 함수의 `fetch`로 바꾸면, 모든 요청을 메모리 모델이 답한다 —
 * 네트워크를 쓰지 않는다.
 * - 모델(`DemoWorld`)은 예시 여정 하나가 ①→⑨를 거치는 모습을 실제 BE의 규칙으로 되풀이한다: 아직 안 한 일의 조회는 실제 BE가 주는
 *   답(빈 목록·404 `STEP_OUTPUT_NOT_FOUND`)이고, 순서를 어기면 실제 BE의 오류다. 결과는 짧은 지연 뒤에 나온다.
 * - 따라 하기에 없는 POST·PUT·PATCH·DELETE(설정 저장·연결 테스트·동기화 …): 403 `DEMO_READ_ONLY`(기존 오류 표시에 그대로 보인다)
 * - 표에 없는 조회: 404 `DEMO_NOT_AVAILABLE`, `unknownRequests`에 남긴다
 */
export function createDemoApi(options?: DemoWorldOptions): DemoApi {
  const world = new DemoWorld(options);
  const dispatcher = createDispatcher(ROUTES, world);
  return {
    fetch: dispatcher.handle,
    imageAssetFileUrl: demoImageUrl,
    world,
    unknownRequests: dispatcher.unknownRequests,
    readOnlyRequests: dispatcher.readOnlyRequests,
    serverErrors: dispatcher.serverErrors,
  };
}

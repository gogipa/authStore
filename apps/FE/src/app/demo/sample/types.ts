import type { components, paths } from '@/shared/api/schema';

/** 05-2 스키마 하나(예시 데이터 타입) */
export type Schema<Name extends keyof components['schemas']> = components['schemas'][Name];

/** 체험이 답하는 메서드(읽기 GET과, 따라 하기(D-32)에서 눌러 실행하는 POST·PUT·PATCH·DELETE) */
export type DemoMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type JsonBody<Response> = Response extends { content: { 'application/json': infer Body } }
  ? Body
  : never;

/**
 * 그 경로·메서드의 성공 응답 본문(200, 없으면 201의 application/json). 생성된 05-2 타입(schema.d.ts)에서 꺼내므로 명세가 바뀌면
 * 예시 데이터가 typecheck에서 걸린다.
 */
export type Ok<P extends keyof paths, M extends DemoMethod = 'get'> = paths[P][M] extends {
  responses: infer Responses;
}
  ? Responses extends { 200: infer Success }
    ? JsonBody<Success>
    : Responses extends { 201: infer Created }
      ? JsonBody<Created>
      : never
  : never;

/**
 * 그 경로·메서드의 202 접수 본문(application/json). 결과는 나중에(SSE) 오는 작업이다 — 체험은 접수만 답하고 결과는 예시 그대로 둔다.
 */
export type Accepted<P extends keyof paths, M extends DemoMethod = 'post'> = paths[P][M] extends {
  responses: infer Responses;
}
  ? Responses extends { 202: infer Accept }
    ? JsonBody<Accept>
    : never
  : never;

/**
 * 그 경로·메서드의 `S` 상태 응답 본문(application/json). 따라 하기(D-32)의 실행 라우트가 답하는 모양을 05-2 타입으로 묶는다 —
 * 명세가 바뀌면 모델의 응답이 typecheck에서 걸린다.
 */
export type Res<
  P extends keyof paths,
  M extends DemoMethod,
  S extends number,
> = paths[P][M] extends { responses: infer Responses }
  ? S extends keyof Responses
    ? JsonBody<Responses[S]>
    : never
  : never;

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { FakeEventSource } from './fakeEventSource';

// 테스트는 실제 네트워크를 부르지 않는다. API는 src/test/apiStub.ts의 stubApi()로 정하고,
// 정하지 않은 요청이 fetch까지 오면 바로 실패한다(openapi-fetch는 만들 때의 globalThis.fetch를 쓴다).
globalThis.fetch = async (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input);
  throw new TypeError(`테스트에서 실제 네트워크를 부르지 않습니다: ${url}`);
};

afterEach(() => {
  // 화면을 내리면(언마운트) 진행 알림 구독도 풀린다. 그 뒤 가짜 EventSource 목록을 비운다.
  cleanup();
  FakeEventSource.reset();
});

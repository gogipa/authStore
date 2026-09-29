import type { EventSourceLike } from '@/shared/api/events';

/**
 * 테스트용 가짜 EventSource(jsdom에는 EventSource가 없다).
 * - `emit(name, data)`: 서버가 이벤트 한 개를 보낸 것처럼 한다(data는 JSON으로 바꿔 보낸다).
 * - `fail()`: 연결이 끊겨 브라우저가 다시 붙으려는 상태(CONNECTING)로 바꾸고 error를 보낸다.
 *   `fail({ closed: true })`는 브라우저가 포기한 상태(CLOSED, 예: 프록시 502)다.
 * - `reopen()`(= `open()`): 연결이 (다시) 열렸다.
 * 만든 인스턴스는 `FakeEventSource.instances`에 쌓인다. src/test/setup.ts가 테스트마다 비운다.
 */
export class FakeEventSource extends EventTarget implements EventSourceLike {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  static instances: FakeEventSource[] = [];

  /** 가장 최근에 만든 인스턴스. 없으면 테스트를 실패시킨다. */
  static latest(): FakeEventSource {
    const last = FakeEventSource.instances.at(-1);
    if (!last) throw new Error('EventSource가 만들어지지 않았습니다.');
    return last;
  }

  static reset() {
    FakeEventSource.instances = [];
  }

  readonly url: string;
  readonly withCredentials = false;
  readyState: number = FakeEventSource.CONNECTING;
  closeCount = 0;
  private lastId = 0;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closeCount += 1;
    this.readyState = FakeEventSource.CLOSED;
  }

  get closed() {
    return this.readyState === FakeEventSource.CLOSED;
  }

  open() {
    this.readyState = FakeEventSource.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  reopen() {
    this.open();
  }

  fail(options: { closed?: boolean } = {}) {
    this.readyState = options.closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.dispatchEvent(new Event('error'));
  }

  emit(name: string, data: unknown) {
    this.lastId += 1;
    this.dispatchEvent(
      new MessageEvent(name, { data: JSON.stringify(data), lastEventId: String(this.lastId) }),
    );
  }

  /** 서버가 JSON이 아닌 data를 보낸 경우. */
  emitRaw(name: string, data: string) {
    this.dispatchEvent(new MessageEvent(name, { data }));
  }
}

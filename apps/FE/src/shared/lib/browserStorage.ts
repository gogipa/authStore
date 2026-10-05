/**
 * 브라우저 저장소(localStorage·sessionStorage)를 여는 한 곳. 앱 코드는 `window.localStorage`·`window.sessionStorage`를 직접
 * 쓰지 않고 이 함수로 받는다(app/source-rules.test.ts).
 *
 * 체험(`/demo`, D-31)은 보통 앱과 같은 출처(같은 저장소)라, 체험에서 한 일(작업 흐름 카드 '다시 보지 않기', 설정 마법사 표시)이
 * 보통 앱의 키에 남으면 체험을 끝낸 뒤 보통 앱이 달라진다(예: 같은 탭에서 설정 마법사가 저절로 열리지 않음). 그래서 체험은 켤 때
 * `installMemoryStorage()`로 두 저장소를 페이지 안 메모리로 바꾼다 — 체험은 브라우저 저장소에 아무것도 쓰지 않고, 새로 고치면
 * 처음 그대로다. 보통 앱은 부르지 않는다.
 *
 * 저장소를 못 쓰면(사생활 보호 창·막힌 사이트 데이터) 이 함수나 그 메서드가 예외를 던진다 — 부르는 쪽이 try/catch한다.
 */
export type BrowserStorageKind = 'local' | 'session';

let memory: Readonly<Record<BrowserStorageKind, Storage>> | null = null;

export function browserStorage(kind: BrowserStorageKind): Storage {
  if (memory) return memory[kind];
  return kind === 'local' ? window.localStorage : window.sessionStorage;
}

/** 페이지 안 메모리 저장소(Storage 모양). 탭·새로 고침을 넘어 남지 않는다 */
export function createMemoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, String(value));
    },
  };
}

/** 체험 앱이 켤 때 부른다. 돌려준 함수로 되돌린다(테스트) */
export function installMemoryStorage(): () => void {
  const next = { local: createMemoryStorage(), session: createMemoryStorage() };
  memory = next;
  return () => {
    if (memory === next) memory = null;
  };
}

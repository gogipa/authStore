import { createContext, useContext } from 'react';

/**
 * 체험의 '다음에 할 일' 한 건(D-32). `id`는 글(features/guide `DEMO_GUIDE_TEXT.actions`)의 키, `path`는 그 일을 하는 화면의
 * 체험 안 경로(basename `/demo` 뺀 `/keywords`, `/candidates/1/sourcing`). 글은 features에 있어(shared는 features를 모른다) 모델은
 * 키와 경로만 준다.
 */
export interface DemoNextAction {
  id: string;
  path: string;
  /** 글의 `{이름}` 자리를 채울 값(예: 재실행 필요 단계 이름 목록). 없으면 비어 있다 */
  params?: Readonly<Record<string, string>>;
}

/**
 * 체험 진행 스냅샷(D-32): 따라 하기 모델(app/demo/demoWorld)의 지금 상태를 띠가 읽는 모양으로 줄인 것. 상태가 바뀔 때만 새
 * 객체다(`useSyncExternalStore`가 같은 값을 기대한다).
 */
export interface DemoProgress {
  /** 끝낸 일 수 */
  done: number;
  /** 해야 할 일 수 */
  total: number;
  /** 다음에 할 일. 다 끝났으면 null */
  next: DemoNextAction | null;
  /** 지금 만들어 둔 예시 여정 id(① [이 검색어로 소싱] 전에는 null) */
  candidateId: number | null;
  /** 예시 여정이 등록됨(⑨)까지 갔다 */
  registered: boolean;
  /** 모델이 결과를 만드는 중이다(실행 중) — 띠가 '잠시 기다려 주세요'를 보인다 */
  busy: boolean;
}

/** 체험 진행을 읽고(subscribe·getSnapshot) 처음으로 되돌리는(reset) 입구. 띠가 쓴다 */
export interface DemoGuide {
  subscribe(listener: () => void): () => void;
  getSnapshot(): DemoProgress;
  /** [처음부터 다시]: 모델·화면이 읽은 값·메모리 저장소를 모두 처음 상태로 */
  reset(): void;
}

/**
 * 체험(`/demo`, F-GD-05, D-31·D-32) 표시. 체험 앱(app/demo)만 값을 넣고, 보통 앱은 기본값 null이다.
 * 화면은 이 값으로 체험 띠(따라 하기 안내)·탭 제목('(체험)')·체험 입구 버튼 숨기기·바깥 링크 끄기만 가른다. 데이터는 여기서 바꾸지
 * 않는다(체험의 데이터는 API 전송을 바꿔서 온다 — shared/api/client.ts `installApiRuntime`).
 */
export interface DemoInfo {
  /**
   * 바깥 사이트 링크 자리에 보이는 글(안내문구 §8.1 `externalLink`). 글은 features/guide에 있어(shared는 features를 모른다)
   * 체험 앱이 넣는다
   */
  externalLinkNote: string;
  /** 따라 하기 진행(D-32) */
  guide: DemoGuide;
}

export const DemoContext = createContext<DemoInfo | null>(null);

/** 체험 중이면 체험 정보, 보통 앱이면 null */
export function useDemo(): DemoInfo | null {
  return useContext(DemoContext);
}

/** 바깥 사이트 링크 `<a>`의 속성: 보통 앱은 새 탭 링크, 체험은 href 없는 꺼진 링크 */
export type ExternalLinkProps =
  | { href: string; target: '_blank'; rel: 'noopener noreferrer'; title?: string }
  | { role: 'link'; 'aria-disabled': true; title: string };

/**
 * 서버가 준 바깥 사이트 주소(라쿠텐 상품 페이지·네이버쇼핑 검색·원산지 근거 등)를 새 탭으로 여는 `<a>` 속성.
 * 체험에서는 열지 않는다: 예시 주소는 스킴 없는 예시 글자라(앱 소스에 바깥 주소 글자를 두지 않는 규칙 15) 열면 `/demo/…` 안 '없는
 * 화면'으로 간다. 그래서 href 없이 꺼진 링크(`role="link"` `aria-disabled`)로 두고, 마우스를 올리면(또는 화면 읽기 프로그램이)
 * '체험에서는 바깥 사이트를 열지 않습니다.'를 보인다(`title`). 눌러도 아무 데도 가지 않는다.
 */
export function externalLinkProps(
  href: string,
  demo: DemoInfo | null,
  title?: string,
): ExternalLinkProps {
  if (demo) return { role: 'link', 'aria-disabled': true, title: demo.externalLinkNote };
  return { href, target: '_blank', rel: 'noopener noreferrer', ...(title ? { title } : {}) };
}

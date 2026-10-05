import { useDemo } from './demo';

/**
 * 앱 표시 이름(D-28). 내비 머리와 브라우저 탭 제목이 이 값을 쓴다(index.html 첫 제목은 글자로 같은 값).
 * 저장소·패키지·DB 같은 내부 이름(autoStore, @autostore/*)은 바꾸지 않는다.
 */
export const APP_NAME = '스마트스토어 정복';

/** 체험(`/demo`, D-31) 탭 제목 끝에 붙는 글 */
export const DEMO_TITLE_SUFFIX = '(체험)';

/** 브라우저 탭 제목: `<화면 제목> · 스마트스토어 정복`. 체험이면 끝에 ` (체험)`. */
export function documentTitle(title: string, demo = false): string {
  const base = `${title} · ${APP_NAME}`;
  return demo ? `${base} ${DEMO_TITLE_SUFFIX}` : base;
}

/** 지금 앱(보통·체험)에 맞는 탭 제목. 화면은 `<title>{useDocumentTitle(제목)}</title>`처럼 쓴다 */
export function useDocumentTitle(title: string): string {
  return documentTitle(title, useDemo() !== null);
}

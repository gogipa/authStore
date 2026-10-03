/**
 * 앱 표시 이름(D-28). 내비 머리와 브라우저 탭 제목이 이 값을 쓴다(index.html 첫 제목은 글자로 같은 값).
 * 저장소·패키지·DB 같은 내부 이름(autoStore, @autostore/*)은 바꾸지 않는다.
 */
export const APP_NAME = '스마트스토어 정복';

/** 브라우저 탭 제목: `<화면 제목> · 스마트스토어 정복`. */
export function documentTitle(title: string): string {
  return `${title} · ${APP_NAME}`;
}

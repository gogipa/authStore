import { createContext, useContext } from 'react';

/**
 * 단계 화면 안내(맨 위 안내 판 `StepIntro`·'지금 여기' `NowMark`)를 그릴지(D-43).
 * 오너가 "실제 사용에서는 뜨면 안 되는 것 아니냐"고 해서 **체험(`/demo`)에서만** 보인다 — 앱 틀(`AppLayout`)이 체험일 때만 true를 준다.
 * 기본값이 true라, 틀 밖에서 화면 하나만 그리는 시험은 안내가 보이는 채로 시험한다.
 */
export const StepGuideVisibleContext = createContext(true);

export function useStepGuideVisible(): boolean {
  return useContext(StepGuideVisibleContext);
}

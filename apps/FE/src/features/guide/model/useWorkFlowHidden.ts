import { useCallback, useState } from 'react';
import { browserStorage } from '@/shared/lib/browserStorage';

/**
 * '작업 흐름' 카드를 대시보드에서 숨겼는지(F-DB-11 '다시 보지 않기', D-29). 이 브라우저에만 기억하는 편의 값이다.
 * 저장소를 못 쓰면(사생활 보호 창·막힌 사이트 데이터 — 읽기·쓰기가 예외를 던짐) 숨기지 않은 것으로 보고,
 * 숨기기는 이번 화면에서만 된다. 서버에는 보내지 않는다. 체험(`/demo`)에서는 저장소가 메모리라(`browserStorage`) 보통 앱의 이 값은
 * 그대로다.
 */
export const WORK_FLOW_HIDDEN_KEY = 'autostore.guide.workFlowHidden';

export function readWorkFlowHidden(): boolean {
  try {
    return browserStorage('local').getItem(WORK_FLOW_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeWorkFlowHidden(hidden: boolean): void {
  try {
    if (hidden) browserStorage('local').setItem(WORK_FLOW_HIDDEN_KEY, '1');
    else browserStorage('local').removeItem(WORK_FLOW_HIDDEN_KEY);
  } catch {
    // 저장소를 못 쓰면 기억하지 않는다(이번 화면 상태만 바뀐다)
  }
}

/** [숨김 여부, 바꾸기]. 처음 값은 저장소에서 한 번 읽는다 */
export function useWorkFlowHidden(): [boolean, (hidden: boolean) => void] {
  const [hidden, setHiddenState] = useState(readWorkFlowHidden);
  const setHidden = useCallback((next: boolean) => {
    writeWorkFlowHidden(next);
    setHiddenState(next);
  }, []);
  return [hidden, setHidden];
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useDemo } from '@/shared/lib/demo';
import { SETUP_WIZARD_PATH } from '../../content';
import { useReadiness } from '../../model/useReadiness';
import { readSetupWizardShown, writeSetupWizardShown } from '../../model/setupWizardSession';

/**
 * 설정 마법사(F-GD-04, D-30) 자동 열기. 대시보드에 둔다(다른 화면으로 바로 온 링크를 가로채지 않게).
 * 이번 브라우저 세션(탭)에서 아직 정하지 않았을 때 한 번만 시작 준비 5가지를 보고:
 * - 할 일이 하나라도 → 표시를 남기고 `/setup`으로 간다(뒤로 가기가 다시 대시보드로 돌아와 되풀이하지 않게 replace)
 * - 모두 완료 → 표시만 남기고 그대로 둔다(열지 않는다)
 * - 받는 중이거나, 할 일 없이 '확인 못함'만 있으면(서버 문제) 아직 정하지 않는다(다음에 대시보드를 열 때 다시 본다)
 * 저장소를 못 쓰면 '정한 것'으로 읽혀 열지 않는다(setupWizardSession.ts). 체험(`/demo`)에서는 열지 않는다.
 */
export function SetupWizardAutoOpen() {
  const demo = useDemo() !== null;
  const [shown] = useState(readSetupWizardShown);
  return shown || demo ? null : <AutoOpenCheck />;
}

function AutoOpenCheck() {
  const navigate = useNavigate();
  const { items, allDone, loading } = useReadiness();
  const decided = useRef(false);
  const hasTodo = items.some((item) => item.state === 'todo');
  const onlyErrors = !hasTodo && items.some((item) => item.state === 'error');

  useEffect(() => {
    if (decided.current || loading || onlyErrors) return;
    decided.current = true;
    writeSetupWizardShown();
    if (!allDone) void navigate(SETUP_WIZARD_PATH, { replace: true });
  }, [allDone, loading, navigate, onlyErrors]);

  return null;
}

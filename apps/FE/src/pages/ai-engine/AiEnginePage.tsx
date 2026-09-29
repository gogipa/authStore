import { Link } from 'react-router';
import { ScreenPlaceholder } from '@/shared/ui';

/** AI 엔진 선택(D-16). 설정의 하위 화면이다. */
export function AiEnginePage() {
  return (
    <ScreenPlaceholder
      screenId="SCR-13"
      title="AI 엔진"
      description="앱이 텍스트·비전 작업에 쓸 엔진을 하나 고릅니다."
      design="AiEngine.dc.html"
      breadcrumb={
        <>
          <Link to="/settings">설정</Link> / AI 엔진
        </>
      }
    />
  );
}

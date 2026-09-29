import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router';
import { isApiRequestError } from '@/shared/api/errors';
import { Banner, Button, PageHeader } from '@/shared/ui';
import styles from './RouteErrorBoundary.module.css';

/** 화면에 보일 오류 글. 서버 오류는 05-3 봉투의 `message`를 그대로 쓴다(03-2 §6.2). */
function errorMessage(error: unknown): string {
  if (isApiRequestError(error)) return error.message;
  if (isRouteErrorResponse(error)) {
    const data: unknown = error.data;
    if (typeof data === 'string' && data.trim() !== '') return data;
    return `${error.status} ${error.statusText}`.trim();
  }
  if (error instanceof Error && error.message) return error.message;
  return '알 수 없는 오류가 났습니다.';
}

/**
 * 화면 오류 경계(05-2 §4-2 옵션 B). `AppLayout` 아래 경로 없는 layout route의 `ErrorBoundary`라서
 * 오류가 나도 왼쪽 내비는 남고, 본문(<main>)에만 오류 봉투의 `message`와 '다시 시도'를 보인다.
 * '다시 시도'는 Query 오류 상태를 풀고 같은 주소로 다시 이동한다. 위치가 바뀌면 React Router가 오류 경계를
 * 풀고 화면을 다시 그린다(페이지를 새로 고치지 않는다, URL·기록은 그대로).
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const location = useLocation();
  const navigate = useNavigate();
  const { reset } = useQueryErrorResetBoundary();

  function retry() {
    reset();
    const { pathname, search, hash, state } = location;
    void navigate({ pathname, search, hash }, { replace: true, state });
  }

  return (
    <>
      <PageHeader
        title="화면을 그리지 못했습니다"
        description="다시 시도해도 같으면 앱을 다시 켜 보세요."
      />
      <Banner tone="blocked" role="alert">
        <p className={styles.message}>{errorMessage(error)}</p>
        {isApiRequestError(error) ? <code className={styles.code}>{error.code}</code> : null}
      </Banner>
      <div>
        <Button variant="primary" onClick={retry}>
          다시 시도
        </Button>
      </div>
    </>
  );
}

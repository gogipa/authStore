import { useLocation } from 'react-router';
import { ButtonLink, PageHeader } from '@/shared/ui';

export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <PageHeader
      title="없는 화면입니다"
      description={
        <>
          주소 <code>{pathname}</code>에 해당하는 화면이 없습니다. 왼쪽 메뉴에서 화면을 고르세요.
        </>
      }
      actions={
        <ButtonLink to="/" variant="primary">
          대시보드로
        </ButtonLink>
      }
    />
  );
}

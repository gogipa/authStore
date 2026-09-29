import { ScreenPlaceholder } from '@/shared/ui';

export function CandidatesPage() {
  return (
    <ScreenPlaceholder
      screenId="SCR-12"
      title="후보 작업"
      description="후보마다 단계 상태를 보고, 멈춘 단계만 골라 실행합니다."
      design="CandidateWork.dc.html"
    />
  );
}

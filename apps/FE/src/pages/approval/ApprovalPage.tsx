import { useParams, useSearchParams } from 'react-router';
import {
  APPROVAL_DESCRIPTION,
  APPROVAL_TITLE,
  approveState,
  preValidationLines,
  preValidationSummary,
  useApprovalQuery,
  usePreValidation,
  type RegistrationOptionType,
} from '@/features/registration';
import { parseCandidateId } from '@/features/step-engine';
import { Banner, PageHeader } from '@/shared/ui';
import { ApprovalStatusBadges } from './ApprovalStatusBadges';
import { ApproveSection } from './ApproveSection';
import { PreValidationPanel } from './PreValidationPanel';
import { PreviewPanel } from './PreviewPanel';
import { UploadSection } from './UploadSection';
import styles from './ApprovalPage.module.css';

/** 옵션 방식 search param(`?optionType=STANDARD` — 표준형 미리보기. 고르는 버튼은 P4-03) */
function optionTypeOf(value: string | null): RegistrationOptionType {
  return value === 'STANDARD' ? 'STANDARD' : 'COMBINATION';
}

/**
 * SCR-08 ⑧⑨ 최종 승인·등록(Approval.dc.html, P4-02 §5 FE `ApprovalPage.tsx`). 후보 작업 틀(CandidateLayout — StepRail 있음) 안 단계
 * 본문: PageHeader('최종 승인', 시안 설명) + ⑧ 이미지 업로드(P4-01) + [전체 미리보기 | 사전 검증 결과] + ⑨ 등록(승인 버튼 자리 —
 * 누른 뒤 동작·등록 모드·차단 스위치는 P4-03). 미리보기(`getCandidateApproval`)와 사전 검증(`runCandidatePreValidation`)은 화면을 열
 * 때 한 번 돌고, SSE `candidate-step.changed`·`gate.invalidated`·`candidate.status-changed`에 다시 돈다(사전 검증은 한 번에 하나).
 * 승인대기가 아니면 두 API가 409라 그 문구를 띠로 보이고 버튼을 끈다. 시안의 M2 요소('승인대기 2건 모아 승인' F-AP-42, 요청 JSON
 * '내려받기' F-AP-49, '20:02가 지나면 … 자동으로' F-AP-52)는 그리지 않는다.
 */
export function ApprovalPage() {
  const { candidateId: rawId = '' } = useParams();
  const [search] = useSearchParams();
  const optionType = optionTypeOf(search.get('optionType'));
  const candidateId = parseCandidateId(rawId);
  const approval = useApprovalQuery(candidateId, optionType);
  const preValidation = usePreValidation(candidateId, optionType, {
    enabled: approval.isSuccess,
  });
  const preview = approval.data;
  const lines = preValidationLines(preValidation.data, preview);
  const summary = preValidation.data ? preValidationSummary(lines) : null;
  const approve = approveState({
    preview,
    previewError: approval.error,
    result: preValidation.data,
    resultError: preValidation.error,
    lines,
  });

  return (
    <>
      <PageHeader title={APPROVAL_TITLE} description={APPROVAL_DESCRIPTION} />
      {candidateId !== null ? (
        <div className={styles.body}>
          <UploadSection
            candidateId={candidateId}
            statusExtra={<ApprovalStatusBadges candidateId={candidateId} />}
          />
          {approval.error ? (
            <Banner tone="warning" role="status">
              {approval.error.message}
            </Banner>
          ) : null}
          <div className={styles.grid}>
            {preview ? <PreviewPanel candidateId={candidateId} preview={preview} /> : null}
            {preview ? (
              <PreValidationPanel
                candidateId={candidateId}
                lines={lines}
                checking={preValidation.isFetching}
                error={preValidation.error}
              />
            ) : null}
          </div>
          <ApproveSection
            preview={preview}
            summaryText={summary ? `사전 검증 ${summary.text}` : null}
            enabled={approve.enabled}
            reason={approve.reason}
          />
        </div>
      ) : null}
    </>
  );
}

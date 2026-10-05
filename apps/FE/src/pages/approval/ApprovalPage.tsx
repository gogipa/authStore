import { useParams, useSearchParams } from 'react-router';
import { APPROVAL_GUIDE, NowMark, ScreenGuidePanel, STEP_GUIDE_COMMON } from '@/features/guide';
import {
  APPROVAL_DESCRIPTION,
  APPROVAL_TITLE,
  approvalBlockersOf,
  approveState,
  duplicateOf,
  lastResultView,
  preValidationLines,
  preValidationSummary,
  useApprovalQuery,
  useCandidateRegistrations,
  usePreValidation,
  useRegistrationSwitch,
  type RegistrationOptionType,
} from '@/features/registration';
import {
  parseCandidateId,
  railByCode,
  STEP_NAME,
  useCandidate,
  useCandidateGates,
  useCandidateSteps,
} from '@/features/step-engine';
import { stepPath } from '@/shared/lib/steps';
import { Banner, PageHeader } from '@/shared/ui';
import { approvalNowKey, approvalNowLinkStep, approvalNowPlace } from './approvalNow';
import { ApprovalStatusBadges } from './ApprovalStatusBadges';
import { PreValidationPanel } from './PreValidationPanel';
import { PreviewPanel } from './PreviewPanel';
import { RegisterSection } from './RegisterSection';
import { RegistrationSwitchBanner } from './RegistrationSwitchBanner';
import { UploadSection } from './UploadSection';
import styles from './ApprovalPage.module.css';

/** 옵션 방식 search param(`?optionType=STANDARD` — 표준형. '표준형으로 바꾸기'가 바꾼다, 승인 전에는 저장하지 않는다) */
function optionTypeOf(value: string | null): RegistrationOptionType {
  return value === 'STANDARD' ? 'STANDARD' : 'COMBINATION';
}

/**
 * SCR-08 ⑧⑨ 최종 승인·등록(Approval.dc.html, P4-02·P4-03 §5 FE). 여정 틀(CandidateLayout — StepRail 있음) 안 단계 본문:
 * PageHeader('최종 승인', 시안 설명) + ⑧ 이미지 업로드(P4-01) + 등록 API 차단 스위치 띠(P4-03) + [전체 미리보기 | 사전 검증 결과] +
 * ⑨ 등록(등록 모드·직전 결과·요청 JSON·승인 바 또는 기존 상품 보기 — P4-03). 미리보기(`getCandidateApproval`)와 사전 검증
 * (`runCandidatePreValidation`)은 화면을 열 때 한 번 돌고, SSE `candidate-step.changed`·`gate.invalidated`·`candidate.status-changed`·
 * `registration.status-changed`에 다시 돈다(사전 검증은 한 번에 하나). 승인대기가 아니면 두 API가 409라 그 문구를 띠로 보이고 버튼을
 * 끄지만, ⑨ 영역은 등록 기록으로 결과를 계속 보인다(드라이런 뒤 VALIDATED 포함). 시안의 M2 요소('승인대기 2건 모아 승인' F-AP-42,
 * 요청 JSON '내려받기' F-AP-49, '20:02가 지나면 … 자동으로' F-AP-52)는 그리지 않는다.
 * 맨 위(머리 아래)에 처음 쓰는 사람용 안내 판(`ScreenGuidePanel`, D-41): 하는 일 · 지금 할 일 · 낯선 말 풀이. 지금 할 일은 화면에 이미 있는 값
 * (⑧ 상태·사전 검증 결과·승인 여부·등록 API 차단 스위치·직전 등록 결과)만 읽어 `approvalNowKey`가 고르고, 그 자리에 '지금 여기'(`NowMark`)를 붙인다.
 */
export function ApprovalPage() {
  const { candidateId: rawId = '' } = useParams();
  const [search, setSearch] = useSearchParams();
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
  // 맨 위 안내(D-41): 하는 일 · 지금 할 일 · 낯선 말 풀이
  const candidateStatus = useCandidate(candidateId).data?.status;
  const rail = useCandidateSteps(candidateId).data;
  const gates = useCandidateGates(candidateId).data?.items;
  const apiBlocked = useRegistrationSwitch().data?.apiBlocked;
  const latest = useCandidateRegistrations(candidateId).data?.content[0] ?? null;
  const upload = railByCode(rail?.items).UPLOAD;
  const blockerStep = preview
    ? null
    : (approvalBlockersOf(rail?.items, gates, () => '', STEP_NAME)[0]?.stepCode ?? null);
  const nowInput = {
    candidateStatus,
    uploadStatus: upload?.status,
    uploadRunBlocked: upload ? !upload.actions.run.enabled : false,
    blockerStep,
    loading: approval.isPending || (approval.isSuccess && preValidation.isPending),
    lines,
    duplicated: duplicateOf(preview?.duplicate, preValidation.data?.duplicate) !== null,
    apiBlocked,
    approveEnabled: approve.enabled,
    canCheckResult: lastResultView(latest).canCheck,
  };
  const nowKey = approvalNowKey(nowInput);
  const nowPlace = approvalNowPlace(nowKey);
  const linkStep = approvalNowLinkStep(nowKey, nowInput);
  const changeOptionType = (next: RegistrationOptionType) => {
    setSearch(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'STANDARD') params.set('optionType', 'STANDARD');
        else params.delete('optionType');
        return params;
      },
      { replace: true },
    );
  };

  return (
    <>
      <PageHeader title={APPROVAL_TITLE} description={APPROVAL_DESCRIPTION} />
      {candidateId !== null ? (
        <div className={styles.body}>
          <ScreenGuidePanel
            guide={APPROVAL_GUIDE}
            nowKey={nowKey}
            linkTo={linkStep ? stepPath(candidateId, linkStep) : undefined}
          />
          <UploadSection
            candidateId={candidateId}
            statusExtra={<ApprovalStatusBadges candidateId={candidateId} />}
            nowActive={nowPlace === 'upload'}
          />
          <NowMark label={STEP_GUIDE_COMMON.nowMark} active={nowPlace === 'switch'}>
            <RegistrationSwitchBanner />
          </NowMark>
          {approval.error ? (
            <Banner tone="warning" role="status">
              {approval.error.message}
            </Banner>
          ) : null}
          <div className={styles.grid}>
            {preview ? (
              <PreviewPanel
                candidateId={candidateId}
                preview={preview}
                onOptionTypeChange={changeOptionType}
              />
            ) : null}
            <NowMark label={STEP_GUIDE_COMMON.nowMark} active={nowPlace === 'validation'}>
              {preview ? (
                <PreValidationPanel
                  candidateId={candidateId}
                  lines={lines}
                  checking={preValidation.isFetching}
                  error={preValidation.error}
                  warnings={preValidation.data?.warnings ?? preview.warnings}
                />
              ) : null}
            </NowMark>
          </div>
          <RegisterSection
            candidateId={candidateId}
            optionType={optionType}
            preview={preview}
            result={preValidation.data}
            summaryText={summary ? `사전 검증 ${summary.text}` : null}
            enabled={approve.enabled}
            reason={approve.reason}
            nowPlace={nowPlace}
          />
        </div>
      ) : null}
    </>
  );
}

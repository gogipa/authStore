import {
  approvalBlockersOf,
  duplicateOf,
  EXISTING_PRODUCT_LABEL,
  existingProductText,
  LAST_RESULT_LABEL,
  lastResultView,
  NO_APPROVAL_TEXT,
  REGISTER_GUIDE,
  REGISTER_MODE_LABEL,
  REGISTER_TITLE,
  registerModeView,
  REQUEST_JSON_LABEL,
  requestSummaryText,
  RESULT_CHECK_LABEL,
  useCandidateRegistrations,
  useCheckRegistrationResult,
  useCreateRegistration,
  useRegistration,
  type ApprovalPreview,
  type PreValidationResult,
  type RegistrationOptionType,
} from '@/features/registration';
import { STEP_NAME, useCandidateGates, useCandidateSteps } from '@/features/step-engine';
import { stepPath } from '@/shared/lib/steps';
import {
  Button,
  Chip,
  DisabledReason,
  Disclosure,
  GateBadge,
  StatusChip,
  stepStatusLabel,
} from '@/shared/ui';
import { ApproveSection } from './ApproveSection';
import styles from './RegisterSection.module.css';

export interface RegisterSectionProps {
  candidateId: number;
  optionType: RegistrationOptionType;
  /** 승인 미리보기(승인대기가 아니면 409라 없다) */
  preview: ApprovalPreview | undefined;
  /** 사전 검증 결과(로컬 + SELLER_CODE 중복 정보·경고) */
  result: PreValidationResult | undefined;
  summaryText: string | null;
  enabled: boolean;
  reason: string | null;
}

/** 직전 결과 칩 색(Chip tone) */
const RESULT_TONE = {
  done: 'done',
  failed: 'failed',
  running: 'running',
  waiting: 'waiting',
  idle: 'idle',
  neutral: 'neutral',
} as const;

/**
 * SCR-08 '⑨ 등록'(Approval.dc.html 맨 아래 — P4-03 §5 FE `RegisterSection.tsx`, F-AP-26~37). 머리 '⑨ 등록' + 상태 칩(등록 기록이 있으면
 * 그 상태를 ⑨ 단계 상태보다 먼저 — ERD `registration` 대응) + G4 배지, [등록 모드 | 직전 결과] 2열, 요청 JSON 요약 + 펼치기, 맨 아래 승인 바.
 * - 등록 모드: '처음 10건은 전시중지로 등록 (3/10)'(미리보기 `liveRegistrationCount`·`initialSuspensionCount` — 05-2 P4-03 칸) + 전시중지 안내
 * - 직전 결과: 등록 기록 이력 맨 앞(`listCandidateRegistrations`) — 상태·한국어 오류·추적 번호(`getRegistration`). 결과확인필요이고
 *   종결 전이면 '결과 확인'(`checkRegistrationResult`). 드라이런 뒤(VALIDATED — 미리보기가 409)도 이 칸이 결과를 보인다(Proposed)
 * - 승인 바: '승인·등록'은 누를 때 `Idempotency-Key`를 한 번 만들고(`useCreateRegistration`) 누르는 동안 잠근다. 202 뒤 폴링하지 않는다
 *   (SSE `registration.status-changed`가 다시 읽힌다)
 * - 중복(로컬 또는 SELLER_CODE)이면 버튼 자리에 '기존 상품 보기': 상품 번호·등록 시각, 누르면 스마트스토어센터 상품 화면을 새 창으로
 *   (주소는 서버가 준 `smartstoreProductUrl` — 화면 소스에 외부 주소를 두지 않는다)
 * 시안의 요청 JSON '내려받기'(M2 F-AP-49)는 그리지 않는다.
 */
export function RegisterSection({
  candidateId,
  optionType,
  preview,
  result,
  summaryText,
  enabled,
  reason,
}: RegisterSectionProps) {
  const registrations = useCandidateRegistrations(candidateId);
  const latest = registrations.data?.content[0] ?? null;
  const detail = useRegistration(latest?.registrationId ?? null).data;
  const last = lastResultView(detail ?? latest);
  const create = useCreateRegistration(candidateId);
  const check = useCheckRegistrationResult(candidateId);
  const steps = useCandidateSteps(candidateId).data;
  const registerStep = steps?.items.find((item) => item.stepCode === 'REGISTER');
  const gates = useCandidateGates(candidateId).data?.items;
  const g4 = gates?.find((item) => item.gate === 'G4');
  // 승인대기가 아니어서 미리보기가 없을 때(예: ⑤를 다시 골라 ⑧이 재실행 필요) 무엇이 막는지와 고칠 단계(US-33 AC6)
  const blockers = preview
    ? []
    : approvalBlockersOf(
        steps?.items,
        gates,
        (status, failureKind) =>
          stepStatusLabel(status, failureKind as Parameters<typeof stepStatusLabel>[1]),
        STEP_NAME,
      ).map((b) => ({ text: b.text, href: stepPath(candidateId, b.stepCode) }));
  const duplicate = duplicateOf(preview?.duplicate, result?.duplicate);
  const mode = registerModeView({
    displayStatusType: preview?.displayStatusType ?? latest?.displayStatusType ?? 'SUSPENSION',
    liveRegistrationCount: preview?.liveRegistrationCount ?? null,
    initialSuspensionCount: preview?.initialSuspensionCount ?? null,
  });

  const onApprove = () => {
    if (!preview) return;
    create.approve({
      optionType,
      expectedUploadResultId: preview.uploadResultId,
      expectedPriceJudgementId: preview.priceJudgementId,
    });
  };

  return (
    <section aria-labelledby="register-title" className={styles.section}>
      <div className={styles.head}>
        <h2 id="register-title" className={styles.title}>
          {REGISTER_TITLE}
        </h2>
        {last.status ? (
          <Chip tone={RESULT_TONE[last.tone]}>{last.status}</Chip>
        ) : registerStep ? (
          <StatusChip status={registerStep.status} />
        ) : null}
        <span className={styles.spacer} />
        <GateBadge gate="G4" state={g4?.passed ? 'passed' : 'pending'} />
      </div>
      <div className={styles.grid}>
        <div className={styles.cell}>
          <span className={styles.label}>{REGISTER_MODE_LABEL}</span>
          <span className={styles.value}>
            {mode.text}
            {mode.count ? <span className={styles.mono}> {mode.count}</span> : null}
          </span>
          <span className={styles.caption}>{mode.note}</span>
        </div>
        <div className={styles.cell}>
          <span className={styles.label}>{LAST_RESULT_LABEL}</span>
          <span className={styles.value}>
            {last.status ?? NO_APPROVAL_TEXT}
            {last.canCheck && latest ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={check.isPending}
                onClick={() => {
                  check.reset();
                  check.mutate(latest.registrationId);
                }}
              >
                {RESULT_CHECK_LABEL}
              </Button>
            ) : null}
          </span>
          {last.message ? (
            <span className={last.tone === 'failed' ? styles.errorText : styles.caption}>
              {last.message}
            </span>
          ) : null}
          {last.traceId ? (
            <span className={styles.caption}>
              추적 번호 <span className={styles.mono}>{last.traceId}</span>
            </span>
          ) : null}
          {check.error ? (
            <span role="alert" className={styles.errorText}>
              {check.error.message}
            </span>
          ) : null}
          <span className={styles.caption}>{REGISTER_GUIDE}</span>
        </div>
      </div>
      {preview ? (
        <div className={styles.json}>
          <Disclosure
            title={REQUEST_JSON_LABEL}
            meta={<span className={styles.caption}>{requestSummaryText(preview)}</span>}
          >
            <pre className={styles.pre} aria-label="요청 JSON 초안">
              {JSON.stringify(preview.requestJsonDraft, null, 2)}
            </pre>
          </Disclosure>
        </div>
      ) : null}
      {duplicate ? (
        <div className={styles.existing}>
          <div className={styles.existingText}>
            <span className={styles.value}>같은 상품·색상이 이미 등록돼 있습니다</span>
            <span className={styles.caption}>{existingProductText(duplicate)}</span>
            {!duplicate.smartstoreProductUrl ? (
              <DisabledReason id="existing-why">
                상품 번호를 몰라 스마트스토어센터 상품 화면을 열 수 없습니다.
              </DisabledReason>
            ) : null}
          </div>
          <Button
            variant="primary"
            disabled={!duplicate.smartstoreProductUrl}
            aria-describedby={!duplicate.smartstoreProductUrl ? 'existing-why' : undefined}
            onClick={() => {
              if (duplicate.smartstoreProductUrl) {
                window.open(duplicate.smartstoreProductUrl, '_blank', 'noopener,noreferrer');
              }
            }}
          >
            {EXISTING_PRODUCT_LABEL}
          </Button>
        </div>
      ) : (
        <ApproveSection
          preview={preview}
          summaryText={summaryText}
          enabled={enabled && preview !== undefined}
          reason={reason}
          onApprove={onApprove}
          pending={create.isPending}
          error={create.error}
          blockers={blockers}
        />
      )}
    </section>
  );
}

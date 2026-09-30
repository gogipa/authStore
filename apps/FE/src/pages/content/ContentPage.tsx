import { useParams } from 'react-router';
import { useContentCopyQuery, useContentFactQuery } from '@/features/content';
import {
  AiEngineSettingsLinkForError,
  CONTENT_GROUP_CODES,
  contentGroupStatus,
  ContinuousRunButton,
  groupLastRunAt,
  parseCandidateId,
  railByCode,
  runButtonLabel,
  useCandidateSteps,
  useStartStepRun,
  type CandidateStepRailItem,
} from '@/features/step-engine';
import { isApiRequestError } from '@/shared/api/errors';
import { formatKstTime } from '@/shared/lib/format';
import { stepPath } from '@/shared/lib/steps';
import { Button, ButtonLink, DisabledReason, StatusChip } from '@/shared/ui';
import styles from './ContentPage.module.css';
import { CopySection } from './CopySection';
import { FactTable } from './FactTable';

const TITLE = '상세 콘텐츠';

/** ⑥ 상태 줄 입력 출처(보드 그대로) */
export const CONTENT_SOURCE_TEXT = '② 소싱 산출물 · ③ 판매 사이즈 · 프로필';
export const NEXT_TAGS_LABEL = '다음: ⑦ 태그';
/** ⑥-3 구획 자리 글(P3-04가 채운다) */
export const NOTICE_PLACEHOLDER_TEXT =
  '⑥-3 고시·사양 블록·구매대행 고지·상품명은 ⑥-1·⑥-2가 끝나면 규칙으로 만듭니다(AI를 쓰지 않습니다).';

/** 단계 하나 실행 버튼(⑥-1·⑥-2 — 보드에는 ⑥ 묶음 '다시 실행'만 있다, P3-03 Proposed) */
function SubRunButton({
  item,
  label,
  pending,
  onRun,
}: {
  item: CandidateStepRailItem | undefined;
  label: string;
  pending: boolean;
  onRun: () => void;
}) {
  if (!item) return null;
  const action = item.actions.run;
  const reason = !action.enabled ? (action.disabledReason?.message ?? null) : null;
  const reasonId = `run-why-${item.stepCode}`;
  return (
    <>
      <Button
        size="sm"
        disabled={pending || reason !== null}
        aria-describedby={reason ? reasonId : undefined}
        onClick={onRun}
      >
        {`${label} ${runButtonLabel(item.status)}`}
      </Button>
      {reason ? (
        <DisabledReason id={reasonId} tone="muted">
          {reason}
        </DisabledReason>
      ) : null}
    </>
  );
}

/**
 * SCR-06 ⑥ 상세 콘텐츠(Content.dc.html, P3-03). 후보 작업 틀(CandidateLayout) 안 단계 본문:
 * - ⑥ 머리: 제목 + 화면 ID + 묶음 상태 줄(상태 칩 · 마지막 실행 · 입력 출처 · '실행'/'다시 실행' = ⑥-1→⑥-2→⑥-3 이어서
 *   (`throughStepCode=NOTICE_HTML`) · '여기부터 연속 실행')
 * - 세부 단계 이동(⑥-1 카피 · ⑥-2 원산지·소재 · ⑥-3 고시·HTML) + '다음: ⑦ 태그'
 * - ⑥-1 카피(`CopySection`) · ⑥-2 원산지·소재(`FactTable`) · ⑥-3 고시·HTML 자리(P3-04가 채운다)
 * 시안의 '문구 검사'(M2 F-CT-38·39)와 '⑥-3 HTML 미리보기'(P3-04)는 만들지 않는다. 결과는 폴링하지 않고 SSE
 * (`step-run.status-changed` COPY·NOTICE_RAW, `content-field.recheck-flagged`)가 산출물을 다시 읽힌다.
 */
export function ContentPage() {
  const { candidateId: rawId = '' } = useParams();
  const candidateId = parseCandidateId(rawId);
  const rail = useCandidateSteps(candidateId);
  const start = useStartStepRun();
  const items = railByCode(rail.data?.items);
  const copyItem = items.COPY;
  const factItem = items.NOTICE_RAW;
  const groupItems = CONTENT_GROUP_CODES.map((code) => items[code]);
  const groupStatus = contentGroupStatus(groupItems);
  const lastAt = groupLastRunAt(groupItems);
  const copy = useContentCopyQuery(copyItem?.currentStepRunId != null ? candidateId : null);
  const fact = useContentFactQuery(factItem?.currentStepRunId != null ? candidateId : null);
  const copyOutput =
    copy.data && copy.data.stepRunId === copyItem?.currentStepRunId ? copy.data : undefined;
  const factOutput =
    fact.data && fact.data.stepRunId === factItem?.currentStepRunId ? fact.data : undefined;
  const runAction = copyItem?.actions.run;
  const runReason =
    runAction && !runAction.enabled ? (runAction.disabledReason?.message ?? null) : null;

  const run = (stepCode: 'COPY' | 'NOTICE_RAW', chain: boolean) => {
    if (candidateId === null) return;
    start.reset();
    start.mutate({
      candidateId,
      stepCode,
      body: chain ? { throughStepCode: 'NOTICE_HTML' } : {},
    });
  };

  return (
    <>
      <title>{`${TITLE} · 신발 자동등록`}</title>
      <h1 className={styles.srOnly}>{TITLE}</h1>
      <section aria-labelledby="step6-title" className={styles.step}>
        <div className={styles.stepHead}>
          <h2 id="step6-title" className={styles.stepTitle}>
            ⑥ 상세 콘텐츠
          </h2>
          <span className={styles.screenId}>SCR-06</span>
          {copyItem ? (
            <div className={styles.bar} data-step="CONTENT">
              <StatusChip status={groupStatus} />
              <span className={styles.caption}>
                마지막 실행 {lastAt ? formatKstTime(lastAt) : '—'}
              </span>
              <span className={styles.caption}>입력 출처: {CONTENT_SOURCE_TEXT}</span>
              {start.error ? (
                <span role="alert" className={styles.failed}>
                  {isApiRequestError(start.error)
                    ? start.error.message
                    : '실행을 요청하지 못했습니다.'}
                  <AiEngineSettingsLinkForError error={start.error} />
                </span>
              ) : null}
              <span className={styles.spacer} />
              <Button
                disabled={start.isPending || runReason !== null}
                aria-describedby={runReason ? 'content-run-why' : undefined}
                onClick={() => run('COPY', true)}
              >
                {runButtonLabel(copyItem.status)}
              </Button>
              {candidateId !== null ? (
                <ContinuousRunButton
                  candidateId={candidateId}
                  stepCode="COPY"
                  action={copyItem.actions.continuousRun}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        {runReason ? (
          <DisabledReason id="content-run-why" className={styles.reasonLine}>
            {runReason}
          </DisabledReason>
        ) : null}
        <div className={styles.subNavRow}>
          <nav aria-label="상세 콘텐츠 세부 단계" className={styles.subNav}>
            <a href="#copy">⑥-1 카피</a>
            <a href="#origin">⑥-2 원산지·소재</a>
            <a href="#notice">⑥-3 고시·HTML</a>
          </nav>
          {candidateId !== null ? (
            <ButtonLink to={stepPath(candidateId, 'TAGS')}>{NEXT_TAGS_LABEL}</ButtonLink>
          ) : null}
        </div>
        {candidateId !== null ? (
          <>
            <CopySection
              key={`copy-${copyOutput?.stepRunId ?? 'none'}`}
              candidateId={candidateId}
              item={copyItem}
              output={copyOutput}
              runAction={
                <SubRunButton
                  item={copyItem}
                  label="⑥-1"
                  pending={start.isPending}
                  onRun={() => run('COPY', false)}
                />
              }
            />
            <FactTable
              key={`fact-${factOutput?.stepRunId ?? 'none'}`}
              candidateId={candidateId}
              item={factItem}
              output={factOutput}
              runAction={
                <SubRunButton
                  item={factItem}
                  label="⑥-2"
                  pending={start.isPending}
                  onRun={() => run('NOTICE_RAW', false)}
                />
              }
            />
            <section id="notice" aria-labelledby="notice-title" className={styles.sub}>
              <div className={styles.subHead}>
                <h2 id="notice-title" className={styles.subTitle}>
                  ⑥-3 고시·HTML
                </h2>
                {items.NOTICE_HTML ? <StatusChip status={items.NOTICE_HTML.status} /> : null}
              </div>
              <p className={styles.placeholder}>{NOTICE_PLACEHOLDER_TEXT}</p>
            </section>
          </>
        ) : null}
      </section>
    </>
  );
}

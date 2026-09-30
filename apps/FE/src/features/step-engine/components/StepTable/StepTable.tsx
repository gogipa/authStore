import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  findCallUsage,
  formatUsageCount,
  pageReadBlockedReason,
  useCallUsageQuery,
} from '@/features/integrations';
import { isCommerceKeyErrorCode, SystemKeyLink } from '@/features/system';
import { isApiRequestError } from '@/shared/api/errors';
import { formatKstTime } from '@/shared/lib/format';
import { stepPath, type StepCode } from '@/shared/lib/steps';
import {
  Button,
  ButtonLink,
  Chip,
  DisabledReason,
  GateBadge,
  Icon,
  StatusChip,
  type GateState,
  type StepFailureKind,
} from '@/shared/ui';
import { useCandidateGates } from '../../api/useContinuousRunQueries';
import {
  useCandidateSteps,
  useOwnerEdit,
  useRefetchCandidate,
  useStartStepRun,
  useStepRuns,
} from '../../api/useStepRunQueries';
import {
  NO_CONTINUOUS_STEPS,
  REGISTER_ONLY_G4_TEXT,
  UPLOAD_NEEDS_G3_TEXT,
} from '../../model/continuousRun';
import { gateStateMap, gateViewsFromList } from '../../model/gateViews';
import { FAILURE_KIND_LABEL } from '../../model/labels';
import {
  CONTENT_GROUP_CODES,
  contentGroupStatus,
  groupLastRunAt,
  inputSourceText,
  lastRunAt,
  railByCode,
  runButtonLabel,
  sourcingSourceText,
  STEP_TABLE_ROWS,
} from '../../model/stepTable';
import type { CandidateDetail, CandidateStepRailItem, StepActionState } from '../../model/types';
import type { ChainStartStepCode } from '../ContinuousRunButton/ContinuousRunButton';
import { ContinuousRunBanner } from '../ContinuousRunBanner/ContinuousRunBanner';
import { ContinuousRunButton } from '../ContinuousRunButton/ContinuousRunButton';
import { RerunAllButton } from '../RerunAllButton/RerunAllButton';
import {
  AiEngineSettingsLinkFor,
  AiEngineSettingsLinkForError,
} from '../AiEngineSettingsLink/AiEngineSettingsLink';
import { StaleInputs } from '../StaleInputs/StaleInputs';
import styles from './StepTable.module.css';

export interface StepTableProps {
  /** 후보 상세(게이트·페이지 데이터 수집 시각·생성 경로) */
  detail: CandidateDetail;
}

const COLUMN_COUNT = 6;
/** G2 줄 설명 id: G2 전 ④ 이후 '여기부터 연속 실행'이 꺼진 이유(시안은 줄마다가 아니라 G2 줄에 한 번 적는다) */
const G2_CHAIN_WHY_ID = 'g2-chain-why';

/**
 * '실행' 꺼진 이유 글. ⑧(G3 전)·⑨는 시안 글, 그 밖은 API disabledReason.message 그대로.
 */
function runReasonText(action: StepActionState | undefined): string | null {
  const reason = action && !action.enabled ? action.disabledReason : null;
  if (!reason) return null;
  if (reason.code === 'GATE_NOT_PASSED' && reason.details?.gate === 'G3') {
    return UPLOAD_NEEDS_G3_TEXT;
  }
  if (reason.code === 'INVALID_STEP_CODE' && reason.details?.reason === 'NOT_RUNNABLE') {
    return REGISTER_ONLY_G4_TEXT;
  }
  return reason.message;
}

/**
 * '여기부터 연속 실행'이 꺼졌을 때 가리킬 이유 글 id. G2 전이면 G2 줄 설명, '실행'과 같은 이유면 그 옆 글, 아니면 없음(버튼 옆에
 * 글을 그린다).
 */
function chainReasonId(
  item: CandidateStepRailItem | undefined,
  runReasonId: string,
): string | undefined {
  const chain = item?.actions.continuousRun;
  if (!chain || chain.enabled || !chain.disabledReason) return undefined;
  if (chain.disabledReason.code === 'CONTINUOUS_RUN_BEFORE_G2') return G2_CHAIN_WHY_ID;
  const run = item.actions.run;
  if (!run.enabled && run.disabledReason?.code === chain.disabledReason.code) return runReasonId;
  return undefined;
}

function timeText(at: string | null): string {
  return at ? formatKstTime(at) : '—';
}

/** 표 전체 폭 한 줄(게이트·안내·펼침) */
function FullRow({
  children,
  id,
  className,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <tr id={id}>
      <td colSpan={COLUMN_COUNT} className={`${styles.full} ${className ?? ''}`}>
        {children}
      </td>
    </tr>
  );
}

/** 꺼진 버튼 + 이유 글(공통부품 §I). 이유 글은 API disabledReason.message 그대로 */
function RunButton({
  id,
  label,
  action,
  pending,
  onRun,
  ariaLabel,
}: {
  id: string;
  label: string;
  action: StepActionState | undefined;
  pending: boolean;
  onRun: () => void;
  ariaLabel?: string;
}) {
  const reason = runReasonText(action);
  const disabled = !action || !action.enabled || pending;
  return (
    <>
      <Button
        size="sm"
        disabled={disabled}
        aria-describedby={reason ? id : undefined}
        aria-label={ariaLabel}
        onClick={onRun}
      >
        {label}
      </Button>
      {reason ? <DisabledReason id={id}>{reason}</DisabledReason> : null}
    </>
  );
}

/** 버전 이력 펼침(F-CW-21): 'v2 14:08 현재 버전', 이전 버전마다 '이전 버전 다시 고르기' */
function VersionHistory({
  candidateId,
  stepCode,
  locked,
}: {
  candidateId: number;
  stepCode: StepCode;
  locked: boolean;
}) {
  const runs = useStepRuns(candidateId, stepCode, { sort: ['version,desc'], size: 20 });
  const restore = useOwnerEdit();
  const content = runs.data?.content ?? [];
  const onlyCurrent = content.length <= 1;
  return (
    <div className={styles.history}>
      <span className={styles.historyLabel}>버전 이력</span>
      {runs.isError ? <span className={styles.error}>{runs.error.message}</span> : null}
      <ul className={styles.versionList} aria-label={`${stepCode} 버전 이력`}>
        {content.map((run) => (
          <li key={run.id} className={styles.version}>
            <span className={styles.mono}>v{run.version}</span>
            <span className={styles.monoMuted}>{timeText(run.endedAt ?? run.startedAt)}</span>
            {run.isCurrent ? <span className={styles.caption}>현재 버전</span> : null}
            {!run.isCurrent && run.status === 'COMPLETED' ? (
              <Button
                size="sm"
                disabled={restore.isPending || locked}
                aria-label={`v${run.version} 이전 버전 다시 고르기`}
                onClick={() =>
                  restore.mutate({
                    candidateId,
                    stepCode,
                    body: { ownerAction: 'RESTORE_VERSION', baseStepRunId: run.id },
                  })
                }
              >
                이전 버전 다시 고르기
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {onlyCurrent && runs.data ? (
        <span className={styles.historyEmpty}>
          <span className={styles.caption}>이전 버전이 없습니다</span>
          <Button size="sm" disabled>
            이전 버전 다시 고르기
          </Button>
        </span>
      ) : null}
      {restore.error ? (
        <span role="alert" className={styles.error}>
          {isApiRequestError(restore.error) ? restore.error.message : '요청을 처리하지 못했습니다.'}
        </span>
      ) : null}
    </div>
  );
}

/** 단계 줄 아래 안내: 입력 대기·실패·재실행 필요 사유·경고 */
function StepNotes({
  candidateId,
  code,
  label,
  item,
}: {
  candidateId: number;
  code: StepCode;
  label: string;
  item: CandidateStepRailItem | undefined;
}) {
  if (!item) return null;
  const run = item.currentRun;
  return (
    <>
      {item.status === 'WAITING_INPUT' ? (
        <FullRow className={styles.note}>
          <span className={styles.waiting}>
            <Icon name="pause" size={14} />
            입력을 기다리고 있습니다. {label} 화면에서 입력을 마치면 이어서 실행합니다.
          </span>
        </FullRow>
      ) : null}
      {item.status === 'FAILED' && run ? (
        <FullRow className={styles.note}>
          <span className={styles.failed}>
            <Icon name="alert" size={14} />
            {run.failureKind ? `${FAILURE_KIND_LABEL[run.failureKind]} · ` : ''}
            {run.errorMessage ?? '실행하지 못했습니다.'}
          </span>
          {/* 커머스API 인증 실패·키 없음(⑧·⑨·P1-08)은 시스템 상태 '키 입력'으로 잇는다(P1-07 규칙 14) */}
          {isCommerceKeyErrorCode(run.errorCode) ? <SystemKeyLink /> : null}
          {/* 선택 AI 엔진을 쓸 수 없어 실패(P1-10 규칙 12, F-BS-76) → 'AI 엔진 설정으로' */}
          <AiEngineSettingsLinkFor code={run.errorCode} />
        </FullRow>
      ) : null}
      {item.status === 'RERUN_REQUIRED' ? (
        <FullRow className={styles.note}>
          <StaleInputs
            candidateId={candidateId}
            stepCode={code}
            staleInputs={item.staleInputs}
            currentStepRunId={item.currentStepRunId}
          />
        </FullRow>
      ) : null}
      {item.warnings.map((warning) => (
        <FullRow key={warning.code} className={styles.note}>
          <div role="note" className={styles.warning}>
            <Icon name="alert" size={16} />
            <span>{warning.message}</span>
          </div>
        </FullRow>
      ))}
    </>
  );
}

/**
 * SCR-12 단계 표(CandidateWork.dc.html, F-CW-11·13·17·18·20·21). 열 '단계·상태·마지막 실행·입력 출처·버전·동작'.
 * - 버튼 켜짐과 꺼진 이유는 API(listCandidateSteps `actions`)가 준 값 그대로다(실행 API 409와 같은 계산).
 * - '실행'·'다시 실행'은 POST 한 번. 결과는 폴링하지 않고 SSE 뒤 표를 다시 읽는다. 다음 단계는 자동으로 시작하지 않는다.
 * - ⑥ 묶음 '실행'은 ⑥-1 → ⑥-2 → ⑥-3(COPY + throughStepCode=NOTICE_HTML). 펼치면 ⑥-1~⑥-3 줄.
 * - ② 페이지 데이터가 판정 유효 시간을 넘으면 '오래됨'(재실행 필요로 바꾸지 않는다). ⑤·⑥-1·⑥-2는 G2 전 AI 비용 경고.
 * - 연속 실행(P1-06): 표 위 '재실행 필요 단계 모두 실행'(RERUN_STALE), 줄마다 '여기부터 연속 실행'(FROM_HERE, 켜짐·꺼진
 *   이유는 레일 `actions.continuousRun`). G2 전 ④ 이후는 G2 줄 설명이 꺼진 이유다. 열린 묶음·방금 시작한 묶음은
 *   `ContinuousRunBanner`로 진행·건너뛴 단계·멈춘 이유를 보인다. 게이트 줄 배지는 `listCandidateGates`로 그린다.
 */
export function StepTable({ detail }: StepTableProps) {
  const candidateId = detail.id;
  const rail = useCandidateSteps(candidateId);
  const gateList = useCandidateGates(candidateId);
  const start = useStartStepRun();
  const refetch = useRefetchCandidate();
  const pageUsage = findCallUsage(useCallUsageQuery().data, 'RAKUTEN_PAGE');
  const refetchBlocked = pageReadBlockedReason(pageUsage);
  // 따라갈 연속 실행: 열린 묶음이 보이면 그것, 아니면 이 화면에서 방금 시작한 묶음(멈춘 뒤에도 이유를 보인다)
  const openChainId = detail.openContinuousRun?.id ?? null;
  const [chainId, setChainId] = useState<number | null>(openChainId);
  if (openChainId !== null && openChainId !== chainId) setChainId(openChainId);
  const [openHistory, setOpenHistory] = useState<StepCode | null>(null);
  /** ⑥ 하위 줄 펼침. null이면 자동(하위 단계에 입력 대기·실패·재실행 필요가 있으면 펼친다) */
  const [groupOpenChoice, setGroupOpen] = useState<boolean | null>(null);
  const items = railByCode(rail.data?.items);
  const gateState = gateStateMap(gateViewsFromList(gateList.data?.items, detail)) as Record<
    'G2' | 'G3' | 'G4',
    GateState
  >;
  const rerunCount = (rail.data?.items ?? []).filter((i) => i.status === 'RERUN_REQUIRED').length;
  const pending = start.isPending || refetch.isPending;

  const run = (stepCode: StepCode, throughNoticeHtml = false) => {
    refetch.reset();
    start.reset();
    start.mutate({
      candidateId,
      stepCode,
      body: throughNoticeHtml ? { throughStepCode: 'NOTICE_HTML' } : {},
    });
  };

  const versionCell = (code: StepCode, no: string, item: CandidateStepRailItem | undefined) => {
    const current = item?.currentRun;
    if (!current) return <span className={styles.muted}>—</span>;
    const open = openHistory === code;
    return (
      <button
        type="button"
        className={styles.versionToggle}
        aria-expanded={open}
        aria-controls={`hist-${code}`}
        aria-label={`${no} 버전 이력 ${open ? '접기' : '펼치기'}`}
        onClick={() => setOpenHistory(open ? null : code)}
      >
        <span className={styles.mono}>v{current.version}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
    );
  };

  const actionCell = (
    code: StepCode,
    label: string,
    item: CandidateStepRailItem | undefined,
    options: { continuous: boolean },
  ) => {
    if (item?.status === 'WAITING_INPUT') {
      return (
        <ButtonLink size="sm" to={stepPath(candidateId, code)}>
          {label} 열기
        </ButtonLink>
      );
    }
    const runReasonId = `run-why-${code}`;
    return (
      <span className={styles.actions}>
        <RunButton
          id={runReasonId}
          label={runButtonLabel(item?.status ?? 'NOT_RUN')}
          action={item?.actions.run}
          pending={pending}
          onRun={() => run(code)}
        />
        {options.continuous ? (
          <ContinuousRunButton
            candidateId={candidateId}
            stepCode={code as ChainStartStepCode}
            action={item?.actions.continuousRun}
            describedBy={chainReasonId(item, runReasonId)}
            ariaLabel={`${label} 여기부터 연속 실행`}
            onStarted={(accepted) => setChainId(accepted.stepChainId)}
          />
        ) : null}
      </span>
    );
  };

  const stepRows = (
    code: StepCode,
    no: string,
    label: string,
    source: string,
    options: { sub?: boolean; continuous: boolean },
  ) => {
    const item = items[code];
    return (
      <Fragment key={code}>
        <tr className={options.sub ? styles.subRow : undefined} data-step={code}>
          <td className={styles.td}>
            <span className={styles.stepName}>
              <span className={options.sub ? styles.subNo : styles.no}>{no}</span>
              {label}
            </span>
          </td>
          <td className={styles.td}>
            {item ? (
              <StatusChip
                status={item.status}
                detail={(item.currentRun?.failureKind ?? null) as StepFailureKind | null}
              />
            ) : (
              <span className={styles.muted}>—</span>
            )}
          </td>
          <td className={`${styles.td} ${styles.num}`}>{timeText(lastRunAt(item))}</td>
          <td className={styles.td}>{inputSourceText(source, item)}</td>
          <td className={styles.td}>{versionCell(code, no, item)}</td>
          <td className={styles.td}>{actionCell(code, label, item, options)}</td>
        </tr>
        {code === 'SOURCING' && detail.pageDataCollectedAt ? (
          <FullRow className={styles.note}>
            <span className={styles.pageData}>
              {detail.pageDataStale ? <Chip tone="waiting">오래됨</Chip> : null}
              <span className={styles.caption}>
                라쿠텐 페이지{' '}
                <span className={styles.monoMuted}>
                  {formatKstTime(detail.pageDataCollectedAt)}
                </span>{' '}
                받음{detail.pageDataStale ? ' · 6시간이 지났습니다' : ''}
              </span>
              {detail.pageDataStale ? (
                <>
                  {pageUsage ? (
                    <span className={styles.caption}>
                      재조회는 페이지 1건 · 오늘{' '}
                      <span className={styles.monoMuted}>{formatUsageCount(pageUsage)}</span>
                    </span>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={pending || refetchBlocked !== null || detail.locked}
                    aria-describedby={refetchBlocked ? 'refetch-why' : undefined}
                    onClick={() => {
                      start.reset();
                      refetch.reset();
                      refetch.mutate(candidateId);
                    }}
                  >
                    재조회
                  </Button>
                  {refetchBlocked ? (
                    <DisabledReason id="refetch-why">{refetchBlocked}</DisabledReason>
                  ) : null}
                </>
              ) : null}
            </span>
          </FullRow>
        ) : null}
        {openHistory === code && item?.currentRun ? (
          <FullRow id={`hist-${code}`} className={styles.note}>
            <VersionHistory candidateId={candidateId} stepCode={code} locked={detail.locked} />
          </FullRow>
        ) : null}
        <StepNotes candidateId={candidateId} code={code} label={label} item={item} />
      </Fragment>
    );
  };

  const groupChildren = CONTENT_GROUP_CODES.map((code) => items[code]);
  const groupStatus = contentGroupStatus(groupChildren);
  const groupAttention = groupChildren.some(
    (i) =>
      i?.status === 'WAITING_INPUT' || i?.status === 'FAILED' || i?.status === 'RERUN_REQUIRED',
  );
  const groupOpen = groupOpenChoice ?? groupAttention;
  const copyItem = items.COPY;

  return (
    <section aria-labelledby="steps-title" className={styles.steps}>
      <div className={styles.head}>
        <div className={styles.titleBlock}>
          <h2 id="steps-title" className={styles.title}>
            단계
          </h2>
          <span className={styles.caption}>
            단계마다 따로 실행하고, 다음 단계는 자동으로 시작하지 않습니다. 실행 중인 단계가 있으면
            그 결과를 읽는 단계와 앞 단계는 끝날 때까지 잠깁니다.
          </span>
        </div>
        <div className={styles.headActions}>
          <RerunAllButton
            id="rerun-all-why"
            candidateId={candidateId}
            rerunCount={rerunCount}
            chainOpen={openChainId !== null}
            locked={detail.locked || detail.status === 'EXCLUDED'}
            onStarted={(accepted) => setChainId(accepted.stepChainId)}
          />
        </div>
      </div>
      {chainId !== null ? (
        <ContinuousRunBanner
          stepChainId={chainId}
          onClose={openChainId === null ? () => setChainId(null) : undefined}
        />
      ) : null}
      {start.error ? (
        <div role="alert" className={styles.alert}>
          {isApiRequestError(start.error) ? start.error.message : '실행을 요청하지 못했습니다.'}{' '}
          <AiEngineSettingsLinkForError error={start.error} />
        </div>
      ) : null}
      {refetch.error ? (
        <div role="alert" className={styles.alert}>
          {isApiRequestError(refetch.error)
            ? refetch.error.message
            : '재조회를 요청하지 못했습니다.'}
        </div>
      ) : null}
      {rail.isError ? <div className={styles.alert}>{rail.error.message}</div> : null}
      <div className={styles.frame}>
        <table className={styles.table} aria-label="단계 표">
          <colgroup>
            <col className={styles.colStep} />
            <col className={styles.colStatus} />
            <col className={styles.colTime} />
            <col />
            <col className={styles.colVersion} />
            <col className={styles.colActions} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={styles.th}>
                단계
              </th>
              <th scope="col" className={styles.th}>
                상태
              </th>
              <th scope="col" className={`${styles.th} ${styles.num}`}>
                마지막 실행
              </th>
              <th scope="col" className={styles.th}>
                입력 출처
              </th>
              <th scope="col" className={styles.th}>
                버전
              </th>
              <th scope="col" className={styles.th}>
                동작
              </th>
            </tr>
          </thead>
          <tbody>
            {STEP_TABLE_ROWS.map((row) => {
              if (row.kind === 'gate') {
                return (
                  <FullRow key={row.gate} className={styles.gateRow}>
                    <span className={styles.gateLine}>
                      <GateBadge gate={row.gate} state={gateState[row.gate]} />
                      <span
                        className={styles.caption}
                        id={row.gate === 'G2' ? G2_CHAIN_WHY_ID : undefined}
                      >
                        {row.text}
                      </span>
                    </span>
                  </FullRow>
                );
              }
              if (row.kind === 'step') {
                const source =
                  row.code === 'SOURCING' ? sourcingSourceText(detail.creationPath) : row.source;
                return stepRows(row.code, row.no, row.label, source, {
                  continuous: !NO_CONTINUOUS_STEPS.includes(row.code),
                });
              }
              const anyRun = groupChildren.some((i) => i && i.status !== 'NOT_RUN');
              return (
                <Fragment key="content-group">
                  <tr data-step="CONTENT">
                    <td className={styles.td}>
                      <span className={styles.stepName}>
                        <span className={styles.no}>{row.no}</span>
                        <span>{row.label}</span>
                        <button
                          type="button"
                          className={styles.groupToggle}
                          aria-expanded={groupOpen}
                          aria-label={`⑥-1 카피, ⑥-2 원산지·소재, ⑥-3 고시·HTML ${groupOpen ? '접기' : '펼치기'}`}
                          onClick={() => setGroupOpen(!groupOpen)}
                        >
                          <Icon name={groupOpen ? 'chevron-up' : 'chevron-down'} size={14} />
                        </button>
                      </span>
                    </td>
                    <td className={styles.td}>
                      <StatusChip status={groupStatus} />
                    </td>
                    <td className={`${styles.td} ${styles.num}`}>
                      {timeText(groupLastRunAt(groupChildren))}
                    </td>
                    <td className={styles.td}>{row.source}</td>
                    <td className={styles.td}>
                      <span className={styles.muted}>—</span>
                    </td>
                    <td className={styles.td}>
                      <span className={styles.actions}>
                        <RunButton
                          id="run-why-CONTENT"
                          label={anyRun ? '다시 실행' : '실행'}
                          ariaLabel={`⑥ 상세 콘텐츠 ${anyRun ? '다시 실행' : '실행'}`}
                          action={copyItem?.actions.run}
                          pending={pending}
                          onRun={() => run('COPY', true)}
                        />
                        <ContinuousRunButton
                          candidateId={candidateId}
                          stepCode="COPY"
                          action={copyItem?.actions.continuousRun}
                          describedBy={chainReasonId(copyItem, 'run-why-CONTENT')}
                          ariaLabel="⑥ 상세 콘텐츠 여기부터 연속 실행"
                          onStarted={(accepted) => setChainId(accepted.stepChainId)}
                        />
                      </span>
                    </td>
                  </tr>
                  <FullRow className={styles.note}>
                    <span className={styles.caption}>
                      &apos;실행&apos;은 ⑥-1 카피 → ⑥-2 원산지·소재 → ⑥-3 고시·HTML을 이어서
                      실행합니다. ⑥-1·⑥-2도 AI를 씁니다. ⑥-3은 ③의 판매 사이즈와{' '}
                      <Link to="/settings" className={styles.link}>
                        구매대행 프로필
                      </Link>
                      (수입자·상호·A/S)이 채워져야 시작합니다.
                    </span>
                  </FullRow>
                  {groupOpen
                    ? row.children.map((child) =>
                        stepRows(child.code, child.no, child.label, child.source, {
                          sub: true,
                          continuous: false,
                        }),
                      )
                    : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

import { Link, useSearchParams } from 'react-router';
import {
  CANDIDATE_STATUS_LABEL,
  CandidateDetailHeader,
  candidateDisplayName,
  EXCLUDED_REASON_LABEL,
  parseCandidateId,
  STEP_NAME,
  stepStatusOf,
  useCandidate,
  useCandidates,
  useCandidateStatusCounts,
  useExcludeCandidate,
  useReopenCandidate,
  type CandidateDetail,
  type CandidateStatus,
  type CandidateSummary,
  type CandidateWarning,
} from '@/features/step-engine';
import { isApiRequestError } from '@/shared/api/errors';
import { cx } from '@/shared/lib/cx';
import { formatCount } from '@/shared/lib/format';
import { isStepCode, stepPath, type StepCode } from '@/shared/lib/steps';
import {
  Banner,
  Button,
  ButtonLink,
  Chip,
  DisabledReason,
  FilterToggleGroup,
  GateBadge,
  PageHeader,
  Panel,
  StatusChip,
  type FilterToggleItem,
} from '@/shared/ui';
import styles from './CandidatesPage.module.css';

/** 목록 필터(CandidateWork.dc.html '후보 거르기'): 전체(진행 중) · 작업중 · 승인대기 · 제외 */
type StatusFilter = 'ALL' | 'WORKING' | 'AWAITING_APPROVAL' | 'EXCLUDED';
const FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'WORKING', label: '작업중' },
  { value: 'AWAITING_APPROVAL', label: '승인대기' },
  { value: 'EXCLUDED', label: '제외' },
];
/** '전체'에 세는 상태(목록 기본값과 같다: EXCLUDED·REGISTERED 뺌) */
const IN_PROGRESS: readonly CandidateStatus[] = [
  'TEMP',
  'WORKING',
  'AWAITING_APPROVAL',
  'VALIDATED',
  'REGISTERING',
  'RESULT_CHECK_REQUIRED',
];
const LIST_SIZE = 100;
const LOCKED: readonly CandidateStatus[] = ['REGISTERING', 'RESULT_CHECK_REQUIRED', 'REGISTERED'];

function parseFilter(value: string | null): StatusFilter {
  return FILTERS.some((f) => f.value === value) ? (value as StatusFilter) : 'ALL';
}

/** 후보 한 줄의 상태 줄: '작업중 · ③ 판정' + 단계 상태 칩, 승인대기면 'G4 최종 승인 · 확인 필요', 제외면 사유 */
function StatusLine({ candidate }: { candidate: CandidateSummary }) {
  const label = CANDIDATE_STATUS_LABEL[candidate.status];
  if (candidate.status === 'AWAITING_APPROVAL' || candidate.status === 'VALIDATED') {
    return (
      <div className={styles.statusLine}>
        <span className={styles.statusText}>{label}</span>
        <GateBadge gate="G4" state="pending" />
      </div>
    );
  }
  if (candidate.status === 'EXCLUDED') {
    return (
      <div className={styles.statusLine}>
        <span className={styles.statusText}>
          {label}
          {candidate.excludedReason ? ` · ${EXCLUDED_REASON_LABEL[candidate.excludedReason]}` : ''}
        </span>
      </div>
    );
  }
  const step = candidate.resumeStepCode;
  const stepStatus = stepStatusOf(candidate.steps, step);
  return (
    <div className={styles.statusLine}>
      <span className={styles.statusText}>{step ? `${label} · ${STEP_NAME[step]}` : label}</span>
      {stepStatus ? <StatusChip status={stepStatus} /> : null}
    </div>
  );
}

function CandidateListItem({
  candidate,
  selected,
  href,
}: {
  candidate: CandidateSummary;
  selected: boolean;
  href: string;
}) {
  return (
    <li className={cx(styles.item, selected && styles.itemSelected)}>
      <Link
        to={href}
        aria-current={selected ? 'true' : undefined}
        className={cx(styles.itemName, selected && styles.itemNameSelected)}
      >
        {candidateDisplayName(candidate)}
      </Link>
      <StatusLine candidate={candidate} />
      {candidate.creationPath === 'RAKUTEN_URL' ? (
        <div className={styles.badges}>
          <Chip tone="neutral">수동</Chip>
          <Chip tone="outline">비교 안 함</Chip>
        </div>
      ) : null}
    </li>
  );
}

/** '입력 고르기'(F-CW-22): 단계 화면을 후보 없이 열었을 때 그 단계를 지금 실행할 수 있는 후보를 고른다 */
function InputPicker({ stepCode }: { stepCode: StepCode }) {
  const runnable = useCandidates({ runnableStep: stepCode, size: LIST_SIZE });
  const rows = runnable.data?.content ?? [];
  return (
    <Panel title="입력 고르기" caption={`${STEP_NAME[stepCode]} 화면에서 작업할 후보를 고릅니다`}>
      {runnable.isError ? <Banner tone="warning">{runnable.error.message}</Banner> : null}
      {rows.length === 0 && !runnable.isPending ? (
        <p className={styles.hint}>
          지금 {STEP_NAME[stepCode]} 단계를 실행할 수 있는 후보가 없습니다.
        </p>
      ) : (
        <ul className={styles.pickList} aria-label="실행할 수 있는 후보">
          {rows.map((candidate) => (
            <li key={candidate.id} className={styles.pickItem}>
              <span className={styles.pickName}>{candidateDisplayName(candidate)}</span>
              <Link to={stepPath(candidate.id, stepCode)} className={styles.link}>
                {STEP_NAME[stepCode]} 열기
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** 고른 후보: 후보 머리(제외·다시 작업) + 단계 표 자리(P1-05) */
function SelectedCandidate({ candidateId }: { candidateId: number }) {
  const candidate = useCandidate(candidateId);
  const exclude = useExcludeCandidate();
  const reopen = useReopenCandidate();
  const detail = candidate.data;
  const mutationError = exclude.error ?? reopen.error;
  const warnings: CandidateWarning[] = reopen.data?.warnings ?? [];

  if (candidate.isError) {
    return (
      <Banner tone="warning">
        {candidate.error.code === 'CANDIDATE_NOT_FOUND'
          ? '후보를 찾을 수 없습니다.'
          : candidate.error.message}
      </Banner>
    );
  }
  if (!detail) return <p className={styles.hint}>후보 정보를 불러오는 중입니다.</p>;

  return (
    <>
      <CandidateDetailHeader
        detail={detail}
        actions={<CandidateActions detail={detail} exclude={exclude} reopen={reopen} />}
      />
      {mutationError ? (
        <Banner tone="blocked" role="alert">
          {isApiRequestError(mutationError) ? mutationError.message : '요청을 처리하지 못했습니다.'}
        </Banner>
      ) : null}
      {warnings.map((w) => (
        <Banner key={w.code} tone="warning">
          {w.message}
        </Banner>
      ))}
      <section aria-labelledby="steps-title" className={styles.steps}>
        <div className={styles.stepsHead}>
          <h2 id="steps-title" className={styles.sectionTitle}>
            단계
          </h2>
          <span className={styles.caption}>
            단계마다 따로 실행하고, 다음 단계는 자동으로 시작하지 않습니다. 실행 중인 단계가 있으면
            그 결과를 읽는 단계와 앞 단계는 끝날 때까지 잠깁니다.
          </span>
        </div>
        <Panel aria-label="단계 표">
          <p className={styles.hint}>단계별 실행·버전 이력은 후보 작업 화면에서 봅니다.</p>
          <div>
            <ButtonLink to={`/candidates/${detail.id}`}>후보 작업 열기</ButtonLink>
          </div>
        </Panel>
      </section>
    </>
  );
}

function CandidateActions({
  detail,
  exclude,
  reopen,
}: {
  detail: CandidateDetail;
  exclude: ReturnType<typeof useExcludeCandidate>;
  reopen: ReturnType<typeof useReopenCandidate>;
}) {
  const busy = exclude.isPending || reopen.isPending;
  if (detail.status === 'EXCLUDED') {
    return (
      <Button
        disabled={busy}
        onClick={() => {
          exclude.reset();
          reopen.mutate(detail.id);
        }}
      >
        다시 작업
      </Button>
    );
  }
  if (LOCKED.includes(detail.status)) {
    return (
      <>
        <Button variant="danger" disabled aria-describedby="exclude-locked">
          후보 제외
        </Button>
        <DisabledReason id="exclude-locked">등록을 진행 중이거나 끝난 후보입니다</DisabledReason>
      </>
    );
  }
  return (
    <Button
      variant="danger"
      disabled={busy}
      onClick={() => {
        reopen.reset();
        exclude.mutate(detail.id);
      }}
    >
      후보 제외
    </Button>
  );
}

/**
 * SCR-12 후보 작업 목록(CandidateWork.dc.html)의 M1 부분.
 * - 왼쪽: '후보' 목록과 필터(전체·작업중·승인대기·제외 + 수, URL `?status=`). 줄마다 표시명·상태·이어 할 단계와 그 상태 칩,
 *   URL 후보는 '수동'·'비교 안 함'. 'URL로 만들기'는 자리만(P2-02가 잇는다).
 * - 오른쪽: `?candidateId=`의 후보 머리(후보 제외·다시 작업)와 단계 표 자리(P1-05), `?runnableStep=`이면 '입력 고르기'.
 * 임시 후보 줄·여러 후보 같은 단계 실행은 M2라 만들지 않는다.
 */
export function CandidatesPage() {
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params.get('status'));
  const selectedId = parseCandidateId(params.get('candidateId'));
  const runnableRaw = params.get('runnableStep');
  const runnableStep = isStepCode(runnableRaw) ? runnableRaw : null;

  const counts = useCandidateStatusCounts();
  const list = useCandidates(
    filter === 'ALL' ? { size: LIST_SIZE } : { status: [filter], size: LIST_SIZE },
  );
  const countOf = (status: CandidateStatus) =>
    counts.data?.items.find((item) => item.status === status)?.count;
  const inProgressCount = counts.data
    ? IN_PROGRESS.reduce((sum, status) => sum + (countOf(status) ?? 0), 0)
    : undefined;
  const filterItems: FilterToggleItem<StatusFilter>[] = FILTERS.map((f) => ({
    value: f.value,
    label: f.label,
    count: f.value === 'ALL' ? inProgressCount : countOf(f.value),
  }));

  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  };
  const hrefFor = (candidateId: number) => {
    const next = new URLSearchParams(params);
    next.set('candidateId', String(candidateId));
    return `/candidates?${next.toString()}`;
  };
  const rows = list.data?.content ?? [];

  return (
    <>
      <PageHeader
        title="후보 작업"
        screenId="SCR-12"
        description="후보마다 단계 상태를 보고, 멈춘 단계만 골라 실행합니다"
      />
      <div className={styles.layout}>
        <section aria-labelledby="list-title" className={styles.listPanel}>
          <div className={styles.listHead}>
            <div className={styles.titleRow}>
              <h2 id="list-title" className={styles.sectionTitle}>
                후보
              </h2>
              {list.data ? (
                <span className={styles.count}>{formatCount(list.data.page.totalElements)}</span>
              ) : null}
            </div>
            <div className={styles.urlCreate}>
              <Button disabled aria-describedby="url-create-reason">
                URL로 만들기
              </Button>
            </div>
          </div>
          <DisabledReason id="url-create-reason" tone="muted">
            라쿠텐 URL로 만들기는 아직 준비 중입니다
          </DisabledReason>
          <FilterToggleGroup
            aria-label="후보 거르기"
            look="soft"
            items={filterItems}
            value={filter}
            onValueChange={(value) => updateParams({ status: value === 'ALL' ? null : value })}
          />
          {list.isError ? <Banner tone="warning">{list.error.message}</Banner> : null}
          {rows.length === 0 && !list.isPending ? (
            <p className={styles.hint}>이 조건의 후보가 없습니다.</p>
          ) : (
            <ul className={styles.list} aria-label="후보 목록">
              {rows.map((candidate) => (
                <CandidateListItem
                  key={candidate.id}
                  candidate={candidate}
                  selected={candidate.id === selectedId}
                  href={hrefFor(candidate.id)}
                />
              ))}
            </ul>
          )}
        </section>
        <div className={styles.detail}>
          {runnableStep ? <InputPicker stepCode={runnableStep} /> : null}
          {selectedId !== null ? (
            <SelectedCandidate key={selectedId} candidateId={selectedId} />
          ) : runnableStep ? null : (
            <Panel aria-label="고른 후보 없음">
              <p className={styles.hint}>왼쪽 목록에서 후보를 고르면 게이트와 단계를 봅니다.</p>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

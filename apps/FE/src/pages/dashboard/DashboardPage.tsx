import { Link } from 'react-router';
import { EMPTY_STATE, ReadinessCard, ScreenHelp, WorkFlowCard } from '@/features/guide';
import { useSettingsQuery } from '@/features/settings';
import {
  CandidateStatusChip,
  candidateDisplayName,
  FAILURE_KIND_LABEL,
  inputKeyLabel,
  resumeStepLabel,
  resumeStepPath,
  resumeTargetLabel,
  resumeTargetPath,
  STEP_DOT_GROUPS,
  STEP_NAME,
  StepDot,
  StepDotLegend,
  stepDots,
  useAttentionSteps,
  useCandidate,
  useCandidates,
  useResumeTarget,
  type CandidateStepAttentionItem,
  type CandidateSummary,
} from '@/features/step-engine';
import { formatCount, formatKstTime } from '@/shared/lib/format';
import { stepPath } from '@/shared/lib/steps';
import {
  Banner,
  ButtonLink,
  DataTable,
  EmptyState,
  Icon,
  PageHeader,
  Panel,
  StatusChip,
  type DataTableColumn,
} from '@/shared/ui';
import styles from './DashboardPage.module.css';

/** 대시보드가 한 번에 읽는 진행 중 후보 수(목록 최대 크기) */
const PROGRESS_PAGE_SIZE = 100;

/** '이어서 할 곳: {후보} · {단계}' + '이어 하기'(Main.dc.html 머리 오른쪽). 이어 할 곳이 없으면(204) 그리지 않는다 */
function ResumeBanner({ names }: { names: ReadonlyMap<number, string> }) {
  const resume = useResumeTarget();
  const target = resume.data ?? null;
  const candidate = useCandidate(target?.candidateId ?? null);
  if (!target) return null;
  const name = candidate.data
    ? candidateDisplayName(candidate.data)
    : (names.get(target.candidateId) ?? `후보 #${target.candidateId}`);
  return (
    <>
      <span className={styles.resumeText}>
        이어서 할 곳: {name} · {resumeTargetLabel(target)}
      </span>
      <ButtonLink to={resumeTargetPath(target)} variant="primary">
        이어 하기
      </ButtonLink>
    </>
  );
}

/** '사유' 칸: 재실행 필요면 바뀐 입력, 실패면 오류 문구, 입력 대기면 기다린 시각 */
function attentionReason(item: CandidateStepAttentionItem): string {
  switch (item.status) {
    case 'RERUN_REQUIRED':
      return item.staleInputs.length > 0
        ? `바뀐 입력: ${item.staleInputs.map(inputKeyLabel).join(', ')}`
        : '앞 단계 값이 바뀌었습니다';
    case 'FAILED':
      return (
        item.errorMessage ??
        (item.failureKind ? FAILURE_KIND_LABEL[item.failureKind] : '실패했습니다')
      );
    case 'WAITING_INPUT':
      return item.waitingSince
        ? `${formatKstTime(item.waitingSince)}부터 입력을 기다립니다`
        : '입력을 기다립니다';
    case 'RUNNING':
      return '실행 중입니다';
    default:
      return '—';
  }
}

function SectionHead({
  id,
  title,
  count,
  caption,
}: {
  id: string;
  title: string;
  count?: number;
  caption?: string;
}) {
  return (
    <div className={styles.sectionHead}>
      <div className={styles.titleRow}>
        <h2 id={id} className={styles.sectionTitle}>
          {title}
        </h2>
        {count !== undefined ? <span className={styles.count}>{formatCount(count)}</span> : null}
      </div>
      {caption ? <span className={styles.caption}>{caption}</span> : null}
    </div>
  );
}

/** '재실행 필요·멈춘 후보'(F-DB-01): 단계 단위 표. '단계 열기'는 그 단계 화면으로 */
function AttentionSection({ names }: { names: ReadonlyMap<number, string> }) {
  const attention = useAttentionSteps();
  const rows = attention.data?.content ?? [];
  const columns: DataTableColumn<CandidateStepAttentionItem>[] = [
    {
      key: 'candidate',
      header: '후보',
      width: 226,
      cell: (row) => (
        <span className={styles.strong}>
          {names.get(row.candidateId) ?? `후보 #${row.candidateId}`}
        </span>
      ),
    },
    { key: 'step', header: '단계', width: 140, cell: (row) => STEP_NAME[row.stepCode] },
    {
      key: 'status',
      header: '상태',
      width: 124,
      cell: (row) => <StatusChip status={row.status} detail={row.failureKind} />,
    },
    { key: 'reason', header: '사유', cell: (row) => attentionReason(row) },
    {
      key: 'action',
      header: '동작',
      width: 96,
      cell: (row) => (
        <Link to={stepPath(row.candidateId, row.stepCode)} className={styles.link}>
          단계 열기
        </Link>
      ),
    },
  ];
  return (
    <section aria-labelledby="stuck-title" className={styles.section}>
      <SectionHead
        id="stuck-title"
        title="재실행 필요·멈춘 후보"
        count={attention.data?.page.totalElements}
        caption="재실행 필요 단계는 자동으로 다시 돌지 않습니다. 단계를 열어 다시 실행하세요."
      />
      {attention.isError ? <Banner tone="warning">{attention.error.message}</Banner> : null}
      <DataTable
        aria-labelledby="stuck-title"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={attention.isPending ? '불러오는 중입니다.' : '재실행 필요·멈춘 단계가 없습니다.'}
      />
    </section>
  );
}

/** '진행 중 후보'(F-CW-09·10): 후보 · 후보 상태 · ②~⑨ 점 · '{단계} 열기'. 선택 체크박스·일괄 실행은 M2 */
function ProgressSection({
  candidates,
  total,
  pending,
  error,
}: {
  candidates: readonly CandidateSummary[];
  total: number | undefined;
  pending: boolean;
  error: string | null;
}) {
  const columns: DataTableColumn<CandidateSummary>[] = [
    {
      key: 'candidate',
      header: '후보',
      cell: (row) => (
        <Link to={`/candidates/${row.id}`} className={styles.candidateLink}>
          {candidateDisplayName(row)}
        </Link>
      ),
    },
    {
      key: 'status',
      header: '후보 상태',
      width: 112,
      cell: (row) => <CandidateStatusChip status={row.status} />,
    },
    ...STEP_DOT_GROUPS.map((group, index): DataTableColumn<CandidateSummary> => ({
      key: `dot-${group.no}`,
      header: group.no,
      align: 'center',
      width: 46,
      cell: (row) => {
        const dot = stepDots(row.steps)[index]!;
        return <StepDot no={dot.no} status={dot.status} />;
      },
    })),
    {
      key: 'resume',
      header: '이어 하기',
      width: 150,
      cell: (row) => (
        <Link to={resumeStepPath(row.id, row.resumeStepCode)} className={styles.link}>
          {resumeStepLabel(row.resumeStepCode)} 열기
        </Link>
      ),
    },
  ];
  return (
    <section aria-labelledby="progress-title" className={styles.section}>
      <SectionHead id="progress-title" title="진행 중 후보" count={total} />
      {error ? <Banner tone="warning">{error}</Banner> : null}
      <DataTable
        aria-labelledby="progress-title"
        columns={columns}
        rows={candidates}
        rowKey={(row) => row.id}
        empty={
          pending ? (
            '불러오는 중입니다.'
          ) : (
            // 빈 상태 안내(F-GD-03, D-29): 다음 행동 버튼
            <EmptyState
              title={EMPTY_STATE.dashboardProgress.title}
              actions={
                <>
                  <ButtonLink to={EMPTY_STATE.dashboardProgress.primary.to} size="sm">
                    {EMPTY_STATE.dashboardProgress.primary.label}
                  </ButtonLink>
                  <ButtonLink to={EMPTY_STATE.dashboardProgress.secondary.to} size="sm">
                    {EMPTY_STATE.dashboardProgress.secondary.label}
                  </ButtonLink>
                </>
              }
            >
              {EMPTY_STATE.dashboardProgress.text}
            </EmptyState>
          )
        }
      />
      <StepDotLegend />
    </section>
  );
}

/**
 * 시스템 경고의 '설정 파일 검사' 줄(P1-03이 P1-04에 맡긴 줄, `getSettings`). 같은 칸의 공지 변경·자격증명 만료 줄은 M2라
 * 그리지 않는다(Proposed P1-04).
 */
function SystemWarnings() {
  const settings = useSettingsQuery();
  const errors = settings.data?.errors.length ?? 0;
  const passed = settings.data?.valid === true;
  return (
    <Panel
      title="시스템 경고"
      actions={
        <Link to="/system" className={styles.link}>
          시스템 상태 보기
        </Link>
      }
    >
      <div className={styles.checkRow}>
        {settings.isPending ? (
          <span className={styles.caption}>설정 파일 검사 결과를 불러오는 중입니다.</span>
        ) : passed ? (
          <>
            <span className={styles.passChip}>
              <Icon name="check" size={12} strokeWidth={2.5} />
              통과
            </span>
            <span>설정 파일 검사 · 앱을 켤 때 오류 없음</span>
          </>
        ) : (
          <>
            <span className={styles.failChip}>
              <Icon name="alert" size={12} strokeWidth={2.5} />
              {errors > 0 ? `오류 ${formatCount(errors)}건` : '오류'}
            </span>
            <span>
              설정 파일 검사 ·{' '}
              <Link to="/settings" className={styles.link}>
                설정 화면에서 확인
              </Link>
            </span>
          </>
        )}
      </div>
    </Panel>
  );
}

/**
 * SCR-01 대시보드(Main.dc.html)의 M1 부분: 이어서 할 곳, 재실행 필요·멈춘 후보, 진행 중 후보(②~⑨ 점), 설정 파일 검사.
 * D-29(화면시안_명세 §8): 머리 아래 맨 위에 '시작 준비'(F-DB-10), 그 아래 '작업 흐름'(F-DB-11, 숨길 수 있음) 카드,
 * 제목 옆 '?' 도움말(F-GD-02), 진행 중 후보가 없을 때 다음 행동 버튼(F-GD-03).
 * M2 부분(오늘 처리량·단계별 대기 건수·조치 필요·등록 한도·판매상품비중·공지·자격증명 경고·일괄 실행)은 만들지 않는다.
 * 값은 SSE `candidate.status-changed`·`candidate-step.changed`가 오면 다시 읽는다(폴링하지 않는다).
 */
export function DashboardPage() {
  const inProgress = useCandidates({ size: PROGRESS_PAGE_SIZE });
  const candidates = inProgress.data?.content ?? [];
  const names = new Map(candidates.map((c) => [c.id, candidateDisplayName(c)]));

  return (
    <>
      <PageHeader
        title="대시보드"
        description="오늘 할 일과 멈춘 곳을 봅니다"
        actions={<ResumeBanner names={names} />}
        help={<ScreenHelp screen="dashboard" />}
      />
      <ReadinessCard />
      <WorkFlowCard variant="dashboard" />
      <div className={styles.layout}>
        <div className={styles.main}>
          <AttentionSection names={names} />
          <ProgressSection
            candidates={candidates}
            total={inProgress.data?.page.totalElements}
            pending={inProgress.isPending}
            error={inProgress.isError ? inProgress.error.message : null}
          />
        </div>
        <div className={styles.side}>
          <SystemWarnings />
        </div>
      </div>
    </>
  );
}

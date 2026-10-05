import { useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { type DemoInfo, type DemoNextAction, useDemo } from '@/shared/lib/demo';
import { Button, ButtonLink, Icon, ProgressBar } from '@/shared/ui';
import { DEMO_GUIDE_TEXT, DEMO_TEXT, fillText, type DemoGuideActionId } from '../../content';
import styles from './DemoBanner.module.css';

/**
 * 체험을 끝내고 갈 곳: basename(`/demo`) 밖 앱 첫 화면 `/`의 절대 주소. 라우터는 basename 밖 주소를 바깥 링크로 보고
 * 전체 이동한다(체험 앱을 내리고 보통 앱을 처음부터 켠다).
 */
function appHomeUrl(): string {
  return `${window.location.origin}/`;
}

/** 다음 할 일이 있는 화면 이름(경로 끝 조각으로 찾는다 — `/keywords`, `/candidates/1/sourcing` …). 모르면 null */
function screenNameOf(path: string): string | null {
  const key = path.split('/').filter(Boolean).pop() ?? '';
  return Object.prototype.hasOwnProperty.call(DEMO_GUIDE_TEXT.screens, key)
    ? DEMO_GUIDE_TEXT.screens[key as keyof typeof DEMO_GUIDE_TEXT.screens]
    : null;
}

const isActionId = (id: string): id is DemoGuideActionId => id in DEMO_GUIDE_TEXT.actions;

/**
 * 다음에 할 일의 단계 이름과 글. 일 19개는 `actions` 표에서 찾고, 지금 상태에 따라 갈리는 것은 따로 있다:
 * 재실행 필요 단계가 있을 때(`rerunStale` — 단계 이름 목록을 채우고, 버튼이 거절될 때는 `rerunStaleNeedsG2`·`rerunStaleNeedsStep`),
 * 등록 API 차단이 꺼진 채 첫 승인을 할 때(`approveBlockOff`)
 */
function nextLineOf(next: DemoNextAction | null): { step: string; text: string } | null {
  if (!next) return null;
  if (next.id === 'rerunStale') {
    return {
      step: DEMO_GUIDE_TEXT.rerunStaleStep,
      text: [
        fillText(DEMO_GUIDE_TEXT.rerunStale, { steps: next.params?.steps ?? '' }),
        // ③이 다시 돌면 판매가가 달라져 G2가 풀릴 수 있다 — 그때만 G2 안내를 잇는다
        next.params?.g2 ? DEMO_GUIDE_TEXT.rerunStaleG2 : '',
      ]
        .filter(Boolean)
        .join(' '),
    };
  }
  // 버튼이 지금 거절될 때(BE 시작 검사와 같다): 막은 것을 먼저 알린다
  if (next.id === 'rerunStaleNeedsG2') {
    return {
      step: DEMO_GUIDE_TEXT.rerunStaleStep,
      text: fillText(DEMO_GUIDE_TEXT.rerunStaleNeedsG2, { steps: next.params?.steps ?? '' }),
    };
  }
  if (next.id === 'rerunStaleNeedsStep') {
    return {
      step: DEMO_GUIDE_TEXT.rerunStaleStep,
      text: fillText(DEMO_GUIDE_TEXT.rerunStaleNeedsStep, {
        steps: next.params?.steps ?? '',
        blocker: next.params?.blocker ?? '',
      }),
    };
  }
  if (next.id === 'approveBlockOff') {
    return {
      step: DEMO_GUIDE_TEXT.actions.approveDryRun.step,
      text: DEMO_GUIDE_TEXT.approveBlockOff,
    };
  }
  return isActionId(next.id) ? DEMO_GUIDE_TEXT.actions[next.id] : null;
}

/**
 * 체험 띠(F-GD-05, D-31·D-32, 화면시안_명세 §9). 앱 틀이 모든 화면 본문 맨 위에 둔다(sticky). 체험(`DemoContext`)에서만 그린다.
 * - 윗줄: '체험 — …' + [등록된 여정 보기](⑨까지 갔을 때만 — 등록된 여정은 M1 목록에 보이지 않아 여기서 연다) + [처음부터 다시] + [체험 끝내기]
 * - 따라 하기 줄: '{끝낸 수}/{전체}단계' + 진행 막대 + 다음에 할 일 한 문장(`role="status"` — 바뀌는 글을 화면 읽기 프로그램이
 *   알리되 초점은 옮기지 않는다) + 지금 그 화면이 아니면 [{화면 이름} 화면 열기]. 글은 체험 모델의 지금 상태를 따라가서, 마음대로 돌아다녀도 맞다
 */
export function DemoBanner() {
  const demo = useDemo();
  return demo ? <DemoBannerBody demo={demo} /> : null;
}

function DemoBannerBody({ demo }: { demo: DemoInfo }) {
  const { guide } = demo;
  const progress = useSyncExternalStore(guide.subscribe, guide.getSnapshot);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const next = progress.next;
  const action = nextLineOf(next);
  const elsewhere = next !== null && pathname !== next.path;
  const screenName = next ? screenNameOf(next.path) : null;

  const restart = () => {
    guide.reset();
    // 처음 상태에는 여정이 없다 — 보던 여정 화면이 '없는 여정'이 되지 않게, 첫 할 일이 있는 키워드 화면으로(체험 안에 머문다)
    void navigate('/keywords');
  };

  return (
    <section className={styles.banner} aria-label={DEMO_TEXT.label} data-demo-banner>
      <div className={styles.top}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name="alert" size={18} />
        </span>
        <p className={styles.message}>
          <strong className={styles.label}>{DEMO_TEXT.label}</strong> — {DEMO_TEXT.text}
        </p>
        <div className={styles.actions}>
          {progress.registered && progress.candidateId !== null ? (
            <ButtonLink to={`/candidates/${progress.candidateId}`} size="sm">
              {DEMO_TEXT.candidate}
            </ButtonLink>
          ) : null}
          <Button size="sm" onClick={restart}>
            {DEMO_GUIDE_TEXT.restart}
          </Button>
          <ButtonLink to={appHomeUrl()} reloadDocument size="sm">
            {DEMO_TEXT.exit}
          </ButtonLink>
        </div>
      </div>
      <div className={styles.guide}>
        <span className={styles.count}>
          {fillText(DEMO_GUIDE_TEXT.progress, { done: progress.done, total: progress.total })}
        </span>
        <div className={styles.bar}>
          <ProgressBar
            aria-label={DEMO_GUIDE_TEXT.progressLabel}
            value={progress.done}
            max={progress.total}
            valueText={fillText(DEMO_GUIDE_TEXT.progress, {
              done: progress.done,
              total: progress.total,
            })}
          />
        </div>
        <p className={styles.next} role="status">
          {progress.busy ? (
            DEMO_GUIDE_TEXT.busy
          ) : action ? (
            <>
              <strong className={styles.step}>{action.step}</strong> {action.text}
            </>
          ) : (
            DEMO_GUIDE_TEXT.finished
          )}
        </p>
        {elsewhere && !progress.busy ? (
          <ButtonLink to={next.path} size="sm">
            {screenName
              ? fillText(DEMO_GUIDE_TEXT.open, { screen: screenName })
              : DEMO_GUIDE_TEXT.openFallback}
            <Icon name="arrow-right" size={16} />
          </ButtonLink>
        ) : null}
      </div>
    </section>
  );
}

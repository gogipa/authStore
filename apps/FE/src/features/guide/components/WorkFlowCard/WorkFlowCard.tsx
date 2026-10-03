import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { Banner, Button, ButtonLink, Chip, Icon, Panel } from '@/shared/ui';
import { WORK_FLOW_STEPS, WORK_FLOW_TEXT, type WorkFlowStep } from '../../content';
import { useWorkFlowHidden } from '../../model/useWorkFlowHidden';
import styles from './WorkFlowCard.module.css';

export interface WorkFlowCardProps {
  /**
   * dashboard: 대시보드(F-DB-11). '다시 보지 않기'로 숨기고, 숨겼으면 그리지 않는다.
   * guide: 사용 안내 화면(F-GD-01). 늘 보이고, 대시보드에서 숨겼으면 '대시보드에 다시 보이기'를 둔다.
   */
  variant: 'dashboard' | 'guide';
  /** 패널 id(사용 안내의 `#flow`) */
  id?: string;
}

function stepTitle(step: WorkFlowStep): string {
  return step.no ? `${step.no} ${step.label}` : step.label;
}

/**
 * '작업 흐름' 카드(D-29, 화면시안_명세 §8): ① 키워드 → … → 승인 → ⑨ 등록. 단계는 가로 탭(`role="tablist"`,
 * ←→·Home·End로 옮기면 바로 고른다)이고, 고른 단계의 하는 일·앱이 하는 것·사람이 확인할 것과 그 화면 링크를 보인다.
 * '다시 보지 않기'는 이 브라우저에만 기억한다(localStorage, 못 쓰면 이번 화면에서만 숨김).
 * 누른 버튼이 사라지는 두 곳('다시 보지 않기'·'대시보드에 다시 보이기')은 초점을 그 자리에 새로 보이는 안내 글로 옮긴다(tabIndex -1).
 */
export function WorkFlowCard({ variant, id }: WorkFlowCardProps) {
  const base = `work-flow-${useId()}`;
  const [hidden, setHidden] = useWorkFlowHidden();
  const [justHidden, setJustHidden] = useState(false);
  const [justShown, setJustShown] = useState(false);
  const [selected, setSelected] = useState(WORK_FLOW_STEPS[0]!.key);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const dismissedNote = useRef<HTMLDivElement>(null);
  const shownNote = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (justHidden) dismissedNote.current?.focus();
  }, [justHidden]);
  useEffect(() => {
    if (justShown) shownNote.current?.focus();
  }, [justShown]);

  if (variant === 'dashboard' && hidden) {
    return justHidden ? (
      <div ref={dismissedNote} tabIndex={-1} className={styles.dismissedNote}>
        <Banner
          tone="info"
          role="status"
          actions={
            <Link to={WORK_FLOW_TEXT.dismissedLink.to} className={styles.link}>
              {WORK_FLOW_TEXT.dismissedLink.label}
            </Link>
          }
        >
          {WORK_FLOW_TEXT.dismissed}
        </Banner>
      </div>
    ) : null;
  }

  const index = Math.max(
    0,
    WORK_FLOW_STEPS.findIndex((step) => step.key === selected),
  );
  const current = WORK_FLOW_STEPS[index]!;

  const select = (next: number) => {
    const step = WORK_FLOW_STEPS[(next + WORK_FLOW_STEPS.length) % WORK_FLOW_STEPS.length]!;
    setSelected(step.key);
    refs.current.get(step.key)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: WORK_FLOW_STEPS.length - 1,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  };

  const tabId = (key: string) => `${base}-tab-${key}`;
  const panelId = `${base}-panel`;

  return (
    <Panel
      id={id}
      title={WORK_FLOW_TEXT.title}
      caption={WORK_FLOW_TEXT.caption}
      actions={
        variant === 'dashboard' ? (
          <Button
            size="sm"
            onClick={() => {
              setHidden(true);
              setJustHidden(true);
            }}
          >
            {WORK_FLOW_TEXT.dismiss}
          </Button>
        ) : undefined
      }
    >
      {variant === 'guide' && hidden ? (
        <div className={styles.hiddenNote}>
          <span>{WORK_FLOW_TEXT.hiddenOnDashboard}</span>
          <Button
            size="sm"
            onClick={() => {
              setHidden(false);
              setJustShown(true);
            }}
          >
            {WORK_FLOW_TEXT.showOnDashboard}
          </Button>
        </div>
      ) : null}
      {variant === 'guide' && justShown && !hidden ? (
        <p ref={shownNote} tabIndex={-1} role="status" className={styles.shownNote}>
          {WORK_FLOW_TEXT.shownOnDashboard}
        </p>
      ) : null}
      <div role="tablist" aria-label={WORK_FLOW_TEXT.tabsLabel} className={styles.steps}>
        {WORK_FLOW_STEPS.map((step, i) => {
          const isSelected = step.key === current.key;
          return (
            <div key={step.key} role="presentation" className={styles.stepCell}>
              {i > 0 ? (
                <span className={styles.arrow} aria-hidden="true">
                  <Icon name="arrow-right" size={14} />
                </span>
              ) : null}
              <button
                ref={(node) => {
                  if (node) refs.current.set(step.key, node);
                  else refs.current.delete(step.key);
                }}
                type="button"
                role="tab"
                id={tabId(step.key)}
                aria-selected={isSelected}
                aria-controls={panelId}
                tabIndex={isSelected ? 0 : -1}
                className={styles.step}
                data-gate={step.gate ? 'true' : undefined}
                onClick={() => setSelected(step.key)}
                onKeyDown={onKeyDown}
              >
                {step.no ? (
                  <>
                    <span className={styles.no}>{step.no}</span>{' '}
                  </>
                ) : null}
                <span>{step.label}</span>
              </button>
            </div>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(current.key)}
        className={styles.detail}
      >
        <div className={styles.detailHead}>
          <h3 className={styles.detailTitle}>{stepTitle(current)}</h3>
          {current.gate ? <Chip tone="outline">{current.gate}</Chip> : null}
          <ButtonLink to={current.link.to} size="sm" className={styles.open}>
            {current.link.label}
          </ButtonLink>
        </div>
        <dl className={styles.columns}>
          <div className={styles.column}>
            <dt className={styles.term}>{WORK_FLOW_TEXT.does}</dt>
            <dd className={styles.desc}>{current.does}</dd>
          </div>
          <div className={styles.column}>
            <dt className={styles.term}>{WORK_FLOW_TEXT.auto}</dt>
            <dd className={styles.desc}>{current.auto}</dd>
          </div>
          <div className={styles.column}>
            <dt className={styles.term}>{WORK_FLOW_TEXT.check}</dt>
            <dd className={styles.desc}>{current.check}</dd>
          </div>
        </dl>
      </div>
      <p className={styles.note}>{WORK_FLOW_TEXT.note}</p>
    </Panel>
  );
}

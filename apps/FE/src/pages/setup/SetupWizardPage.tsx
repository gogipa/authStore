import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  DemoEntry,
  fillText,
  READINESS_INFO,
  READINESS_TEXT,
  ReadinessRows,
  SETUP_WIZARD_STEPS,
  SETUP_WIZARD_TEXT,
  switchInfoText,
  TRAINING_TEXT,
  useReadiness,
  writeSetupWizardShown,
  type Readiness,
  type ReadinessItemView,
} from '@/features/guide';
import { type SecretKey, SecretKeysPanel } from '@/features/system';
import { Button, ButtonLink, Icon, PageHeader } from '@/shared/ui';
import styles from './SetupWizardPage.module.css';

/** 3단계 '키 넣기'에서 여는 키(커머스API·라쿠텐). 환율 키는 시스템 상태에서 */
const SETUP_SECRET_KEYS: readonly SecretKey[] = [
  'COMMERCE_CLIENT_ID',
  'COMMERCE_CLIENT_SECRET',
  'RAKUTEN_APPLICATION_ID',
  'RAKUTEN_ACCESS_KEY',
];

/** 단계 키 → '지금 상태'에 보일 시작 준비 항목 */
const STEP_ITEMS: Readonly<Record<string, readonly ReadinessItemView['key'][]>> = {
  aiEngine: ['AI_ENGINE', 'IMAGE_TOOL'],
  keys: ['COMMERCE_KEYS', 'RAKUTEN_KEYS'],
  profile: ['PROFILE'],
  done: ['COMMERCE_KEYS', 'RAKUTEN_KEYS', 'AI_ENGINE', 'IMAGE_TOOL', 'PROFILE'],
};

/** 체험 입구 [체험해 보기]를 보이는 단계(6 체험해 보기·7 준비 끝) */
const DEMO_ENTRY_STEPS: ReadonlySet<string> = new Set(['demo', 'done']);

function stepIndex(raw: string | null): number {
  const n = Number(raw ?? '1');
  if (!Number.isInteger(n)) return 0;
  return Math.min(Math.max(n, 1), SETUP_WIZARD_STEPS.length) - 1;
}

/** 단계마다 '지금 상태'(시작 준비 모델에서 그대로) */
function StepStatus({ stepKey, readiness }: { stepKey: string; readiness: Readiness }) {
  const keys = STEP_ITEMS[stepKey];
  if (stepKey === 'welcome') {
    return (
      <dl className={styles.facts}>
        <div>
          <dt>{READINESS_TEXT.title}</dt>
          <dd>
            {fillText(READINESS_TEXT.progress, {
              total: readiness.total,
              done: readiness.done,
            })}
          </dd>
        </div>
        <div>
          <dt>{READINESS_INFO.SWITCH.label}</dt>
          <dd>{switchInfoText(readiness.apiBlocked)}</dd>
        </div>
      </dl>
    );
  }
  if (stepKey === 'training') return <p className={styles.note}>{SETUP_WIZARD_TEXT.noCheck}</p>;
  if (!keys) return null;
  return (
    <ReadinessRows
      label={SETUP_WIZARD_TEXT.statusTitle}
      items={readiness.items.filter((item) => keys.includes(item.key))}
    />
  );
}

/** 단계마다 더 보이는 것(키 입력 칸·학습 끄는 곳) */
function StepExtra({ stepKey }: { stepKey: string }): ReactNode {
  if (stepKey === 'keys') return <SecretKeysPanel keys={SETUP_SECRET_KEYS} />;
  if (stepKey === 'training') {
    return (
      <ul className={styles.points}>
        {TRAINING_TEXT.items.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    );
  }
  return null;
}

/**
 * SCR-15 설정 마법사(`/setup`, F-GD-04, D-30 — 보드 없음, 화면시안_명세 §9). 처음 쓰기 전에 할 준비를 7단계로 한다:
 * 환영(안전장치) → AI 엔진 연결 → 키 넣기 → 구매대행 프로필 → AI 계정 학습 끄기 → 체험해 보기 → 준비 끝.
 * - 단계는 주소 `?step=N`(뒤로 가기·새로 고침이 그대로). 단계를 바꾸면 초점이 단계 제목(h2)으로 간다
 * - '지금 상태'는 대시보드 '시작 준비'와 같은 모델(`useReadiness`). 새 점검을 돌리지 않는다
 * - 6·7단계에 체험 입구 [체험해 보기](`/demo` 새 탭, D-31). 체험 안에서는 '지금 체험 중' 글
 * - [건너뛰기]는 늘 있다. 이 화면을 열면 이번 세션 자동 열기를 끝낸 것으로 남긴다(대시보드가 다시 끌어오지 않게)
 * - 입구: 대시보드 '시작 준비' 카드(할 일이 남은 동안)·설정 화면 머리·사용 안내. 예전 주소 `/welcome`은 여기로 온다
 * - 화면 도움말 '?'는 달지 않는다(이 화면이 안내다)
 */
export function SetupWizardPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const index = stepIndex(params.get('step'));
  const step = SETUP_WIZARD_STEPS[index]!;
  const total = SETUP_WIZARD_STEPS.length;
  const last = index === total - 1;
  const readiness = useReadiness();
  const headingId = `setup-step-${useId()}`;
  const heading = useRef<HTMLHeadingElement>(null);
  const shownIndex = useRef(index);

  useEffect(() => {
    writeSetupWizardShown();
  }, []);

  // 단계가 바뀌면(처음 열 때는 빼고) 단계 제목으로 초점을 옮긴다
  useEffect(() => {
    if (shownIndex.current === index) return;
    shownIndex.current = index;
    heading.current?.focus();
  }, [index]);

  const go = (next: number) => setParams(next === 0 ? {} : { step: String(next + 1) });
  const leave = () => {
    writeSetupWizardShown();
    void navigate('/');
  };

  return (
    <>
      <PageHeader
        title={SETUP_WIZARD_TEXT.title}
        description={SETUP_WIZARD_TEXT.description}
        actions={<Button onClick={leave}>{SETUP_WIZARD_TEXT.skip}</Button>}
      />
      <div className={styles.layout}>
        <nav aria-label={SETUP_WIZARD_TEXT.stepsLabel} className={styles.nav}>
          <ol className={styles.stepList}>
            {SETUP_WIZARD_STEPS.map((item, i) => (
              <li key={item.key}>
                <button
                  type="button"
                  className={styles.stepButton}
                  aria-current={i === index ? 'step' : undefined}
                  onClick={() => go(i)}
                >
                  <span className={styles.stepNo}>{i + 1}</span>
                  <span>{item.title}</span>
                  {i < index ? <Icon name="check" size={16} /> : null}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section className={styles.panel} aria-labelledby={headingId} data-step={step.key}>
          <p className={styles.progress}>
            {fillText(SETUP_WIZARD_TEXT.progress, { total, current: index + 1 })}
          </p>
          <h2 id={headingId} ref={heading} tabIndex={-1} className={styles.title}>
            {step.title}
          </h2>
          <p className={styles.lead}>{step.lead}</p>
          {step.points.length > 0 ? (
            <ul className={styles.points}>
              {step.points.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
          <StepExtra stepKey={step.key} />
          {step.key !== 'demo' ? (
            <div className={styles.status}>
              <h3 className={styles.statusTitle}>{SETUP_WIZARD_TEXT.statusTitle}</h3>
              <StepStatus stepKey={step.key} readiness={readiness} />
            </div>
          ) : null}
          {step.link || DEMO_ENTRY_STEPS.has(step.key) ? (
            <div className={styles.links}>
              {step.link ? (
                <ButtonLink to={step.link.to} size="sm">
                  {step.link.label}
                </ButtonLink>
              ) : null}
              {DEMO_ENTRY_STEPS.has(step.key) ? <DemoEntry /> : null}
            </div>
          ) : null}
          <div className={styles.footer}>
            {index > 0 ? (
              <Button onClick={() => go(index - 1)}>{SETUP_WIZARD_TEXT.prev}</Button>
            ) : null}
            <span className={styles.spacer} />
            {last ? (
              <Button variant="primary" onClick={leave}>
                {SETUP_WIZARD_TEXT.finish}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => go(index + 1)}>
                {SETUP_WIZARD_TEXT.next}
                <Icon name="arrow-right" size={16} />
              </Button>
            )}
          </div>
          <p className={styles.hint}>{SETUP_WIZARD_TEXT.reopenHint}</p>
        </section>
      </div>
    </>
  );
}

import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useRegistrationSwitch } from '@/features/registration';
import { usePurchaseAgencyProfileQuery } from '@/features/settings';
import {
  AI_CLI_HISTORY_SIZE,
  useAiCliChecksQuery,
  useLatestAiCliChecksQuery,
  useSecretsQuery,
} from '@/features/system';
import { Button, Chip, Icon, Panel } from '@/shared/ui';
import { fillText, READINESS_INFO, READINESS_TEXT } from '../../content';
import {
  readinessItems,
  readinessProgress,
  switchInfoText,
  type QueryResult,
  type ReadinessState,
} from '../../model/readiness';
import styles from './ReadinessCard.module.css';

function errorText(error: { message: string } | null): string | null {
  return error ? error.message : null;
}

function result<T>(query: {
  data: T | undefined;
  error: { message: string } | null;
}): QueryResult<T> {
  return { data: query.data, error: errorText(query.error) };
}

function StateChip({ state }: { state: ReadinessState }) {
  switch (state) {
    case 'done':
      return (
        <Chip tone="done" icon="check">
          {READINESS_TEXT.chipDone}
        </Chip>
      );
    case 'todo':
      return <Chip tone="waiting">{READINESS_TEXT.chipTodo}</Chip>;
    case 'error':
      return (
        <Chip tone="waiting" icon="alert">
          {READINESS_TEXT.chipError}
        </Chip>
      );
    default:
      return <Chip tone="idle">{READINESS_TEXT.chipLoading}</Chip>;
  }
}

/**
 * 대시보드 맨 위 '시작 준비' 카드(F-DB-10, D-29, 화면시안_명세 §8). 앱이 확인할 수 있는 준비 5가지의 실제 상태와 고칠 곳 링크.
 * 이미 있는 M1 API만 읽는다(`GET /secrets`·`/ai-cli-checks/latest`·`/ai-cli-checks`·`/purchase-agency-profile`·
 * `/registration-switch`). 점검을 새로 돌리지 않는다(감지·연결 테스트는 AI 엔진 화면에서).
 * 센 항목이 모두 완료면 접혀서 한 줄만 보이고 [펼치기]로 연다. 등록 API 차단·AI 계정 학습 끄기는 세지 않는 참고 줄이다.
 */
export function ReadinessCard() {
  const regionId = `readiness-${useId()}`;
  const secrets = useSecretsQuery();
  const aiLatest = useLatestAiCliChecksQuery();
  const aiHistory = useAiCliChecksQuery({ size: AI_CLI_HISTORY_SIZE });
  const profile = usePurchaseAgencyProfileQuery();
  const registrationSwitch = useRegistrationSwitch();
  const [expanded, setExpanded] = useState<boolean | null>(null);

  const items = readinessItems({
    secrets: result(secrets),
    aiLatest: result(aiLatest),
    aiHistory: aiHistory.data?.content,
    profile: result(profile),
  });
  const { done, total, allDone } = readinessProgress(items);
  // 사용자가 누르기 전에는 '다 됐으면 접힘'. 누른 뒤에는 누른 대로 둔다
  const open = expanded ?? !allDone;
  const apiBlocked = registrationSwitch.isError ? undefined : registrationSwitch.data?.apiBlocked;

  return (
    <Panel
      id="readiness"
      title={READINESS_TEXT.title}
      caption={
        <>
          {fillText(READINESS_TEXT.caption, { total })} ·{' '}
          <span className={styles.progress}>
            {fillText(READINESS_TEXT.progress, { total, done })}
          </span>
        </>
      }
      actions={
        <Button
          size="sm"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setExpanded(!open)}
        >
          {open ? READINESS_TEXT.collapse : READINESS_TEXT.expand}
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
        </Button>
      }
    >
      {!open && allDone ? (
        <p className={styles.allDone}>
          <Icon name="check" size={16} />
          {READINESS_TEXT.allDone}
        </p>
      ) : null}
      <div id={regionId} hidden={!open} className={styles.region}>
        <ul className={styles.items} aria-label={READINESS_TEXT.title}>
          {items.map((item) => (
            <li key={item.key} className={styles.item} data-item={item.key} data-state={item.state}>
              <div className={styles.itemHead}>
                <StateChip state={item.state} />
                <span className={styles.label}>{item.label}</span>
              </div>
              <p className={styles.text}>{item.text}</p>
              <Link to={item.link.to} className={styles.link}>
                {item.link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className={styles.info}>
          <span className={styles.infoTitle}>{READINESS_TEXT.infoTitle}</span>
          <ul className={styles.infoList}>
            <li className={styles.infoRow} data-info="SWITCH">
              <span className={styles.infoLabel}>{READINESS_INFO.SWITCH.label}</span>
              <span className={styles.infoText}>{switchInfoText(apiBlocked)}</span>
              <Link to={READINESS_INFO.SWITCH.link.to} className={styles.link}>
                {READINESS_INFO.SWITCH.link.label}
              </Link>
            </li>
            <li className={styles.infoRow} data-info="TRAINING">
              <span className={styles.infoLabel}>{READINESS_INFO.TRAINING.label}</span>
              <span className={styles.infoText}>{READINESS_INFO.TRAINING.text}</span>
              <Link to={READINESS_INFO.TRAINING.link.to} className={styles.link}>
                {READINESS_INFO.TRAINING.link.label}
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </Panel>
  );
}

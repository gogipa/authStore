import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Button, ButtonLink, Icon, Panel } from '@/shared/ui';
import {
  fillText,
  READINESS_INFO,
  READINESS_TEXT,
  SETUP_WIZARD_PATH,
  SETUP_WIZARD_TEXT,
} from '../../content';
import { switchInfoText } from '../../model/readiness';
import { useReadiness } from '../../model/useReadiness';
import { ReadinessStateChip } from '../ReadinessStateChip/ReadinessStateChip';
import styles from './ReadinessCard.module.css';

/**
 * 대시보드 맨 위 '시작 준비' 카드(F-DB-10, D-29, 화면시안_명세 §8). 앱이 확인할 수 있는 준비 5가지의 실제 상태와 고칠 곳 링크.
 * 이미 있는 M1 API만 읽는다(`GET /secrets`·`/ai-cli-checks/latest`·`/ai-cli-checks`·`/purchase-agency-profile`·
 * `/registration-switch`). 점검을 새로 돌리지 않는다(감지·연결 테스트는 AI 엔진 화면에서).
 * 센 항목이 모두 완료면 접혀서 한 줄만 보이고 [펼치기]로 연다. 등록 API 차단·AI 계정 학습 끄기는 세지 않는 참고 줄이다.
 * 할 일·확인 못함이 남아 있는 동안 머리에 [설정 마법사](`/setup`, D-30)를 둔다.
 */
export function ReadinessCard() {
  const regionId = `readiness-${useId()}`;
  const { items, done, total, allDone, remaining, apiBlocked } = useReadiness();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  // 사용자가 누르기 전에는 '다 됐으면 접힘'. 누른 뒤에는 누른 대로 둔다
  const open = expanded ?? !allDone;

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
        <>
          {remaining ? (
            <ButtonLink to={SETUP_WIZARD_PATH} size="sm">
              {SETUP_WIZARD_TEXT.open}
            </ButtonLink>
          ) : null}
          <Button
            size="sm"
            aria-expanded={open}
            aria-controls={regionId}
            onClick={() => setExpanded(!open)}
          >
            {open ? READINESS_TEXT.collapse : READINESS_TEXT.expand}
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
          </Button>
        </>
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
                <ReadinessStateChip state={item.state} />
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

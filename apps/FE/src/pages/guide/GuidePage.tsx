import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import {
  DAY_SCENARIO,
  GUIDE_PAGE_TEXT,
  SAFETY_TEXT,
  SCREENS_TEXT,
  ScreenHelp,
  TRAINING_TEXT,
  WorkFlowCard,
} from '@/features/guide';
import { ButtonLink, PageHeader, Panel } from '@/shared/ui';
import styles from './GuidePage.module.css';

/**
 * SCR-14 사용 안내(`/guide`, F-GD-01, D-29 — 보드 없음, 화면시안_명세 §8). 처음 쓰는 사람을 위한 안내:
 * 작업 흐름(대시보드 카드와 같은 부품 — 숨겼으면 '대시보드에 다시 보이기'), 하루 작업 순서, 화면 안내,
 * 안전장치(게이트·등록 API 차단 스위치), AI 계정 학습 끄기(앱이 확인할 수 없는 일, D-20).
 * 다른 화면이 `/guide#safety`·`#training`처럼 보내면 그 패널로 옮긴다. API를 부르지 않는다.
 */
export function GuidePage() {
  const { hash } = useLocation();

  useEffect(() => {
    const id = hash.startsWith('#') ? decodeURIComponent(hash.slice(1)) : '';
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
  }, [hash]);

  return (
    <>
      <PageHeader
        title={GUIDE_PAGE_TEXT.title}
        description={GUIDE_PAGE_TEXT.description}
        help={<ScreenHelp screen="guide" />}
      />
      <WorkFlowCard variant="guide" id="flow" />
      <div className={styles.layout}>
        <div className={styles.main}>
          <Panel id="day" title={DAY_SCENARIO.title} caption={DAY_SCENARIO.caption}>
            <ol className={styles.ordered}>
              {DAY_SCENARIO.steps.map((step) => (
                <li key={step.text}>
                  {step.text}
                  {'link' in step && step.link ? (
                    <>
                      {' '}
                      <Link to={step.link.to} className={styles.link}>
                        {step.link.label}
                      </Link>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
            <h3 className={styles.subTitle}>{DAY_SCENARIO.entriesTitle}</h3>
            <ul className={styles.bullets}>
              {DAY_SCENARIO.entries.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <div>
              <ButtonLink to={DAY_SCENARIO.entriesLink.to} size="sm">
                {DAY_SCENARIO.entriesLink.label}
              </ButtonLink>
            </div>
          </Panel>
          <Panel id="screens" title={SCREENS_TEXT.title} caption={SCREENS_TEXT.caption}>
            <ul className={styles.screens}>
              {SCREENS_TEXT.items.map((item) => (
                <li key={item.to} className={styles.screenRow}>
                  <Link to={item.to} className={styles.screenName}>
                    {item.label}
                  </Link>
                  <span className={styles.screenText}>{item.text}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className={styles.side}>
          <Panel id="safety" title={SAFETY_TEXT.title} caption={SAFETY_TEXT.caption}>
            <h3 className={styles.subTitle}>{SAFETY_TEXT.gatesTitle}</h3>
            <ul className={styles.bullets}>
              {SAFETY_TEXT.gates.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <h3 id="kill-switch" className={styles.subTitle}>
              {SAFETY_TEXT.switchTitle}
            </h3>
            <ul className={styles.bullets}>
              {SAFETY_TEXT.switchLines.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <h3 className={styles.subTitle}>{SAFETY_TEXT.otherTitle}</h3>
            <ul className={styles.bullets}>
              {SAFETY_TEXT.others.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </Panel>
          <Panel id="training" title={TRAINING_TEXT.title}>
            <p className={styles.lead}>{TRAINING_TEXT.lead}</p>
            <ul className={styles.bullets}>
              {TRAINING_TEXT.items.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

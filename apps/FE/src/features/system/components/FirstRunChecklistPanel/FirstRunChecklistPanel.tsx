import { Panel } from '@/shared/ui';
import { useAiCliChecksQuery, useLatestAiCliChecksQuery } from '../../api/aiCliChecks';
import { AI_CLI_HISTORY_SIZE, engineCheckViews } from '../../model/aiEngineStatus';
import { FirstRunAiEngineItem } from '../FirstRunAiEngineItem/FirstRunAiEngineItem';
import styles from './FirstRunChecklistPanel.module.css';

/** 첫 실행 점검 패널 id(머리의 '첫 실행 점검 열기'가 여기로 옮긴다) */
export const FIRST_RUN_PANEL_ID = 'first-run';

/**
 * SCR-11 (12) '첫 실행 점검'(System.dc.html, 열 B 맨 위). M1은 'AI 엔진 고르기' 한 줄이다(F-SY-23). 나머지 첫 실행 항목
 * (이용 고지·사전 조건)은 M2(F-SY-05·F-SY-08)다. 처음 켰는지 기록할 곳(install_info)이 M2라 늘 보인다(Proposed).
 */
export function FirstRunChecklistPanel() {
  const latest = useLatestAiCliChecksQuery();
  const history = useAiCliChecksQuery({ size: AI_CLI_HISTORY_SIZE });
  const views = latest.data ? engineCheckViews(latest.data, history.data?.content) : undefined;
  return (
    <Panel id={FIRST_RUN_PANEL_ID} title="첫 실행 점검" caption="처음 켤 때 한 번">
      <ul className={styles.rows}>
        <FirstRunAiEngineItem views={views} />
      </ul>
      {latest.isError ? <p className={styles.error}>{latest.error.message}</p> : null}
    </Panel>
  );
}

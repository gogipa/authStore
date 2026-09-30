import { Link } from 'react-router';
import {
  AI_ENGINE_LABEL,
  AI_ENGINE_SETTINGS_LINK_TEXT,
  AI_ENGINE_SETTINGS_PATH,
} from '@/shared/lib/aiEngine';
import { Banner, Chip, Panel } from '@/shared/ui';
import { useAiCliChecksQuery, useLatestAiCliChecksQuery } from '../../api/aiCliChecks';
import {
  AI_CLI_HISTORY_SIZE,
  type AiEngineCheckView,
  authStatusView,
  engineCheckViews,
  engineHealthChip,
  formatLatency,
  smokeChip,
  type StatusChipView,
} from '../../model/aiEngineStatus';
import styles from './AiToolStatusPanel.module.css';

function StateChip({ chip }: { chip: StatusChipView }) {
  return (
    <Chip tone={chip.tone} icon={chip.icon}>
      {chip.label}
    </Chip>
  );
}

/** 선택 엔진 둘째 줄: '2.1.269 · 로그인됨 · 연결 테스트 통과 12.7초'(보드) */
function detailLine(view: AiEngineCheckView): string {
  const latest = view.latest;
  if (!latest) return '아직 점검하지 않았습니다';
  if (!latest.installed) return '설치되지 않았습니다';
  const parts = [latest.cliVersion ?? '버전 모름', authStatusView(view).chip.label];
  const smoke = view.lastSmoke;
  parts.push(
    smoke
      ? `연결 테스트 ${smokeChip(smoke).label} ${formatLatency(smoke.latencyMs)}`
      : '연결 테스트 안 함',
  );
  return parts.join(' · ');
}

/**
 * SCR-11 (4) 'AI 도구 상태'(System.dc.html, F-SY-13, P1-11 규칙 13). '텍스트·비전 AI 엔진' 묶음에 세 엔진의 설치·버전·
 * 로그인·형식 점검('OK') 결과·걸린 시간을 보인다. 선택 엔진에는 '선택됨' 칩과 둘째 줄(버전·로그인·연결 테스트)을 붙인다.
 * 지원 범위 밖 버전(`versionSupported=false`)이면 경고와 'AI 엔진 설정으로' 링크를 보인다.
 * 이미지 생성 CLI 줄은 M1에 조회할 API가 없어 그리지 않는다(Proposed — P3-02가 이미지 생성 경로를 만들 때 붙인다).
 * 끝은 SSE `ai-cli-check.completed`로 다시 읽는다(폴링 없음). 문구는 SCR-13 카드와 같은 함수(aiEngineStatus)에서 온다.
 */
export function AiToolStatusPanel() {
  const latest = useLatestAiCliChecksQuery();
  const history = useAiCliChecksQuery({ size: AI_CLI_HISTORY_SIZE });
  const views = latest.data ? engineCheckViews(latest.data, history.data?.content) : [];
  const unsupported = views.filter(
    (v) => v.latest?.installed && v.latest.versionSupported === false,
  );

  return (
    <Panel
      id="ai-tools"
      title="AI 도구 상태"
      actions={
        <Link to={AI_ENGINE_SETTINGS_PATH} className={styles.link}>
          {AI_ENGINE_SETTINGS_LINK_TEXT}
        </Link>
      }
    >
      {latest.isPending ? <p className={styles.muted}>불러오는 중입니다.</p> : null}
      {latest.isError ? <Banner tone="warning">{latest.error.message}</Banner> : null}
      {unsupported.map((v) => (
        <Banner
          key={v.engineCode}
          tone="warning"
          actions={
            <Link to={AI_ENGINE_SETTINGS_PATH} className={styles.link}>
              {AI_ENGINE_SETTINGS_LINK_TEXT}
            </Link>
          }
        >
          {`${AI_ENGINE_LABEL[v.engineCode]} ${v.latest?.cliVersion ?? ''}은 지원 범위 밖 버전입니다. 결과가 달라질 수 있으니 AI 엔진 설정에서 확인해 주세요.`}
        </Banner>
      ))}
      {views.length > 0 ? (
        <div className={styles.group}>
          <span className={styles.groupLabel}>텍스트·비전 AI 엔진</span>
          <ul className={styles.rows} aria-label="텍스트·비전 AI 엔진">
            {views.map((view) =>
              view.selected ? (
                <li
                  key={view.engineCode}
                  className={styles.detailRow}
                  data-engine={view.engineCode}
                >
                  <div className={styles.head}>
                    <span className={styles.name}>{AI_ENGINE_LABEL[view.engineCode]}</span>
                    <Chip tone="accent">선택됨</Chip>
                    <span className={styles.spacer} />
                    <StateChip chip={engineHealthChip(view)} />
                  </div>
                  <span className={styles.caption}>{detailLine(view)}</span>
                </li>
              ) : (
                <li key={view.engineCode} className={styles.row} data-engine={view.engineCode}>
                  <span
                    className={
                      view.latest?.installed === false ? styles.nameMuted : styles.nameGrow
                    }
                  >
                    {AI_ENGINE_LABEL[view.engineCode]}
                  </span>
                  {view.latest?.installed && view.latest.cliVersion ? (
                    <span className={styles.version}>{view.latest.cliVersion}</span>
                  ) : null}
                  <StateChip chip={engineHealthChip(view)} />
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAiEngineSettingsQuery } from '@/features/settings';
import {
  AI_CLI_HISTORY_SIZE,
  engineCheckViews,
  lastCheckedAt,
  StorageUsagePanel,
  useAiCliChecksQuery,
  useLatestAiCliChecksQuery,
} from '@/features/system';
import { formatKstTime } from '@/shared/lib/format';
import { Banner, Button, Icon, PageHeader, Panel } from '@/shared/ui';
import { AiCheckHistoryTable } from './AiCheckHistoryTable';
import { EngineCard } from './EngineCard';
import { SaveBar } from './SaveBar';
import { useAiEngineForm } from './useAiEngineForm';
import styles from './AiEnginePage.module.css';

/** 이력 표가 처음 보이는 행 수(나머지는 [전체 이력], Proposed) */
export const HISTORY_PREVIEW_ROWS = 10;

/** 첫 실행 점검에서 온 주소(`?from=first-run`)면 이 화면의 감지·연결 테스트 계기는 FIRST_RUN(Proposed) */
function useTrigger(): 'MANUAL' | 'FIRST_RUN' {
  const [params] = useSearchParams();
  return params.get('from') === 'first-run' ? 'FIRST_RUN' : 'MANUAL';
}

/**
 * SCR-13 AI 엔진(AiEngine.dc.html, F-ST-27~32·F-SY-23, P1-11 규칙 11). 설정의 하위 화면이다.
 * - 머리: '설정 / AI 엔진', '마지막 감지 HH:mm', [다시 감지](세 엔진 감지만 — 호출 비용 없음)
 * - 엔진 카드 3개(`role="radiogroup"` 안의 진짜 라디오), 안내 띠 2개, 최근 점검 이력 표, 하단 고정 저장 바
 * - 맨 아래 읽기 전용 '저장 공간'(D-25, F-ST-33 — 보드에 없다. 화면시안_명세 SCR-13 D-25 절). 저장 바와 관계없다
 * 화면을 열 때 세 엔진을 한 번 감지한다(`smokeTest: false`). 연결 테스트는 사용자가 누를 때만, 누른 엔진만 부른다(R7).
 * 결과는 SSE `ai-cli-check.completed` → 최신 점검·이력 다시 읽기로 받는다(폴링 없음).
 */
export function AiEnginePage() {
  const trigger = useTrigger();
  const settings = useAiEngineSettingsQuery();
  const latest = useLatestAiCliChecksQuery();
  const history = useAiCliChecksQuery({ size: AI_CLI_HISTORY_SIZE });
  const historyRows = history.data?.content ?? [];
  const form = useAiEngineForm({
    settings: settings.data,
    latest: latest.data,
    history: historyRows,
    trigger,
  });
  const [showAllHistory, setShowAllHistory] = useState(false);
  const historyTitleId = `ai-check-history-${useId()}`;

  // 화면을 열 때 한 번 감지(React StrictMode에서 두 번 그려도 한 번만 보낸다)
  const detected = useRef(false);
  const { detect } = form;
  useEffect(() => {
    if (detected.current) return;
    detected.current = true;
    detect();
  }, [detect]);

  const views = engineCheckViews(latest.data, historyRows);
  const lastDetected = lastCheckedAt(latest.data);
  const saved = form.saved;
  const values = form.values;

  return (
    <>
      <PageHeader
        title="AI 엔진"
        screenId="SCR-13"
        breadcrumb={
          <>
            <Link to="/settings">설정</Link> / AI 엔진
          </>
        }
        description="앱이 텍스트·비전 작업에 쓸 엔진을 하나 고릅니다. 검색어 변환, 동일 상품 판정, 원산지 추출, 상세 카피, 색상 표기, 썸네일 검사에 쓰입니다. 썸네일 이미지 생성은 '썸네일 생성 설정'에서 따로 정합니다."
        actions={
          <>
            <span className={styles.lastDetected}>
              마지막 감지{' '}
              <span className={styles.mono}>
                {lastDetected ? formatKstTime(lastDetected) : '—'}
              </span>
            </span>
            <Button onClick={form.detect} disabled={form.requesting}>
              <Icon name="refresh" size={16} />
              다시 감지
            </Button>
          </>
        }
      />

      {settings.isError ? <Banner tone="blocked">{settings.error.message}</Banner> : null}
      {settings.isPending ? <p className={styles.muted}>불러오는 중입니다.</p> : null}

      {settings.data && values ? (
        <div role="radiogroup" aria-label="AI 엔진 고르기" className={styles.cards}>
          {settings.data.engines.map((option) => {
            const view = views.find((v) => v.engineCode === option.engineCode)!;
            return (
              <EngineCard
                key={option.engineCode}
                option={option}
                view={view}
                inUse={settings.data.selectedEngine === option.engineCode}
                picked={values.engine === option.engineCode}
                models={values.models[option.engineCode]}
                onPick={() => form.pickEngine(option.engineCode)}
                onModelChange={(kind, value) => form.setModel(option.engineCode, kind, value)}
                onTest={() => form.testEngine(option.engineCode)}
                requesting={form.requesting}
                locked={form.busy}
              />
            );
          })}
        </div>
      ) : null}

      <div className={styles.notes}>
        <Banner tone="info">
          바꾸면 새로 시작하는 AI 단계부터 적용됩니다. 진행 중인 실행과 이미 만든 결과는
          그대로입니다.
        </Banner>
        <Banner tone="info" icon="pause-circle">
          선택한 엔진을 쓸 수 없으면 다른 엔진으로 넘어가지 않고 멈춥니다. 멈춘 단계에는 &apos;AI
          엔진 설정으로&apos; 링크가 붙습니다.
        </Banner>
      </div>

      <Panel
        title={<span id={historyTitleId}>최근 점검 이력</span>}
        caption="감지(설치·버전·로그인)는 호출 비용이 없습니다. 앱을 켤 때는 사용 중인 엔진만 연결 테스트합니다."
        actions={
          historyRows.length > HISTORY_PREVIEW_ROWS ? (
            <Button size="sm" onClick={() => setShowAllHistory((v) => !v)}>
              {showAllHistory ? '최근만 보기' : '전체 이력'}
            </Button>
          ) : (
            <Button size="sm" disabled>
              전체 이력
            </Button>
          )
        }
      >
        {history.isError ? <Banner tone="warning">{history.error.message}</Banner> : null}
        <AiCheckHistoryTable
          aria-labelledby={historyTitleId}
          rows={showAllHistory ? historyRows : historyRows.slice(0, HISTORY_PREVIEW_ROWS)}
        />
      </Panel>

      <StorageUsagePanel />

      {saved && values ? (
        <SaveBar
          state={form.state}
          phase={form.phase}
          message={form.message}
          savedEngine={saved.engine}
          savedTextModel={saved.models[saved.engine].text}
          savedVisionModel={saved.models[saved.engine].vision}
          pickedEngine={values.engine}
          onRevert={form.revert}
          onSave={form.save}
        />
      ) : null}
    </>
  );
}

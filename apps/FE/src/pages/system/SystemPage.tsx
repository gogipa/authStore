import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { MetaSyncPanel } from '@/features/integrations';
import {
  AiToolStatusPanel,
  AuthStatusPanel,
  FIRST_RUN_PANEL_ID,
  FirstRunChecklistPanel,
  isSecretKey,
  lastCheckedAt,
  type SecretKey,
  secretKeyFromHash,
  SecretKeysPanel,
  secretRowId,
  SystemKeyLink,
  useCreateAiCliCheckMutation,
  useLatestAiCliChecksQuery,
} from '@/features/system';
import { isApiRequestError } from '@/shared/api/errors';
import { formatKstTime } from '@/shared/lib/format';
import { Banner, Button, PageHeader } from '@/shared/ui';
import styles from './SystemPage.module.css';

const DESCRIPTION =
  '키·인증·동기화·AI 도구가 준비됐는지 봅니다. 막힌 곳은 할 일을 함께 알려 드립니다.';

/**
 * SCR-11 시스템 상태(System.dc.html)의 틀: 3열(열 A 420px · 열 B 368px · 열 C 나머지).
 * - 열 A: (1) 키 입력 · (2) 인증 상태(P1-07). (8) 외부 호출 기록은 M2.
 * - 열 B: (12) 첫 실행 점검(P1-11, 'AI 엔진 고르기') · (3) 메타데이터 동기화(P1-08). (5) 사전 조건 · (6) 자격증명 기한은 M2.
 *   메타 패널의 '지금 동기화'가 커머스 키 없음(409)이면 열 A 키 입력의 그 키 행으로 잇는다(SystemKeyLink → `#secret-<키>`).
 * - 열 C: (4) AI 도구 상태(P1-11). (9) AI 사용량 · (7) 공인 IP · (10) 공지 · (11) 버전은 M2.
 * 머리(P1-11, Proposed): 설명 끝 '마지막 점검 HH:MM.'은 AI 엔진 최신 점검 가운데 가장 늦은 시각(없으면 붙이지 않는다).
 * '첫 실행 점검 열기'는 열 B '첫 실행 점검' 패널로 옮긴다. '다시 점검'은 세 AI 엔진 감지(`POST /ai-cli-checks`
 * `{ smokeTest: false, trigger: 'MANUAL' }`, 호출 비용 없음)와 이 화면의 다른 상태 다시 읽기다 — 연결 테스트·토큰 발급처럼
 * 비용·외부 호출이 있는 점검은 부르지 않는다(사전조건 점검 실행은 M2 `POST /prerequisite-check-runs`).
 * 다른 화면이 `/system#secret-<키>`로 보내면 그 키 행 입력칸을 열고 초점을 옮긴다(규칙 14).
 */
export function SystemPage() {
  const { hash } = useLocation();
  const [editingKey, setEditingKey] = useState<SecretKey | null>(() => secretKeyFromHash(hash));
  const [focusRequest, setFocusRequest] = useState(0);
  const [seenHash, setSeenHash] = useState(hash);

  // 같은 화면에서 주소 조각만 바뀌면(다른 화면의 링크) 그 키 행을 연다
  if (hash !== seenHash) {
    setSeenHash(hash);
    const key = secretKeyFromHash(hash);
    if (key) {
      setEditingKey(key);
      setFocusRequest((n) => n + 1);
    }
  }

  useEffect(() => {
    const id = hash.startsWith('#') ? hash.slice(1) : '';
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
  }, [hash]);

  const queryClient = useQueryClient();
  const aiLatest = useLatestAiCliChecksQuery();
  const recheck = useCreateAiCliCheckMutation();
  const lastChecked = lastCheckedAt(aiLatest.data);
  const recheckError =
    recheck.isError &&
    !(isApiRequestError(recheck.error) && recheck.error.code === 'ALREADY_IN_PROGRESS')
      ? recheck.error.message
      : null;

  const openFirstRun = () => {
    const panel = document.getElementById(FIRST_RUN_PANEL_ID);
    panel?.scrollIntoView?.({ block: 'start' });
    panel?.querySelector<HTMLElement>('a')?.focus();
  };

  const recheckAll = () => {
    recheck.mutate({ smokeTest: false, trigger: 'MANUAL' });
    void queryClient.invalidateQueries({ queryKey: ['system'] });
    void queryClient.invalidateQueries({
      queryKey: ['integrations', 'getLatestCommerceMetaSyncRuns'],
    });
  };

  const reenter = (key: SecretKey) => {
    setEditingKey(key);
    setFocusRequest((n) => n + 1);
    document.getElementById(secretRowId(key))?.scrollIntoView?.({ block: 'center' });
  };

  return (
    <>
      <PageHeader
        title="시스템 상태"
        screenId="SCR-11"
        description={
          lastChecked ? `${DESCRIPTION} 마지막 점검 ${formatKstTime(lastChecked)}.` : DESCRIPTION
        }
        actions={
          <>
            <Button onClick={openFirstRun}>첫 실행 점검 열기</Button>
            <Button variant="primary" onClick={recheckAll} disabled={recheck.isPending}>
              다시 점검
            </Button>
          </>
        }
      />
      {recheckError ? (
        <Banner tone="blocked" role="alert">
          {recheckError}
        </Banner>
      ) : null}
      <div className={styles.layout}>
        <div className={styles.columnA} data-column="A">
          <SecretKeysPanel
            editingKey={editingKey}
            onEditingKeyChange={setEditingKey}
            focusRequest={focusRequest}
          />
          <AuthStatusPanel onReenterSecret={reenter} />
        </div>
        <div className={styles.columnB} data-column="B">
          <FirstRunChecklistPanel />
          <MetaSyncPanel
            renderSecretLink={(keys) => {
              const key = keys.find(isSecretKey);
              return <SystemKeyLink secretKey={key}>키 입력으로 가기</SystemKeyLink>;
            }}
          />
        </div>
        <div className={styles.columnC} data-column="C">
          <AiToolStatusPanel />
        </div>
      </div>
    </>
  );
}

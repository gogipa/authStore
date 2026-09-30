import type { MouseEvent } from 'react';
import { Banner, Button, Chip, DefinitionList, Num, Panel } from '@/shared/ui';
import { useAuthCheckMutation, useAuthStatusQuery } from '../../api/commerceAuth';
import {
  CAUSE_GUIDES,
  type CauseGuide,
  type CommerceAuthStatus,
  TOKEN_STATE_CHIP,
  tokenState,
  tokenTimes,
} from '../../model/commerceAuth';
import { SECRET_LABEL, type SecretKey, secretRowId } from '../../model/secretLabels';
import styles from './AuthStatusPanel.module.css';

/** 원인 안내 목록 라벨 열 폭(가장 긴 '통합매니저 인증 휴면'이 한 줄에 들어가는 폭) */
const CAUSE_LABEL_WIDTH = 148;

export interface AuthStatusPanelProps {
  /** '시크릿 변경'의 'client_secret 다시 넣기'를 누르면(키 입력 행을 열고 초점을 옮긴다) */
  onReenterSecret?: (key: SecretKey) => void;
}

/**
 * SCR-11 (2) 인증 상태(System.dc.html, F-SY-02·F-BS-47). 커머스API 토큰 칩 · '14:00 발급 · 16:30에 새로 받음' ·
 * 원인 네 가지 안내(dl). 마지막 발급이 실패했으면 그 원인 줄을 강조한다('지금 원인' 칩).
 * '토큰 다시 받기'(POST /auth-checks)는 보드에 없어 패널 머리 보조 버튼으로 두었다(Proposed).
 */
export function AuthStatusPanel({ onReenterSecret }: AuthStatusPanelProps) {
  const status = useAuthStatusQuery();
  const check = useAuthCheckMutation();
  const data = status.data;
  const failedCause = data?.lastSucceeded === false ? data.causeCategory : null;

  return (
    <Panel
      id="auth"
      title="인증 상태"
      actions={
        <Button size="sm" disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? '받는 중…' : '토큰 다시 받기'}
        </Button>
      }
    >
      {status.isPending ? <p className={styles.muted}>불러오는 중입니다.</p> : null}
      {status.isError ? <Banner tone="warning">{status.error.message}</Banner> : null}
      {data ? <TokenRow status={data} /> : null}
      {check.isError ? (
        <p role="alert" className={styles.alert}>
          {check.error.message}
        </p>
      ) : null}
      {check.isSuccess ? (
        <p role="status" className={styles.ok}>
          토큰을 새로 받았습니다.
        </p>
      ) : null}
      <div className={styles.guide}>
        <p className={styles.guideTitle}>다시 받기도 실패하면 원인별로 이렇게 안내합니다</p>
        <DefinitionList
          className={styles.causes}
          labelWidth={CAUSE_LABEL_WIDTH}
          items={CAUSE_GUIDES.map((guide) => {
            const current = failedCause === guide.category;
            return {
              key: guide.category,
              term: guide.term,
              detail: (
                <>
                  <CauseDetail guide={guide} onReenterSecret={onReenterSecret} />
                  {current ? (
                    <Chip tone="failed" icon="alert">
                      지금 원인
                    </Chip>
                  ) : null}
                </>
              ),
              className: current ? styles.current : undefined,
              state: current ? 'current' : undefined,
            };
          })}
        />
        {data && failedCause === 'UNKNOWN' ? (
          <p className={styles.unknown}>
            네 가지에 들지 않는 실패입니다 · 오류 코드{' '}
            <span className={styles.mono}>{data.lastErrorCode ?? '—'}</span>
            {data.lastTraceId ? (
              <>
                {' '}
                · 추적 번호 <span className={styles.mono}>{data.lastTraceId}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function CauseDetail({
  guide,
  onReenterSecret,
}: {
  guide: CauseGuide;
  onReenterSecret?: (key: SecretKey) => void;
}) {
  const key = guide.reenterKey;
  if (!key) return <span>{guide.detail}</span>;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onReenterSecret) return;
    event.preventDefault();
    onReenterSecret(key);
  };
  return (
    <a href={`#${secretRowId(key)}`} className={styles.link} onClick={onClick}>
      <span className={styles.mono}>{SECRET_LABEL[key].name}</span> 다시 넣기
    </a>
  );
}

/** '커머스API 토큰' 줄: 상태 칩 + 오른쪽 시각 글 */
function TokenRow({ status }: { status: CommerceAuthStatus }) {
  const state = tokenState(status);
  const chip = TOKEN_STATE_CHIP[state];
  return (
    <div className={styles.tokenRow}>
      <span className={styles.tokenLabel}>커머스API 토큰</span>
      <Chip tone={chip.tone} icon={chip.icon}>
        {chip.label}
      </Chip>
      <span className={styles.spacer} />
      <span className={styles.timeline}>
        <TokenTimeline status={status} />
      </span>
    </div>
  );
}

function TokenTimeline({ status }: { status: CommerceAuthStatus }) {
  const state = tokenState(status);
  if (state === 'ok') {
    const { issuedAt, refreshAt } = tokenTimes(status);
    return (
      <>
        {issuedAt ? (
          <>
            <Num value={issuedAt} unit="time" align="inline" /> 발급 ·{' '}
          </>
        ) : null}
        <Num value={refreshAt} unit="time" align="inline" />에 새로 받음
      </>
    );
  }
  if (state === 'failed' && status.lastCheckedAt) {
    return (
      <>
        <Num value={status.lastCheckedAt} unit="time" align="inline" /> 실패
        {status.lastErrorCode ? (
          <>
            {' '}
            · <span className={styles.mono}>{status.lastErrorCode}</span>
          </>
        ) : null}
      </>
    );
  }
  if (state === 'no-keys') return <>client_id·client_secret을 먼저 넣어 주세요</>;
  return <>처음 부를 때 받습니다</>;
}

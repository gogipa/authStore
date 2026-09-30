import type { ReactNode } from 'react';
import { isApiRequestError } from '@/shared/api/errors';
import { aiGeneratedLabel } from '@/shared/lib/aiEngine';
import { formatKstTime } from '@/shared/lib/format';
import { Chip, StatusChip, type StepFailureKind } from '@/shared/ui';
import { NO_CONTINUOUS_STEPS } from '../../model/continuousRun';
import { inputKeyLabels } from '../../model/inputLabels';
import { lastRunAt } from '../../model/stepTable';
import type { CandidateStepRailItem, ContinuousRunAccepted } from '../../model/types';
import { AiEngineSettingsLinkFor } from '../AiEngineSettingsLink/AiEngineSettingsLink';
import {
  ContinuousRunButton,
  type ChainStartStepCode,
} from '../ContinuousRunButton/ContinuousRunButton';
import styles from './StepStatusBar.module.css';

export interface StepStatusBarProps {
  /** 단계 레일 한 칸(listCandidateSteps) */
  item: CandidateStepRailItem;
  /** 입력 출처 글(예 '② 소싱 산출물') */
  source: string;
  /** 오른쪽 버튼 자리('다시 실행' 등과 꺼진 이유) */
  actions?: ReactNode;
  /**
   * 후보 id. 주면 버튼 자리 끝에 '여기부터 연속 실행'(P1-06)을 그린다(⑧·⑨ 제외). 켜짐·꺼진 이유는 `item.actions.continuousRun`
   */
  candidateId?: number;
  /** '여기부터 연속 실행' 202를 받으면 */
  onContinuousRunStarted?: (accepted: ContinuousRunAccepted) => void;
  /**
   * 단계 화면의 실행 요청 오류(시작 409 등). 주면 문구를 보이고, code가 AI_ENGINE_UNAVAILABLE이면 'AI 엔진 설정으로'
   * 링크를 붙인다(F-BS-76, P1-10)
   */
  error?: unknown;
}

/**
 * 단계 본문 맨 위 상태 줄(공통부품 §H, 04-3 StepStatusBar): 상태 칩 · '마지막 실행 14:08 · 버전 v2' ·
 * '입력 출처: ② 소싱 산출물' · 버튼 · '여기부터 연속 실행'(P1-06, candidateId를 줄 때). 재실행 필요면 '바뀐 입력: …' 글을
 * 함께 보인다. 단계 화면(P2~P4)이 쓴다.
 * P1-10: 현재 실행이 AI 엔진을 썼으면 'AI 생성 · Claude Code' 칩(F-BS-75). 실패면 실패 문구를 보이고, 실행 기록
 * errorCode나 `error`(시작 409)의 code가 AI_ENGINE_UNAVAILABLE이면 'AI 엔진 설정으로' 링크(F-BS-76).
 */
export function StepStatusBar({
  item,
  source,
  actions,
  candidateId,
  onContinuousRunStarted,
  error,
}: StepStatusBarProps) {
  const at = lastRunAt(item);
  const run = item.currentRun;
  const failedRun = item.status === 'FAILED' && run ? run : null;
  return (
    <div className={styles.bar} data-step={item.stepCode}>
      <StatusChip
        status={item.status}
        detail={(run?.failureKind ?? null) as StepFailureKind | null}
      />
      <span className={styles.meta}>
        마지막 실행 {at ? formatKstTime(at) : '—'} · 버전 {run ? `v${run.version}` : '—'}
      </span>
      <span className={styles.meta}>입력 출처: {source}</span>
      {run?.aiEngine ? <Chip tone="outline">{aiGeneratedLabel(run.aiEngine)}</Chip> : null}
      {item.status === 'RERUN_REQUIRED' && item.staleInputs.length > 0 ? (
        <span className={styles.stale}>바뀐 입력: {inputKeyLabels(item.staleInputs)}</span>
      ) : null}
      {failedRun ? (
        <span className={styles.failed}>
          {failedRun.errorMessage ?? '실행하지 못했습니다.'}
          <AiEngineSettingsLinkFor code={failedRun.errorCode} />
        </span>
      ) : null}
      {error ? (
        <span role="alert" className={styles.failed}>
          {isApiRequestError(error) ? error.message : '실행을 요청하지 못했습니다.'}
          <AiEngineSettingsLinkFor code={isApiRequestError(error) ? error.code : null} />
        </span>
      ) : null}
      <span className={styles.spacer} />
      {actions}
      {candidateId !== undefined && !NO_CONTINUOUS_STEPS.includes(item.stepCode) ? (
        <ContinuousRunButton
          candidateId={candidateId}
          stepCode={item.stepCode as ChainStartStepCode}
          action={item.actions.continuousRun}
          onStarted={onContinuousRunStarted}
        />
      ) : null}
    </div>
  );
}

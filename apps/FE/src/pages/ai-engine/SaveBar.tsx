import { AI_ENGINE_LABEL, type AiEngineCode } from '@/shared/lib/aiEngine';
import { Button } from '@/shared/ui';
import type { SaveBarState, SavePhase } from './useAiEngineForm';
import styles from './SaveBar.module.css';

/** 저장 바 도움말(보드 문구) */
export const SAVE_BAR_HELP =
  '연결 테스트를 통과한 엔진만 저장할 수 있습니다. 저장을 누르면 10분 안에 통과한 기록이 없을 때 먼저 연결 테스트를 합니다.';

export interface SaveBarProps {
  state: SaveBarState;
  /** 저장된 엔진·모델('사용 중 …') */
  savedEngine: AiEngineCode;
  savedTextModel: string | null;
  savedVisionModel: string | null;
  /** 화면에서 고른 엔진 */
  pickedEngine: AiEngineCode;
  /** 저장 흐름 단계(연결 테스트 중·저장 중) */
  phase?: SavePhase;
  /** 저장 실패·연결 테스트 실패 문구(봉투 message 그대로) */
  message?: string | null;
  onRevert: () => void;
  onSave: () => void;
}

const PHASE_TEXT: Record<SavePhase, string> = {
  idle: '',
  testing: '연결 테스트 중…',
  saving: '저장 중…',
};

/**
 * SCR-13 하단 고정 저장 바(04-3 organism SaveBar, P1-11 규칙 11). `state`:
 * - unchanged: '바뀐 것이 없습니다 · 사용 중 {엔진} 텍스트 … · 비전 …', 두 버튼 꺼짐
 * - needsTest: '변경: {저장된 엔진} → {고른 엔진} · 연결 테스트 필요'(waiting 글자)
 * - tested: '… · 연결 테스트 통과'(done 글자)
 * - changed: 저장 흐름이 도는 중('연결 테스트 중…'·'저장 중…'), 두 버튼 꺼짐
 * 같은 엔진에서 모델만 바꿨으면 '변경: {엔진} 모델'(Proposed — 보드는 엔진 바꾸기만 그렸다).
 */
export function SaveBar({
  state,
  savedEngine,
  savedTextModel,
  savedVisionModel,
  pickedEngine,
  phase = 'idle',
  message,
  onRevert,
  onSave,
}: SaveBarProps) {
  const busy = state === 'changed';
  const change =
    pickedEngine === savedEngine
      ? `변경: ${AI_ENGINE_LABEL[savedEngine]} 모델 · `
      : `변경: ${AI_ENGINE_LABEL[savedEngine]} → ${AI_ENGINE_LABEL[pickedEngine]} · `;
  return (
    <div role="region" aria-label="저장" className={styles.bar} data-state={state}>
      <div className={styles.text}>
        {state === 'unchanged' ? (
          <span className={styles.status}>
            바뀐 것이 없습니다 · 사용 중 <strong>{AI_ENGINE_LABEL[savedEngine]}</strong>{' '}
            <span className={styles.models}>
              텍스트 {savedTextModel ?? '—'} · 비전 {savedVisionModel ?? '—'}
            </span>
          </span>
        ) : (
          <span role="status" className={styles.statusStrong}>
            {change}
            {state === 'tested' ? (
              <span className={styles.tested}>연결 테스트 통과</span>
            ) : state === 'needsTest' ? (
              <span className={styles.needsTest}>연결 테스트 필요</span>
            ) : (
              <span className={styles.needsTest}>{PHASE_TEXT[phase]}</span>
            )}
          </span>
        )}
        {message ? (
          <span role="alert" className={styles.error}>
            {message}
          </span>
        ) : (
          <span className={styles.help}>{SAVE_BAR_HELP}</span>
        )}
      </div>
      <Button disabled={state === 'unchanged' || busy} onClick={onRevert}>
        되돌리기
      </Button>
      <Button variant="primary" disabled={state === 'unchanged' || busy} onClick={onSave}>
        {phase === 'saving' ? '저장 중…' : '저장'}
      </Button>
    </div>
  );
}

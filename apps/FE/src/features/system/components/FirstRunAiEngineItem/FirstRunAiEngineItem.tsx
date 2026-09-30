import { Link } from 'react-router';
import { AI_ENGINE_LABEL, AI_ENGINE_SETTINGS_PATH } from '@/shared/lib/aiEngine';
import { formatKstTime } from '@/shared/lib/format';
import { Chip } from '@/shared/ui';
import { type AiEngineCheckView, firstRunAiEngineState } from '../../model/aiEngineStatus';
import styles from './FirstRunAiEngineItem.module.css';

/** 첫 실행 점검에서 AI 엔진 페이지로 가는 주소. 그 화면의 감지·연결 테스트 계기가 FIRST_RUN이 된다(Proposed) */
export const FIRST_RUN_AI_ENGINE_PATH = `${AI_ENGINE_SETTINGS_PATH}?from=first-run`;

export interface FirstRunAiEngineItemProps {
  /** 엔진 3개 점검 모습(최신 + 이력). 받는 중이면 undefined */
  views: readonly AiEngineCheckView[] | undefined;
}

/**
 * SCR-11 첫 실행 점검의 'AI 엔진 고르기' 줄(F-SY-23, P1-11 규칙 14). [AI 엔진] 링크로 AI 엔진 페이지에 바로 잇는다.
 * 확정 여부·시각을 둘 곳이 M1에 없어(install_info는 M2) 있는 기록으로 판단한다(Proposed): 선택 엔진의 마지막 연결 테스트가
 * 통과면 '완료'이고 캡션 '{엔진} ({모델})로 확정 · {HH:MM}'(그 테스트의 모델·시각). 아니면 '할 일'과 추천
 * (설치됐고 연결 테스트를 통과한 엔진 가운데 Claude Code → Codex → Antigravity CLI 순서의 첫 번째). 사용자가 저장해야 확정된다.
 * 추천을 위해 연결 테스트를 부르지 않는다(R7).
 */
export function FirstRunAiEngineItem({ views }: FirstRunAiEngineItemProps) {
  const state = views ? firstRunAiEngineState(views) : null;
  return (
    <li className={styles.row} data-item="AI_ENGINE">
      <div className={styles.head}>
        <span className={styles.label}>AI 엔진 고르기</span>
        {state?.done ? (
          <Chip tone="done" icon="check">
            완료
          </Chip>
        ) : state ? (
          <Chip tone="waiting">할 일</Chip>
        ) : null}
        <Link to={FIRST_RUN_AI_ENGINE_PATH} className={styles.link}>
          AI 엔진
        </Link>
      </div>
      <span className={styles.caption}>
        {!state ? (
          '불러오는 중입니다.'
        ) : state.done ? (
          <>
            {AI_ENGINE_LABEL[state.engine]} <span className={styles.mono}>({state.model})</span>로
            확정 · <span className={styles.mono}>{formatKstTime(state.at)}</span>
          </>
        ) : state.recommended ? (
          `추천 ${AI_ENGINE_LABEL[state.recommended]} · 연결 테스트를 통과한 엔진입니다. AI 엔진에서 골라 저장해 주세요.`
        ) : (
          '연결 테스트를 통과한 엔진이 아직 없습니다. AI 엔진에서 감지·연결 테스트를 해 주세요.'
        )}
      </span>
    </li>
  );
}

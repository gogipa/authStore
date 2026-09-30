import { Link } from 'react-router';
import {
  AI_ENGINE_SETTINGS_LINK_TEXT,
  AI_ENGINE_SETTINGS_PATH,
  isAiEngineUnavailableCode,
} from '@/shared/lib/aiEngine';
import { isApiRequestError } from '@/shared/api/errors';
import styles from './AiEngineSettingsLink.module.css';

/**
 * 'AI 엔진 설정으로' 링크(F-BS-76, PRD §8.9 R10, SCR-12 → SCR-13). 선택 엔진을 쓸 수 없어 AI 단계 시작이 409로
 * 막혔거나 실행 기록이 `AI_ENGINE_UNAVAILABLE`로 실패했을 때 오류 문구 옆에 붙인다. 다른 엔진으로 넘어가지 않는다.
 */
export function AiEngineSettingsLink() {
  return (
    <Link to={AI_ENGINE_SETTINGS_PATH} className={styles.link}>
      {AI_ENGINE_SETTINGS_LINK_TEXT}
    </Link>
  );
}

/** 오류 코드(실행 기록 errorCode·시작 409 code)가 AI_ENGINE_UNAVAILABLE이면 링크, 아니면 아무것도 */
export function AiEngineSettingsLinkFor({ code }: { code: string | null | undefined }) {
  return isAiEngineUnavailableCode(code) ? <AiEngineSettingsLink /> : null;
}

/** 요청 오류(ApiRequestError)의 code로 링크를 붙인다 */
export function AiEngineSettingsLinkForError({ error }: { error: unknown }) {
  return <AiEngineSettingsLinkFor code={isApiRequestError(error) ? error.code : null} />;
}

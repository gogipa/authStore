/**
 * guide(사용 안내, D-29)의 공개 API. 밖에서는 `@/features/guide`로만 가져온다.
 * - 대시보드 '시작 준비'(F-DB-10)·'작업 흐름'(F-DB-11) 카드, 사용 안내 화면(F-GD-01)이 쓰는 글·부품
 * - 화면 도움말 '?'(F-GD-02)의 내용 `ScreenHelp`, 빈 상태 안내(F-GD-03) 글 `EMPTY_STATE`
 * 글은 모두 content.ts 한 곳이고, 오너 검토 원본 docs/design/spec/안내문구.md와 같아야 한다(content.test.ts).
 * 새 API는 없다: 이미 있는 system·settings·registration 조회만 쓴다.
 */
export {
  DAY_SCENARIO,
  EMPTY_STATE,
  fillText,
  GUIDE_PAGE_TEXT,
  GUIDE_PATH,
  HELP_TEXT,
  SAFETY_TEXT,
  SCREEN_HELP,
  SCREEN_HELP_KEYS,
  SCREENS_TEXT,
  START_WITHOUT_KEYWORD_PATH,
  TRAINING_TEXT,
  WORK_FLOW_STEPS,
  WORK_FLOW_TEXT,
} from './content';
export type { GuideLink, ScreenHelpContent, ScreenHelpKey, WorkFlowStep } from './content';
export { readinessItems, readinessProgress, switchInfoText } from './model/readiness';
export type {
  QueryResult,
  ReadinessInput,
  ReadinessItemView,
  ReadinessState,
} from './model/readiness';
export {
  readWorkFlowHidden,
  useWorkFlowHidden,
  WORK_FLOW_HIDDEN_KEY,
  writeWorkFlowHidden,
} from './model/useWorkFlowHidden';
export { ReadinessCard } from './components/ReadinessCard/ReadinessCard';
export { WorkFlowCard } from './components/WorkFlowCard/WorkFlowCard';
export type { WorkFlowCardProps } from './components/WorkFlowCard/WorkFlowCard';
export { ScreenHelp } from './components/ScreenHelp/ScreenHelp';
export type { ScreenHelpProps } from './components/ScreenHelp/ScreenHelp';

/**
 * guide(사용 안내, D-29)의 공개 API. 밖에서는 `@/features/guide`로만 가져온다.
 * - 대시보드 '시작 준비'(F-DB-10)·'작업 흐름'(F-DB-11) 카드, 사용 안내 화면(F-GD-01)이 쓰는 글·부품
 * - 화면 도움말 '?'(F-GD-02)의 내용 `ScreenHelp`, 빈 상태 안내(F-GD-03) 글 `EMPTY_STATE`
 * 글은 모두 content.ts 한 곳이고, 오너 검토 원본 docs/design/spec/안내문구.md와 같아야 한다(content.test.ts).
 * - D-30: 설정 마법사(F-GD-04, SCR-15 `/setup`)의 글·자동 열기(`SetupWizardAutoOpen`)·'지금 상태' 줄
 * - D-34: 단계 화면 맨 위 안내 `StepIntro`(하는 일·지금 할 일·낯선 말 풀이)와 ② 글(`SOURCING_*`)
 * - D-31: 체험(F-GD-05, `/demo`) 띠(`DemoBanner` — 앱 틀이 모든 화면 맨 위에 두고 체험에서만 그린다)와 입구 [체험해 보기](`DemoEntry`)
 * API: 이미 있는 system·settings·registration 조회만 쓴다. 체험인지는 `@/shared/lib/demo`(컨텍스트)로 안다.
 */
export {
  DAY_SCENARIO,
  DEMO_ENTRY_TEXT,
  DEMO_GUIDE_TEXT,
  DEMO_PATH,
  DEMO_START_PATH,
  DEMO_TEXT,
  EMPTY_STATE,
  APPROVAL_GUIDE,
  CONTENT_GUIDE,
  fillText,
  GUIDE_PAGE_TEXT,
  GUIDE_PATH,
  GUIDE_SETUP_WIZARD_TEXT,
  HELP_TEXT,
  JUDGEMENT_GUIDE,
  READINESS_INFO,
  READINESS_TEXT,
  SAFETY_TEXT,
  SCREEN_HELP,
  SCREEN_GUIDE_KEYS,
  SCREEN_HELP_KEYS,
  SCREENS_TEXT,
  SETUP_WIZARD_PATH,
  SETUP_WIZARD_STEPS,
  SETUP_WIZARD_TEXT,
  SOURCING_GLOSSARY,
  SOURCING_GUIDE_TEXT,
  SOURCING_NOW_TEXT,
  START_WITHOUT_KEYWORD_PATH,
  STEP_GUIDE_COMMON,
  TAGS_GUIDE,
  THUMBNAIL_GUIDE,
  TRAINING_TEXT,
  WORK_FLOW_STEPS,
  WORK_FLOW_TEXT,
} from './content';
export type {
  DemoGuideActionId,
  GuideLink,
  ScreenGuideContent,
  ScreenGuideKey,
  ScreenHelpContent,
  ScreenHelpKey,
  SetupWizardStep,
  SourcingGlossaryKey,
  WorkFlowStep,
} from './content';
export { readinessItems, readinessProgress, switchInfoText } from './model/readiness';
export type {
  QueryResult,
  ReadinessInput,
  ReadinessItemView,
  ReadinessState,
} from './model/readiness';
export { StepGuideVisibleContext, useStepGuideVisible } from './model/stepGuideVisible';
export { useReadiness } from './model/useReadiness';
export type { Readiness } from './model/useReadiness';
export {
  readSetupWizardShown,
  SETUP_WIZARD_SHOWN_KEY,
  writeSetupWizardShown,
} from './model/setupWizardSession';
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
export { ReadinessRows } from './components/ReadinessRows/ReadinessRows';
export type { ReadinessRowsProps } from './components/ReadinessRows/ReadinessRows';
export { SetupWizardAutoOpen } from './components/SetupWizardAutoOpen/SetupWizardAutoOpen';
export { DemoBanner } from './components/DemoBanner/DemoBanner';
export { DemoEntry } from './components/DemoEntry/DemoEntry';
export type { DemoEntryProps } from './components/DemoEntry/DemoEntry';
export { NowMark } from './components/NowMark/NowMark';
export type { NowMarkProps } from './components/NowMark/NowMark';
export { StepIntro } from './components/StepIntro/StepIntro';
export type { StepIntroGlossaryItem, StepIntroProps } from './components/StepIntro/StepIntro';
export { ScreenGuidePanel } from './components/ScreenGuidePanel/ScreenGuidePanel';
export type { ScreenGuidePanelProps } from './components/ScreenGuidePanel/ScreenGuidePanel';

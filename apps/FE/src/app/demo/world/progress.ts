import type { DemoNextAction, DemoProgress } from '@/shared/lib/demo';
import type { DemoWorld } from '../demoWorld';
import { currentKeywordId } from './domains/keywords';
import { domesticPriceEntered } from './domains/pricing';
import { thumbnailPhase } from './domains/thumbnail';
import { STEP_SCREEN } from '@/shared/lib/steps';
import { gateValid, isBusy, isCompleted, rerunStaleRefusal } from './engine';
import { STEP_LABEL } from './errors';
import type { WorldState } from './state';
import { requiredReads } from './graph';
import { REQUIRED_STEPS } from './steps';

/**
 * 따라 하기 진행(D-32). 띠가 '다음에 할 일'을 보이는 데 쓴다 — 순서대로 늘어놓은 일 가운데 아직 안 된 첫 일이다.
 * 일이 됐는지는 모델의 지금 상태로만 판단하므로(눌렀던 기록이 아니다) 마음대로 돌아다녀도, 같은 일을 두 번 해도 맞다.
 * id는 글(features/guide `DEMO_GUIDE_TEXT.actions`)의 키다.
 */
export type DemoGuideAction =
  | 'collect'
  | 'useKeyword'
  | 'startSourcing'
  | 'anchor'
  | 'pickShop'
  | 'domesticPrice'
  | 'runPricing'
  | 'passG2'
  | 'runCategory'
  | 'chooseLeaf'
  | 'runThumbnail'
  | 'references'
  | 'generate'
  | 'pickThumbnail'
  | 'runChain'
  | 'approveDryRun'
  | 'switchOff'
  | 'approve'
  | 'switchOn';

interface Milestone {
  id: DemoGuideAction;
  /** 이 일을 하는 화면(체험 안 경로) */
  screen: 'keywords' | 'sourcing' | 'judgement' | 'thumbnail' | 'content' | 'approval';
  done: (s: WorldState, w: DemoWorld) => boolean;
}

const stepDone = (s: WorldState, code: keyof WorldState['steps']) =>
  s.steps[code].status === 'COMPLETED';
const stepStarted = (s: WorldState, code: keyof WorldState['steps']) =>
  s.steps[code].status !== 'NOT_RUN';
// G2는 통과 기록이 있고 ③ 판정의 지문이 그대로일 때만 유효하다(③ 금액을 바꿔 다시 실행하면 판매가가 달라져 다시 확정해야 한다)
const g2Valid = (_s: WorldState, w: DemoWorld) => stepDone(w.s, 'PRICING') && gateValid(w, 'G2');
const registered = (s: WorldState) => s.registration.records.some((r) => r.status === 'REGISTERED');

const MILESTONES: readonly Milestone[] = [
  { id: 'collect', screen: 'keywords', done: (s) => s.keywords.snapshot?.status === 'COMPLETED' },
  // ① 목록에서 키워드를 하나 고른다(D-33 — 줄을 고르면 곧 '이 검색어로 쓴다'. 지금 고른 키워드가 있으면 된 일이다)
  {
    id: 'useKeyword',
    screen: 'keywords',
    done: (s) => currentKeywordId(s.keywords) !== null || s.candidate !== null,
  },
  { id: 'startSourcing', screen: 'keywords', done: (s) => s.candidate !== null },
  {
    id: 'anchor',
    screen: 'sourcing',
    done: (s) => s.sourcing.anchorFixed || stepDone(s, 'SOURCING'),
  },
  { id: 'pickShop', screen: 'sourcing', done: (s) => stepDone(s, 'SOURCING') },
  {
    id: 'domesticPrice',
    screen: 'judgement',
    done: (s) => domesticPriceEntered(s.pricing) || stepDone(s, 'PRICING'),
  },
  { id: 'runPricing', screen: 'judgement', done: (s) => stepDone(s, 'PRICING') },
  { id: 'passG2', screen: 'judgement', done: g2Valid },
  { id: 'runCategory', screen: 'judgement', done: (s) => stepStarted(s, 'CATEGORY') },
  { id: 'chooseLeaf', screen: 'judgement', done: (s) => stepDone(s, 'CATEGORY') },
  { id: 'runThumbnail', screen: 'thumbnail', done: (s) => stepStarted(s, 'THUMBNAIL') },
  {
    id: 'references',
    screen: 'thumbnail',
    done: (s) => stepDone(s, 'THUMBNAIL') || thumbnailPhase(s.thumbnail) !== 'NONE',
  },
  {
    id: 'generate',
    screen: 'thumbnail',
    done: (s) =>
      stepDone(s, 'THUMBNAIL') ||
      thumbnailPhase(s.thumbnail) === 'GENERATING' ||
      thumbnailPhase(s.thumbnail) === 'GENERATED',
  },
  {
    id: 'pickThumbnail',
    screen: 'thumbnail',
    done: (s) => stepDone(s, 'THUMBNAIL') && s.gates.G3 !== null,
  },
  { id: 'runChain', screen: 'content', done: (s) => stepDone(s, 'UPLOAD') },
  { id: 'approveDryRun', screen: 'approval', done: (s) => s.registration.records.length > 0 },
  {
    id: 'switchOff',
    screen: 'approval',
    done: (s) =>
      !s.registration.apiBlocked || s.registration.records.some((r) => r.status !== 'VALIDATED'),
  },
  {
    id: 'approve',
    screen: 'approval',
    done: (s) => s.registration.records.some((r) => r.status !== 'VALIDATED'),
  },
  { id: 'switchOn', screen: 'approval', done: (s) => registered(s) && s.registration.apiBlocked },
];

/** 해야 할 일 수 */
export const DEMO_GUIDE_TOTAL = MILESTONES.length;

/** 따라 하기 일 id 목록(글 표와 짝을 맞추는 테스트가 본다) */
export const DEMO_GUIDE_ACTIONS: readonly DemoGuideAction[] = MILESTONES.map((m) => m.id);

function pathOf(w: DemoWorld, screen: string): string {
  const candidate = w.s.candidate;
  if (screen === 'keywords' || !candidate) return '/keywords';
  return `/candidates/${candidate.id}/${screen}`;
}

/**
 * 다음에 할 일. 재실행 필요 단계가 있으면 그것이 먼저다(앞 단계 값이 바뀌어 뒤 단계가 낡았다 — 단계 목록 아래 버튼으로 고친다).
 * 단, 버튼이 지금 거절될 때는(BE 시작 검사 `rerunStaleRefusal`과 같은 검사) 거절 이유를 알린다: G2가 풀려 있으면 [소싱 확정(G2)]을
 * 먼저, 낡은 첫 단계가 읽는 앞 단계(예: 다시 실행 중인 ⑤의 선택)가 안 끝났으면 그 단계를 먼저. 그 밖에는 순서대로 늘어놓은 일 가운데
 * 아직 안 된 첫 일이고, 같은 일이라도 지금 상태에 따라 글이 갈리는 곳은 다른 글을 가리킨다: 등록 API 차단이 꺼져 있으면 첫
 * [승인·등록]도 실제로 등록한다(드라이런이 아니다).
 */
function nextActionOf(w: DemoWorld, first: Milestone | undefined): DemoNextAction | null {
  const stale = w.s.candidate
    ? REQUIRED_STEPS.filter((code) => w.s.steps[code].status === 'RERUN_REQUIRED')
    : [];
  if (stale.length > 0) {
    const steps = stale.map((code) => STEP_LABEL[code]).join(', ');
    const refusal = rerunStaleRefusal(w);
    if (refusal === null) {
      return {
        id: 'rerunStale',
        path: pathOf(w, STEP_SCREEN[stale[0]!]),
        params: { steps, ...(stale.includes('PRICING') ? { g2: '1' } : {}) },
      };
    }
    if (refusal.code === 'CONTINUOUS_RUN_BEFORE_G2') {
      return { id: 'rerunStaleNeedsG2', path: pathOf(w, 'judgement'), params: { steps } };
    }
    if (refusal.code === 'STEP_START_CONDITION_UNMET' || refusal.code === 'GATE_NOT_PASSED') {
      const blocker =
        requiredReads(stale[0]!).find((code) => !isCompleted(w, code)) ??
        (stale[0] === 'UPLOAD' ? 'THUMBNAIL' : null);
      if (blocker) {
        return {
          id: 'rerunStaleNeedsStep',
          path: pathOf(w, STEP_SCREEN[blocker]),
          params: { steps, blocker: STEP_LABEL[blocker] },
        };
      }
    }
    // 그 밖의 거절(연속 실행이 도는 중 …)은 '만드는 중' 글이 맡거나 아래 첫 일이 맞다
  }
  if (!first) return null;
  const id =
    first.id === 'approveDryRun' && !w.s.registration.apiBlocked ? 'approveBlockOff' : first.id;
  return { id, path: pathOf(w, first.screen) };
}

export function computeProgress(w: DemoWorld): DemoProgress {
  const s = w.s;
  const done = MILESTONES.filter((m) => m.done(s, w)).length;
  const first = MILESTONES.find((m) => !m.done(s, w));
  const next = nextActionOf(w, first);
  return {
    done,
    total: MILESTONES.length,
    next,
    candidateId: s.candidate?.id ?? null,
    registered: registered(s),
    busy: isBusy(w) || thumbnailPhase(s.thumbnail) === 'GENERATING',
  };
}

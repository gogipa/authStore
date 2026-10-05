import { describe, expect, it } from 'vitest';
import {
  aiCliCheck,
  aiCliCheckLatestList,
  boardChecks,
  detectedOnly,
} from '@/test/fixtures/aiEngine';
import { emptyProfile, filledProfile } from '@/test/fixtures/purchaseAgencyProfile';
import { secretStatusList } from '@/test/fixtures/system';
import { READINESS_ITEMS } from '../content';
import {
  readinessItems,
  readinessProgress,
  switchInfoText,
  type ReadinessInput,
} from './readiness';

const ok = <T>(data: T) => ({ data, error: null });
/** 픽스처 점검 시각(2026-09-27 KST 14:00)과 같은 날 KST 18:00 */
const SAME_DAY = new Date('2026-09-27T09:00:00Z');
const pending = { data: undefined, error: null };

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    secrets: ok(secretStatusList()),
    aiLatest: ok(aiCliCheckLatestList()),
    aiHistory: [],
    profile: ok(filledProfile()),
    now: SAME_DAY,
    ...overrides,
  };
}

const byKey = (items: ReturnType<typeof readinessItems>) =>
  Object.fromEntries(items.map((item) => [item.key, item]));

describe("'시작 준비' 항목(F-DB-10)", () => {
  it('순서는 커머스API 키 → 라쿠텐 앱 키 → AI 엔진 → 썸네일 생성 도구 → 구매대행 프로필', () => {
    expect(readinessItems(input()).map((i) => i.key)).toEqual([
      'COMMERCE_KEYS',
      'RAKUTEN_KEYS',
      'AI_ENGINE',
      'IMAGE_TOOL',
      'PROFILE',
    ]);
  });

  it('받는 중이면 모두 확인 중이고, 0개 완료로 센다', () => {
    const items = readinessItems({ secrets: pending, aiLatest: pending, profile: pending });
    expect(items.map((i) => i.state)).toEqual(Array(5).fill('loading'));
    expect(items[0]?.text).toBe('확인하는 중입니다.');
    expect(readinessProgress(items)).toEqual({ done: 0, total: 5, allDone: false });
  });

  it('조회가 실패하면 그 항목만 확인 못함(오류 문구)이고 완료로 세지 않는다', () => {
    const items = byKey(
      readinessItems(input({ secrets: { data: undefined, error: '키체인을 열 수 없습니다.' } })),
    );
    expect(items.COMMERCE_KEYS).toMatchObject({ state: 'error', text: '키체인을 열 수 없습니다.' });
    expect(items.RAKUTEN_KEYS).toMatchObject({ state: 'error' });
    expect(items.PROFILE?.state).toBe('done');
  });

  it('빠진 키는 이름을 보이고 링크가 첫 빠진 키 행으로 간다', () => {
    const items = byKey(
      readinessItems(input({ secrets: ok(secretStatusList(['COMMERCE_CLIENT_ID'])) })),
    );
    expect(items.COMMERCE_KEYS).toMatchObject({
      state: 'todo',
      text: '빠진 키: client_secret. 시스템 상태에서 넣어 주세요.',
      link: { label: '키 넣기', to: '/system#secret-COMMERCE_CLIENT_SECRET' },
    });
    expect(items.RAKUTEN_KEYS).toMatchObject({
      state: 'todo',
      text: '빠진 키: applicationId, accessKey. 시스템 상태에서 넣어 주세요.',
      link: { to: '/system#secret-RAKUTEN_APPLICATION_ID' },
    });
  });

  it('키가 모두 있으면 완료이고 링크는 시스템 상태 키 입력', () => {
    const items = byKey(readinessItems(input()));
    expect(items.COMMERCE_KEYS).toMatchObject({
      state: 'done',
      text: READINESS_ITEMS.COMMERCE_KEYS.done,
      link: { label: '시스템 상태', to: '/system#keys' },
    });
  });

  it('AI 엔진: 선택 엔진의 마지막 연결 테스트가 통과면 완료(엔진·모델·시각)', () => {
    expect(byKey(readinessItems(input())).AI_ENGINE).toMatchObject({
      state: 'done',
      text: 'Claude Code (sonnet) 연결 테스트 통과 · 14:00',
      link: { to: '/settings/ai-engine' },
    });
  });

  it('AI 엔진·썸네일 도구: 통과가 오늘이 아니면 날짜를 붙인다(지금 다시 확인하지 않으므로 오래된 통과를 숨기지 않는다)', () => {
    const agyPassed = aiCliCheck({ engineCode: 'AGY', cliVersion: '1.2.9' });
    const items = byKey(
      readinessItems(
        input({
          aiLatest: ok(aiCliCheckLatestList({ ...boardChecks(), AGY: agyPassed })),
          now: new Date('2026-10-03T01:00:00Z'),
        }),
      ),
    );
    expect(items.AI_ENGINE).toMatchObject({
      state: 'done',
      text: 'Claude Code (sonnet) 연결 테스트 통과 · 09-27 14:00',
    });
    expect(items.IMAGE_TOOL).toMatchObject({
      state: 'done',
      text: 'Antigravity CLI 1.2.9 연결 테스트 통과 · 09-27 14:00',
    });
  });

  it('AI 엔진: 통과 기록이 없으면 할 일(추천이 있으면 추천 엔진)', () => {
    const failed = aiCliCheck({ smokeStatus: 'FAILED' });
    const none = byKey(
      readinessItems(
        input({ aiLatest: ok(aiCliCheckLatestList({ ...boardChecks(), CLAUDE: failed })) }),
      ),
    );
    expect(none.AI_ENGINE).toMatchObject({
      state: 'todo',
      text: '연결 테스트를 통과한 엔진이 아직 없습니다. AI 엔진에서 감지·연결 테스트를 해 주세요.',
    });
    const codexPassed = aiCliCheck({ engineCode: 'CODEX', model: 'gpt-5-codex' });
    const recommended = byKey(
      readinessItems(
        input({
          aiLatest: ok(
            aiCliCheckLatestList({ ...boardChecks(), CLAUDE: failed, CODEX: codexPassed }),
          ),
        }),
      ),
    );
    expect(recommended.AI_ENGINE?.text).toBe(
      '추천 Codex. AI 엔진에서 골라 연결 테스트를 하고 저장해 주세요.',
    );
  });

  it('썸네일 생성 도구: agy 감지만 했으면 연결 테스트를 권한다', () => {
    expect(byKey(readinessItems(input())).IMAGE_TOOL).toMatchObject({
      state: 'todo',
      text: '⑤ 썸네일은 고른 AI 엔진과 관계없이 agy가 만듭니다. Antigravity CLI 카드에서 [연결 테스트]를 한 번 눌러 주세요.',
    });
  });

  it('썸네일 생성 도구: 이력에서 agy 연결 테스트 통과를 찾으면 완료', () => {
    const agyPassed = aiCliCheck({
      engineCode: 'AGY',
      cliVersion: '1.2.9',
      model: 'gemini-3.8-flash-medium',
      authStatus: 'UNKNOWN',
      checkedAt: '2026-09-27T04:00:00.000Z',
    });
    expect(byKey(readinessItems(input({ aiHistory: [agyPassed] }))).IMAGE_TOOL).toMatchObject({
      state: 'done',
      text: 'Antigravity CLI 1.2.9 연결 테스트 통과 · 13:00',
    });
  });

  it('썸네일 생성 도구: 감지 전·설치 안 됨·실패를 나눠 말한다', () => {
    const item = (agy: Parameters<typeof aiCliCheckLatestList>[0]) =>
      byKey(readinessItems(input({ aiLatest: ok(aiCliCheckLatestList(agy)) }))).IMAGE_TOOL;
    expect(item({ ...boardChecks(), AGY: null })?.text).toBe(
      '아직 감지하지 않았습니다. AI 엔진 화면을 열면 감지합니다.',
    );
    expect(item({ ...boardChecks(), AGY: detectedOnly('AGY', { installed: false }) })?.text).toBe(
      'agy가 설치되어 있지 않습니다. ⑤ 썸네일을 만들려면 설치하고 로그인해 주세요.',
    );
    expect(
      item({ ...boardChecks(), AGY: aiCliCheck({ engineCode: 'AGY', smokeStatus: 'FAILED' }) }),
    ).toMatchObject({
      state: 'todo',
      text: '마지막 연결 테스트가 실패했습니다. 로그인을 확인하고 다시 테스트해 주세요.',
    });
  });

  it('구매대행 프로필: 빈칸 수와 화면 이름을 보이고, 모두 채우면 완료', () => {
    expect(byKey(readinessItems(input({ profile: ok(emptyProfile()) }))).PROFILE).toMatchObject({
      state: 'todo',
      text: '빈칸 10개: 해외 출고지, 반품·교환지, 발송 택배사, 반품 택배사, 반품비, 교환비, 상호, A/S 연락처, A/S 안내, 수입자. 설정에서 채우고 저장해 주세요.',
      link: { label: '설정', to: '/settings' },
    });
    expect(byKey(readinessItems(input())).PROFILE?.state).toBe('done');
  });

  it('모두 완료면 allDone', () => {
    const agyPassed = aiCliCheck({ engineCode: 'AGY', cliVersion: '1.2.9' });
    const items = readinessItems(
      input({ aiLatest: ok(aiCliCheckLatestList({ ...boardChecks(), AGY: agyPassed })) }),
    );
    expect(readinessProgress(items)).toEqual({ done: 5, total: 5, allDone: true });
  });

  it('등록 API 차단 참고 줄: 켜짐·꺼짐·확인 전', () => {
    expect(switchInfoText(true)).toMatch(/^켜짐 · /);
    expect(switchInfoText(false)).toBe('꺼짐 · 승인하면 실제 스마트스토어에 등록합니다.');
    expect(switchInfoText(undefined)).toBe('확인 전입니다.');
  });
});

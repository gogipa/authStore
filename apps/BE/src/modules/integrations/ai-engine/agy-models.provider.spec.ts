import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_FIXTURE_ROOT,
  createFakeCliWorld,
  type FakeCliWorld,
} from '../../../../test/support/fake-ai-cli.js';
import { AgyAdapter } from './adapters/agy.adapter.js';
import { AgyModelsProvider, parseAgyModels } from './agy-models.provider.js';
import type { AiEngineAdapter } from './ai-engine.port.js';
import { IsolatedCliRunner } from './process/isolated-cli-runner.js';

const FIXTURE_MODELS = [
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'gemini-3.1-pro-high',
  'gemini-3.1-pro-low',
];

describe('parseAgyModels(P1-11, F-ST-30)', () => {
  it('fixture(agy/models.txt): 머리 줄·뒤 설명을 버리고 모델 ID 5개(순서 그대로)', () => {
    const text = readFileSync(join(AI_FIXTURE_ROOT, 'agy', 'models.txt'), 'utf8');
    expect(parseAgyModels(text)).toEqual(FIXTURE_MODELS);
  });

  it('글머리표·색 코드·표 머리·겹침', () => {
    const esc = String.fromCharCode(27);
    const text = [
      'MODEL        DESCRIPTION',
      `- ${esc}[32mgemini-3.8-flash-high${esc}[0m  빠름`,
      '* gemini-3.1-pro-low, 느림',
      '• gemini-3.8-flash-high',
      '',
      'Models:',
    ].join('\n');
    expect(parseAgyModels(text)).toEqual(['gemini-3.8-flash-high', 'gemini-3.1-pro-low']);
  });

  it('JSON(글자 배열·{models:[{id}]})도 받는다. 모델 모양이 아니면 버린다', () => {
    expect(parseAgyModels('["a-1","b-2","a-1"]')).toEqual(['a-1', 'b-2']);
    expect(
      parseAgyModels(
        JSON.stringify({ models: [{ id: 'gemini-3.8-flash-high' }, { name: 'x y' }] }),
      ),
    ).toEqual(['gemini-3.8-flash-high']);
    expect(parseAgyModels('')).toEqual([]);
  });
});

describe('AgyAdapter.listModels — 가짜 CLI(`agy models`, probe)', () => {
  let world: FakeCliWorld;

  beforeEach(() => {
    world = createFakeCliWorld();
  });

  afterEach(() => {
    world.cleanup();
  });

  it('`agy models`를 빈 작업 폴더·허용 환경변수만으로 한 번 부르고 목록을 준다', async () => {
    const adapter = new AgyAdapter(new IsolatedCliRunner({ env: world.env }));
    expect(await adapter.listModels()).toEqual(FIXTURE_MODELS);
    const calls = world.records().filter((r) => r.kind === 'models');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ engine: 'agy', argv: ['models'], cwdEntries: [] });
    expect(calls[0]!.envNames).not.toContain('ANTHROPIC_API_KEY');
    expect(calls[0]!.envNames).not.toContain('OPENAI_API_KEY');
  });

  it('실패(exit 1)·빈 출력·미설치면 null', async () => {
    const runner = new IsolatedCliRunner({ env: world.env });
    world.setScenario({ agy: { models: { stdout: { text: 'boom' }, exit: 1 } } });
    expect(await new AgyAdapter(runner).listModels()).toBeNull();
    world.setScenario({ agy: { models: { stdout: { text: '' }, exit: 0 } } });
    expect(await new AgyAdapter(runner).listModels()).toBeNull();
    const noAgy = createFakeCliWorld(['claude']);
    try {
      const adapter = new AgyAdapter(new IsolatedCliRunner({ env: noAgy.env }));
      expect(await adapter.listModels()).toBeNull();
      expect(noAgy.records()).toHaveLength(0);
    } finally {
      noAgy.cleanup();
    }
  });
});

describe('AgyModelsProvider — 캐시(Proposed)', () => {
  function providerWith(results: (string[] | null | Error)[]) {
    let calls = 0;
    const adapter: Pick<AiEngineAdapter, 'code' | 'listModels'> = {
      code: 'AGY',
      listModels: () => {
        const next = results[Math.min(calls, results.length - 1)];
        calls += 1;
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? null);
      },
    };
    const provider = new AgyModelsProvider([adapter as AiEngineAdapter]);
    (provider as unknown as { logger: object }).logger = { warn: () => undefined };
    return { provider, calls: () => calls };
  }

  it('처음 필요할 때 한 번 받고, 그 뒤 list()는 부르지 않는다', async () => {
    const { provider, calls } = providerWith([['m-1', 'm-2']]);
    expect(provider.current()).toBeNull();
    expect(await provider.list()).toEqual(['m-1', 'm-2']);
    expect(await provider.list()).toEqual(['m-1', 'm-2']);
    expect(calls()).toBe(1);
  });

  it('refresh()가 실패하면(null·예외) 전 목록을 그대로 둔다. 동시에 부르면 한 번만 부른다', async () => {
    const { provider, calls } = providerWith([['m-1'], null, new Error('x'), ['m-3']]);
    await provider.refresh();
    expect(await provider.refresh()).toEqual(['m-1']);
    expect(await provider.refresh()).toEqual(['m-1']);
    const [a, b] = await Promise.all([provider.refresh(), provider.refresh()]);
    expect(a).toEqual(['m-3']);
    expect(b).toEqual(['m-3']);
    expect(calls()).toBe(4);
  });

  it('한 번도 받지 못했으면 null(쓰는 쪽이 기본 모델로 대신한다). 다시 시도는 감지 때만', async () => {
    const { provider, calls } = providerWith([null]);
    expect(await provider.list()).toBeNull();
    expect(await provider.list()).toBeNull();
    expect(calls()).toBe(1);
  });

  it('목록 명령이 없는 어댑터(가짜 목록에 AGY가 없음)면 null', async () => {
    const provider = new AgyModelsProvider([]);
    expect(await provider.list()).toBeNull();
  });
});

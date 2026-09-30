import { ApiException } from '../../common/errors/api.exception.js';
import type { Candidate, ImageAsset, StepRun } from '../../generated/prisma/client.js';
import { DEFAULT_SETTINGS } from '../settings/defaults/default-settings.js';
import type { AppSettings } from '../settings/schema/settings.types.js';
import type {
  StepInputContext,
  StepRunContext,
  StepStartContext,
  Tx,
} from '../step-engine/contracts/step-runner.js';
import { inputFingerprint } from '../step-engine/domain/fingerprint.js';
import { readResolvedInputs } from '../step-engine/execution/step-run-store.js';
import type { SourcingImagesView } from '../step-engine/ports/sourcing-selection.port.js';
import type { StepEngineApi } from '../step-engine/step-engine.api.js';
import type {
  ConfirmedReference,
  ReferenceInputSelection,
  ThumbnailReferenceRepository,
} from './references/thumbnail-reference.repository.js';
import {
  checklistSnapshot,
  type ThumbnailSelectionOutput,
} from './selection/thumbnail-selection.js';
import type { ThumbnailSelectionRepository } from './selection/thumbnail-selection.repository.js';
import {
  SourceImageDownloadError,
  type SourceImageDownloader,
  type SourceImagesInput,
} from './source-images/source-image.downloader.js';
import { ThumbnailStepRunner } from './thumbnail-step.runner.js';

const AT = new Date('2026-09-28T05:10:00Z');
const clock = { now: () => AT, sleep: () => Promise.resolve() };
const db = {} as Tx;

function view(itemCode: string): SourcingImagesView {
  return {
    sourcingStepRunId: 11,
    rakutenItemId: 5,
    itemCode,
    shopCode: itemCode.split(':')[0]!,
    shopName: null,
    itemUrl: 'x',
    collectedAt: AT,
    imageUrls: ['https://tshop.r10s.jp/a/1.jpg'],
    modelCodeNorm: '1201A019108',
    colorCode: '108',
  };
}

function candidate(itemCode: string): Candidate {
  return { id: 3, itemCode } as Candidate;
}

function inputCtx(
  itemCode: string,
  settings: Readonly<AppSettings> = DEFAULT_SETTINGS,
): StepInputContext {
  return {
    db,
    candidate: candidate(itemCode),
    settings,
    steps: {} as StepInputContext['steps'],
    completedRunId: () => 11,
  };
}

function runCtx(): StepRunContext {
  return {
    stepRunId: 90,
    candidateId: 3,
    stepCode: 'THUMBNAIL',
    version: 1,
    executionMode: 'STEP',
    stepChainId: null,
    settingsSnapshotId: 1,
    settings: DEFAULT_SETTINGS,
    inputs: [],
    ownerInputs: {},
    previous: null,
    resume: null,
    ownerEdit: null,
    aiEngine: null,
    pinnedAi: null,
  };
}

function setup(options: { selection?: boolean; itemCode?: string } = {}) {
  const itemCode = options.itemCode ?? 'shop-a:10000123';
  const downloads: SourceImagesInput[] = [];
  let downloadImpl: () => Promise<unknown> = () =>
    Promise.resolve({
      via: 'MEDIA_IMAGES',
      images: [{ imageAssetId: 21 }, { imageAssetId: 22 }],
      skipped: [],
    });
  const api = {
    currentCompletedRun: () => Promise.resolve({ id: 11 } as StepRun),
    readSourcingSelection: () => Promise.resolve(options.selection === false ? null : { itemCode }),
    readSourcingImages: () => Promise.resolve(options.selection === false ? null : view(itemCode)),
  } as unknown as StepEngineApi;
  const downloader = {
    download: (input: SourceImagesInput) => {
      downloads.push(input);
      return downloadImpl();
    },
  } as unknown as SourceImageDownloader;
  const replaced: { stepRunId: number; rows: ConfirmedReference[] }[] = [];
  let latest: ReferenceInputSelection | null = null;
  let existing = 0;
  const references = {
    latestSelectionHash: (_db: Tx, _cid: number, code: string | null) =>
      Promise.resolve(code === itemCode && latest ? 'f'.repeat(64) : null),
    referencesOf: () => Promise.resolve(new Array(existing).fill({})),
    latestEligibleInput: (_db: Tx, _cid: number, code: string | null) =>
      Promise.resolve(code === itemCode ? latest : null),
    replaceReferences: (_tx: Tx, stepRunId: number, rows: ConfirmedReference[]) => {
      replaced.push({ stepRunId, rows });
      return Promise.resolve();
    },
    copyReferences: (_tx: Tx, from: number, to: number) => {
      copied.push({ table: 'thumbnail_reference', from, to });
      return Promise.resolve(0);
    },
  } as unknown as ThumbnailReferenceRepository;
  const written: { stepRunId: number; output: ThumbnailSelectionOutput }[] = [];
  const copied: { table: string; from: number; to: number }[] = [];
  const selections = {
    write: (_tx: Tx, stepRunId: number, output: ThumbnailSelectionOutput) => {
      written.push({ stepRunId, output });
      return Promise.resolve(1);
    },
    copy: (_tx: Tx, from: number, to: number) => {
      copied.push({ table: 'thumbnail_selection', from, to });
      return Promise.resolve(null);
    },
  } as unknown as ThumbnailSelectionRepository;
  const runner = new ThumbnailStepRunner(api, downloader, references, selections, clock);
  return {
    runner,
    downloads,
    replaced,
    written,
    copied,
    setLatest: (value: ReferenceInputSelection | null) => (latest = value),
    setExisting: (n: number) => (existing = n),
    failDownload: (error: Error) => (downloadImpl = () => Promise.reject(error)),
  };
}

describe('ThumbnailStepRunner(P3-01 §5 — ⑤ 실행기)', () => {
  it('M1은 선택 AI 엔진을 쓰지 않는다(ai_* NULL, AI_ENGINE_UNAVAILABLE로 막지 않는다)', () => {
    expect(setup().runner.usesAi).toBe(false);
    expect(setup().runner.stepCode).toBe('THUMBNAIL');
  });

  it('시작 조건 키는 설정 두 개뿐이다(규칙 2) — 레퍼런스 선택은 실행 중 오너 입력(지문 밖)', async () => {
    const { runner } = setup();
    const inputs = await runner.readInputs(inputCtx('shop-a:10000123'));
    expect(inputs.filter((i) => i.isStartCondition).map((i) => [i.inputKey, i.sourceType])).toEqual(
      [
        ['settings.thumbnail.promptTemplate', 'SETTINGS'],
        ['settings.thumbnail.faceOptionDefault', 'SETTINGS'],
      ],
    );
    expect(inputs.filter((i) => !i.isStartCondition).map((i) => i.inputKey)).toEqual([
      'owner.referenceSelection',
    ]);
    expect(inputs.some((i) => i.sourceType === 'PREV_STEP')).toBe(false);
  });

  it('② itemCode만 다른 새 버전이어도 ⑤ 지문이 같다(같은 앵커 키 안에서 샵만 바꿈), 설정이 바뀌면 다르다', async () => {
    const { runner } = setup();
    const a = await readResolvedInputs(runner, inputCtx('shop-a:10000123'));
    const b = await readResolvedInputs(runner, inputCtx('shop-b:20000456'));
    expect(inputFingerprint(b)).toBe(inputFingerprint(a));
    const changed = structuredClone(DEFAULT_SETTINGS) as AppSettings;
    changed.thumbnail.faceOptionDefault = 'CHIN_CROP';
    const c = await readResolvedInputs(runner, inputCtx('shop-a:10000123', changed));
    expect(inputFingerprint(c)).not.toBe(inputFingerprint(a));
  });

  it('레퍼런스 선택 값 = 최신 선택의 레퍼런스 해시(이 itemCode 원본일 때만, 없으면 null)', async () => {
    const t = setup();
    expect(
      (await t.runner.readInputs(inputCtx('shop-a:10000123'))).find(
        (i) => i.inputKey === 'owner.referenceSelection',
      )?.value,
    ).toBeNull();
    t.setLatest({ inputNo: 1, rows: [] });
    expect(
      (await t.runner.readInputs(inputCtx('shop-a:10000123'))).find(
        (i) => i.inputKey === 'owner.referenceSelection',
      )?.value,
    ).toBe('f'.repeat(64));
  });

  it('beforeStart: ② 완료 버전에 소싱 선택이 없으면 409 STEP_START_CONDITION_UNMET(sourcing.selection)', async () => {
    const { runner } = setup({ selection: false });
    const start = { db, candidate: candidate('x') } as unknown as StepStartContext;
    const error = await runner.beforeStart(start).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiException);
    expect(error).toMatchObject({
      code: 'STEP_START_CONDITION_UNMET',
      fieldErrors: [{ field: 'sourcing.selection' }],
    });
    await expect(setup().runner.beforeStart(start)).resolves.toBeUndefined();
  });

  it('run: 원본을 받고 입력 대기(THUMBNAIL_REFERENCE_REQUIRED, pending owner.referenceSelection)', async () => {
    const { runner, downloads } = setup();
    const outcome = await runner.run(runCtx());
    expect(downloads).toEqual([
      {
        itemCode: 'shop-a:10000123',
        shopCode: 'shop-a',
        imageUrls: ['https://tshop.r10s.jp/a/1.jpg'],
        modelCodeNorm: '1201A019108',
        colorCode: '108',
      },
    ]);
    expect(outcome).toEqual({
      kind: 'WAITING_INPUT',
      waitingReasonCode: 'THUMBNAIL_REFERENCE_REQUIRED',
      pendingInputs: ['owner.referenceSelection'],
      output: {
        kind: 'THUMBNAIL_ORIGINALS',
        candidateId: 3,
        itemCode: 'shop-a:10000123',
        imageAssetIds: [21, 22],
        via: 'MEDIA_IMAGES',
      },
    });
  });

  it('run: 받기 실패는 FAILED(EXTERNAL_API) — 받기 오류·관문 오류 코드 그대로', async () => {
    const t = setup();
    t.failDownload(new SourceImageDownloadError('RAKUTEN_IMAGE_HTTP_503', '받지 못했습니다'));
    expect(await t.runner.run(runCtx())).toEqual({
      kind: 'FAILED',
      failureKind: 'EXTERNAL_API',
      errorCode: 'RAKUTEN_IMAGE_HTTP_503',
      errorMessage: '받지 못했습니다',
    });
    t.failDownload(new ApiException('EXTERNAL_CALL_COOLDOWN'));
    expect(await t.runner.run(runCtx())).toMatchObject({
      kind: 'FAILED',
      failureKind: 'EXTERNAL_API',
      errorCode: 'EXTERNAL_CALL_COOLDOWN',
    });
    t.failDownload(new Error('boom'));
    await expect(t.runner.run(runCtx())).rejects.toThrow('boom');
  });

  it('persist: 최신 선택이 이 itemCode 원본이면 thumbnail_reference 기본값으로 복사(이미 있으면 두지 않는다)', async () => {
    const t = setup();
    const outcome = await t.runner.run(runCtx());
    await t.runner.persist(db, 90, outcome);
    expect(t.replaced).toEqual([]);
    t.setLatest({
      inputNo: 2,
      rows: [
        {
          imageAssetId: 22,
          sortOrder: 1,
          noPersonConfirmedAt: AT,
          image: {} as ImageAsset,
        },
      ],
    });
    await t.runner.persist(db, 90, outcome);
    expect(t.replaced).toEqual([
      { stepRunId: 90, rows: [{ imageAssetId: 22, sortOrder: 1, noPersonConfirmedAt: AT }] },
    ]);
    t.setExisting(1);
    await t.runner.persist(db, 90, outcome);
    expect(t.replaced).toHaveLength(1);
    // 다른 결과(실패)는 쓰지 않는다
    await t.runner.persist(db, 90, {
      kind: 'FAILED',
      failureKind: 'EXTERNAL_API',
      errorCode: 'X',
      errorMessage: 'x',
    });
    expect(t.replaced).toHaveLength(1);
  });

  it('persist(P3-02): G3 선택 결과(THUMBNAIL_SELECTION)면 ⑤를 닫기 전에 선택본을 쓰고 레퍼런스는 건드리지 않는다', async () => {
    const t = setup();
    const output: ThumbnailSelectionOutput = {
      kind: 'THUMBNAIL_SELECTION',
      checklist: checklistSnapshot(),
      sameProductColorConfirmedAt: null,
      selectedAt: AT,
      images: [{ imageAssetId: 31, role: 'REPRESENTATIVE', sortOrder: 0 }],
    };
    await t.runner.persist(db, 90, { kind: 'COMPLETED', output });
    expect(t.written).toEqual([{ stepRunId: 90, output }]);
    expect(t.replaced).toEqual([]);
    // 결과가 선택본이 아니면(다른 완료) 쓰지 않는다
    await t.runner.persist(db, 91, { kind: 'COMPLETED', output: null });
    expect(t.written).toHaveLength(1);
  });

  it('copyOutput(P3-02): 이전 버전 다시 고르기는 레퍼런스와 G3 선택을 새 버전으로 복사한다(생성 시도는 복사하지 않는다)', async () => {
    const t = setup();
    await t.runner.copyOutput(db, 90, 95);
    expect(t.copied).toEqual([
      { table: 'thumbnail_reference', from: 90, to: 95 },
      { table: 'thumbnail_selection', from: 90, to: 95 },
    ]);
  });
});

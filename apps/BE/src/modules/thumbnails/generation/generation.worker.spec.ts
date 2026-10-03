import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { FileStorageService } from '../../../common/files/file-storage.service.js';
import { ImageAssetsService } from '../../../common/files/image-assets.service.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { Clock } from '../../integrations/http/clock.token.js';
import { FakeImageGenProvider } from '../../integrations/image-gen/fake-image-gen.provider.js';
import type { SettingsService } from '../../settings/settings.service.js';
import { GENERATION_ERROR_MESSAGES } from './generation-rules.js';
import { detectGeneratedImage, finishTimeOf, GenerationWorker } from './generation.worker.js';

const FIXTURES = join(import.meta.dirname, '../../../../test/fixtures/thumbnails');
const pngNamedJpg = readFileSync(join(FIXTURES, 'generated/slot-2.jpg'));
const STARTED = new Date('2026-09-28T05:20:00Z');

function runRow(patch: Record<string, unknown> = {}) {
  return {
    id: 41,
    stepRunId: 9,
    slotNo: 2,
    attemptNo: 1,
    triggerType: 'INITIAL',
    prompt: 'square 1:1, 1024 pixels. Model framing: full face.',
    promptAdjusted: false,
    faceOption: 'FULL_FACE',
    requestedSizePx: 1024,
    provider: 'AGY',
    model: 'fake-image-gen',
    providerVersion: 'fake-1',
    referenceSetSha256: 'a'.repeat(64),
    status: 'RUNNING',
    refusalReason: null,
    errorMessage: null,
    resultImageAssetId: null,
    startedAt: STARTED,
    finishedAt: null,
    ...patch,
  };
}

/** DB·파일·설정 대역(메모리) — 실제 형식 판별(sharp)과 ImageAssetsService.saveImage는 그대로 돈다 */
function setup(timeoutSeconds = 300) {
  let row = runRow();
  const createdAssets: Record<string, unknown>[] = [];
  const events: { name: string; data: Record<string, unknown> }[] = [];
  const update = ({ data }: { data: Record<string, unknown> }) => {
    if (row.status !== 'RUNNING') return Promise.resolve({ count: 0 });
    row = { ...row, ...data };
    return Promise.resolve({ count: 1 });
  };
  const generationRun = {
    findUnique: () => Promise.resolve({ ...row, stepRun: { candidateId: 3 } }),
    updateMany: update,
    findUniqueOrThrow: () => Promise.resolve(row),
  };
  const tx = {
    generationRun,
    imageAsset: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        createdAssets.push(data);
        return Promise.resolve({ id: 77, ...data });
      },
    },
  };
  const prisma = {
    generationRun,
    thumbnailReference: {
      findMany: () => Promise.resolve([{ imageAsset: { filePath: 'images/ab/ref.jpg' } }]),
    },
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaService;
  const files = {
    exists: () => Promise.resolve(true),
    resolve: (p: string) => `/data/${p}`,
    imagePath: (sha: string, ext: string) => `images/${sha.slice(0, 2)}/${sha}.${ext}`,
    writeIfAbsent: () => Promise.resolve(true),
  } as unknown as FileStorageService;
  const settings = {
    currentOrNull: () => ({ thumbnail: { generationTimeoutSeconds: timeoutSeconds } }),
  } as unknown as SettingsService;
  const publisher = {
    publish: (name: string, data: Record<string, unknown>) => {
      events.push({ name, data });
    },
  } as unknown as ProgressEventsService;
  const provider = new FakeImageGenProvider();
  const clock: Clock = {
    now: () => new Date('2026-09-28T05:21:00Z'),
    sleep: () => Promise.resolve(),
  };
  const worker = new GenerationWorker(
    prisma,
    settings,
    new ImageAssetsService(prisma, files),
    files,
    publisher,
    provider,
    clock,
  );
  return { worker, provider, createdAssets, events, row: () => row };
}

describe('GenerationWorker(P3-02 규칙 5·6 — 생성 한 건)', () => {
  it('형식 판별: 공급자가 .jpg 이름으로 PNG를 주면 mime_type=image/png로 저장한다(GENERATED·PERMITTED·candidate_id)', async () => {
    await expect(detectGeneratedImage(pngNamedJpg)).resolves.toMatchObject({
      mimeType: 'image/png',
      width: 256,
      height: 256,
    });
    const t = setup();
    t.provider.enqueue({ kind: 'success', bytes: pngNamedJpg, fileName: 'slot-2.jpg' });
    t.worker.submit([41]);
    await t.worker.whenIdle();
    expect(t.createdAssets).toEqual([
      expect.objectContaining({
        kind: 'GENERATED',
        usageRight: 'PERMITTED',
        candidateId: 3,
        mimeType: 'image/png',
        width: 256,
        height: 256,
      }),
    ]);
    expect(String(t.createdAssets[0]!.filePath)).toMatch(/\.png$/);
    expect(t.row()).toMatchObject({ status: 'SUCCEEDED', resultImageAssetId: 77 });
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toMatchObject({
      name: 'generation-run.updated',
      data: {
        generationRunId: 41,
        candidateId: 3,
        stepRunId: 9,
        slotNo: 2,
        attemptNo: 1,
        triggerType: 'INITIAL',
        status: 'SUCCEEDED',
        resultImageAssetId: 77,
      },
    });
    // 공급자에게는 레퍼런스 절대 경로·해상도·타임아웃과 call_log 연결용 id만 넘긴다(M0 S1)
    expect(t.provider.calls[0]).toMatchObject({
      referenceImagePaths: ['/data/images/ab/ref.jpg'],
      sizePx: 1024,
      timeoutMs: 300_000,
      stepRunId: 9,
      candidateId: 3,
    });
  });

  it('이미지가 아닌 바이트 → FAILED(형식 판별 실패), image_asset을 만들지 않는다', async () => {
    const t = setup();
    t.provider.enqueue({ kind: 'success', bytes: Buffer.from('not an image') });
    t.worker.submit([41]);
    await t.worker.whenIdle();
    expect(t.createdAssets).toEqual([]);
    expect(t.row()).toMatchObject({
      status: 'FAILED',
      errorMessage: GENERATION_ERROR_MESSAGES.unsupported,
    });
  });

  it('거부 → REFUSED + refusal_reason, 실패 → FAILED + 공급자 문구', async () => {
    const refused = setup();
    refused.provider.enqueue({ kind: 'refused', reason: '인물 생성 제한' });
    refused.worker.submit([41]);
    await refused.worker.whenIdle();
    expect(refused.row()).toMatchObject({ status: 'REFUSED', refusalReason: '인물 생성 제한' });

    const failed = setup();
    failed.provider.enqueue({ kind: 'failed', message: '도구 오류' });
    failed.worker.submit([41]);
    await failed.worker.whenIdle();
    expect(failed.row()).toMatchObject({ status: 'FAILED', errorMessage: '도구 오류' });
  });

  it('타임아웃 → FAILED + 한국어 문구(설정 시간)', async () => {
    const t = setup(0.02);
    t.provider.enqueue({ kind: 'timeout' });
    t.worker.submit([41]);
    await t.worker.whenIdle();
    expect(t.row()).toMatchObject({
      status: 'FAILED',
      errorMessage: GENERATION_ERROR_MESSAGES.timeout(20),
    });
    expect(t.row().finishedAt).toEqual(new Date('2026-09-28T05:21:00Z'));
  });

  it('타임아웃 뒤 행은 바로 마감하고, 끊긴 공급자가 끝날 때까지 대기열을 비우지 않는다(이미지 작업 동시 1개)', async () => {
    const t = setup(0.02);
    const order: string[] = [];
    // 끊긴 뒤 50ms 지나서야 끝나는 공급자(agy 자식이 SIGTERM 뒤 끝나는 시간). ESM 모드라 jest.spyOn 대신 직접 바꾼다
    t.provider.generate = (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          order.push(`abort:${String(t.row().status)}`);
          setTimeout(() => {
            order.push(`end:${String(t.row().status)}`);
            reject(new Error('killed'));
          }, 50);
        });
      });
    t.worker.submit([41]);
    await t.worker.whenIdle();
    order.push('idle');
    // 끊긴 때는 아직 RUNNING, 공급자가 끝날 때는 이미 FAILED(행은 기다리지 않고 마감), 대기열은 그 뒤에 빈다
    expect(order).toEqual(['abort:RUNNING', 'end:FAILED', 'idle']);
    expect(t.row()).toMatchObject({
      status: 'FAILED',
      errorMessage: GENERATION_ERROR_MESSAGES.timeout(20),
    });
  });

  it('마감 시각은 시작보다 이르지 않다(ck_gen_time)', () => {
    expect(finishTimeOf(new Date('2026-09-28T05:00:00Z'), STARTED)).toEqual(STARTED);
    const later = new Date('2026-09-28T06:00:00Z');
    expect(finishTimeOf(later, STARTED)).toEqual(later);
  });
});

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { ImageAssetsService } from '../../../common/files/image-assets.service.js';
import type { SaveImageMeta } from '../../../common/files/image-asset.rules.js';
import type { ImageAsset, UploadedImage } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FixtureCommerceImagesPort } from '../../../../test/support/fake-commerce-images.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import { COMMERCE_IMAGES_PORT } from '../../integrations/naver-commerce/commerce-images.port.js';
import {
  ImageNotAllowedError,
  ImageUploadService,
  type UploadSource,
} from './image-upload.service.js';
import { UploadQueue } from './upload-queue.js';

const FIXTURES = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'test',
  'fixtures',
  'registration',
  'upload',
);
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

/** 이미지 표·업로드 캐시만 흉내 내는 메모리 DB(추가만 — 고치지 않는다) */
class MemoryDb {
  readonly assets: ImageAsset[] = [];
  readonly uploaded: UploadedImage[] = [];
  readonly files = new Map<number, Buffer>();

  addAsset(buffer: Buffer, patch: Partial<ImageAsset> & Pick<ImageAsset, 'kind'>): ImageAsset {
    const id = this.assets.length + 1;
    const row: ImageAsset = {
      id,
      filePath: `images/x/${id}`,
      sha256: sha(buffer),
      byteSize: buffer.length,
      mimeType: 'image/png',
      width: 1024,
      height: 1024,
      sourceSection: null,
      sourceUrl: null,
      sourceItemCode: null,
      sourceShopCode: null,
      sourceModelCodeNorm: null,
      sourceColorCode: null,
      collectedAt: null,
      usageRight:
        patch.kind === 'ORIGINAL' || patch.kind === 'REFERENCE' ? 'REFERENCE_ONLY' : 'PERMITTED',
      candidateId: patch.kind === 'ORIGINAL' ? null : 1,
      derivedFromImageAssetId: null,
      createdAt: new Date('2026-09-28T00:00:00Z'),
      ...patch,
    };
    this.assets.push(row);
    this.files.set(id, buffer);
    return row;
  }

  readonly prisma = {
    imageAsset: {
      findMany: ({ where }: { where: { id: { in: number[] } } }) =>
        Promise.resolve(this.assets.filter((a) => where.id.in.includes(a.id))),
      findFirst: ({
        where,
      }: {
        where: { kind: string; derivedFromImageAssetId: number; uploadedImage: null };
      }) =>
        Promise.resolve(
          [...this.assets]
            .reverse()
            .find(
              (a) =>
                a.kind === where.kind &&
                a.derivedFromImageAssetId === where.derivedFromImageAssetId &&
                !this.uploaded.some((u) => u.imageAssetId === a.id),
            ) ?? null,
        ),
    },
    uploadedImage: {
      findMany: ({ where }: { where: { sourceSha256: { in: string[] } } }) =>
        Promise.resolve(
          this.uploaded.filter((u) => where.sourceSha256.in.includes(u.sourceSha256)),
        ),
      create: ({ data }: { data: Omit<UploadedImage, 'id'> }) => {
        if (this.uploaded.some((u) => u.sourceSha256 === data.sourceSha256)) {
          return Promise.reject(new Error('uploaded_image_source_sha256_key'));
        }
        const row: UploadedImage = { id: this.uploaded.length + 1, ...data };
        this.uploaded.push(row);
        return Promise.resolve(row);
      },
    },
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(this.prisma),
  };

  readonly images = {
    readFile: (id: number) =>
      Promise.resolve({
        buffer: this.files.get(id)!,
        asset: this.assets.find((a) => a.id === id)!,
      }),
    saveImage: (buffer: Buffer, meta: SaveImageMeta) =>
      Promise.resolve(
        this.addAsset(buffer, {
          kind: meta.kind,
          mimeType: 'image/jpeg',
          width: 1000,
          height: 1000,
          candidateId: meta.candidateId ?? null,
          derivedFromImageAssetId: meta.derivedFromImageAssetId ?? null,
        }),
      ),
  };
}

const clock: Clock = {
  now: () => new Date('2026-10-01T05:00:00Z'),
  sleep: () => Promise.resolve(),
};

async function setup() {
  const db = new MemoryDb();
  const port = new FixtureCommerceImagesPort();
  const moduleRef = await Test.createTestingModule({
    providers: [
      ImageUploadService,
      UploadQueue,
      { provide: PrismaService, useValue: db.prisma },
      { provide: ImageAssetsService, useValue: db.images },
      { provide: CLOCK, useValue: clock },
      { provide: COMMERCE_IMAGES_PORT, useValue: null },
    ],
  })
    .overrideProvider(COMMERCE_IMAGES_PORT)
    .useValue(port)
    .compile();
  return { db, port, service: moduleRef.get(ImageUploadService) };
}

const CTX = { candidateId: 1, stepRunId: 50 };
const rep = (asset: ImageAsset): UploadSource => ({
  imageAssetId: asset.id,
  sortOrder: 0,
  role: 'REPRESENTATIVE',
});
const add = (asset: ImageAsset, sortOrder: number): UploadSource => ({
  imageAssetId: asset.id,
  sortOrder,
  role: 'ADDITIONAL',
});

describe('image-upload.service — 참조 전용 거부·해시 재사용·정규화·묶음(규칙 4~8)', () => {
  it('ORIGINAL(REFERENCE_ONLY) 1장 포함 → IMAGE_NOT_ALLOWED 예외, 가짜 포트 호출 0', async () => {
    const { db, port, service } = await setup();
    const generated = db.addAsset(fixture('gen-1024.png'), { kind: 'GENERATED' });
    const original = db.addAsset(fixture('gen-portrait.png'), { kind: 'ORIGINAL' });
    await expect(service.uploadSelection([rep(generated), add(original, 1)], CTX)).rejects.toThrow(
      ImageNotAllowedError,
    );
    expect(port.calls).toHaveLength(0);
    // 정규화본도 만들지 않았다(외부 호출 전, 첫 줄에서 막는다)
    expect(db.assets.filter((a) => a.kind === 'UPLOAD')).toHaveLength(0);
  });

  it('참조 전용에서 만든 파일(UPLOAD ← ORIGINAL 사슬)도 거부한다', async () => {
    const { db, port, service } = await setup();
    const original = db.addAsset(fixture('gen-portrait.png'), { kind: 'ORIGINAL' });
    const derived = db.addAsset(fixture('gen-1024.png'), {
      kind: 'UPLOAD',
      derivedFromImageAssetId: original.id,
    });
    await expect(service.uploadSelection([rep(derived)], CTX)).rejects.toMatchObject({
      reason: 'REFERENCE_ONLY',
      imageAssetIds: [derived.id],
    });
    expect(port.calls).toHaveLength(0);
  });

  it('처음: 2장 → 정규화본(UPLOAD·derived_from) 2개, 호출 1건·파일 2개. 같은 sha256 두 번째 실행 → 호출 0, 같은 URL', async () => {
    const { db, port, service } = await setup();
    const a = db.addAsset(fixture('gen-1024.png'), { kind: 'GENERATED' });
    const b = db.addAsset(fixture('gen-webp-named.jpg'), { kind: 'GENERATED' });
    const first = await service.uploadSelection([rep(a), add(b, 1)], CTX);
    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]!.files).toHaveLength(2);
    expect(port.calls[0]!.context).toEqual(CTX);
    const uploads = db.assets.filter((x) => x.kind === 'UPLOAD');
    expect(uploads.map((u) => u.derivedFromImageAssetId)).toEqual([a.id, b.id]);
    expect(first.map((r) => [r.sortOrder, r.role, r.reused])).toEqual([
      [0, 'REPRESENTATIVE', false],
      [1, 'ADDITIONAL', false],
    ]);
    expect(first.map((r) => r.sourceSha256)).toEqual([a.sha256, b.sha256]);
    expect(first[0]!.traceId).toBe('fixture-trace-upload-200');
    expect(db.uploaded.map((u) => u.uploadedAt.toISOString())).toEqual([
      '2026-10-01T05:00:00.000Z',
      '2026-10-01T05:00:00.000Z',
    ]);

    const again = await service.uploadSelection([rep(a), add(b, 1)], { ...CTX, stepRunId: 51 });
    expect(port.calls).toHaveLength(1);
    expect(again.map((r) => r.url)).toEqual(first.map((r) => r.url));
    expect(again.every((r) => r.reused)).toBe(true);
    // 다른 후보·버전이라도 같은 해시면 다시 쓴다
    const otherCandidate = db.addAsset(fixture('gen-1024.png'), {
      kind: 'GENERATED',
      candidateId: 2,
    });
    const reused = await service.uploadSelection([rep(otherCandidate)], {
      candidateId: 2,
      stepRunId: 70,
    });
    expect(port.calls).toHaveLength(1);
    expect(reused[0]!.url).toBe(first[0]!.url);
  });

  it('선택본 3장 중 1장만 새 해시 → 호출 1건, 파일 1개', async () => {
    const { db, port, service } = await setup();
    const a = db.addAsset(fixture('gen-1024.png'), { kind: 'GENERATED' });
    const b = db.addAsset(fixture('gen-webp-named.jpg'), { kind: 'GENERATED' });
    await service.uploadSelection([rep(a), add(b, 1)], CTX);
    port.reset();
    const c = db.addAsset(fixture('gen-portrait.png'), { kind: 'GENERATED' });
    const out = await service.uploadSelection([rep(a), add(b, 1), add(c, 2)], CTX);
    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]!.files).toHaveLength(1);
    expect(out.map((r) => r.reused)).toEqual([true, true, false]);
  });

  it('묶음 상한을 넘으면 여러 번 차례로 보낸다(동시 1건). 뒤 묶음이 실패해도 앞 묶음 URL은 남는다(Proposed)', async () => {
    const { db, port, service } = await setup();
    service.batchLimits = { maxFiles: 1, maxBytesExclusive: 10_485_760 };
    const sources = ['gen-1024.png', 'gen-webp-named.jpg', 'big-4mb.jpg'].map((name) =>
      db.addAsset(fixture(name), { kind: 'GENERATED' }),
    );
    const failure = new Error('500');
    // 셋째 묶음만 실패
    let calls = 0;
    const original = port.uploadProductImages.bind(port);
    port.uploadProductImages = async (files, ctx) => {
      calls += 1;
      if (calls === 3) throw failure;
      return original(files, ctx);
    };
    await expect(
      service.uploadSelection(
        sources.map((s, i) => (i === 0 ? rep(s) : add(s, i))),
        CTX,
      ),
    ).rejects.toBe(failure);
    expect(port.calls).toHaveLength(2);
    expect(port.maxInFlight).toBe(1);
    expect(db.uploaded.map((u) => u.sourceSha256)).toEqual([
      sources[0]!.sha256,
      sources[1]!.sha256,
    ]);

    // 다시 실행: 앞 두 장은 다시 올리지 않고, 실패한 한 장만(만들어 둔 정규화본을 다시 쓴다)
    port.uploadProductImages = original;
    const uploadsBefore = db.assets.filter((a) => a.kind === 'UPLOAD').length;
    const out = await service.uploadSelection(
      sources.map((s, i) => (i === 0 ? rep(s) : add(s, i))),
      CTX,
    );
    expect(port.calls).toHaveLength(3);
    expect(port.calls[2]!.files).toHaveLength(1);
    expect(db.assets.filter((a) => a.kind === 'UPLOAD')).toHaveLength(uploadsBefore);
    expect(out.map((r) => r.reused)).toEqual([true, true, false]);
  });

  it('두 후보의 업로드를 동시에 요청해도 가짜 포트가 본 동시 호출은 최대 1', async () => {
    const { db, port, service } = await setup();
    const a = db.addAsset(fixture('gen-1024.png'), { kind: 'GENERATED' });
    const b = db.addAsset(fixture('gen-webp-named.jpg'), { kind: 'GENERATED', candidateId: 2 });
    const release = port.hold();
    const first = service.uploadSelection([rep(a)], CTX);
    const second = service.uploadSelection([rep(b)], { candidateId: 2, stepRunId: 60 });
    // 첫 업로드가 포트에 닿을 때까지 기다린다(정규화 시간은 테스트 부하에 따라 50ms를 넘을 수 있다 — 고정 대기만으로는 흔들렸다)
    for (let i = 0; i < 300 && port.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(port.calls).toHaveLength(1);
    release();
    await Promise.all([first, second]);
    expect(port.calls).toHaveLength(2);
    expect(port.maxInFlight).toBe(1);
  });
});

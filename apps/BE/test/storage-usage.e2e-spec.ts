import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { FileStorageService } from '../src/common/files/file-storage.service.js';
import {
  AGY_RECORDS_DISPLAY_PATH,
  APP_IMAGES_FALLBACK_DISPLAY_PATH,
  STORAGE_USAGE_OPTIONS,
  type StorageUsageOptions,
} from '../src/modules/system/storage-usage/storage-usage.options.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

const USAGE_URL = '/api/v1/storage-usage';

interface UsageBody {
  items: {
    key: string;
    displayPath: string;
    status: string;
    bytes: number | null;
    fileCount: number | null;
  }[];
  disk: { freeBytes: number | null; totalBytes: number | null };
  measuredAt: string;
}

/** 폴더 아래 (경로, 크기, 수정 시각) — 요청 전후가 같은지(읽기 전용) 본다 */
function snapshot(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .map((d) => {
      const p = join(d.parentPath, d.name);
      const s = statSync(p);
      return `${p} ${s.size} ${s.mtimeMs}`;
    })
    .sort();
}

describe('저장 공간(e2e, GET /storage-usage, D-25)', () => {
  let t: TestApp;
  let fakeHome: string;
  let agyRoot: string;
  let imagesDir: string;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    fakeHome = mkdtempSync(join(tmpdir(), 'autostore-e2e-home-'));
    agyRoot = join(fakeHome, '.gemini', 'antigravity-cli');
    const options: StorageUsageOptions = {
      agyRoot,
      homeDir: fakeHome,
      timeBudgetMs: 5000,
      cacheTtlMs: 60_000,
    };
    t = await createTestApp({ overrides: [{ provide: STORAGE_USAGE_OPTIONS, useValue: options }] });
    imagesDir = join(t.app.get(FileStorageService).rootDir, 'images');
  });

  beforeEach(async () => {
    rmSync(agyRoot, { recursive: true, force: true });
    rmSync(imagesDir, { recursive: true, force: true });
    mkdirSync(join(agyRoot, 'brain', 'conv-1'), { recursive: true });
    mkdirSync(join(agyRoot, 'conversations'), { recursive: true });
    writeFileSync(join(agyRoot, 'brain', 'conv-1', 'thumbnail.jpg'), Buffer.alloc(4000));
    writeFileSync(join(agyRoot, 'conversations', 'conv-1.db'), Buffer.alloc(1000));
    mkdirSync(join(imagesDir, 'ab'), { recursive: true });
    writeFileSync(join(imagesDir, 'ab', `${'ab'.repeat(32)}.jpg`), Buffer.alloc(700));
    // 캐시를 비운다(이전 테스트 값이 남지 않게)
    await http().get(`${USAGE_URL}?refresh=true`).expect(200);
  });

  afterAll(async () => {
    await t.app.close();
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('200: 05-2 StorageUsage 모양 — 폴더 2개(순서)·크기·파일 수·디스크·잰 시각', async () => {
    const res = await http().get(USAGE_URL).expect(200);
    const body = res.body as UsageBody;
    expect(Object.keys(body).sort()).toEqual(['disk', 'items', 'measuredAt']);
    expect(body.items).toEqual([
      {
        key: 'AGY_RECORDS',
        displayPath: AGY_RECORDS_DISPLAY_PATH,
        status: 'OK',
        bytes: 5000,
        fileCount: 2,
      },
      {
        key: 'APP_IMAGES',
        displayPath: APP_IMAGES_FALLBACK_DISPLAY_PATH,
        status: 'OK',
        bytes: 700,
        fileCount: 1,
      },
    ]);
    expect(Object.keys(body.disk).sort()).toEqual(['freeBytes', 'totalBytes']);
    expect(body.disk.totalBytes).toBeGreaterThan(0);
    expect(body.disk.freeBytes).toBeGreaterThanOrEqual(0);
    expect(body.measuredAt).toBe(t.clock.now().toISOString());
  });

  it('응답에 절대 경로가 없다(데이터 폴더·가짜 홈·실제 홈)', async () => {
    const res = await http().get(USAGE_URL).expect(200);
    expect(res.text).not.toContain(t.app.get(FileStorageService).rootDir);
    expect(res.text).not.toContain(fakeHome);
    expect(res.text).not.toContain(homedir());
  });

  it('읽기 전용: 요청 전후로 두 폴더 안이 그대로다', async () => {
    const before = [snapshot(agyRoot), snapshot(imagesDir)];
    await http().get(`${USAGE_URL}?refresh=true`).expect(200);
    expect([snapshot(agyRoot), snapshot(imagesDir)]).toEqual(before);
  });

  it('1분 안에는 같은 값, refresh=true면 새로 잼, 1분이 지나면 새로 잼', async () => {
    writeFileSync(join(agyRoot, 'conversations', 'conv-2.db'), Buffer.alloc(1000));
    const cached = (await http().get(USAGE_URL).expect(200)).body as UsageBody;
    expect(cached.items[0]!.bytes).toBe(5000);

    const refreshed = (await http().get(`${USAGE_URL}?refresh=true`).expect(200)).body as UsageBody;
    expect(refreshed.items[0]!.bytes).toBe(6000);
    expect(refreshed.items[0]!.fileCount).toBe(3);

    writeFileSync(join(imagesDir, 'ab', 'second.png'), Buffer.alloc(300));
    t.clock.advance(60_000);
    const expired = (await http().get(`${USAGE_URL}?refresh=false`).expect(200)).body as UsageBody;
    expect(expired.items[1]!.bytes).toBe(1000);
    expect(expired.measuredAt).toBe(t.clock.now().toISOString());
  });

  it('폴더가 없으면 NOT_FOUND(크기 null)', async () => {
    rmSync(agyRoot, { recursive: true, force: true });
    rmSync(imagesDir, { recursive: true, force: true });
    const body = (await http().get(`${USAGE_URL}?refresh=true`).expect(200)).body as UsageBody;
    expect(body.items.map((i) => [i.key, i.status, i.bytes, i.fileCount])).toEqual([
      ['AGY_RECORDS', 'NOT_FOUND', null, null],
      ['APP_IMAGES', 'NOT_FOUND', null, null],
    ]);
  });

  it('refresh가 true·false가 아니면 422 INVALID_QUERY_PARAMETER(fieldErrors refresh)', async () => {
    const res = await http().get(`${USAGE_URL}?refresh=yes`).expect(422);
    const body = res.body as { code: string; fieldErrors: { field: string }[] };
    expect(body.code).toBe('INVALID_QUERY_PARAMETER');
    expect(body.fieldErrors.map((f) => f.field)).toEqual(['refresh']);
  });

  it('정의 밖 쿼리(path 등)는 422 — 경로를 받지 않는다', async () => {
    const res = await http().get(`${USAGE_URL}?path=/etc`).expect(422);
    expect((res.body as { code: string }).code).toBe('INVALID_QUERY_PARAMETER');
  });

  it('Host가 attacker.example이면 403 HOST_NOT_ALLOWED', async () => {
    const res = await http().get(USAGE_URL).set('Host', 'attacker.example');
    expect(res.status).toBe(403);
    expect((res.body as { code: string }).code).toBe('HOST_NOT_ALLOWED');
  });

  it('GET이라 X-AutoStore-Client·Origin이 없어도 200, 다른 Origin이어도 CORS 헤더가 없다', async () => {
    const plain = await http().get(USAGE_URL).expect(200);
    const foreign = await http().get(USAGE_URL).set('Origin', 'http://evil.example').expect(200);
    for (const res of [plain, foreign]) {
      const cors = Object.keys(res.headers).filter((h) => h.startsWith('access-control-'));
      expect(cors).toEqual([]);
    }
  });
});

describe('저장 공간(e2e) — 기본 테스트 앱은 사용자 ~/.gemini를 읽지 않는다', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('createTestApp 기본: agy 폴더는 데이터 폴더(임시) 안의 없는 폴더 → NOT_FOUND', async () => {
    const res = await request(t.app.getHttpServer()).get(USAGE_URL).expect(200);
    const body = res.body as UsageBody;
    expect(body.items[0]).toMatchObject({
      key: 'AGY_RECORDS',
      displayPath: AGY_RECORDS_DISPLAY_PATH,
      status: 'NOT_FOUND',
      bytes: null,
    });
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { AppConfigService } from '../../../common/config/app-config.service.js';
import type { Clock } from '../../integrations/http/clock.token.js';
import {
  AGY_RECORDS_DISPLAY_PATH,
  APP_IMAGES_FALLBACK_DISPLAY_PATH,
  defaultAgyRecordsRoot,
  defaultStorageUsageOptions,
  homeDisplayPath,
  type StorageUsageOptions,
} from './storage-usage.options.js';
import { readDiskSpace, StorageUsageService } from './storage-usage.service.js';

class TestClock implements Clock {
  constructor(public ms: number) {}
  now(): Date {
    return new Date(this.ms);
  }
  sleep(): Promise<void> {
    return Promise.resolve();
  }
}

describe('homeDisplayPath(응답에 절대 경로를 넣지 않는다)', () => {
  it('홈 아래면 ~/…(구분자 /)', () => {
    expect(homeDisplayPath('/Users/kim/Library/autoStore/images', '/Users/kim', 'F')).toBe(
      '~/Library/autoStore/images',
    );
  });

  it.each([
    ['홈 밖', '/var/folders/x/images', '/Users/kim'],
    ['홈과 같은 경로', '/Users/kim', '/Users/kim'],
    ['이름이 비슷한 이웃 폴더', '/Users/kimchi/images', '/Users/kim'],
    ['홈이 /', '/data/images', '/'],
  ])('%s → 대체 글', (_name, abs, home) => {
    expect(homeDisplayPath(abs, home, 'F')).toBe('F');
  });

  it('agy 기록 기본 폴더는 <홈>/.gemini/antigravity-cli', () => {
    expect(defaultAgyRecordsRoot('/Users/kim')).toBe('/Users/kim/.gemini/antigravity-cli');
    expect(defaultStorageUsageOptions('/Users/kim')).toEqual({
      agyRoot: '/Users/kim/.gemini/antigravity-cli',
      homeDir: '/Users/kim',
      timeBudgetMs: 5000,
      cacheTtlMs: 60000,
    });
  });
});

describe('readDiskSpace', () => {
  it('남은 공간 = bavail × bsize, 전체 = blocks × bsize', async () => {
    const fake = () => Promise.resolve({ bavail: 25n, blocks: 100n, bsize: 4096n });
    await expect(readDiskSpace('/x', fake)).resolves.toEqual({
      freeBytes: 25 * 4096,
      totalBytes: 100 * 4096,
    });
  });

  it('읽지 못하면 두 값 모두 null', async () => {
    const fail = () => Promise.reject(new Error('ENOSYS'));
    await expect(readDiskSpace('/x', fail)).resolves.toEqual({
      freeBytes: null,
      totalBytes: null,
    });
  });

  it('실제 폴더(임시 폴더)는 0보다 큰 값', async () => {
    const disk = await readDiskSpace(tmpdir());
    expect(disk.totalBytes).toBeGreaterThan(0);
    expect(disk.freeBytes).toBeGreaterThanOrEqual(0);
    expect(disk.freeBytes!).toBeLessThanOrEqual(disk.totalBytes!);
  });
});

describe('StorageUsageService(D-25, GET /storage-usage)', () => {
  // 잰 결과 debug 로그는 테스트 출력에 필요 없다
  beforeAll(() => {
    Logger.overrideLogger(false);
  });
  afterAll(() => {
    Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose', 'fatal']);
  });

  let base: string;
  let home: string;
  let dataDir: string;
  let agyRoot: string;
  let clock: TestClock;

  const make = (overrides: Partial<StorageUsageOptions> = {}) =>
    new StorageUsageService({ appDataDir: dataDir } as AppConfigService, clock, {
      agyRoot,
      homeDir: home,
      timeBudgetMs: 5000,
      cacheTtlMs: 60_000,
      ...overrides,
    });

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'autostore-storage-'));
    home = join(base, 'home');
    dataDir = join(home, 'Library', 'autoStore');
    agyRoot = join(home, '.gemini', 'antigravity-cli');
    mkdirSync(join(agyRoot, 'brain', 'conv-1'), { recursive: true });
    mkdirSync(join(agyRoot, 'conversations'), { recursive: true });
    writeFileSync(join(agyRoot, 'brain', 'conv-1', 'thumbnail.jpg'), Buffer.alloc(1500));
    writeFileSync(join(agyRoot, 'conversations', 'conv-1.db'), Buffer.alloc(500));
    mkdirSync(join(dataDir, 'images', 'ab'), { recursive: true });
    writeFileSync(join(dataDir, 'images', 'ab', `${'ab'.repeat(32)}.jpg`), Buffer.alloc(300));
    clock = new TestClock(Date.parse('2026-10-03T05:20:00Z'));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('폴더 2개(AGY_RECORDS·APP_IMAGES 순서)의 크기·파일 수, 디스크, 잰 시각', async () => {
    const usage = await make().get();
    expect(usage.items).toEqual([
      {
        key: 'AGY_RECORDS',
        displayPath: AGY_RECORDS_DISPLAY_PATH,
        status: 'OK',
        bytes: 2000,
        fileCount: 2,
      },
      {
        key: 'APP_IMAGES',
        displayPath: '~/Library/autoStore/images',
        status: 'OK',
        bytes: 300,
        fileCount: 1,
      },
    ]);
    expect(usage.disk.totalBytes).toBeGreaterThan(0);
    expect(usage.measuredAt).toBe('2026-10-03T05:20:00.000Z');
  });

  it('응답에 절대 경로(임시 폴더·홈·실제 사용자 홈)가 없다', async () => {
    const text = JSON.stringify(await make().get());
    expect(text).not.toContain(base);
    expect(text).not.toContain(home);
    expect(text).not.toContain(homedir());
  });

  it('데이터 폴더가 홈 밖이면 앱 이미지 위치는 <데이터 폴더>/images', async () => {
    const usage = await make({ homeDir: join(base, 'other-home') }).get();
    expect(usage.items[1]).toMatchObject({
      key: 'APP_IMAGES',
      displayPath: APP_IMAGES_FALLBACK_DISPLAY_PATH,
    });
  });

  it('폴더가 없으면 NOT_FOUND(agy를 아직 안 씀·이미지 없음)', async () => {
    rmSync(agyRoot, { recursive: true });
    rmSync(join(dataDir, 'images'), { recursive: true });
    const usage = await make().get();
    expect(usage.items.map((i) => [i.key, i.status, i.bytes, i.fileCount])).toEqual([
      ['AGY_RECORDS', 'NOT_FOUND', null, null],
      ['APP_IMAGES', 'NOT_FOUND', null, null],
    ]);
  });

  it('시간 한도가 지나면 두 폴더 모두 PARTIAL(센 만큼)', async () => {
    let t = 0;
    const usage = await make({ timeBudgetMs: 0, monotonicNow: () => (t += 1) }).get();
    expect(usage.items.map((i) => i.status)).toEqual(['PARTIAL', 'PARTIAL']);
    expect(usage.items.map((i) => i.bytes)).toEqual([0, 0]);
  });

  it('1분 안에는 같은 값(캐시), 1분이 지나거나 refresh면 새로 잰다', async () => {
    const service = make();
    const first = await service.get();
    writeFileSync(join(agyRoot, 'conversations', 'conv-2.db'), Buffer.alloc(1000));

    clock.ms += 59_000;
    const cached = await service.get();
    expect(cached).toBe(first);
    expect(cached.items[0]!.bytes).toBe(2000);

    const refreshed = await service.get(true);
    expect(refreshed.items[0]!.bytes).toBe(3000);
    expect(refreshed.measuredAt).toBe(new Date(clock.ms).toISOString());

    writeFileSync(join(agyRoot, 'conversations', 'conv-3.db'), Buffer.alloc(1000));
    clock.ms += 60_000;
    const expired = await service.get();
    expect(expired.items[0]!.bytes).toBe(4000);
  });

  it('재는 중에 온 요청(refresh 포함)은 같은 결과를 같이 받는다', async () => {
    const service = make();
    const a = service.get();
    const b = service.get(true);
    expect(b).toBe(a);
    await a;
    const c = service.get();
    expect(await c).toBe(await a);
  });
});

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfigService } from '../../common/config/app-config.service.js';
import { ApiException } from '../../common/errors/api.exception.js';
import type { ProgressEventsService } from '../../common/events/progress-events.service.js';
import type { SettingsSnapshot } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { DEFAULT_SETTINGS } from './defaults/default-settings.js';
import type { AppSettings } from './schema/settings.types.js';
import {
  checkSettingsText,
  SettingsFileLoader,
  type SettingsLoadResult,
  writeSettingsFileAtomically,
} from './settings-file.loader.js';
import type { SettingsRerunPropagator } from './settings-rerun.port.js';
import { diffSettingsKeys, isAiSettingsKey, SettingsService } from './settings.service.js';

/** settings_snapshot 한 표만 흉내 내는 가짜 Prisma(Jest ESM이라 jest.mock 없이 손으로 만든다) */
class FakePrisma {
  rows: SettingsSnapshot[] = [];
  private nextId = 1;

  settingsSnapshot = {
    findFirst: () =>
      Promise.resolve(
        [...this.rows].sort(
          (a, b) => b.lastLoadedAt.getTime() - a.lastLoadedAt.getTime() || b.id - a.id,
        )[0] ?? null,
      ),
    findUnique: ({ where }: { where: { id?: number; contentSha256?: string } }) =>
      Promise.resolve(
        this.rows.find((r) =>
          where.id !== undefined ? r.id === where.id : r.contentSha256 === where.contentSha256,
        ) ?? null,
      ),
    update: ({ where, data }: { where: { id: number }; data: { lastLoadedAt: Date } }) => {
      const row = this.rows.find((r) => r.id === where.id)!;
      row.lastLoadedAt = data.lastLoadedAt;
      return Promise.resolve({ ...row });
    },
    create: ({ data }: { data: Omit<SettingsSnapshot, 'id'> }) => {
      const row: SettingsSnapshot = { ...data, id: this.nextId++ };
      this.rows.push(row);
      return Promise.resolve({ ...row });
    },
  };

  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

/** 파일 대신 글자를 돌려주는 가짜 로더 */
class FakeLoader {
  text = JSON.stringify(DEFAULT_SETTINGS);
  load(): Promise<SettingsLoadResult> {
    return Promise.resolve({
      ...checkSettingsText(this.text),
      createdFromTemplate: false,
      fileManifest: [{ name: 'settings.json', sha256: 'f'.repeat(64), sizeBytes: 1 }],
    });
  }
  set(change: (s: AppSettings) => void): void {
    this.text = edited(change);
  }
}

/** 기본 템플릿 사본을 고쳐 JSON 글자로 */
function edited(change: (s: AppSettings) => void): string {
  const copy = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  change(copy);
  return JSON.stringify(copy);
}

function setup(prisma = new FakePrisma()) {
  const loader = new FakeLoader();
  const published: { name: string; data: unknown }[] = [];
  const events = {
    publish: (name: string, data: unknown) => {
      published.push({ name, data });
      return { id: published.length, name, data, candidateId: null };
    },
  };
  const propagated: string[][] = [];
  const propagator: SettingsRerunPropagator = (keys) => {
    propagated.push([...keys]);
    return Promise.resolve(0);
  };
  const service = new SettingsService(
    prisma as unknown as PrismaService,
    loader as unknown as SettingsFileLoader,
    events as unknown as ProgressEventsService,
    propagator,
  );
  // 로그를 테스트 출력에서 숨긴다(ESM 모드라 jest.spyOn 대신 직접 바꾼다)
  const quiet = () => undefined;
  (service as unknown as { logger: object }).logger = { log: quiet, warn: quiet, error: quiet };
  return { prisma, loader, published, propagated, service };
}

const rejection = async (p: Promise<unknown>): Promise<ApiException> => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiException);
  return error as ApiException;
};

describe('diffSettingsKeys', () => {
  it('바뀐 값의 점 경로. 배열은 통째로 한 키, 한쪽에만 있는 키도 넣는다', () => {
    expect(
      diffSettingsKeys(
        { costs: { targetMarginPct: 10, a: 1 }, list: [1, 2], ai: { engine: 'CLAUDE' } },
        { costs: { targetMarginPct: 12, a: 1 }, list: [1, 2, 3], ai: { engine: 'CLAUDE' }, n: 1 },
      ),
    ).toEqual(['costs.targetMarginPct', 'list', 'n']);
    expect(diffSettingsKeys(DEFAULT_SETTINGS, structuredClone(DEFAULT_SETTINGS))).toEqual([]);
  });

  it('ai 섹션 키 판별', () => {
    expect(isAiSettingsKey('ai.engine')).toBe(true);
    expect(isAiSettingsKey('ai.models.CLAUDE.text')).toBe(true);
    expect(isAiSettingsKey('ai')).toBe(true);
    expect(isAiSettingsKey('aisle.x')).toBe(false);
    expect(isAiSettingsKey('costs.targetMarginPct')).toBe(false);
  });
});

describe('SettingsService(가짜 DB·로더)', () => {
  it('시작: 통과하면 스냅샷을 만들고 current()·currentSnapshotId()·status()를 준다', async () => {
    const { prisma, service } = setup();
    await service.initialize();
    expect(prisma.rows).toHaveLength(1);
    expect(service.currentSnapshotId()).toBe(1);
    expect(service.current().costs.targetMarginPct).toBe(10);
    expect(service.status()).toEqual({ valid: true, errors: [] });
    expect(Object.isFrozen(service.current().costs)).toBe(true);
    expect(prisma.rows[0]).toMatchObject({
      schemaVersion: '1',
      appVersion: expect.any(String) as string,
    });
  });

  it('목표 마진 10→12: changedKeys [costs.targetMarginPct], 전파 포트에 그 키를 넘긴다(기본 0)', async () => {
    const { loader, service, propagated, published } = setup();
    await service.initialize();
    loader.set((s) => (s.costs.targetMarginPct = 12));
    const { created, result } = await service.reload();
    expect(created).toBe(true);
    expect(result.changedKeys).toEqual(['costs.targetMarginPct']);
    expect(result.rerunRequiredStepCount).toBe(0);
    expect(propagated).toEqual([['costs.targetMarginPct']]);
    expect(published).toEqual([
      {
        name: 'settings.reloaded',
        data: {
          settingsSnapshotId: result.snapshot.id,
          changedKeys: ['costs.targetMarginPct'],
          valid: true,
          errors: [],
          rerunRequiredStepCount: 0,
        },
      },
    ]);
  });

  it('ai.engine만 바꾸면 changedKeys에는 들어가지만 전파 포트에는 넘기지 않는다', async () => {
    const { loader, service, propagated } = setup();
    await service.initialize();
    loader.set((s) => (s.ai.engine = 'CODEX'));
    const { result } = await service.reload();
    expect(result.changedKeys).toEqual(['ai.engine']);
    expect(propagated).toEqual([]);
    expect(service.current().ai.engine).toBe('CODEX');
  });

  it('ai와 다른 키가 같이 바뀌면 ai 키만 빼고 넘긴다', async () => {
    const { loader, service, propagated } = setup();
    await service.initialize();
    loader.set((s) => {
      s.ai.models.CLAUDE.text = 'opus';
      s.sourcing.minSizeCount = 4;
    });
    const { result } = await service.reload();
    expect(result.changedKeys).toEqual(['ai.models.CLAUDE.text', 'sourcing.minSizeCount']);
    expect(propagated).toEqual([['sourcing.minSizeCount']]);
  });

  it('포트가 돌려준 수를 rerunRequiredStepCount로 쓴다(P1-05가 바꿔 끼운다)', async () => {
    const { loader, service } = setup();
    await service.initialize();
    service.setRerunPropagator(() => Promise.resolve(3));
    loader.set((s) => (s.costs.miscCostKrw = 3500));
    const { result } = await service.reload();
    expect(result.rerunRequiredStepCount).toBe(3);
  });

  it('같은 내용 다시 읽기: 새 행 없이 last_loaded_at만, created=false', async () => {
    const { prisma, service } = setup();
    await service.initialize();
    const before = prisma.rows[0]!.lastLoadedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    const { created, result } = await service.reload();
    expect(created).toBe(false);
    expect(result.changedKeys).toEqual([]);
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]!.lastLoadedAt.getTime()).toBeGreaterThan(before);
  });

  it('다시 읽기 실패: 현재 스냅샷은 그대로, 422, status는 valid=false, SSE는 id null', async () => {
    const { loader, service, published, prisma } = setup();
    await service.initialize();
    loader.set((s) => (s.safety.judgementValidityHours = 7));
    const error = await rejection(service.reload());
    expect(error.code).toBe('SAFETY_SETTING_RELAXATION_REJECTED');
    expect(error.message).toBe('안전 기준은 느슨하게 바꿀 수 없습니다(판정 유효 시간 늘리기).');
    expect(error.details).toEqual({
      violations: [
        {
          item: 'JUDGEMENT_VALIDITY_EXTENDED',
          field: '/safety/judgementValidityHours',
          message: '판정 유효 시간은 6시간보다 길게 할 수 없습니다.',
        },
      ],
    });
    expect(prisma.rows).toHaveLength(1);
    expect(service.currentSnapshotId()).toBe(1);
    expect(service.current().safety.judgementValidityHours).toBe(6);
    expect(service.status().valid).toBe(false);
    expect(published.at(-1)).toEqual({
      name: 'settings.reloaded',
      data: {
        settingsSnapshotId: null,
        changedKeys: [],
        valid: false,
        errors: ['/safety/judgementValidityHours: 판정 유효 시간은 6시간보다 길게 할 수 없습니다.'],
        rerunRequiredStepCount: 0,
      },
    });

    loader.text = '{"costs": {"cardSurchargePct": "2.5"}, "x": 1}';
    const schema = await rejection(service.reload());
    expect(schema.code).toBe('SETTINGS_SCHEMA_INVALID');
    expect(schema.message).toMatch(/^설정 형식이 맞지 않습니다: \/\S+ 외 1곳\.$/);
    expect(schema.fieldErrors?.map((e) => e.field).sort()).toEqual([
      '/costs/cardSurchargePct',
      '/x',
    ]);
  });

  it('시작 실패 + 전에 통과한 스냅샷 있음 → 그 스냅샷을 쓰고 valid=false', async () => {
    const first = setup();
    await first.service.initialize();
    const { service, loader } = setup(first.prisma);
    loader.text = '{ broken';
    await service.initialize();
    expect(service.currentSnapshotId()).toBe(1);
    expect(service.status()).toEqual({
      valid: false,
      errors: [{ field: '/', message: expect.stringMatching(/^JSON 문법 오류/) as string }],
    });
  });

  it('시작 실패 + 통과한 스냅샷 없음 → current()·currentSnapshotId()는 503 SETTINGS_INVALID(fieldErrors)', async () => {
    const { service, loader } = setup();
    loader.set((s) => (s.safety.childShoeMaxSizeMm = 200));
    await service.initialize();
    const error = await rejection(Promise.resolve().then(() => service.currentSnapshotId()));
    expect(error.code).toBe('SETTINGS_INVALID');
    expect(error.getStatus()).toBe(503);
    expect(error.fieldErrors).toEqual([
      {
        field: '/safety/childShoeMaxSizeMm',
        message: '아동화 의심 기준은 235mm보다 낮출 수 없습니다.',
      },
    ]);
    expect(service.currentOrNull()).toBeNull();
    await expect(service.getView()).rejects.toBeInstanceOf(ApiException);
  });

  it('시작 중 DB 오류가 나도 던지지 않는다(앱은 뜬다)', async () => {
    const { service, prisma } = setup();
    prisma.settingsSnapshot.findFirst = () => Promise.reject(new Error('db down'));
    await expect(service.initialize()).resolves.toBeUndefined();
    expect(service.status().valid).toBe(false);
    expect(service.currentOrNull()).toBeNull();
  });

  it('로그에 설정 파일의 절대 경로를 넣지 않는다(규칙 3, 실제 로더·임시 폴더)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autostore-settings-log-'));
    try {
      const prisma = new FakePrisma();
      const loader = new SettingsFileLoader({ appDataDir: dir } as unknown as AppConfigService);
      const events = { publish: () => ({}) } as unknown as ProgressEventsService;
      const service = new SettingsService(prisma as unknown as PrismaService, loader, events, () =>
        Promise.resolve(0),
      );
      const logged: string[] = [];
      const capture = (...args: unknown[]) => {
        logged.push(JSON.stringify(args));
      };
      (service as unknown as { logger: object }).logger = {
        log: capture,
        warn: capture,
        error: capture,
      };

      await service.initialize(); // 파일 없음 → 템플릿 복사
      await writeSettingsFileAtomically(dir, '{ broken');
      await rejection(service.reload()); // 형식 오류
      await writeSettingsFileAtomically(
        dir,
        edited((s) => (s.safety.childShoeMaxSizeMm = 200)),
      );
      await rejection(service.reload()); // 안전 기준 완화
      await service.initialize(); // 시작 실패 + 전 스냅샷

      expect(logged.length).toBeGreaterThanOrEqual(4);
      for (const line of logged) {
        expect(line).not.toContain(dir);
        expect(line).not.toContain(realpathSync(dir));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('다시 읽기는 한 번에 하나씩 돈다(같은 해시 행이 두 번 생기지 않는다)', async () => {
    const { loader, service, prisma } = setup();
    await service.initialize();
    loader.set((s) => (s.costs.targetMarginPct = 15));
    const [a, b] = await Promise.all([service.reload(), service.reload()]);
    expect([a.created, b.created]).toEqual([true, false]);
    expect(prisma.rows).toHaveLength(2);
  });
});

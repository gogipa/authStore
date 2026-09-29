import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { APP_VERSION } from '../src/common/config/app-version.js';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../src/common/events/progress-events.service.js';
import {
  DEFAULT_SETTINGS,
  readDefaultSettingsText,
} from '../src/modules/settings/defaults/default-settings.js';
import type { AppSettings } from '../src/modules/settings/schema/settings.types.js';
import {
  settingsDirPath,
  settingsFilePath,
  writeSettingsFileAtomically,
} from '../src/modules/settings/settings-file.loader.js';
import { createTestApp, type TestApp, truncate } from './helpers/test-app.js';

/** setup-env.cjs가 이 파일에 준 임시 데이터 폴더(os.tmpdir()/autostore-e2e-*). 저장소 .data는 건드리지 않는다 */
const DATA_DIR = process.env.APP_DATA_DIR!;
const FIXTURES = join(import.meta.dirname, 'fixtures', 'settings');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/** 05-2 SettingsView의 required 전부(SettingsSnapshot 9개 + valid·errors) */
const SETTINGS_VIEW_KEYS = [
  'id',
  'contentSha256',
  'schemaVersion',
  'appVersion',
  'fileManifest',
  'content',
  'firstLoadedAt',
  'lastLoadedAt',
  'isCurrent',
  'valid',
  'errors',
].sort();

interface ReloadBody {
  snapshot: { id: number; isCurrent: boolean; content: AppSettings };
  created: boolean;
  changedKeys: string[];
  rerunRequiredStepCount: number;
}

interface ErrorBody {
  code: string;
  message: string;
  status: number;
  fieldErrors?: { field: string; message: string }[];
  details?: { violations?: { item: string; field: string }[] };
}

describe('설정 파일 로더·GET /settings·POST /settings-snapshots (e2e, autostore_test)', () => {
  let t: TestApp | null = null;
  let unsubscribe: () => void = () => undefined;
  const events: PublishedProgressEvent[] = [];
  /** 모든 응답 본문(마지막에 임시 폴더 경로가 없는지 본다) */
  const bodies: string[] = [];

  const start = async (options: { truncateFirst?: boolean } = {}): Promise<TestApp> => {
    const app = await createTestApp({
      beforeInit: options.truncateFirst
        ? (prisma) => truncate(prisma, ['settings_snapshot'])
        : undefined,
    });
    const sub = app.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
    t = app;
    return app;
  };
  const stop = async (): Promise<void> => {
    unsubscribe();
    await t?.app.close();
    t = null;
  };
  const http = () => request(t!.app.getHttpServer());
  const keep = <R extends { text: string }>(res: R): R => {
    bodies.push(res.text);
    return res;
  };
  const getSettings = async () => keep(await http().get('/api/v1/settings'));
  const reload = async (withClientHeader = true) => {
    const req = http().post('/api/v1/settings-snapshots');
    return keep(await (withClientHeader ? req.set('X-AutoStore-Client', '1') : req));
  };
  const rows = () => t!.prisma.settingsSnapshot.findMany({ orderBy: { id: 'asc' } });
  const writeSettings = (text: string) => writeSettingsFileAtomically(DATA_DIR, text);
  const writeEdited = (change: (s: AppSettings) => void) => {
    const copy = structuredClone(DEFAULT_SETTINGS) as AppSettings;
    change(copy);
    return writeSettings(`${JSON.stringify(copy, null, 2)}\n`);
  };
  const lastReloaded = () => events.filter((e) => e.name === 'settings.reloaded').at(-1);

  afterAll(async () => {
    await stop();
  });

  it('파일 없이 시작: 기본 템플릿이 생기고 GET 200 {valid:true, errors:[], isCurrent:true}, 스냅샷 1행', async () => {
    rmSync(settingsDirPath(DATA_DIR), { recursive: true, force: true });
    await start({ truncateFirst: true });

    expect(readFileSync(settingsFilePath(DATA_DIR), 'utf8')).toBe(readDefaultSettingsText());
    const res = await getSettings();
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(SETTINGS_VIEW_KEYS);
    expect(body).toMatchObject({
      valid: true,
      errors: [],
      isCurrent: true,
      schemaVersion: '1',
      appVersion: APP_VERSION,
      content: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as unknown,
      fileManifest: [
        {
          name: 'settings.json',
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
          sizeBytes: Buffer.byteLength(readDefaultSettingsText()),
        },
      ],
    });
    expect(body.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.firstLoadedAt.getTime()).toBe(all[0]!.lastLoadedAt.getTime());
  });

  it('같은 파일로 앱을 다시 만들면 행은 1개 그대로, last_loaded_at만 커진다', async () => {
    const [before] = await rows();
    await stop();
    await start();
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before!.id);
    expect(after[0]!.firstLoadedAt.getTime()).toBe(before!.firstLoadedAt.getTime());
    expect(after[0]!.lastLoadedAt.getTime()).toBeGreaterThan(before!.lastLoadedAt.getTime());
  });

  it('파일 수정 뒤 POST(헤더 있음): 201, Location, created:true, changedKeys에 바꾼 키 + SSE settings.reloaded', async () => {
    await writeEdited((s) => (s.costs.targetMarginPct = 12));
    const res = await reload();
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe('/api/v1/settings');
    const body = res.body as ReloadBody;
    expect(body).toMatchObject({
      created: true,
      changedKeys: ['costs.targetMarginPct'],
      rerunRequiredStepCount: 0,
      snapshot: { isCurrent: true },
    });
    expect(body.snapshot.content.costs.targetMarginPct).toBe(12);
    expect(await rows()).toHaveLength(2);

    expect(lastReloaded()?.data).toEqual({
      settingsSnapshotId: body.snapshot.id,
      changedKeys: body.changedKeys,
      valid: true,
      errors: [],
      rerunRequiredStepCount: 0,
    });
    expect(lastReloaded()?.candidateId).toBeNull();

    const view = await getSettings();
    expect(view.body).toMatchObject({ id: body.snapshot.id, valid: true, isCurrent: true });
  });

  it('같은 요청 다시: 200, created:false, 행 수 그대로', async () => {
    const res = await reload();
    expect(res.status).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toMatchObject({ created: false, changedKeys: [], rerunRequiredStepCount: 0 });
    expect(await rows()).toHaveLength(2);
  });

  it('헤더 없이 POST: 403 CLIENT_HEADER_REQUIRED', async () => {
    const res = await reload(false);
    expect(res.status).toBe(403);
    expect((res.body as ErrorBody).code).toBe('CLIENT_HEADER_REQUIRED');
    expect(await rows()).toHaveLength(2);
  });

  it('하루 조회 상한은 설정에서 읽는다: pageFetchDailyLimit 90 → GET /call-usage RAKUTEN_PAGE dailyLimit 90', async () => {
    await writeEdited((s) => {
      s.costs.targetMarginPct = 12;
      s.sourcing.pageFetchDailyLimit = 90;
    });
    const res = await reload();
    expect(res.status).toBe(201);
    expect((res.body as ReloadBody).changedKeys).toEqual(['sourcing.pageFetchDailyLimit']);
    const usage = keep(await http().get('/api/v1/call-usage').expect(200));
    const items = (usage.body as { items: { target: string; dailyLimit: number | null }[] }).items;
    expect(items.find((i) => i.target === 'RAKUTEN_PAGE')?.dailyLimit).toBe(90);
    expect(items.find((i) => i.target === 'DATALAB')?.dailyLimit).toBe(100);
  });

  it('ai 섹션만 바꿔 다시 읽기: 받아들인다(05-1 §7.5-51 Proposed), changedKeys ai.engine, 재실행 0', async () => {
    await writeEdited((s) => {
      s.costs.targetMarginPct = 12;
      s.sourcing.pageFetchDailyLimit = 90;
      s.ai.engine = 'CODEX';
    });
    const res = await reload();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ changedKeys: ['ai.engine'], rerunRequiredStepCount: 0 });
    const latest = keep(await http().get('/api/v1/ai-cli-checks/latest').expect(200));
    expect((latest.body as { selectedEngine: string }).selectedEngine).toBe('CODEX');
  });

  it('invalid-schema.json으로 POST: 422 SETTINGS_SCHEMA_INVALID(fieldErrors JSON 경로), 그 뒤 GET은 전 content + valid:false', async () => {
    const before = (await getSettings()).body as { id: number; content: AppSettings };
    const count = (await rows()).length;
    await writeSettings(fixture('invalid-schema.json'));

    const res = await reload();
    expect(res.status).toBe(422);
    const body = res.body as ErrorBody;
    expect(body.code).toBe('SETTINGS_SCHEMA_INVALID');
    expect(body.message).toMatch(/^설정 형식이 맞지 않습니다: \/\S+ 외 1곳\.$/);
    expect(body.fieldErrors?.map((e) => e.field).sort()).toEqual([
      '/commerceClientSecret',
      '/costs/cardSurchargePct',
    ]);
    expect(res.text).not.toContain('fixture-not-a-real-secret');
    expect(await rows()).toHaveLength(count);
    expect(lastReloaded()?.data).toMatchObject({
      settingsSnapshotId: null,
      valid: false,
      rerunRequiredStepCount: 0,
    });

    const view = await getSettings();
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ id: before.id, content: before.content, valid: false });
    expect((view.body as { errors: unknown[] }).errors).toHaveLength(2);
  });

  it.each([
    ['relax-child-word.json', ['CHILD_KEYWORD_REMOVED', 'NG_KEYWORD_CHILD_WORD_REMOVED']],
    ['relax-size-230.json', ['CHILD_SHOE_SIZE_LOWERED']],
    ['relax-validity-7h.json', ['JUDGEMENT_VALIDITY_EXTENDED']],
    ['notice-block-edited.json', ['NOTICE_REQUIRED_BLOCK_EDITED']],
  ])('%s로 POST: 422 SAFETY_SETTING_RELAXATION_REJECTED, 새 행 없음', async (file, items) => {
    const count = (await rows()).length;
    await writeSettings(fixture(file));
    const res = await reload();
    expect(res.status).toBe(422);
    const body = res.body as ErrorBody;
    expect(body.code).toBe('SAFETY_SETTING_RELAXATION_REJECTED');
    expect(body.message).toMatch(/^안전 기준은 느슨하게 바꿀 수 없습니다\(.+\)\.$/);
    expect(body.details?.violations?.map((v) => v.item)).toEqual(items);
    expect(await rows()).toHaveLength(count);
    expect((await getSettings()).body).toMatchObject({ valid: false });
  });

  it('통과한 스냅샷이 0개이고 파일이 잘못되면 GET 503 SETTINGS_INVALID(fieldErrors). 고치고 다시 읽으면 200', async () => {
    await stop();
    await writeSettings(fixture('broken.json'));
    await start({ truncateFirst: true });
    expect(await rows()).toHaveLength(0);

    const res = await getSettings();
    expect(res.status).toBe(503);
    const body = res.body as ErrorBody;
    expect(body.code).toBe('SETTINGS_INVALID');
    expect(body.message).toBe(
      '설정 파일에 오류가 있어 설정을 읽지 못했습니다. 설정 화면의 검사 결과를 확인해 주세요.',
    );
    expect(body.fieldErrors).toEqual([
      { field: '/', message: expect.stringMatching(/^JSON 문법 오류: 6번째 줄/) as string },
    ]);

    // 앱은 떠 있다: 다른 API는 그대로 답한다
    keep(await http().get('/api/v1/call-usage').expect(200));

    const again = await reload();
    expect(again.status).toBe(422);
    expect((await getSettings()).status).toBe(503);

    await writeSettings(fixture('valid.json'));
    const fixed = await reload();
    expect(fixed.status).toBe(201);
    expect(fixed.body).toMatchObject({ created: true, changedKeys: [] });
    expect((await getSettings()).body).toMatchObject({ valid: true, errors: [] });
  });

  it('응답 본문·SSE·file_manifest에 임시 데이터 폴더 경로가 없다', async () => {
    expect(bodies.length).toBeGreaterThan(10);
    const dirs = [DATA_DIR, realpathSync(DATA_DIR)];
    for (const text of [...bodies, ...events.map((e) => JSON.stringify(e.data))]) {
      for (const dir of dirs) expect(text).not.toContain(dir);
    }
    for (const row of await rows()) {
      const manifest = JSON.stringify(row.fileManifest);
      for (const dir of dirs) expect(manifest).not.toContain(dir);
      expect(manifest).not.toMatch(/"name":"\//);
    }
    expect(existsSync(join(DATA_DIR, 'settings'))).toBe(true);
  });
});

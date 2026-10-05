import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AbstractLoader, ExpressLoader, SERVE_STATIC_MODULE_OPTIONS } from '@nestjs/serve-static';
import request from 'supertest';
import { FE_STATIC_EXCLUDE, feStaticOptions } from '../src/common/config/fe-static.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

/**
 * 운영(`pnpm start`)의 화면 내보내기(SPA 대체, AppModule `ServeStaticModule` + `feStaticOptions`). /api 밖 경로는 빌드 안 파일이 아니면
 * index.html — 체험 `/demo/…`(D-31)를 새로 고치거나 바로 열어도 화면이 뜬다. /api 아래 없는 주소는 화면이 아니라 404 봉투다.
 * FE 빌드(apps/FE/dist)가 없어도 돌도록 임시 폴더에 표식이 든 index.html을 두고, AppModule의 ServeStatic 옵션만 운영 값
 * (`feStaticOptions(true, 임시 폴더)`)으로 바꾼다. 로컬 보안 미들웨어·404 봉투는 createTestApp(configureApp) 그대로다.
 * 로더(`AbstractLoader`)도 `ExpressLoader`로 정해 준다: ServeStaticModule은 모듈을 만들 때 HTTP 어댑터를 보고 로더를 고르는데,
 * 운영(`NestFactory.create`)은 그때 이미 Express 어댑터가 있어 `ExpressLoader`를 고르지만 테스트 모듈(`Test.createTestingModule`)은
 * 어댑터를 `createNestApplication`에서야 붙여 아무것도 하지 않는 `NoopLoader`가 된다.
 */
const MARKER = 'autostore-spa-fallback-marker';
const ASSET_BODY = 'console.log("autostore-asset");';
const ENVELOPE_KEYS = ['code', 'message', 'status', 'timestamp', 'path'];

function makeDist(withIndex: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'autostore-fe-dist-'));
  if (withIndex) {
    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html><html><head><title>${MARKER}</title></head><body><div id="root"></div></body></html>`,
    );
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app.js'), ASSET_BODY);
  }
  return dir;
}

const dists: string[] = [];

afterAll(() => {
  for (const dir of dists.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('feStaticOptions — 운영이고 FE 빌드가 있을 때만 화면을 내보낸다', () => {
  it('운영 + index.html 있음 → 빌드 폴더를 내보내고 /api 아래는 뺀다', () => {
    const dir = makeDist(true);
    dists.push(dir);
    expect(feStaticOptions(true, dir)).toEqual([{ rootPath: dir, exclude: ['/api/{*path}'] }]);
    expect(FE_STATIC_EXCLUDE).toEqual(['/api/{*path}']);
  });

  it('운영이 아니면(개발·테스트) 빌드가 있어도 끈다', () => {
    const dir = makeDist(true);
    dists.push(dir);
    expect(feStaticOptions(false, dir)).toEqual([]);
  });

  it('운영이어도 index.html이 없으면 끈다', () => {
    const dir = makeDist(false);
    dists.push(dir);
    expect(feStaticOptions(true, dir)).toEqual([]);
  });
});

describe('운영 화면 내보내기(e2e) — /api 밖은 index.html(SPA 대체), 체험 /demo/… 포함', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());
  const host = () => `127.0.0.1:${t.port}`;

  beforeAll(async () => {
    const dir = makeDist(true);
    dists.push(dir);
    t = await createTestApp({
      overrides: [
        { provide: SERVE_STATIC_MODULE_OPTIONS, useValue: feStaticOptions(true, dir) },
        { provide: AbstractLoader, useValue: new ExpressLoader() },
      ],
    });
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it.each([
    '/',
    '/settings/ai-engine',
    '/demo',
    '/demo/',
    '/demo/candidates/1/approval',
    '/demo/settings/ai-engine',
    '/demo/candidates/1/steps/content?tab=notice',
  ])('GET %s → 200 index.html', async (path) => {
    const res = await http().get(path).set('Host', host()).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain(MARKER);
  });

  it('빌드 안 파일은 그 파일 그대로 준다(index.html로 바꾸지 않는다)', async () => {
    const res = await http().get('/assets/app.js').set('Host', host()).expect(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toBe(ASSET_BODY);
  });

  it.each(['/api/v1/no-such-route', '/api/v1/demo/candidates', '/api/v1/app-info'])(
    'GET %s → 404 ROUTE_NOT_FOUND JSON 봉투(화면이 아니다)',
    async (path) => {
      const res = await http().get(path).set('Host', host()).expect(404);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.text).not.toContain(MARKER);
      const body = res.body as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(expect.arrayContaining(ENVELOPE_KEYS));
      expect(body.code).toBe('ROUTE_NOT_FOUND');
      expect(body.path).toBe(path);
    },
  );

  it('/api 아래 있는 API는 그대로 JSON으로 답한다', async () => {
    const res = await http().get('/api/v1/storage-usage').set('Host', host()).expect(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.text).not.toContain(MARKER);
  });

  it('로컬 보안은 화면 경로에도 먼저 돈다 — Host가 attacker.example이면 /demo도 403 HOST_NOT_ALLOWED', async () => {
    const res = await http().get('/demo/candidates/1/approval').set('Host', 'attacker.example');
    expect(res.status).toBe(403);
    expect(res.text).not.toContain(MARKER);
    expect((res.body as { code: string }).code).toBe('HOST_NOT_ALLOWED');
  });
});

describe('운영이 아닌 앱(e2e, NODE_ENV=test) — AppModule이 화면을 내보내지 않는다', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('GET /demo → 404 ROUTE_NOT_FOUND JSON 봉투', async () => {
    const res = await request(t.app.getHttpServer())
      .get('/demo')
      .set('Host', `127.0.0.1:${t.port}`)
      .expect(404);
    expect((res.body as { code: string }).code).toBe('ROUTE_NOT_FOUND');
  });
});

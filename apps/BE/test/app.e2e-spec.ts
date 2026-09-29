import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const ENVELOPE_KEYS = ['code', 'message', 'status', 'timestamp', 'path'];
const CHECK_KEYS = [
  'id',
  'engineCode',
  'trigger',
  'installed',
  'binPath',
  'cliVersion',
  'versionSupported',
  'authStatus',
  'smokeStatus',
  'model',
  'latencyMs',
  'errorCode',
  'errorMessage',
  'checkedAt',
];

describe('apps/BE e2e (autostore_test)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let origin: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    await configureApp(app);
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    // 삭제 금지·추가만 트리거가 있어 deleteMany 대신 TRUNCATE(04-3 주석)
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE ai_cli_check, settings_snapshot RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const expectEnvelope = (body: Record<string, unknown>, code: string, status: number) => {
    expect(Object.keys(body)).toEqual(expect.arrayContaining(ENVELOPE_KEYS));
    expect(body.code).toBe(code);
    expect(body.status).toBe(status);
    expect(typeof body.message).toBe('string');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  };

  describe('GET /api/v1/ai-cli-checks/latest', () => {
    it('점검 기록이 없으면 엔진 3개 모두 latest=null, 선택 엔진은 기본 CLAUDE', async () => {
      const res = await http().get('/api/v1/ai-cli-checks/latest').expect(200);
      expect(res.body).toEqual({
        selectedEngine: 'CLAUDE',
        items: [
          { engineCode: 'CLAUDE', selected: true, latest: null },
          { engineCode: 'AGY', selected: false, latest: null },
          { engineCode: 'CODEX', selected: false, latest: null },
        ],
      });
    });

    it('엔진마다 가장 최근 1건을 주고, 설정 스냅샷의 ai.engine을 선택 엔진으로 표시한다', async () => {
      await prisma.aiCliCheck.createMany({
        data: [
          {
            engineCode: 'CLAUDE',
            trigger: 'MANUAL',
            installed: true,
            binPath: '/usr/local/bin/claude',
            cliVersion: '2.1.0',
            versionSupported: true,
            authStatus: 'OK',
            smokeStatus: 'FAILED',
            model: 'sonnet',
            latencyMs: 5000,
            errorCode: 'TIMEOUT',
            errorMessage: '연결 테스트 시간이 지났습니다.',
            checkedAt: new Date('2026-09-27T01:00:00Z'),
          },
          {
            engineCode: 'CLAUDE',
            trigger: 'MANUAL',
            installed: true,
            binPath: '/usr/local/bin/claude',
            cliVersion: '2.1.0',
            versionSupported: true,
            authStatus: 'OK',
            smokeStatus: 'PASSED',
            model: 'sonnet',
            latencyMs: 4200,
            checkedAt: new Date('2026-09-27T02:00:00Z'),
          },
          {
            engineCode: 'CODEX',
            trigger: 'STARTUP',
            installed: false,
            authStatus: 'UNKNOWN',
            smokeStatus: 'SKIPPED',
            checkedAt: new Date('2026-09-27T03:00:00Z'),
          },
        ],
      });
      await prisma.settingsSnapshot.create({
        data: {
          contentSha256: 'a'.repeat(64),
          schemaVersion: '1',
          appVersion: '0.1.0',
          fileManifest: {},
          content: { ai: { engine: 'CODEX' } },
        },
      });

      const res = await http().get('/api/v1/ai-cli-checks/latest').expect(200);
      const body = res.body as {
        selectedEngine: string;
        items: { engineCode: string; selected: boolean; latest: Record<string, unknown> | null }[];
      };
      expect(body.selectedEngine).toBe('CODEX');
      expect(body.items.map((i) => [i.engineCode, i.selected])).toEqual([
        ['CLAUDE', false],
        ['AGY', false],
        ['CODEX', true],
      ]);
      const [claude, agy, codex] = body.items;
      expect(Object.keys(claude!.latest!).sort()).toEqual([...CHECK_KEYS].sort());
      expect(claude!.latest).toMatchObject({
        smokeStatus: 'PASSED',
        latencyMs: 4200,
        errorCode: null,
        checkedAt: '2026-09-27T02:00:00.000Z',
      });
      expect(agy!.latest).toBeNull();
      expect(codex!.latest).toMatchObject({
        installed: false,
        binPath: null,
        smokeStatus: 'SKIPPED',
      });
    });
  });

  describe('로컬 보안(05-1 §1.2)', () => {
    it('Host가 허용값이 아니면 403 HOST_NOT_ALLOWED', async () => {
      const res = await http()
        .get('/api/v1/ai-cli-checks/latest')
        .set('Host', 'evil.example:3100')
        .expect(403);
      expectEnvelope(res.body as Record<string, unknown>, 'HOST_NOT_ALLOWED', 403);
      expect((res.body as { path: string }).path).toBe('/api/v1/ai-cli-checks/latest');
    });

    it('Host 포트가 다르면 403 HOST_NOT_ALLOWED(DNS 리바인딩 방지)', async () => {
      const res = await http()
        .get('/api/v1/ai-cli-checks/latest')
        .set('Host', 'localhost:1')
        .expect(403);
      expectEnvelope(res.body as Record<string, unknown>, 'HOST_NOT_ALLOWED', 403);
    });

    it('상태 변경 요청의 Origin이 앱 자신이 아니면 403 ORIGIN_NOT_ALLOWED', async () => {
      const res = await http()
        .post('/api/v1/ai-cli-checks')
        .set('Origin', 'http://evil.example')
        .set('X-AutoStore-Client', '1')
        .send({})
        .expect(403);
      expectEnvelope(res.body as Record<string, unknown>, 'ORIGIN_NOT_ALLOWED', 403);
    });

    it('테스트 환경에서는 FE 개발 서버 Origin도 받지 않는다(개발에서만 허용)', async () => {
      const res = await http()
        .post('/api/v1/ai-cli-checks')
        .set('Origin', 'http://127.0.0.1:5173')
        .set('X-AutoStore-Client', '1')
        .expect(403);
      expectEnvelope(res.body as Record<string, unknown>, 'ORIGIN_NOT_ALLOWED', 403);
    });

    it('POST에 X-AutoStore-Client: 1이 없으면 403 CLIENT_HEADER_REQUIRED', async () => {
      const res = await http().post('/api/v1/ai-cli-checks').send({}).expect(403);
      expectEnvelope(res.body as Record<string, unknown>, 'CLIENT_HEADER_REQUIRED', 403);
    });

    it('앱 자신의 Origin과 헤더가 있으면 보안 검사를 지나 라우팅된다(없는 경로면 404)', async () => {
      const res = await http()
        .delete('/api/v1/not-a-route')
        .set('Origin', origin)
        .set('X-AutoStore-Client', '1')
        .expect(404);
      expectEnvelope(res.body as Record<string, unknown>, 'ROUTE_NOT_FOUND', 404);
    });

    it('CORS를 열지 않는다(Access-Control-Allow-Origin 없음)', async () => {
      const res = await http()
        .get('/api/v1/ai-cli-checks/latest')
        .set('Origin', 'http://evil.example')
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('오류 봉투(05-3 §2)', () => {
    it('없는 경로는 404 봉투', async () => {
      const res = await http().get('/api/v1/no-such-path').expect(404);
      expectEnvelope(res.body as Record<string, unknown>, 'ROUTE_NOT_FOUND', 404);
      expect((res.body as { path: string }).path).toBe('/api/v1/no-such-path');
    });

    it('/api/v1 밖의 없는 경로도 같은 404 봉투(HTML 아님)', async () => {
      const res = await http().get('/api/v2/anything').expect(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expectEnvelope(res.body as Record<string, unknown>, 'ROUTE_NOT_FOUND', 404);
    });

    it('읽을 수 없는 JSON 본문은 400 MALFORMED_REQUEST', async () => {
      const res = await http()
        .post('/api/v1/ai-cli-checks')
        .set('X-AutoStore-Client', '1')
        .set('Content-Type', 'application/json')
        .send('{broken')
        .expect(400);
      expectEnvelope(res.body as Record<string, unknown>, 'MALFORMED_REQUEST', 400);
    });
  });
});

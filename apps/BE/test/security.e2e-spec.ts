import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import type { Subscription } from 'rxjs';
import request from 'supertest';
import YAML from 'yaml';
import { ProgressEventsService } from '../src/common/events/progress-events.service.js';
import { LOG_DESTINATION } from '../src/common/logging/logging.module.js';
import { SECRET_KEYS } from '../src/common/secrets/secret-keys.js';
import { clearKnownSecrets } from '../src/common/secrets/secret-mask.js';
import { SECRET_STORE } from '../src/common/secrets/secret-store.port.js';
import { HTTP_FETCH } from '../src/modules/integrations/http/http-fetch.token.js';
import { FxCollectorService } from '../src/modules/pricing/fx/fx-collector.service.js';
import { RegistrationSubmitter } from '../src/modules/registration/submit/registration-submitter.js';
import { writeSettingsFileAtomically } from '../src/modules/settings/settings-file.loader.js';
import { StepExecutor } from '../src/modules/step-engine/execution/step-executor.js';
import { seedApprovableCandidate } from './fixtures/registration/approval/seed-approvable-candidate.js';
import { useFakeContentAi } from './fixtures/content/seed-content.js';
import { FlowFakes } from './flow/flow-fakes.js';
import { FLOW_SECRETS, flowSettingsText, truncateAll } from './flow/flow-seed.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';
import { seedUsableAiEngine } from './support/fake-ai-engines.js';
import { FAKE_ACCESS_TOKEN } from './support/fake-commerce-transport.js';
import { InMemorySecretStore } from './support/in-memory-secret-store.js';

/**
 * 로컬 보안·비밀정보·안전장치 점검(P5-01 §5·§6 'BE e2e 보안', autostore_test). 05-1 §1.2, C4 §5, NFR-02, US-27 AC1, US-36 AC4·AC5,
 * PRD §8.7, F-BS-04·05·06·07, ERD `registration_switch`.
 * - Host·Origin·X-AutoStore-Client·CORS(SSE·정적 경로 포함)
 * - 비밀 fixture 값(`TEST-SECRET-…`)을 가짜 키체인에 넣고 키를 쓰는 길(토큰 발급·라쿠텐 검색·환율 수집·restricted-tags·SELLER_CODE·
 *   상품 등록·AI 카피)을 모두 지난 뒤, 05-2 M1 GET 응답 전부·SSE 이벤트·로그(trace)·DB 문자열 칸 전부·AI 프롬프트에 0회
 * - 커머스API 토큰 요청 폼에 account_id 없음
 * - 안전장치를 끄는 설정 칸 없음, 안전 기준 완화 설정은 시작·다시 읽기 때 거부, 새 DB 차단 스위치 켬
 * 밖으로 나가는 요청은 가짜 fetch(흐름 테스트와 같은 가짜 라우터 + 환율 fixture)만 받는다. 실제 외부 서비스는 부르지 않는다.
 */
const CLIENT = { 'X-AutoStore-Client': '1' };
const SPEC_FILE = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'docs',
  'dev',
  '05_API',
  '05-2_openapi.yaml',
);
const FX_DIR = join(import.meta.dirname, 'fixtures', 'fx');
const SETTINGS_DIR = join(import.meta.dirname, 'fixtures', 'settings');
const DATA_DIR = process.env.APP_DATA_DIR!;

/** 05-2 M1 GET 경로(SSE 빼고). 응답 본문을 모두 모아 비밀값을 찾는다 */
function m1GetPaths(): string[] {
  const spec = YAML.parse(readFileSync(SPEC_FILE, 'utf8')) as {
    paths: Record<string, { get?: { 'x-milestone'?: string } }>;
  };
  return Object.entries(spec.paths)
    .filter(([path, item]) => item.get?.['x-milestone'] === 'M1' && path !== '/events')
    .map(([path]) => path);
}

describe('로컬 보안·비밀정보·안전장치(P5-01 e2e)', () => {
  let t: TestApp;
  const store = new InMemorySecretStore();
  const fakes = new FlowFakes();
  const logLines: string[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      logLines.push(chunk.toString('utf8'));
      cb();
    },
  });
  const events: unknown[] = [];
  let subscription: Subscription;
  let origin: string;

  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    await writeSettingsFileAtomically(DATA_DIR, flowSettingsText());
    t = await createTestApp({
      overrides: [
        { provide: SECRET_STORE, useValue: store },
        { provide: LOG_DESTINATION, useValue: { stream: logStream, level: 'trace' } },
      ],
      beforeInit: (prisma) => truncateAll(prisma),
    });
    origin = `http://127.0.0.1:${t.port}`;
    subscription = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    // 커머스·라쿠텐·상품 이미지 = 흐름 테스트 가짜 라우터, 환율 두 곳 = fixture
    t.fetch.handler = (url, init) => {
      const host = new URL(url).hostname;
      if (host === 'oapi.koreaexim.go.kr') {
        return new Response(readFileSync(join(FX_DIR, 'kexim-jpy100.json'), 'utf8'), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (host === 'apis.data.go.kr') {
        return new Response(readFileSync(join(FX_DIR, 'customs-week.xml'), 'utf8'), {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        });
      }
      return fakes.fetch(url, init);
    };
  });

  afterAll(async () => {
    subscription?.unsubscribe();
    await t.app.get(RegistrationSubmitter).whenIdle();
    await t.app.get(StepExecutor).whenIdle();
    await truncateAll(t.prisma);
    await t.app.close();
    clearKnownSecrets();
  });

  describe('Host·Origin·헤더·CORS(05-1 §1.2, C4 §5)', () => {
    it.each([
      ['API', '/api/v1/candidates'],
      ['SSE', '/api/v1/events'],
      ['정적 화면 경로', '/settings/ai-engine'],
      ['이미지 파일', '/api/v1/image-assets/1/file'],
    ])('%s: Host가 attacker.example이면 403 HOST_NOT_ALLOWED', async (_name, path) => {
      const res = await http().get(path).set('Host', 'attacker.example');
      expect(res.status).toBe(403);
      expect((res.body as { code: string }).code).toBe('HOST_NOT_ALLOWED');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('localhost:포트 Host는 받는다(같은 PC)', async () => {
      await http()
        .get('/api/v1/registration-switch')
        .set('Host', `localhost:${t.port}`)
        .expect(200);
    });

    it.each(['http://evil.example', 'http://127.0.0.1:5173', 'null'])(
      '상태 변경 요청의 Origin이 %s면 403 ORIGIN_NOT_ALLOWED(헤더가 있어도)',
      async (badOrigin) => {
        const res = await http()
          .put('/api/v1/registration-switch')
          .set(CLIENT)
          .set('Origin', badOrigin)
          .send({ apiBlocked: false });
        expect(res.status).toBe(403);
        expect((res.body as { code: string }).code).toBe('ORIGIN_NOT_ALLOWED');
        expect(await t.prisma.registrationSwitch.count({ where: { apiBlocked: false } })).toBe(0);
      },
    );

    it.each([
      ['PUT', '/api/v1/registration-switch'],
      ['POST', '/api/v1/candidates/1/registrations'],
      ['PUT', '/api/v1/secrets/COMMERCE_CLIENT_ID'],
      ['POST', '/api/v1/candidates'],
      ['DELETE', '/api/v1/tag-competitor-inputs/1'],
    ] as const)(
      '%s %s: X-AutoStore-Client가 없으면 403 CLIENT_HEADER_REQUIRED',
      async (method, path) => {
        const call = http()[method.toLowerCase() as 'put' | 'post' | 'delete'](path);
        const res = await call.set('Origin', origin).send({});
        expect(res.status).toBe(403);
        expect((res.body as { code: string }).code).toBe('CLIENT_HEADER_REQUIRED');
      },
    );

    it('CORS 미리 묻기(OPTIONS)·조회·변경 어느 응답에도 Access-Control-* 헤더가 없다', async () => {
      const responses = [
        await http()
          .options('/api/v1/registration-switch')
          .set('Origin', 'http://evil.example')
          .set('Access-Control-Request-Method', 'PUT'),
        await http().get('/api/v1/candidates').set('Origin', 'http://evil.example'),
        await http().get('/api/v1/registration-switch'),
        await http()
          .put('/api/v1/registration-switch')
          .set(CLIENT)
          .set('Origin', origin)
          .send({ apiBlocked: true }),
      ];
      for (const res of responses) {
        const cors = Object.keys(res.headers).filter((h) => h.startsWith('access-control-'));
        expect(cors).toEqual([]);
      }
    });
  });

  describe('비밀정보는 키체인에만(NFR-02, US-27 AC1, PRD §8.7)', () => {
    it('키를 쓰는 길을 모두 지난 뒤 M1 GET 응답·SSE·로그·DB 문자열 칸·AI 프롬프트에 비밀값이 0회', async () => {
      logLines.length = 0;
      events.length = 0;
      // 1) 키 입력(PUT /secrets — 값은 키체인 가짜에만)
      for (const key of SECRET_KEYS) {
        await http()
          .put(`/api/v1/secrets/${key}`)
          .set(CLIENT)
          .set('Origin', origin)
          .send({ value: FLOW_SECRETS[key] })
          .expect(204);
      }
      await seedUsableAiEngine(t.prisma);
      useFakeContentAi(t.ai);
      // 2) 커머스API 토큰 발급(서명 = client_secret)
      await http().post('/api/v1/auth-checks').set(CLIENT).set('Origin', origin).expect(200);
      // 3) 환율 수집(수출입은행 authkey·관세청 serviceKey는 쿼리에) — KST 월요일 11시
      t.clock.ms = Date.parse('2026-09-28T11:00:00+09:00');
      await t.app.get(FxCollectorService).runOnce();
      // 4) 라쿠텐 검색(applicationId·accessKey는 쿼리에) — 검색어 후보 + ② 실행
      const created = await http()
        .post('/api/v1/candidates')
        .set(CLIENT)
        .set('Origin', origin)
        .send({ creationPath: 'SEARCH_QUERY', rakutenQuery: 'アシックス ゲルカヤノ14 1201A019' })
        .expect(201);
      const searchCandidateId = (created.body as { id: number }).id;
      await http()
        .post(`/api/v1/candidates/${searchCandidateId}/steps/SOURCING/runs`)
        .set(CLIENT)
        .set('Origin', origin)
        .send({})
        .expect(202);
      await t.app.get(StepExecutor).whenIdle();
      // 5) ⑥-1 카피(AI 프롬프트) — 승인할 후보와 다른 후보에서 다시 실행
      const copySeed = await seedApprovableCandidate(t, { itemCode: 'shop-z:90001' });
      await http()
        .post(`/api/v1/candidates/${copySeed.candidate.id}/steps/COPY/runs`)
        .set(CLIENT)
        .set('Origin', origin)
        .send({})
        .expect(202);
      await t.app.get(StepExecutor).whenIdle();
      // 6) 사전 검증(restricted-tags·SELLER_CODE) → 차단 끔 → 승인 → 상품 등록(토큰은 Authorization에만)
      //    (판정에 쓴 페이지 수집 = 테스트 시계 시작 − 1시간 → 지금(11시) 기준 3시간 전, 6시간 안)
      const seed = await seedApprovableCandidate(t);
      await http()
        .post(`/api/v1/candidates/${seed.candidate.id}/pre-validations`)
        .set(CLIENT)
        .set('Origin', origin)
        .send({})
        .expect(200);
      expect(t.app.get(HTTP_FETCH)).toBe(t.fetch.fn); // 차단 스위치를 끄기 전에: 밖으로 가는 길은 가짜 fetch뿐
      await http()
        .put('/api/v1/registration-switch')
        .set(CLIENT)
        .set('Origin', origin)
        .send({ apiBlocked: false })
        .expect(200);
      const approved = await http()
        .post(`/api/v1/candidates/${seed.candidate.id}/registrations`)
        .set(CLIENT)
        .set('Origin', origin)
        .set('Idempotency-Key', randomUUID())
        .send({
          optionType: 'COMBINATION',
          expectedUploadResultId: seed.uploadResultId,
          expectedPriceJudgementId: seed.priceJudgementId,
        });
      expect(approved.status).toBe(202);
      await t.app.get(RegistrationSubmitter).whenIdle();
      const registrationId = (approved.body as { registrationId: number }).registrationId;
      expect(
        (await t.prisma.registration.findUniqueOrThrow({ where: { id: registrationId } })).status,
      ).toBe('REGISTERED');
      await http()
        .put('/api/v1/registration-switch')
        .set(CLIENT)
        .set('Origin', origin)
        .send({ apiBlocked: true })
        .expect(200);

      // 키를 쓰는 길을 실제로 지났다(가짜 서버가 받았다)
      const state = fakes.state();
      expect(state.commerce.tokenRequests).toBeGreaterThanOrEqual(1);
      expect(state.commerce.productCreates).toBe(1);
      expect(state.commerce.restrictedBatches).toBeGreaterThanOrEqual(1);
      expect(state.rakuten.search).toBeGreaterThanOrEqual(1);
      expect(fakes.violations).toEqual([]);
      expect(await t.prisma.fxRate.count({ where: { source: 'KEXIM' } })).toBeGreaterThanOrEqual(1);
      // 커머스API 토큰 요청 폼: 5칸, account_id 없음(PRD §8.7 — SELF 토큰)
      for (const keys of state.commerce.tokenFormKeys) {
        expect(keys).toEqual([
          'client_id',
          'client_secret_sign',
          'grant_type',
          'timestamp',
          'type',
        ]);
        expect(keys).not.toContain('account_id');
      }
      const sign = new URLSearchParams(fakes.commerce.tokenRequests[0]!.body!).get(
        'client_secret_sign',
      )!;

      // 7) 05-2 M1 GET 응답 전부(경로 변수 = 위에서 만든 행)
      const ids: Record<string, string> = {
        candidateId: String(seed.candidate.id),
        stepCode: 'COPY',
        stepRunId: String(seed.stepRunIds.COPY),
        stepChainId: '1',
        imageAssetId: String(seed.uploadImageAssetIds[0]),
        keywordSnapshotId: '1',
        rakutenItemId: String(seed.rakutenItemId),
        generationRunId: '1',
        registrationId: String(registrationId),
        rateTableId: '1',
      };
      const bodies: string[] = [];
      for (const template of m1GetPaths()) {
        const path = template.replace(/\{([^}]+)\}/g, (_m, name: string) => ids[name] ?? '1');
        const query = template === '/commerce-categories' ? '?gender=MALE' : '';
        const res = await http().get(`/api/v1${path}${query}`).buffer(true);
        expect(res.status).toBeLessThan(500);
        bodies.push(`${template} ${res.status} ${res.text ?? ''}`);
      }
      expect(bodies.length).toBeGreaterThanOrEqual(55);

      // 8) DB 문자열·JSON 칸 전부
      const columns = await t.prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
            AND data_type IN ('text', 'character varying', 'json', 'jsonb', 'ARRAY')`,
      );
      expect(columns.length).toBeGreaterThan(100);
      const secrets = [...Object.values(FLOW_SECRETS), FAKE_ACCESS_TOKEN, sign];
      const patterns = secrets.map((s) => `%${s}%`);
      const dbHits: string[] = [];
      for (const { table_name: table, column_name: column } of columns) {
        const rows = await t.prisma.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM "${table}" WHERE "${column}"::text LIKE ANY($1::text[])`,
          patterns,
        );
        if (rows[0]!.n > 0) dbHits.push(`${table}.${column}`);
      }
      expect(dbHits).toEqual([]);

      // 9) 응답·SSE·로그·AI 프롬프트
      const logs = logLines.join('');
      expect(logs).toContain('/api/v1/secrets'); // 로그가 실제로 모였다
      const haystacks: [string, string][] = [
        ['GET 응답', bodies.join('\n')],
        ['SSE 이벤트', JSON.stringify(events)],
        ['로그', logs],
      ];
      for (const [where, text] of haystacks) {
        for (const secret of secrets)
          expect({ where, found: text.includes(secret) }).toEqual({ where, found: false });
      }
      const aiCalls = [t.ai.claude, t.ai.agy, t.ai.codex].flatMap((a) => a.calls.runStructured);
      expect(aiCalls.map((c) => c.task)).toContain('CT-01');
      for (const call of aiCalls) {
        for (const secret of secrets) expect(call.promptIncludes(secret)).toBe(false);
      }
    });
  });

  describe('안전장치(US-36 AC4, F-BS-04·05, ERD registration_switch)', () => {
    const reload = () =>
      http().post('/api/v1/settings-snapshots').set(CLIENT).set('Origin', origin).send();

    afterEach(async () => {
      await writeSettingsFileAtomically(DATA_DIR, flowSettingsText());
      await reload();
    });

    it('새 DB: GET /registration-switch → apiBlocked true(차단 스위치 기본 켬)', async () => {
      await t.prisma.$executeRawUnsafe('TRUNCATE TABLE registration_switch RESTART IDENTITY');
      const res = await http().get('/api/v1/registration-switch').expect(200);
      expect((res.body as { apiBlocked: boolean }).apiBlocked).toBe(true);
    });

    it.each([
      ['G4 최종 승인 끄기', ['registration', 'skipFinalApproval'], true],
      ['아동화 차단 끄기', ['safety', 'childShoeBlockEnabled'], false],
      ['실존 인물 차단 끄기', ['safety', 'personGuardEnabled'], false],
      ['중복 방지 끄기', ['registration', 'allowDuplicateRegistration'], true],
      ['원본 업로드 허용', ['thumbnail', 'allowOriginalUpload'], true],
    ])(
      '설정 파일에 %s 칸이 없다 — 넣으면 다시 읽기 422 SETTINGS_SCHEMA_INVALID',
      async (_n, path, value) => {
        const settings = JSON.parse(flowSettingsText()) as Record<string, Record<string, unknown>>;
        settings[path[0]!]![path[1]!] = value;
        await writeSettingsFileAtomically(DATA_DIR, `${JSON.stringify(settings, null, 2)}\n`);
        const res = await reload();
        expect(res.status).toBe(422);
        expect((res.body as { code: string }).code).toBe('SETTINGS_SCHEMA_INVALID');
      },
    );

    it.each([
      ['relax-validity-7h.json', 'JUDGEMENT_VALIDITY_EXTENDED'],
      ['relax-child-word.json', 'CHILD_KEYWORD_REMOVED'],
    ])(
      '기준을 완화한 설정(%s)은 다시 읽기에서 422 SAFETY_SETTING_RELAXATION_REJECTED',
      async (file, item) => {
        await writeSettingsFileAtomically(DATA_DIR, readFileSync(join(SETTINGS_DIR, file), 'utf8'));
        const res = await reload();
        expect(res.status).toBe(422);
        const body = res.body as { code: string; details: { violations: { item: string }[] } };
        expect(body.code).toBe('SAFETY_SETTING_RELAXATION_REJECTED');
        expect(body.details.violations.map((v) => v.item)).toContain(item);
      },
    );
  });
});

describe('완화한 설정으로 앱을 켜면 그 설정을 쓰지 않는다(P5-01 e2e)', () => {
  it('판정 유효 7시간 파일로 시작: 스냅샷을 만들지 않고 GET /settings 503 SETTINGS_INVALID', async () => {
    await writeSettingsFileAtomically(
      DATA_DIR,
      readFileSync(join(SETTINGS_DIR, 'relax-validity-7h.json'), 'utf8'),
    );
    const t = await createTestApp({ beforeInit: (prisma) => truncateAll(prisma) });
    try {
      const http = () => request(t.app.getHttpServer());
      const view = await http().get('/api/v1/settings');
      expect(view.status).toBe(503);
      expect((view.body as { code: string }).code).toBe('SETTINGS_INVALID');
      expect(await t.prisma.settingsSnapshot.count()).toBe(0);
    } finally {
      await truncateAll(t.prisma);
      await t.app.close();
    }
  });
});

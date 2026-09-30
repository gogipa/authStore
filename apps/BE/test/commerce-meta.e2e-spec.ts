import request from 'supertest';
import type { PublishedProgressEvent } from '../src/common/events/progress-events.service.js';
import { ProgressEventsService } from '../src/common/events/progress-events.service.js';
import { clearKnownSecrets } from '../src/common/secrets/secret-mask.js';
import { SECRET_STORE } from '../src/common/secrets/secret-store.port.js';
import { CommerceMetaSyncService } from '../src/modules/integrations/commerce-meta/commerce-meta-sync.service.js';
import {
  META_SYNC_INTERRUPTED_MESSAGE,
  META_SYNC_TARGETS,
} from '../src/modules/integrations/commerce-meta/commerce-meta.constants.js';
import { CommerceTokenService } from '../src/modules/integrations/naver-commerce/commerce-token.service.js';
import { createTestApp, type TestApp, truncate } from './helpers/test-app.js';
import {
  FakeCommerceMetaServer,
  META_FIXTURE_API_CALLS,
  META_FIXTURE_ITEM_COUNTS,
  metaFixtureBody,
} from './support/fake-commerce-meta.js';
import {
  FAKE_ACCESS_TOKEN,
  FakeCommerceTransport,
  signatureVector,
} from './support/fake-commerce-transport.js';
import { InMemorySecretStore } from './support/in-memory-secret-store.js';

const CLIENT = { 'X-AutoStore-Client': '1' };
/** 메타 캐시 표(주소록·택배사는 purchase_agency_profile이 FK로 가리켜 CASCADE로 함께 비운다) */
const META_TABLES = [
  'commerce_meta_sync_run',
  'commerce_meta_document',
  'commerce_category',
  'commerce_origin_area',
  'commerce_addressbook',
  'commerce_return_delivery_company',
  'purchase_agency_profile',
  'call_log',
];

interface RunBody {
  id: number;
  target: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  itemCount: number | null;
  errorMessage: string | null;
}
interface LatestBody {
  items: { target: string; latestRun: RunBody | null; lastSucceededAt: string | null }[];
}
interface PageBody<T> {
  content: T[];
  page: { number: number; size: number; totalElements: number; totalPages: number };
}

describe('커머스API 메타데이터 동기화(e2e, 가짜 커머스 메타 서버, P1-08)', () => {
  let t: TestApp;
  let events: ProgressEventsService;
  let sync: CommerceMetaSyncService;
  const store = new InMemorySecretStore();
  const commerce = new FakeCommerceTransport();
  const server = new FakeCommerceMetaServer().install(commerce);
  const v = signatureVector();

  beforeAll(async () => {
    t = await createTestApp({ overrides: [{ provide: SECRET_STORE, useValue: store }] });
    events = t.app.get(ProgressEventsService);
    sync = t.app.get(CommerceMetaSyncService);
  });

  beforeEach(async () => {
    await truncate(t.prisma, META_TABLES);
    store.reset();
    commerce.reset();
    server.reset();
    t.fetch.reset();
    // 가짜 커머스 서버를 가짜 fetch(HTTP_FETCH) 뒤에 둔다 → 실제 관문(허용 목록·UA·call_log)을 지난다
    t.fetch.handler = commerce.fetchHandler;
    t.app.get(CommerceTokenService).invalidate();
  });

  afterEach(async () => {
    commerce.release();
    await sync.whenIdle();
  });

  afterAll(async () => {
    await t.app.close();
    clearKnownSecrets();
  });

  const http = () => request(t.app.getHttpServer());
  const putKeys = async () => {
    await store.set('COMMERCE_CLIENT_ID', v.clientId);
    await store.set('COMMERCE_CLIENT_SECRET', v.clientSecret);
  };
  const latest = async () =>
    (await http().get('/api/v1/commerce-meta-sync-runs/latest').expect(200)).body as LatestBody;
  /** 202 뒤 백그라운드가 끝날 때까지 기다린 뒤 latest를 다시 읽는다(RUNNING이 없어질 때까지) */
  const waitUntilSettled = async (): Promise<LatestBody> => {
    for (let i = 0; i < 20; i++) {
      await sync.whenIdle();
      const body = await latest();
      if (body.items.every((item) => item.latestRun?.status !== 'RUNNING')) return body;
    }
    throw new Error('동기화가 끝나지 않았습니다');
  };
  const post = (body?: unknown) => {
    const req = http().post('/api/v1/commerce-meta-sync-runs').set(CLIENT);
    return body === undefined ? req : req.send(body as object);
  };
  const syncAll = async (targets?: string[]) => {
    await post(targets ? { targets } : undefined).expect(202);
    return waitUntilSettled();
  };
  const captureEvents = () => {
    const got: PublishedProgressEvent[] = [];
    const sub = events.stream().subscribe((e) => got.push(e));
    return { got, stop: () => sub.unsubscribe() };
  };

  it('빈 DB: latest → 200, items 8개(05-2 순서), 모두 latestRun=null·lastSucceededAt=null', async () => {
    expect(await latest()).toEqual({
      items: META_SYNC_TARGETS.map((target) => ({
        target,
        latestRun: null,
        lastSucceededAt: null,
      })),
    });
  });

  it('키 없이 POST → 409 SECRET_NOT_CONFIGURED, X-AutoStore-Client 없이 → 403. 행·호출 없음', async () => {
    const res = await post().expect(409);
    expect(res.body).toMatchObject({
      code: 'SECRET_NOT_CONFIGURED',
      details: { secretKeys: ['COMMERCE_CLIENT_ID', 'COMMERCE_CLIENT_SECRET'] },
    });
    await http().post('/api/v1/commerce-meta-sync-runs').send({}).expect(403);
    store.unavailable = true;
    expect((await post().expect(503)).body).toMatchObject({ code: 'KEYCHAIN_UNAVAILABLE' });
    expect(await t.prisma.commerceMetaSyncRun.count()).toBe(0);
    expect(commerce.requests).toHaveLength(0);
  });

  it('키를 넣고 빈 본문 POST → 202·Location·RUNNING 8개 → 끝나면 8개 SUCCEEDED·건수 = fixture, SSE 8건, call_log = 호출 수', async () => {
    await putKeys();
    const capture = captureEvents();
    const res = await post().expect(202);
    expect(res.headers.location).toBe('/api/v1/commerce-meta-sync-runs/latest');
    const items = (res.body as { items: RunBody[] }).items;
    expect(items.map((r) => r.target)).toEqual([...META_SYNC_TARGETS]);
    expect(items.every((r) => r.status === 'RUNNING' && r.finishedAt === null)).toBe(true);

    const done = await waitUntilSettled();
    capture.stop();
    for (const item of done.items) {
      expect(item.latestRun).toMatchObject({
        status: 'SUCCEEDED',
        itemCount: META_FIXTURE_ITEM_COUNTS[item.target as keyof typeof META_FIXTURE_ITEM_COUNTS],
        errorMessage: null,
      });
      expect(item.lastSucceededAt).toBe(item.latestRun!.finishedAt);
    }
    const completed = capture.got.filter((e) => e.name === 'commerce-meta-sync.completed');
    expect(completed).toHaveLength(8);
    expect(completed.map((e) => (e.data as { target: string }).target)).toEqual([
      ...META_SYNC_TARGETS,
    ]);
    expect(completed[0]!.data).toMatchObject({
      status: 'SUCCEEDED',
      itemCount: 8,
      errorMessage: null,
    });

    // call_log: 가짜 호출 수만큼(토큰 1 + 메타 38) target=COMMERCE_API, url_masked에 비밀 없음
    expect(commerce.apiRequests).toHaveLength(META_FIXTURE_API_CALLS);
    // 호출은 하나씩 차례로(규칙 15): 가짜 fetch에 동시에 들어온 요청이 1개를 넘은 적이 없다
    expect(t.fetch.maxInFlight).toBe(1);
    const logs = await t.prisma.callLog.findMany({ orderBy: { id: 'asc' } });
    expect(logs).toHaveLength(commerce.requests.length);
    expect(logs.every((l) => l.target === 'COMMERCE_API' && l.succeeded === true)).toBe(true);
    for (const log of logs) {
      expect(log.urlMasked).not.toContain(v.clientSecret);
      expect(log.urlMasked).not.toContain(FAKE_ACCESS_TOKEN);
    }
    expect(logs.map((l) => l.urlMasked)).toContain(
      'https://api.commerce.naver.com/external/v1/categories?last=true',
    );

    // DB 제약(CHECK·UNIQUE)을 지나 실제로 들어갔다
    const docs = await t.prisma.commerceMetaDocument.findMany();
    expect(docs).toHaveLength(7 + 7 + 7 + 1);
    expect(docs.every((d) => /^[0-9a-f]{64}$/.test(d.payloadSha256))).toBe(true);
    const child = await t.prisma.commerceCategory.findUnique({ where: { categoryId: '50000794' } });
    expect(child!.exceptionalCategories).toEqual(['CHILD_CERTIFICATION', 'KC_CERTIFICATION']);
    expect(child!.detailSyncedAt).not.toBeNull();
  });

  it('진행 중에 POST {targets:[ADDRESSBOOK]} → 409 ALREADY_IN_PROGRESS(details.job=META_SYNC)', async () => {
    await putKeys();
    commerce.block();
    await post().expect(202);
    const res = await post({ targets: ['ADDRESSBOOK'] }).expect(409);
    expect(res.body).toMatchObject({
      code: 'ALREADY_IN_PROGRESS',
      message: '메타데이터 동기화가 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
      details: { job: 'META_SYNC', targets: ['ADDRESSBOOK'] },
    });
    commerce.release();
    await waitUntilSettled();
    expect(await t.prisma.commerceMetaSyncRun.count()).toBe(8);
  });

  it.each([
    ['빈 배열', { targets: [] }],
    ['알 수 없는 대상', { targets: ['FOO'] }],
    ['중복', { targets: ['CATEGORY', 'CATEGORY'] }],
    ['null', { targets: null }],
    ['모르는 칸', { targets: ['CATEGORY'], force: true }],
  ])('%s → 422 VALIDATION_FAILED(행 없음)', async (_label, body) => {
    await putKeys();
    const res = await post(body).expect(422);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await t.prisma.commerceMetaSyncRun.count()).toBe(0);
  });

  it('GET /commerce-categories: gender 검사 422, 동기화 전 409(CATEGORY), 뒤에는 3건·오름차순, 정렬·크기 검사', async () => {
    expect((await http().get('/api/v1/commerce-categories').expect(422)).body).toMatchObject({
      code: 'INVALID_QUERY_PARAMETER',
    });
    await http().get('/api/v1/commerce-categories?gender=KIDS').expect(422);
    const empty = await http().get('/api/v1/commerce-categories?gender=MALE').expect(409);
    expect(empty.body).toMatchObject({
      code: 'COMMERCE_META_NOT_SYNCED',
      details: { target: 'CATEGORY' },
    });

    await putKeys();
    await syncAll(['CATEGORY', 'CATEGORY_DETAIL']);
    const male = (await http().get('/api/v1/commerce-categories?gender=MALE').expect(200))
      .body as PageBody<{ categoryId: string; wholeCategoryName: string }>;
    expect(male.page.totalElements).toBe(3);
    expect(male.content.map((c) => c.wholeCategoryName)).toEqual([
      '패션잡화>남성신발>구두>로퍼',
      '패션잡화>남성신발>운동화>러닝화',
      '패션잡화>남성신발>운동화>스니커즈',
    ]);
    expect(Object.keys(male.content[0]!).sort()).toEqual(
      [
        'categoryId',
        'detailSyncedAt',
        'exceptionalCategories',
        'id',
        'name',
        'syncedAt',
        'wholeCategoryName',
      ].sort(),
    );
    const female = (await http().get('/api/v1/commerce-categories?gender=FEMALE').expect(200))
      .body as PageBody<unknown>;
    expect(female.page.totalElements).toBe(3);
    await http().get('/api/v1/commerce-categories?gender=MALE&sort=name,asc').expect(422);
    await http().get('/api/v1/commerce-categories?gender=MALE&size=101').expect(422);
    await http().get('/api/v1/commerce-categories?gender=MALE&q=러닝').expect(422);
  });

  it('두 번째 동기화(v2): 사라진 리프 removed_at·id 그대로, 새 리프 추가, 프로필이 가리키는 주소록이 사라져도 FK가 깨지지 않는다', async () => {
    await putKeys();
    await syncAll();
    const loafer = await t.prisma.commerceCategory.findUnique({
      where: { categoryId: '50000793' },
    });
    const warehouse2 = await t.prisma.commerceAddressbook.findUnique({
      where: { addressBookNo: '100000003' },
    });
    await t.prisma.purchaseAgencyProfile.create({
      data: { overseasShippingCommerceAddressbookId: warehouse2!.id },
    });

    server.categories = 'categories-last-v2';
    // 주소록이 한 페이지(page-1)만 남은 응답
    const page1 = metaFixtureBody<Record<string, unknown>>('addressbooks-page-1');
    server.override('/v1/seller/addressbooks-for-page', {
      status: 200,
      headers: {},
      body: { ...page1, totalElements: 2, totalPages: 1 },
    });
    await syncAll(['CATEGORY', 'ADDRESSBOOK']);

    const after = await t.prisma.commerceCategory.findUnique({ where: { categoryId: '50000793' } });
    expect(after).toMatchObject({ id: loafer!.id });
    expect(after!.removedAt).not.toBeNull();
    expect(
      await t.prisma.commerceCategory.findUnique({ where: { categoryId: '50000795' } }),
    ).toMatchObject({ removedAt: null });
    const gone = await t.prisma.commerceAddressbook.findUnique({ where: { id: warehouse2!.id } });
    expect(gone!.removedAt).not.toBeNull();
    expect(await t.prisma.purchaseAgencyProfile.count()).toBe(1);

    // 주소록 목록: 기본은 사라진 행 제외, includeRemoved=true면 포함. 해외만·raw 없음
    const list = (await http().get('/api/v1/commerce-addressbooks').expect(200)).body as PageBody<
      Record<string, unknown>
    >;
    expect(list.page.totalElements).toBe(2);
    const all = (await http().get('/api/v1/commerce-addressbooks?includeRemoved=true').expect(200))
      .body as PageBody<Record<string, unknown>>;
    expect(all.page.totalElements).toBe(4);
    expect(all.content.filter((a) => a.removedAt !== null)).toHaveLength(2);
  });

  it('GET /commerce-addressbooks: 빈 캐시 200, overseas=true면 해외 2건·raw 없음, 잘못된 값 422', async () => {
    const empty = (await http().get('/api/v1/commerce-addressbooks').expect(200))
      .body as PageBody<unknown>;
    expect(empty).toEqual({
      content: [],
      page: { number: 0, size: 20, totalElements: 0, totalPages: 0 },
    });
    await putKeys();
    await syncAll(['ADDRESSBOOK']);
    const overseas = (await http().get('/api/v1/commerce-addressbooks?overseas=true').expect(200))
      .body as PageBody<Record<string, unknown>>;
    expect(overseas.content).toHaveLength(2);
    expect(overseas.content.every((a) => a.isOverseas === true)).toBe(true);
    expect(overseas.content.every((a) => !('raw' in a))).toBe(true);
    expect(overseas.content[0]).toMatchObject({
      addressBookNo: expect.stringMatching(/^[0-9]+$/) as string,
      addressType: 'RELEASE',
      removedAt: null,
    });
    const domestic = (await http().get('/api/v1/commerce-addressbooks?overseas=false').expect(200))
      .body as PageBody<Record<string, unknown>>;
    expect(domestic.content.every((a) => a.isOverseas === false)).toBe(true);
    await http().get('/api/v1/commerce-addressbooks?overseas=yes').expect(422);
    await http().get('/api/v1/commerce-addressbooks?sort=addressBookNo,asc').expect(422);
  });

  it('GET /commerce-return-delivery-companies: 빈 캐시 200, 동기화 뒤 3건(이름순), includeRemoved', async () => {
    expect(
      (
        (await http().get('/api/v1/commerce-return-delivery-companies').expect(200))
          .body as PageBody<unknown>
      ).content,
    ).toEqual([]);
    await putKeys();
    await syncAll(['RETURN_DELIVERY_COMPANY']);
    const list = (await http().get('/api/v1/commerce-return-delivery-companies').expect(200))
      .body as PageBody<{ code: string; name: string; removedAt: string | null }>;
    expect(list.content.map((c) => c.code).sort()).toEqual(['CJGLS', 'EPOST', 'HANJIN']);
    const names = list.content.map((c) => c.name);
    const desc = (
      await http().get('/api/v1/commerce-return-delivery-companies?sort=name,desc').expect(200)
    ).body as PageBody<{ name: string }>;
    expect(desc.content.map((c) => c.name)).toEqual([...names].reverse());
    await http().get('/api/v1/commerce-return-delivery-companies?includeRemoved=1').expect(422);
  });

  it('GET /commerce-origin-areas: 비면 409(ORIGIN_AREA), q 부분 일치(이름·코드), parentCode, 정렬', async () => {
    const empty = await http().get('/api/v1/commerce-origin-areas').expect(409);
    expect(empty.body).toMatchObject({
      code: 'COMMERCE_META_NOT_SYNCED',
      message: "네이버 원산지 정보가 아직 없습니다. 시스템 상태에서 '지금 동기화'를 눌러 주세요.",
      details: { target: 'ORIGIN_AREA' },
    });
    await putKeys();
    await syncAll(['ORIGIN_AREA']);
    const japan = (
      await http()
        .get(`/api/v1/commerce-origin-areas?q=${encodeURIComponent('일본')}`)
        .expect(200)
    ).body as PageBody<{ originAreaCode: string; parentCode: string | null }>;
    expect(japan.content).toEqual([
      expect.objectContaining({ originAreaCode: '0200037', parentCode: '02' }),
    ]);
    const byCode = (await http().get('/api/v1/commerce-origin-areas?q=0200').expect(200))
      .body as PageBody<{ originAreaCode: string }>;
    expect(byCode.page.totalElements).toBe(3);
    const children = (
      await http()
        .get('/api/v1/commerce-origin-areas?parentCode=02&sort=originAreaCode,asc')
        .expect(200)
    ).body as PageBody<{ originAreaCode: string }>;
    expect(children.content.map((c) => c.originAreaCode)).toEqual([
      '0200001',
      '0200036',
      '0200037',
    ]);
    const all = (await http().get('/api/v1/commerce-origin-areas?size=100').expect(200))
      .body as PageBody<unknown>;
    expect(all.page.totalElements).toBe(7);
    await http().get('/api/v1/commerce-origin-areas?sort=parentCode,asc').expect(422);
  });

  it('ADDRESSBOOK 500 → 그 대상만 FAILED(error_message·SSE), 나머지 SUCCEEDED, 이전 주소록 그대로', async () => {
    await putKeys();
    await syncAll(['ADDRESSBOOK', 'RETURN_DELIVERY_COMPANY']);
    const before = await t.prisma.commerceAddressbook.findMany({ orderBy: { id: 'asc' } });
    server.override('/v1/seller/addressbooks-for-page', 'error-500');
    const capture = captureEvents();
    const done = await syncAll(['ADDRESSBOOK', 'RETURN_DELIVERY_COMPANY']);
    capture.stop();
    const byTarget = new Map(done.items.map((i) => [i.target, i]));
    expect(byTarget.get('ADDRESSBOOK')!.latestRun).toMatchObject({
      status: 'FAILED',
      itemCount: null,
      errorMessage: expect.stringContaining('HTTP 500') as string,
    });
    expect(byTarget.get('ADDRESSBOOK')!.lastSucceededAt).not.toBeNull();
    expect(byTarget.get('RETURN_DELIVERY_COMPANY')!.latestRun!.status).toBe('SUCCEEDED');
    expect(await t.prisma.commerceAddressbook.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(
      capture.got
        .filter((e) => e.name === 'commerce-meta-sync.completed')
        .map((e) => (e.data as { status: string }).status),
    ).toEqual(['FAILED', 'SUCCEEDED']);
  });
});

describe('메타데이터 동기화 재시작 정리(e2e, 규칙 10)', () => {
  it('RUNNING으로 남은 행은 앱을 켤 때 FAILED·finished_at·중단 사유로 바뀐다', async () => {
    let runningId = 0;
    const t = await createTestApp({
      beforeInit: async (prisma) => {
        await truncate(prisma, ['commerce_meta_sync_run']);
        const row = await prisma.commerceMetaSyncRun.create({
          data: { target: 'CATEGORY', status: 'RUNNING' },
        });
        runningId = row.id;
      },
    });
    try {
      const row = await t.prisma.commerceMetaSyncRun.findUnique({ where: { id: runningId } });
      expect(row).toMatchObject({ status: 'FAILED', errorMessage: META_SYNC_INTERRUPTED_MESSAGE });
      expect(row!.finishedAt).not.toBeNull();
      const latest = await request(t.app.getHttpServer())
        .get('/api/v1/commerce-meta-sync-runs/latest')
        .expect(200);
      expect((latest.body as LatestBody).items[0]).toMatchObject({
        target: 'CATEGORY',
        latestRun: { status: 'FAILED', errorMessage: META_SYNC_INTERRUPTED_MESSAGE },
        lastSucceededAt: null,
      });
    } finally {
      await truncate(t.prisma, ['commerce_meta_sync_run']);
      await t.app.close();
    }
  });
});

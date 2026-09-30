import { ApiException } from '../../../common/errors/api.exception.js';
import {
  createMetaKit,
  type MetaKit,
  muteNestLogger,
} from '../../../../test/support/commerce-meta-kit.js';
import { commerceAuthFixture } from '../../../../test/support/fake-commerce-transport.js';
import {
  META_FIXTURE_API_CALLS,
  META_FIXTURE_ITEM_COUNTS,
} from '../../../../test/support/fake-commerce-meta.js';
import { META_SYNC_TARGETS } from './commerce-meta.constants.js';

describe('CommerceMetaSyncService(가짜 커머스 메타 서버·메모리 DB)', () => {
  muteNestLogger();
  let k: MetaKit;

  beforeEach(() => {
    k = createMetaKit();
  });

  const runOf = (target: string) =>
    k.prisma.commerceMetaSyncRun.rows.filter((r) => r.target === target).at(-1)!;

  it('전체 동기화: 대상 8개 RUNNING → 차례로 SUCCEEDED, 건수 = fixture 수, SSE 8건, 호출은 하나씩', async () => {
    const runs = await k.sync.start();
    expect(runs.map((r) => r.target)).toEqual([...META_SYNC_TARGETS]);
    expect(runs.every((r) => r.status === 'RUNNING' && r.finishedAt === null)).toBe(true);
    await k.sync.whenIdle();

    for (const target of META_SYNC_TARGETS) {
      expect(runOf(target)).toMatchObject({
        status: 'SUCCEEDED',
        itemCount: META_FIXTURE_ITEM_COUNTS[target],
        errorMessage: null,
      });
      expect(runOf(target).finishedAt).toBeInstanceOf(Date);
    }
    const events = k.events.of('commerce-meta-sync.completed');
    expect(events.map((e) => e.target)).toEqual([...META_SYNC_TARGETS]);
    expect(events.every((e) => e.status === 'SUCCEEDED' && e.errorMessage === null)).toBe(true);
    expect(k.transport.apiRequests).toHaveLength(META_FIXTURE_API_CALLS);
    expect(k.transport.tokenRequests).toHaveLength(1);
    // 카테고리 단위 대상은 캐시의 성별 신발 리프 7개만 부른다(규칙 1, 신발 밖 50000100 제외)
    const optionIds = k.transport.apiRequests
      .filter((r) => r.path.endsWith('/v1/options/standard-options'))
      .map((r) => new URL(r.url).searchParams.get('categoryId'));
    expect(optionIds.sort()).toEqual(
      ['50000791', '50000792', '50000793', '50000794', '50000801', '50000802', '50000803'].sort(),
    );

    // 캐시: 예외 유형·상세 시각, 원산지 계층, 주소록 해외 표시, 문서
    const kc = k.prisma.commerceCategory.rows.find((r) => r.categoryId === '50000791')!;
    expect(kc.exceptionalCategories).toEqual(['KC_CERTIFICATION']);
    expect(kc.detailSyncedAt).toBeInstanceOf(Date);
    const bag = k.prisma.commerceCategory.rows.find((r) => r.categoryId === '50000100')!;
    expect(bag.detailSyncedAt).toBeNull();
    expect(
      k.prisma.commerceOriginArea.rows.find((r) => r.originAreaCode === '0200037')!.parentCode,
    ).toBe('02');
    expect(k.prisma.commerceAddressbook.rows.filter((r) => r.isOverseas)).toHaveLength(2);
    expect(
      k.prisma.commerceMetaDocument.rows.filter((r) => r.kind === 'CATEGORY_DETAIL'),
    ).toHaveLength(7);
    expect(await k.cache.getDocument('PROVIDED_NOTICE', 'SHOES')).toMatchObject({
      kind: 'PROVIDED_NOTICE',
      scopeKey: 'SHOES',
    });
  });

  it('실패 격리: ADDRESSBOOK에서 500 → 그 run만 FAILED(error_message), 이전 주소록 그대로, 나머지 SUCCEEDED', async () => {
    await k.syncAll(['ADDRESSBOOK']);
    const before = k.prisma.commerceAddressbook.rows.map((r) => ({ ...r }));
    expect(before).toHaveLength(4);

    k.clock.advance(60_000);
    k.server.override('/v1/seller/addressbooks-for-page', 'error-500');
    await k.syncAll();

    expect(runOf('ADDRESSBOOK')).toMatchObject({ status: 'FAILED', itemCount: null });
    expect(runOf('ADDRESSBOOK').errorMessage).toMatch(/HTTP 500 · GW.INTERNAL_SERVER_ERROR/);
    expect(runOf('ADDRESSBOOK').finishedAt).toBeInstanceOf(Date);
    expect(k.prisma.commerceAddressbook.rows).toEqual(before);
    for (const target of META_SYNC_TARGETS.filter((t) => t !== 'ADDRESSBOOK')) {
      expect(runOf(target).status).toBe('SUCCEEDED');
    }
    const failed = k.events.of('commerce-meta-sync.completed').filter((e) => e.status === 'FAILED');
    expect(failed).toEqual([
      expect.objectContaining({
        target: 'ADDRESSBOOK',
        itemCount: null,
        errorMessage: expect.any(String) as string,
      }),
    ]);
  });

  it('주소록 403(판매자정보 그룹 없음)이면 권한 안내 문구', async () => {
    k.server.override('/v1/seller/addressbooks-for-page', 'error-403-api-group');
    await k.syncAll(['ADDRESSBOOK']);
    expect(runOf('ADDRESSBOOK').errorMessage).toBe(
      "주소록을 읽을 권한이 없습니다(HTTP 403 · GW.FORBIDDEN). 커머스API센터에서 애플리케이션에 '판매자정보' API 그룹을 추가한 뒤 다시 동기화해 주세요.",
    );
  });

  it('캐시 쓰기 도중 실패하면 그 대상의 캐시 쓰기를 되돌리고 FAILED(이전 캐시 그대로)', async () => {
    await k.syncAll(['CATEGORY']);
    const before = k.prisma.commerceCategory.rows.map((r) => ({ ...r }));
    k.server.categories = 'categories-last-v2';
    const original = k.prisma.commerceCategory.updateMany;
    let calls = 0;
    k.prisma.commerceCategory.updateMany = (args) => {
      calls += 1;
      // 두 번째 updateMany(사라진 행 표시)에서 DB 오류
      return calls === 2 ? Promise.reject(new Error('boom')) : original(args);
    };
    await k.syncAll(['CATEGORY']);
    expect(runOf('CATEGORY')).toMatchObject({
      status: 'FAILED',
      errorMessage: '받은 메타데이터를 저장하지 못했습니다(앱 내부 오류). 로그를 확인해 주세요.',
    });
    expect(k.prisma.commerceCategory.rows).toEqual(before);
  });

  it('카테고리 캐시가 비었으면 카테고리 단위 대상은 부르지 않고 FAILED', async () => {
    await k.syncAll(['STANDARD_OPTIONS']);
    expect(runOf('STANDARD_OPTIONS')).toMatchObject({
      status: 'FAILED',
      errorMessage: '성별 신발 카테고리가 캐시에 없습니다. 카테고리 목록을 먼저 받아 주세요.',
    });
    expect(k.transport.apiRequests).toHaveLength(0);
  });

  it('429 GW.RATE_LIMIT이면 기다렸다가 다시 보낸다(Retry-After·1·2·4초). 계속되면 FAILED', async () => {
    k.server.respondOnce(
      '/v2/product-delivery-info/return-delivery-companies',
      'error-429-rate-limit',
    );
    const t0 = k.clock.now().getTime();
    await k.syncAll(['RETURN_DELIVERY_COMPANY']);
    expect(runOf('RETURN_DELIVERY_COMPANY')).toMatchObject({ status: 'SUCCEEDED', itemCount: 3 });
    // 429 응답 헤더 Remaining 0·Replenish 2 → 500ms, 재시도 대기 1초 중 큰 값
    expect(k.clock.now().getTime() - t0).toBeGreaterThanOrEqual(1000);

    k.server.override(
      '/v2/product-delivery-info/return-delivery-companies',
      'error-429-rate-limit',
    );
    const calls = k.transport.apiRequests.length;
    await k.syncAll(['RETURN_DELIVERY_COMPANY']);
    expect(k.transport.apiRequests.length - calls).toBe(4);
    expect(runOf('RETURN_DELIVERY_COMPANY').status).toBe('FAILED');
    expect(runOf('RETURN_DELIVERY_COMPANY').errorMessage).toMatch(/호출 한도에 걸렸습니다/);
  });

  it('인증 실패(재발급까지 401)면 남은 대상은 부르지 않고 같은 사유로 FAILED', async () => {
    k.transport.defaultResponder = (req) =>
      req.path.endsWith('/v1/oauth2/token')
        ? commerceAuthFixture('token-200')
        : commerceAuthFixture('api-401-authn');
    await k.syncAll(['ORIGIN_AREA', 'ADDRESSBOOK', 'RETURN_DELIVERY_COMPANY']);
    const runs = ['ORIGIN_AREA', 'ADDRESSBOOK', 'RETURN_DELIVERY_COMPANY'].map(runOf);
    expect(runs.every((r) => r.status === 'FAILED')).toBe(true);
    expect(new Set(runs.map((r) => r.errorMessage)).size).toBe(1);
    expect(runs[0]!.errorMessage).toMatch(/네이버 커머스API 인증에 실패했습니다/);
    // 첫 대상만 불렀다(원 요청 + 재발급 뒤 한 번 = 2)
    expect(k.transport.apiRequests).toHaveLength(2);
    expect(k.events.of('auth.failed')).toHaveLength(1);
  });

  it('요청 대상 중 RUNNING이 있으면 409 ALREADY_IN_PROGRESS(details.job=META_SYNC), 새 행 없음', async () => {
    k.prisma.commerceMetaSyncRun.seed({
      target: 'ADDRESSBOOK',
      status: 'RUNNING',
      startedAt: k.clock.now(),
    });
    const error = await k.sync.start(['CATEGORY', 'ADDRESSBOOK']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiException);
    expect(error).toMatchObject({
      code: 'ALREADY_IN_PROGRESS',
      message: '메타데이터 동기화가 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
      details: { job: 'META_SYNC', targets: ['ADDRESSBOOK'] },
    });
    expect(k.prisma.commerceMetaSyncRun.rows).toHaveLength(1);
    // 겹치지 않는 대상은 된다
    await expect(k.sync.start(['CATEGORY'])).resolves.toHaveLength(1);
    await k.sync.whenIdle();
  });

  it('커머스 키가 없으면 409 SECRET_NOT_CONFIGURED, 키체인 오류는 503. 행도 호출도 없다', async () => {
    const noKeys = createMetaKit({ secrets: {} });
    await expect(noKeys.sync.start()).rejects.toMatchObject({
      code: 'SECRET_NOT_CONFIGURED',
      details: { secretKeys: ['COMMERCE_CLIENT_ID', 'COMMERCE_CLIENT_SECRET'] },
    });
    noKeys.store.unavailable = true;
    await expect(noKeys.sync.start()).rejects.toMatchObject({ code: 'KEYCHAIN_UNAVAILABLE' });
    expect(noKeys.prisma.commerceMetaSyncRun.rows).toHaveLength(0);
    expect(noKeys.transport.requests).toHaveLength(0);
  });

  it('latest: 대상 8개 05-2 순서, 돈 적 없으면 null, lastSucceededAt은 마지막 SUCCEEDED의 finishedAt', async () => {
    expect((await k.sync.latest()).items).toEqual(
      META_SYNC_TARGETS.map((target) => ({ target, latestRun: null, lastSucceededAt: null })),
    );
    await k.syncAll(['ADDRESSBOOK']);
    const succeededAt = runOf('ADDRESSBOOK').finishedAt as Date;
    k.clock.advance(3_600_000);
    k.server.override('/v1/seller/addressbooks-for-page', 'error-500');
    await k.syncAll(['ADDRESSBOOK']);
    const item = (await k.sync.latest()).items.find((i) => i.target === 'ADDRESSBOOK')!;
    expect(item.latestRun).toMatchObject({ status: 'FAILED' });
    expect(item.lastSucceededAt).toBe(succeededAt.toISOString());
  });
});

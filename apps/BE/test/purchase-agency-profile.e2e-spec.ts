import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../src/common/events/progress-events.service.js';
import { DEFAULT_SETTINGS } from '../src/modules/settings/defaults/default-settings.js';
import type { AppSettings } from '../src/modules/settings/schema/settings.types.js';
import { writeSettingsFileAtomically } from '../src/modules/settings/settings-file.loader.js';
import {
  dispatchCompaniesFixture,
  PROFILE_SEED_IDS,
  PROFILE_TABLES,
  type ProfileInputBody,
  seedProfileCaches,
  validProfileInput,
} from './fixtures/settings/purchase-agency-profile/profile-fixtures.js';
import { allRequiredCompleted, createCandidate } from './fixtures/step-engine/candidate.factory.js';
import { insertStepRun } from './fixtures/step-engine/step-run.factory.js';
import { STEP_ENGINE_TABLES } from './fixtures/step-engine/truncate.js';
import { createTestApp, type TestApp, truncate } from './helpers/test-app.js';

/** setup-env.cjs가 이 파일에 준 임시 데이터 폴더 */
const DATA_DIR = process.env.APP_DATA_DIR!;

/** 05-2 PurchaseAgencyProfile required 18개 */
const PROFILE_KEYS = [
  'id',
  'overseasShippingCommerceAddressbookId',
  'returnCommerceAddressbookId',
  'dispatchDeliveryCompanyCode',
  'commerceReturnDeliveryCompanyId',
  'deliveryFeeKrw',
  'returnFeeKrw',
  'exchangeFeeKrw',
  'businessName',
  'afterServicePhone',
  'afterServiceGuide',
  'importer',
  'noticeFixedTexts',
  'maxPurchaseQuantityPerOrder',
  'createdAt',
  'updatedAt',
  'missingFields',
  'addressWarnings',
].sort();

interface ProfileBody extends ProfileInputBody {
  id: number | null;
  deliveryFeeKrw: number;
  createdAt: string | null;
  updatedAt: string | null;
  missingFields: string[];
  addressWarnings: { field: string; code: string; message: string }[];
}

interface ErrorBody {
  code: string;
  message: string;
  fieldErrors?: { field: string; message: string }[];
}

/** 발송 택배사 fixture(가짜 코드 2개)를 끼운 설정 파일 */
function settingsWithDispatchCompanies(): string {
  const settings = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  settings.delivery.dispatchCompanies = dispatchCompaniesFixture();
  return `${JSON.stringify(settings, null, 2)}\n`;
}

describe('구매대행 프로필 GET·PUT /purchase-agency-profile · GET /dispatch-delivery-companies (e2e)', () => {
  let t: TestApp;
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const getProfile = () => http().get('/api/v1/purchase-agency-profile');
  const putProfile = (body: object, withClientHeader = true) => {
    const req = http().put('/api/v1/purchase-agency-profile');
    return (withClientHeader ? req.set('X-AutoStore-Client', '1') : req).send(body);
  };
  const auditRows = () =>
    t.prisma.userActionLog.findMany({ where: { eventType: 'SETTING_CHANGED' } });
  const stepRow = (candidateId: number, stepCode: 'NOTICE_HTML' | 'REGISTER' | 'UPLOAD') =>
    t.prisma.candidateStep.findUniqueOrThrow({
      where: { candidateId_stepCode: { candidateId, stepCode } },
    });

  beforeAll(async () => {
    await writeSettingsFileAtomically(DATA_DIR, settingsWithDispatchCompanies());
    t = await createTestApp();
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  beforeEach(async () => {
    await truncate(t.prisma, [...PROFILE_TABLES, ...STEP_ENGINE_TABLES]);
    events.length = 0;
  });

  afterAll(async () => {
    unsubscribe();
    await t.app.close();
  });

  it('빈 DB GET → 200 빈 기본값(id null, 배송비 0, 수량 1, importer null, 고시 {}), missingFields·addressWarnings', async () => {
    const res = await getProfile().expect(200);
    const body = res.body as ProfileBody;
    expect(Object.keys(body).sort()).toEqual(PROFILE_KEYS);
    expect(body).toMatchObject({
      id: null,
      createdAt: null,
      updatedAt: null,
      deliveryFeeKrw: 0,
      maxPurchaseQuantityPerOrder: 1,
      importer: null,
      businessName: null,
      noticeFixedTexts: {},
      addressWarnings: [],
    });
    expect(body.missingFields).toEqual(expect.arrayContaining(['importer', 'businessName']));
    expect(await t.prisma.purchaseAgencyProfile.count()).toBe(0);
  });

  it('캐시 시드 뒤 유효 본문 PUT → 200, 보낸 값 그대로, 1행(singleton_key=1), SETTING_CHANGED 1행(키 이름만)', async () => {
    await seedProfileCaches(t.prisma);
    const input = validProfileInput();
    const res = await putProfile(input).expect(200);
    const body = res.body as { profile: ProfileBody; rerunRequiredStepCount: number };
    expect(body.rerunRequiredStepCount).toBe(0);
    expect(body.profile).toMatchObject({ ...input, deliveryFeeKrw: 0, missingFields: [] });
    expect(body.profile.id).toBeGreaterThanOrEqual(1);
    expect(body.profile.addressWarnings).toEqual([]);

    const rows = await t.prisma.$queryRawUnsafe<
      { singleton_key: number; delivery_fee_krw: number }[]
    >('SELECT singleton_key, delivery_fee_krw FROM purchase_agency_profile');
    expect(rows).toEqual([{ singleton_key: 1, delivery_fee_krw: 0 }]);

    const audits = await auditRows();
    expect(audits).toHaveLength(1);
    const detail = audits[0]!.detail as { setting: string; changedKeys: string[] };
    expect(detail.setting).toBe('PURCHASE_AGENCY_PROFILE');
    expect(detail.changedKeys).toEqual(expect.arrayContaining(['importer', 'businessName']));
    const text = JSON.stringify(detail);
    for (const value of ['[수입자]', '[내 상호]', '[A/S 연락처]', 'FAKE_DISPATCH_A']) {
      expect(text).not.toContain(value);
    }
    expect((await getProfile().expect(200)).body).toMatchObject({ ...input, missingFields: [] });
  });

  it('같은 본문을 다시 PUT → 200, 감사 기록·updatedAt 그대로(rerunRequiredStepCount 0)', async () => {
    await seedProfileCaches(t.prisma);
    const first = await putProfile(validProfileInput()).expect(200);
    const again = await putProfile(validProfileInput()).expect(200);
    expect(again.body).toMatchObject({ rerunRequiredStepCount: 0 });
    expect((again.body as { profile: ProfileBody }).profile.updatedAt).toBe(
      (first.body as { profile: ProfileBody }).profile.updatedAt,
    );
    expect(await auditRows()).toHaveLength(1);
  });

  describe('참조 검사(규칙 5·6)', () => {
    beforeEach(async () => {
      await seedProfileCaches(t.prisma);
    });

    it('국내 주소를 해외 출고지로 → 422 ADDRESS_NOT_OVERSEAS(fieldErrors[0].field)', async () => {
      const res = await putProfile({
        ...validProfileInput(),
        overseasShippingCommerceAddressbookId: PROFILE_SEED_IDS.domesticAddressbookId,
      }).expect(422);
      const body = res.body as ErrorBody;
      expect(body.code).toBe('ADDRESS_NOT_OVERSEAS');
      expect(body.message).toBe('해외 출고지 주소가 아닙니다.');
      expect(body.fieldErrors?.[0]?.field).toBe('overseasShippingCommerceAddressbookId');
      expect(await t.prisma.purchaseAgencyProfile.count()).toBe(0);
    });

    it('없는 주소록 id → 404 ADDRESSBOOK_NOT_FOUND, 사라진 주소록 → 404', async () => {
      const missing = await putProfile({
        ...validProfileInput(),
        overseasShippingCommerceAddressbookId: 999,
      }).expect(404);
      expect((missing.body as ErrorBody).code).toBe('ADDRESSBOOK_NOT_FOUND');
      const removed = await putProfile({
        ...validProfileInput(),
        returnCommerceAddressbookId: PROFILE_SEED_IDS.removedAddressbookId,
      }).expect(404);
      expect(removed.body).toMatchObject({
        code: 'ADDRESSBOOK_NOT_FOUND',
        fieldErrors: [{ field: 'returnCommerceAddressbookId' }],
      });
    });

    it('목록 밖 발송 코드 → 422 DELIVERY_COMPANY_NOT_ALLOWED', async () => {
      const res = await putProfile({
        ...validProfileInput(),
        dispatchDeliveryCompanyCode: 'CJGLS',
      }).expect(422);
      expect(res.body).toMatchObject({
        code: 'DELIVERY_COMPANY_NOT_ALLOWED',
        message: '쓸 수 없는 발송 택배사입니다.',
        fieldErrors: [{ field: 'dispatchDeliveryCompanyCode' }],
      });
    });

    it('사라진 반품 택배사 → 404 RETURN_DELIVERY_COMPANY_NOT_FOUND(Proposed)', async () => {
      const res = await putProfile({
        ...validProfileInput(),
        commerceReturnDeliveryCompanyId: PROFILE_SEED_IDS.removedReturnCompanyId,
      }).expect(404);
      expect(res.body).toMatchObject({
        code: 'RETURN_DELIVERY_COMPANY_NOT_FOUND',
        fieldErrors: [{ field: 'commerceReturnDeliveryCompanyId' }],
      });
    });

    it('빈칸이 있어도 저장된다(값 null 허용), missingFields에 그 이름', async () => {
      const res = await putProfile({
        ...validProfileInput(),
        importer: null,
        businessName: '',
      }).expect(200);
      const profile = (res.body as { profile: ProfileBody }).profile;
      expect(profile.importer).toBeNull();
      expect(profile.businessName).toBeNull();
      expect(profile.missingFields).toEqual(['businessName', 'importer']);
    });
  });

  describe('본문 형식(규칙 3·4)', () => {
    beforeEach(async () => {
      await seedProfileCaches(t.prisma);
    });

    it.each<[string, (b: Record<string, unknown>) => void, string]>([
      ['deliveryFeeKrw: 0(정의 밖 필드)', (b) => (b.deliveryFeeKrw = 0), 'deliveryFeeKrw'],
      ['importer 키 빠짐', (b) => delete b.importer, 'importer'],
      [
        'maxPurchaseQuantityPerOrder: 0',
        (b) => (b.maxPurchaseQuantityPerOrder = 0),
        'maxPurchaseQuantityPerOrder',
      ],
      ['returnFeeKrw: -1', (b) => (b.returnFeeKrw = -1), 'returnFeeKrw'],
      ['상호 101자', (b) => (b.businessName = 'x'.repeat(101)), 'businessName'],
      [
        'noticeFixedTexts 값이 숫자',
        (b) => (b.noticeFixedTexts = { warrantyPolicy: 1 }),
        'noticeFixedTexts',
      ],
    ])('%s → 422 VALIDATION_FAILED', async (_label, change, field) => {
      const body = validProfileInput() as unknown as Record<string, unknown>;
      change(body);
      const res = await putProfile(body).expect(422);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((res.body as ErrorBody).fieldErrors?.map((e) => e.field)).toEqual([field]);
      expect(await t.prisma.purchaseAgencyProfile.count()).toBe(0);
    });

    it('X-AutoStore-Client 없음 → 403', async () => {
      const res = await putProfile(validProfileInput(), false).expect(403);
      expect(res.body).toMatchObject({ code: 'CLIENT_HEADER_REQUIRED' });
    });
  });

  it('저장 뒤 해외 출고지 주소록에 removed_at을 찍으면 GET addressWarnings에 ADDRESSBOOK_NOT_FOUND', async () => {
    await seedProfileCaches(t.prisma);
    await putProfile(validProfileInput()).expect(200);
    await t.prisma.commerceAddressbook.update({
      where: { id: PROFILE_SEED_IDS.overseasAddressbookId },
      data: { removedAt: new Date('2026-09-29T00:10:00Z') },
    });
    const body = (await getProfile().expect(200)).body as ProfileBody;
    expect(body.addressWarnings).toEqual([
      {
        field: 'overseasShippingCommerceAddressbookId',
        code: 'ADDRESSBOOK_NOT_FOUND',
        message: expect.any(String) as string,
      },
    ]);
  });

  describe('재실행 필요 전파(규칙 11·12)', () => {
    it('importer를 바꾸면 profile.importer를 읽은 ⑥-3만 RERUN_REQUIRED(자동 실행 없음), SSE candidate-step.changed 1건', async () => {
      await seedProfileCaches(t.prisma);
      await putProfile(validProfileInput()).expect(200);
      const c = (await createCandidate(t.prisma, { gender: 'MALE' })).candidate;
      await insertStepRun(t.prisma, {
        candidateId: c.id,
        stepCode: 'NOTICE_HTML',
        status: 'COMPLETED',
        inputs: [
          { inputKey: 'profile.importer', sourceType: 'SETTINGS', value: '[수입자]' },
          { inputKey: 'profile.businessName', sourceType: 'SETTINGS', value: '[내 상호]' },
        ],
      });
      // 상호만 읽은 단계는 importer 변경에 영향이 없다
      await insertStepRun(t.prisma, {
        candidateId: c.id,
        stepCode: 'UPLOAD',
        status: 'COMPLETED',
        inputs: [{ inputKey: 'profile.businessName', sourceType: 'SETTINGS', value: '[내 상호]' }],
      });
      events.length = 0;

      const res = await putProfile({ ...validProfileInput(), importer: '[다른 수입자]' }).expect(
        200,
      );
      expect(res.body).toMatchObject({ rerunRequiredStepCount: 1 });
      expect(await stepRow(c.id, 'NOTICE_HTML')).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['profile.importer'],
      });
      expect((await stepRow(c.id, 'UPLOAD')).status).toBe('COMPLETED');
      const changed = events.filter((e) => e.name === 'candidate-step.changed');
      expect(changed).toHaveLength(1);
      expect(changed[0]!.data).toMatchObject({
        candidateId: c.id,
        stepCode: 'NOTICE_HTML',
        status: 'RERUN_REQUIRED',
      });
      // 다시 실행하지 않는다
      expect(await t.prisma.stepRun.count({ where: { candidateId: c.id } })).toBe(2);
      const audits = await auditRows();
      expect(audits.at(-1)!.detail).toEqual({
        setting: 'PURCHASE_AGENCY_PROFILE',
        changedKeys: ['importer'],
      });
    });

    it('승인대기 후보는 작업중으로 돌아가고, 잠긴 후보(등록요청중)는 건너뛴다', async () => {
      await seedProfileCaches(t.prisma);
      await putProfile(validProfileInput()).expect(200);
      const waiting = await createCandidate(t.prisma, {
        status: 'AWAITING_APPROVAL',
        steps: allRequiredCompleted(),
      });
      const locked = await createCandidate(t.prisma, {
        status: 'REGISTERING',
        steps: allRequiredCompleted(),
      });
      for (const fixture of [waiting, locked]) {
        await t.prisma.stepRunInput.create({
          data: {
            stepRunId: fixture.stepRunIds.NOTICE_HTML!,
            inputKey: 'profile.returnFeeKrw',
            sourceType: 'SETTINGS',
            isStartCondition: true,
            valueHash: 'e'.repeat(64),
          },
        });
      }

      const res = await putProfile({ ...validProfileInput(), returnFeeKrw: 35000 }).expect(200);
      expect(res.body).toMatchObject({ rerunRequiredStepCount: 1 });
      expect((await stepRow(waiting.candidate.id, 'NOTICE_HTML')).status).toBe('RERUN_REQUIRED');
      expect(
        (await t.prisma.candidate.findUniqueOrThrow({ where: { id: waiting.candidate.id } }))
          .status,
      ).toBe('WORKING');
      expect((await stepRow(locked.candidate.id, 'NOTICE_HTML')).status).toBe('COMPLETED');
    });
  });

  it('GET /dispatch-delivery-companies → 설정 파일의 목록(코드·이름·출처, 페이징 없음)', async () => {
    const res = await http().get('/api/v1/dispatch-delivery-companies').expect(200);
    expect(res.body).toEqual({ items: dispatchCompaniesFixture() });
  });
});

describe('설정 스냅샷이 없을 때(규칙 7, e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    await writeSettingsFileAtomically(DATA_DIR, '{ "schemaVersion": "1", ');
    t = await createTestApp({
      beforeInit: (prisma) => truncate(prisma, ['settings_snapshot', ...PROFILE_TABLES]),
    });
  });

  afterAll(async () => {
    await t.app.close();
    // 다음 파일이 쓸 설정을 되돌린다(데이터 폴더는 파일마다 따로지만 DB 스냅샷은 같이 쓴다)
    await writeSettingsFileAtomically(DATA_DIR, settingsWithDispatchCompanies());
  });

  it('GET /dispatch-delivery-companies → 503 SETTINGS_INVALID', async () => {
    const res = await request(t.app.getHttpServer())
      .get('/api/v1/dispatch-delivery-companies')
      .expect(503);
    expect(res.body).toMatchObject({ code: 'SETTINGS_INVALID' });
  });

  it('프로필 GET은 설정 없이도 200, 발송 코드가 있는 PUT은 503(Proposed), 없으면 저장된다', async () => {
    const server = t.app.getHttpServer();
    await request(server).get('/api/v1/purchase-agency-profile').expect(200);
    await seedProfileCaches(t.prisma);
    const withCode = await request(server)
      .put('/api/v1/purchase-agency-profile')
      .set('X-AutoStore-Client', '1')
      .send(validProfileInput())
      .expect(503);
    expect(withCode.body).toMatchObject({ code: 'SETTINGS_INVALID' });
    await request(server)
      .put('/api/v1/purchase-agency-profile')
      .set('X-AutoStore-Client', '1')
      .send({ ...validProfileInput(), dispatchDeliveryCompanyCode: null })
      .expect(200);
  });
});

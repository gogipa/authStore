import { Logger } from '@nestjs/common';
import type { UserActionLogInput } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { CommerceMetaCacheService } from '../../integrations/commerce-meta/commerce-meta-cache.service.js';
import { DEFAULT_SETTINGS } from '../defaults/default-settings.js';
import type { AppSettings } from '../schema/settings.types.js';
import type { SettingsService } from '../settings.service.js';
import { FakeMetaPrisma } from '../../../../test/helpers/fake-prisma.js';
import {
  dispatchCompaniesFixture,
  PROFILE_SEED_IDS,
  seedProfileCaches,
  validProfileInput,
} from '../../../../test/fixtures/settings/purchase-agency-profile/profile-fixtures.js';
import { PurchaseAgencyProfileService } from './purchase-agency-profile.service.js';
import type { ProfileRerunPropagator } from './profile-rerun.port.js';
import { emptyProfileValues } from './profile-values.js';

/** 발송 택배사 fixture를 끼운 현재 설정(없으면 503을 던지는 가짜) */
function fakeSettings(loaded = true): SettingsService {
  const settings: AppSettings = {
    ...structuredClone(DEFAULT_SETTINGS as AppSettings),
    delivery: { dispatchCompanies: dispatchCompaniesFixture() },
  };
  return {
    current: () => {
      if (!loaded) throw new ApiException('SETTINGS_INVALID');
      return settings;
    },
  } as unknown as SettingsService;
}

interface Kit {
  prisma: FakeMetaPrisma;
  service: PurchaseAgencyProfileService;
  audits: UserActionLogInput[];
  propagated: string[][];
  /** 전파가 맡긴 커밋 뒤 일(SSE 흉내)이 불린 수 */
  afterCommitCalls: number;
}

async function createKit(options: { settingsLoaded?: boolean; rerunCount?: number } = {}) {
  const prisma = new FakeMetaPrisma();
  await seedProfileCaches(prisma);
  const db = prisma as unknown as PrismaService;
  const kit = {
    prisma,
    audits: [] as UserActionLogInput[],
    propagated: [] as string[][],
    afterCommitCalls: 0,
  } as Kit;
  const propagator: ProfileRerunPropagator = (keys, _tx, afterCommit) => {
    kit.propagated.push([...keys]);
    afterCommit(() => {
      kit.afterCommitCalls += 1;
    });
    return Promise.resolve(options.rerunCount ?? 0);
  };
  const audit = {
    record: (input: UserActionLogInput, _tx?: Prisma.TransactionClient) => {
      kit.audits.push(input);
      return Promise.resolve({});
    },
  };
  kit.service = new PurchaseAgencyProfileService(
    db,
    new CommerceMetaCacheService(db),
    fakeSettings(options.settingsLoaded ?? true),
    audit as never,
    propagator,
  );
  return kit;
}

describe('PurchaseAgencyProfileService(P1-09)', () => {
  // 저장 로그(바뀐 키 이름)는 테스트 출력에 필요 없다
  beforeAll(() => {
    Logger.overrideLogger(false);
  });
  afterAll(() => {
    Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose', 'fatal']);
  });

  describe('getCurrent(규칙 1·2·9)', () => {
    it('행이 없으면 빈 기본값(id·시각 null, 배송비 0, 수량 1, 고시 {}), 개인 값 없음', async () => {
      const k = await createKit();
      const view = await k.service.getCurrent();
      expect(view).toMatchObject({
        ...emptyProfileValues(),
        id: null,
        createdAt: null,
        updatedAt: null,
        deliveryFeeKrw: 0,
        maxPurchaseQuantityPerOrder: 1,
        noticeFixedTexts: {},
        importer: null,
        addressWarnings: [],
      });
      expect(view.missingFields).toEqual(expect.arrayContaining(['importer', 'businessName']));
    });

    it('기본 설정 템플릿에는 발송 택배사 코드가 없다(출처 있는 코드만, 규칙 2·7)', () => {
      expect(DEFAULT_SETTINGS.delivery.dispatchCompanies).toEqual([]);
    });
  });

  describe('참조 검사(규칙 5·6)', () => {
    it('해외 주소·동기화 목록 반품 택배사·설정 목록 발송 코드 → 통과', async () => {
      const k = await createKit();
      await expect(k.service.assertReferences(validProfileInput())).resolves.toBeUndefined();
    });

    it('국내 주소를 해외 출고지로 → 422 ADDRESS_NOT_OVERSEAS(fieldErrors에 칸)', async () => {
      const k = await createKit();
      const input = {
        ...validProfileInput(),
        overseasShippingCommerceAddressbookId: PROFILE_SEED_IDS.domesticAddressbookId,
      };
      await expect(k.service.assertReferences(input)).rejects.toMatchObject({
        code: 'ADDRESS_NOT_OVERSEAS',
        fieldErrors: [{ field: 'overseasShippingCommerceAddressbookId' }],
      });
    });

    it.each([
      ['없는 id', 999],
      ['removed_at 있는 id', PROFILE_SEED_IDS.removedAddressbookId],
    ])('해외 출고지가 %s → 404 ADDRESSBOOK_NOT_FOUND', async (_label, id) => {
      const k = await createKit();
      const input = { ...validProfileInput(), overseasShippingCommerceAddressbookId: id };
      const error = await k.service.assertReferences(input).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiException);
      expect(error).toMatchObject({
        code: 'ADDRESSBOOK_NOT_FOUND',
        fieldErrors: [{ field: 'overseasShippingCommerceAddressbookId' }],
      });
      expect((error as ApiException).getStatus()).toBe(404);
    });

    it('반품·교환지가 사라졌으면 404 ADDRESSBOOK_NOT_FOUND(국내 주소는 된다)', async () => {
      const k = await createKit();
      await expect(
        k.service.assertReferences({
          ...validProfileInput(),
          returnCommerceAddressbookId: PROFILE_SEED_IDS.removedAddressbookId,
        }),
      ).rejects.toMatchObject({
        code: 'ADDRESSBOOK_NOT_FOUND',
        fieldErrors: [{ field: 'returnCommerceAddressbookId' }],
      });
    });

    it('목록 밖 발송 코드 → 422 DELIVERY_COMPANY_NOT_ALLOWED', async () => {
      const k = await createKit();
      await expect(
        k.service.assertReferences({
          ...validProfileInput(),
          dispatchDeliveryCompanyCode: 'NOT_IN_LIST',
        }),
      ).rejects.toMatchObject({
        code: 'DELIVERY_COMPANY_NOT_ALLOWED',
        fieldErrors: [{ field: 'dispatchDeliveryCompanyCode' }],
      });
    });

    it('설정 스냅샷이 없으면 발송 코드를 볼 수 없어 503 SETTINGS_INVALID(코드가 null이면 통과)', async () => {
      const k = await createKit({ settingsLoaded: false });
      await expect(k.service.assertReferences(validProfileInput())).rejects.toMatchObject({
        code: 'SETTINGS_INVALID',
      });
      await expect(
        k.service.assertReferences({ ...validProfileInput(), dispatchDeliveryCompanyCode: null }),
      ).resolves.toBeUndefined();
    });

    it.each([
      ['없는 id', 999],
      ['사라진 id', PROFILE_SEED_IDS.removedReturnCompanyId],
    ])('반품 택배사가 %s → 404 RETURN_DELIVERY_COMPANY_NOT_FOUND(Proposed)', async (_l, id) => {
      const k = await createKit();
      await expect(
        k.service.assertReferences({ ...validProfileInput(), commerceReturnDeliveryCompanyId: id }),
      ).rejects.toMatchObject({
        code: 'RETURN_DELIVERY_COMPANY_NOT_FOUND',
        fieldErrors: [{ field: 'commerceReturnDeliveryCompanyId' }],
      });
    });

    it('빈칸(null)은 검사하지 않는다(빈 프로필도 저장된다)', async () => {
      const k = await createKit();
      await expect(k.service.assertReferences(emptyProfileValues())).resolves.toBeUndefined();
    });
  });

  describe('replace(규칙 3·11·12)', () => {
    it('처음 저장 → 1행 upsert, 바뀐 키만 profile.* 이름으로 전파, 감사 기록은 키 이름만', async () => {
      const k = await createKit({ rerunCount: 2 });
      const result = await k.service.replace(validProfileInput());

      expect(k.prisma.purchaseAgencyProfile.rows).toHaveLength(1);
      expect(k.prisma.purchaseAgencyProfile.rows[0]).toMatchObject({
        singletonKey: 1,
        deliveryFeeKrw: 0,
        importer: '[수입자]',
      });
      expect(result.rerunRequiredStepCount).toBe(2);
      expect(result.profile).toMatchObject({ ...validProfileInput(), missingFields: [] });
      expect(k.propagated).toHaveLength(1);
      expect(k.propagated[0]).toContain('profile.importer');
      expect(k.propagated[0]).not.toContain('profile.maxPurchaseQuantityPerOrder');
      expect(k.afterCommitCalls).toBe(1);
      expect(k.audits).toEqual([
        {
          eventType: 'SETTING_CHANGED',
          detail: {
            setting: 'PURCHASE_AGENCY_PROFILE',
            changedKeys: expect.arrayContaining(['importer', 'businessName']) as unknown,
          },
        },
      ]);
      // 감사 기록 detail에 값이 없다
      expect(JSON.stringify(k.audits)).not.toContain('[수입자]');
    });

    it('같은 값 다시 저장 → 쓰기·전파·감사 기록 없이 rerunRequiredStepCount 0', async () => {
      const k = await createKit({ rerunCount: 5 });
      await k.service.replace(validProfileInput());
      const updatedAt = k.prisma.purchaseAgencyProfile.rows[0]!.updatedAt;
      const again = await k.service.replace(validProfileInput());
      expect(again.rerunRequiredStepCount).toBe(0);
      expect(k.propagated).toHaveLength(1);
      expect(k.audits).toHaveLength(1);
      expect(k.prisma.purchaseAgencyProfile.rows[0]!.updatedAt).toBe(updatedAt);
    });

    it('앞뒤 공백·빈 문자열만 다르면 같은 값이다(빈 문자열 = null)', async () => {
      const k = await createKit();
      await k.service.replace({ ...validProfileInput(), afterServiceGuide: null });
      await k.service.replace({
        ...validProfileInput(),
        importer: ' [수입자] ',
        afterServiceGuide: '',
      });
      expect(k.audits).toHaveLength(1);
    });

    it('importer만 바꾸면 profile.importer 하나만 전파한다', async () => {
      const k = await createKit();
      await k.service.replace(validProfileInput());
      await k.service.replace({ ...validProfileInput(), importer: '[다른 수입자]' });
      expect(k.propagated[1]).toEqual(['profile.importer']);
      expect(k.audits[1]?.detail).toEqual({
        setting: 'PURCHASE_AGENCY_PROFILE',
        changedKeys: ['importer'],
      });
    });

    it('참조 오류면 아무것도 쓰지 않는다', async () => {
      const k = await createKit();
      await expect(
        k.service.replace({
          ...validProfileInput(),
          overseasShippingCommerceAddressbookId: PROFILE_SEED_IDS.domesticAddressbookId,
        }),
      ).rejects.toMatchObject({ code: 'ADDRESS_NOT_OVERSEAS' });
      expect(k.prisma.purchaseAgencyProfile.rows).toHaveLength(0);
      expect(k.propagated).toHaveLength(0);
      expect(k.audits).toHaveLength(0);
    });

    it('전파가 실패하면 저장도 되돌린다(한 트랜잭션, 커밋 뒤 일은 부르지 않는다)', async () => {
      const k = await createKit();
      k.service.setRerunPropagator((_keys, _tx, afterCommit) => {
        afterCommit(() => {
          k.afterCommitCalls += 1;
        });
        return Promise.reject(new Error('전파 실패(테스트)'));
      });
      await expect(k.service.replace(validProfileInput())).rejects.toThrow('전파 실패(테스트)');
      expect(k.prisma.purchaseAgencyProfile.rows).toHaveLength(0);
      expect(k.afterCommitCalls).toBe(0);
    });
  });

  describe('주소 경고(규칙 10, 막지 않음)', () => {
    it('저장 뒤 해외 출고지가 사라지면 ADDRESSBOOK_NOT_FOUND, 해외가 아니게 되면 ADDRESS_NOT_OVERSEAS', async () => {
      const k = await createKit();
      await k.service.replace(validProfileInput());
      const shipping = k.prisma.commerceAddressbook.rows.find(
        (r) => r.id === PROFILE_SEED_IDS.overseasAddressbookId,
      )!;
      shipping.removedAt = new Date('2026-09-29T00:10:00Z');
      expect((await k.service.getCurrent()).addressWarnings).toEqual([
        {
          field: 'overseasShippingCommerceAddressbookId',
          code: 'ADDRESSBOOK_NOT_FOUND',
          message: expect.any(String) as unknown,
        },
      ]);
      shipping.removedAt = null;
      shipping.isOverseas = false;
      expect((await k.service.getCurrent()).addressWarnings).toMatchObject([
        { field: 'overseasShippingCommerceAddressbookId', code: 'ADDRESS_NOT_OVERSEAS' },
      ]);
    });
  });

  describe('registrationFragment(규칙 8)', () => {
    it('저장한 프로필의 주소록 번호(숫자)와 반품 택배사 코드로 조각을 만든다', async () => {
      const k = await createKit();
      await k.service.replace(validProfileInput());
      const fragment = await k.service.registrationFragment();
      expect(fragment.deliveryInfo.claimDeliveryInfo.shippingAddressId).toBe(100000001);
      expect(fragment.deliveryInfo.claimDeliveryInfo.returnAddressId).toBe(100000002);
      expect(fragment.unconfirmedFields.returnDeliveryCompanyCode).toBe('CJGLS');
    });
  });
});

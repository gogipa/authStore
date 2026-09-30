import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DispatchDeliveryCompanySetting } from '../../../../src/modules/settings/schema/settings.types.js';

/**
 * 구매대행 프로필 fixture(P1-09). 캐시(주소록·반품 택배사)는 동기화를 돌리지 않고 이 파일로 직접 시드한다.
 * 비어 있는 표(TRUNCATE … RESTART IDENTITY)에 순서대로 넣으면 id가 1·2·3이 된다(valid-input.json이 이 id를 쓴다).
 */
const DIR = import.meta.dirname;

function read<T>(name: string): T {
  return JSON.parse(readFileSync(join(DIR, name), 'utf8')) as T;
}

/** PUT 본문(12개 키, 자리표시자 값). 부를 때마다 새 사본 */
export interface ProfileInputBody {
  overseasShippingCommerceAddressbookId: number | null;
  returnCommerceAddressbookId: number | null;
  dispatchDeliveryCompanyCode: string | null;
  commerceReturnDeliveryCompanyId: number | null;
  returnFeeKrw: number | null;
  exchangeFeeKrw: number | null;
  businessName: string | null;
  afterServicePhone: string | null;
  afterServiceGuide: string | null;
  importer: string | null;
  noticeFixedTexts: Record<string, string>;
  maxPurchaseQuantityPerOrder: number;
}

export function validProfileInput(): ProfileInputBody {
  return read<ProfileInputBody>('valid-input.json');
}

interface AddressbookSeed {
  addressBookNo: string;
  name: string;
  addressType: string | null;
  isOverseas: boolean;
  addressSummary: string | null;
  syncedAt: string;
  removedAt: string | null;
}

interface ReturnCompanySeed {
  code: string;
  name: string;
  syncedAt: string;
  removedAt: string | null;
}

/** 시드 id(빈 표에 넣은 순서) */
export const PROFILE_SEED_IDS = {
  /** 해외(overseasAddress=true) */
  overseasAddressbookId: 1,
  /** 국내 반품지 */
  domesticAddressbookId: 2,
  /** 최신 동기화에서 사라진 해외 주소 */
  removedAddressbookId: 3,
  returnCompanyId: 1,
  otherReturnCompanyId: 2,
  removedReturnCompanyId: 3,
} as const;

/** 설정 파일에 끼울 발송 택배사 목록(가짜 코드 2개와 출처) */
export function dispatchCompaniesFixture(): DispatchDeliveryCompanySetting[] {
  return read<{ delivery: { dispatchCompanies: DispatchDeliveryCompanySetting[] } }>(
    'settings-dispatch-companies.json',
  ).delivery.dispatchCompanies;
}

/** Prisma(또는 단위 테스트의 FakeMetaPrisma)에서 시드에 쓰는 부분 */
export interface ProfileSeedDb {
  commerceAddressbook: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  commerceReturnDeliveryCompany: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

/** 주소록 3행(해외·국내·사라진 해외)과 반품 택배사 3행(둘은 살아 있고 하나는 사라짐)을 넣는다 */
export async function seedProfileCaches(db: ProfileSeedDb): Promise<void> {
  for (const row of read<AddressbookSeed[]>('addressbooks-seed.json')) {
    await db.commerceAddressbook.create({
      data: {
        ...row,
        raw: { fixture: true },
        syncedAt: new Date(row.syncedAt),
        removedAt: row.removedAt ? new Date(row.removedAt) : null,
      },
    });
  }
  for (const row of read<ReturnCompanySeed[]>('return-delivery-companies-seed.json')) {
    await db.commerceReturnDeliveryCompany.create({
      data: {
        ...row,
        syncedAt: new Date(row.syncedAt),
        removedAt: row.removedAt ? new Date(row.removedAt) : null,
      },
    });
  }
}

/** e2e 정리 표(삭제 금지 트리거가 있어 TRUNCATE … RESTART IDENTITY CASCADE) */
export const PROFILE_TABLES = [
  'purchase_agency_profile',
  'commerce_addressbook',
  'commerce_return_delivery_company',
] as const;

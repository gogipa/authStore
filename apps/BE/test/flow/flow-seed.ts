/**
 * 흐름 테스트(P5-01) 시작점: 가짜 키체인 값·설정 파일·DB 시드. `flow-app.ts`(가짜 연동 BE)와 `test/security.e2e-spec.ts`가 같이 쓴다.
 * 모두 합성 값이다(실제 키·상품·상호 아님).
 */
import { readDefaultSettingsText } from '../../src/modules/settings/defaults/default-settings.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { disclosureTemplateFixture } from '../fixtures/content/assembly/assembly-fixtures.js';
import { seedOriginAreas } from '../fixtures/content/assembly/seed-assembly.js';
import { CATEGORY_MAPPING } from '../fixtures/category/fixture-data.js';
import { seedCommerceCategories } from '../fixtures/category/seed-candidate.js';
import { seedFxRates } from '../fixtures/pricing/seed-candidate.js';
import {
  dispatchCompaniesFixture,
  seedProfileCaches,
  validProfileInput,
} from '../fixtures/settings/purchase-agency-profile/profile-fixtures.js';
import { seedUsableAiEngine } from '../support/fake-ai-engines.js';

/**
 * 가짜 키체인 값(누가 봐도 가짜 — `TEST-SECRET-`). 커머스 client_secret은 bcrypt salt 모양이어야 해서 그 모양으로 둔다.
 * 실제 키가 아니다. 흐름 테스트는 이 값들이 화면·응답·로그에 나오지 않는지도 본다
 */
export const FLOW_SECRETS = {
  COMMERCE_CLIENT_ID: 'TEST-SECRET-commerce-client-id-0001',
  COMMERCE_CLIENT_SECRET: '$2a$04$TESTSECRETCOMMERCE0001',
  RAKUTEN_APPLICATION_ID: 'TEST-SECRET-rakuten-application-id-0001',
  RAKUTEN_ACCESS_KEY: 'TEST-SECRET-rakuten-access-key-0001',
  KOREAEXIM_API_KEY: 'TEST-SECRET-koreaexim-api-key-0001',
  CUSTOMS_SERVICE_KEY: 'TEST-SECRET-customs-service-key-0001',
} as const;

/** 흐름 테스트는 테스트 DB만 쓴다(이름에 test — 06-4 TEST_DATABASE_URL 규칙). 개발 DB를 비우지 않게 먼저 본다 */
export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL이 없습니다(감독 프로세스가 TEST_DATABASE_URL을 넣는다).');
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(name)) throw new Error(`흐름 테스트는 테스트 DB만 씁니다: ${name}`);
}

/**
 * 흐름 설정 파일: 기본 템플릿 + 고지 템플릿(배송기간 10~20 — P3-04 fixture) + ④ 매핑표(P2-06 fixture) + 발송 택배사(P1-09 fixture).
 * 그 밖은 기본값(판정 유효 6시간·처음 10건 전시중지·태그 규칙 등) 그대로다
 */
export function flowSettingsText(): string {
  const settings = JSON.parse(readDefaultSettingsText()) as Record<string, Record<string, unknown>>;
  settings.notice = disclosureTemplateFixture() as unknown as Record<string, unknown>;
  settings.category = { ...settings.category, leafMapping: [...CATEGORY_MAPPING] };
  settings.delivery = { ...settings.delivery, dispatchCompanies: dispatchCompaniesFixture() };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** 테스트 DB의 모든 표(마이그레이션 기록 빼고)를 비운다 — 추가만·삭제 금지 트리거가 있어 TRUNCATE */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  if (tables) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

/**
 * 리허설 사전 점검이 끝난 상태와 같은 시작점: AI 엔진 연결 테스트 통과(CLAUDE), 메타 캐시(카테고리·원산지·주소록·반품 택배사),
 * 구매대행 프로필(수입자 포함), 환율 3종. 실제 앱에서는 오너가 SCR-11·SCR-10·SCR-13에서 채운다
 */
export async function seedStart(prisma: PrismaService): Promise<void> {
  await seedUsableAiEngine(prisma);
  await seedCommerceCategories(prisma);
  await seedOriginAreas(prisma);
  await seedProfileCaches(prisma);
  const profile = validProfileInput();
  await prisma.purchaseAgencyProfile.create({ data: { ...profile } });
  await seedFxRates(prisma);
}

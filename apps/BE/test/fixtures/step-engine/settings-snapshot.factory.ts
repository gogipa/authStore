import type { PrismaService } from '../../../src/prisma/prisma.service.js';

/**
 * 단계 실행(step_run)을 흉내 낼 때 필요한 설정 스냅샷 1행(step_run.settings_snapshot_id NOT NULL).
 * 앱이 시작할 때 만든 실제 스냅샷과 섞이지 않게 고정 해시(fixture 전용)로 한 번만 만든다.
 */
export const FIXTURE_SETTINGS_SHA256 = `${'0'.repeat(63)}1`;

export async function ensureSettingsSnapshot(prisma: PrismaService): Promise<number> {
  const row = await prisma.settingsSnapshot.upsert({
    where: { contentSha256: FIXTURE_SETTINGS_SHA256 },
    create: {
      contentSha256: FIXTURE_SETTINGS_SHA256,
      schemaVersion: '1',
      appVersion: '0.0.0-fixture',
      fileManifest: [],
      content: { schemaVersion: '1', fixture: true },
    },
    update: {},
    select: { id: true },
  });
  return row.id;
}

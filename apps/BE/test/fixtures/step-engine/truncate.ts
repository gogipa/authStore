import type { PrismaService } from '../../../src/prisma/prisma.service.js';
import { truncate } from '../../helpers/test-app.js';

/**
 * step-engine·keywords 표. 삭제 금지·추가만 트리거가 있어 deleteMany 대신 TRUNCATE … RESTART IDENTITY CASCADE로 비운다
 * (CASCADE라 이 표를 가리키는 산출물·호출 기록 표도 함께 비워진다). settings_snapshot은 앱이 시작할 때 만든 행을 쓰므로 비우지 않는다.
 */
export const STEP_ENGINE_TABLES = [
  'candidate',
  'candidate_step',
  'candidate_status_history',
  'step_run',
  'step_run_input',
  'gate_pass',
  'step_chain',
  'keyword',
  'keyword_snapshot',
  'user_action_log',
] as const;

/** 후보 e2e가 함께 쓰는 ② 스냅샷 표(URL로 만들기·표시명 fixture) */
export const SOURCING_SNAPSHOT_TABLES = [
  'rakuten_item',
  'rakuten_sku',
  'sourcing_comparison',
] as const;

export async function truncateStepEngine(prisma: PrismaService): Promise<void> {
  await truncate(prisma, [...STEP_ENGINE_TABLES, ...SOURCING_SNAPSHOT_TABLES]);
}

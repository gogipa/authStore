// 사용: node scripts/with-test-db.mjs <prisma 인자...>  (예: migrate deploy)
// TEST_DATABASE_URL을 DATABASE_URL로 넣고 prisma CLI를 부른다.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { BE_ROOT, applyTestDbEnv } = require('./test-db-env.cjs');

applyTestDbEnv();
const bin = join(BE_ROOT, 'node_modules', '.bin', 'prisma');
const result = spawnSync(bin, process.argv.slice(2), {
  cwd: BE_ROOT,
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);

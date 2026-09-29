// e2e 시작 전 한 번: 테스트 DB에 마이그레이션을 적용한다(이미 적용됐으면 그대로).
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { BE_ROOT, applyTestDbEnv } = require('../scripts/test-db-env.cjs');

module.exports = async function globalSetup() {
  applyTestDbEnv();
  execFileSync(join(BE_ROOT, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
    cwd: BE_ROOT,
    env: process.env,
    stdio: 'pipe',
  });
};

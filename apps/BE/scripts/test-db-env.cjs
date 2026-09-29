// 테스트 DB 환경 준비: apps/BE/.env를 읽고(셸 값 우선) DATABASE_URL을 TEST_DATABASE_URL로 바꾼다.
// e2e(jest setup·globalSetup)와 db:migrate:test가 같이 쓴다.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const BE_ROOT = join(__dirname, '..');

function applyTestDbEnv() {
  const envFile = join(BE_ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL이 없습니다(apps/BE/.env.example 참고).');
  // 개발 DB를 TRUNCATE하지 않도록 이름에 test가 들어간 DB만 받는다
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) throw new Error(`테스트 DB 이름에 'test'가 없습니다: ${dbName}`);
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
  return url;
}

module.exports = { BE_ROOT, applyTestDbEnv };

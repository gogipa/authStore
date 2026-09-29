// Prisma CLI 설정(Prisma 7). 접속 URL은 schema.prisma가 아니라 여기서 준다.
// .env가 있으면 읽는다. 이미 셸에 있는 값은 덮어쓰지 않는다(process.loadEnvFile 동작).
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const envFile = join(dirname(fileURLToPath(import.meta.url)), '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // generate는 접속하지 않으므로 URL이 없어도 된다. migrate·diff는 DATABASE_URL이 필요하다.
    url: process.env.DATABASE_URL ?? '',
  },
});

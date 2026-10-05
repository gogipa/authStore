import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ServeStaticModuleOptions } from '@nestjs/serve-static';
import { FE_DIST_DIR } from './paths.js';

/** 화면으로 보내지 않는 경로. /api 아래 없는 주소는 화면(index.html)이 아니라 404 봉투(ROUTE_NOT_FOUND)다 */
export const FE_STATIC_EXCLUDE: readonly string[] = ['/api/{*path}'];

/**
 * 운영에서 FE 빌드(`apps/FE/dist`)가 있으면 BE가 화면도 내보낸다(AppModule의 ServeStaticModule 옵션).
 * /api 밖 경로는 빌드 안 파일이면 그 파일, 아니면 index.html이다(SPA 대체) — 화면 주소(`/settings/ai-engine`·체험 `/demo/…`, D-31)를
 * 새로 고치거나 바로 열어도 화면이 뜬다. 개발·테스트이거나 빌드가 없으면 끈다(빈 배열).
 */
export function feStaticOptions(
  isProduction: boolean,
  distDir: string = FE_DIST_DIR,
): ServeStaticModuleOptions[] {
  return isProduction && existsSync(join(distDir, 'index.html'))
    ? [{ rootPath: distDir, exclude: [...FE_STATIC_EXCLUDE] }]
    : [];
}

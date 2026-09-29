import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BE_ROOT } from './paths.js';

function readAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(BE_ROOT, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * 앱 버전(apps/BE/package.json의 version). 외부 호출 UA(P1-01)와
 * settings_snapshot.app_version(P1-03)이 쓴다. 읽지 못하면 '0.0.0'.
 */
export const APP_VERSION = readAppVersion();

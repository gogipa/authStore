import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

/**
 * 셸 없이 `PATH`를 훑어 실행 파일 경로를 찾는다(P1-10, ai_cli_check.bin_path). `which`·셸을 부르지 않는다.
 * 상대 경로 PATH 항목(`.` 등)은 무시한다 — 작업 폴더에 따라 다른 파일을 부르지 않게.
 * Windows는 PATHEXT(.EXE·.CMD …)를 붙여 본다(M1은 macOS가 주 대상).
 */
export function locateCliBinary(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const pathValue = env.PATH ?? env.Path ?? '';
  const exts =
    platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter((e) => e.length > 0)
      : [''];
  for (const dir of pathValue.split(delimiter)) {
    if (dir.length === 0 || !isAbsolute(dir)) continue;
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`);
      if (isExecutableFile(candidate, platform)) return candidate;
    }
  }
  return null;
}

function isExecutableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== 'win32') accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

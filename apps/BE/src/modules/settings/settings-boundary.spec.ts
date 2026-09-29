import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { BE_ROOT } from '../../common/config/paths.js';

/**
 * P1-03 규칙 14: 다른 모듈은 설정 파일을 직접 읽지 않는다. `SettingsService.current()`·`currentSnapshotId()`만 쓴다.
 * settings 모듈 밖 앱 코드(src, 테스트 제외)에 설정 파일 로더·파일 이름이 나오지 않는지 글자로 본다.
 */
const SRC = join(BE_ROOT, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('설정 파일은 settings 모듈만 읽는다(규칙 14)', () => {
  const outside = sourceFiles(SRC).filter(
    (file) => !relative(SRC, file).split(sep).join('/').startsWith('modules/settings/'),
  );

  it('검사할 파일이 있다', () => {
    expect(outside.length).toBeGreaterThan(20);
  });

  it('settings 밖에서 설정 파일 로더·파일 이름·기본 템플릿을 쓰지 않는다', () => {
    const offenders = outside.filter((file) =>
      /settings-file\.loader|settings\.json|settings\.default\.json|SETTINGS_FILE_NAME|default-settings/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });
});

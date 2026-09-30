import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const MODULES_DIR = join(import.meta.dirname, '..', '..');
const ALLOWED = 'integrations/ai-engine/process/isolated-cli-runner.ts';

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('node:child_process 경계(P1-10 §5)', () => {
  it('앱 모듈(src/modules)에서 child_process를 import하는 파일은 IsolatedCliRunner 하나뿐이다', () => {
    const importers = tsFiles(MODULES_DIR)
      .filter((file) =>
        /from\s+['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]\s*\)/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(MODULES_DIR, file));
    expect(importers).toEqual([ALLOWED]);
  });

  it('CLI 설치·업데이트·전역 설정 쓰기를 하는 코드가 없다(규칙 5, F-BS-29)', () => {
    const offenders = tsFiles(join(MODULES_DIR, 'integrations', 'ai-engine')).filter((file) =>
      /npm\s+i(?:nstall)?\s+-g|claude\s+update|['"]update['"]\s*\]|\.claude\/settings\.json|~\/\.codex/.test(
        readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, ''),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

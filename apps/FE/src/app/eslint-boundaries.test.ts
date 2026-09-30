// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// 레이어 경계(03-2 §4·§5): apps/FE/eslint.config.js의 boundaries를 실제 ESLint로 검사한다.
const FE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

let eslint: ESLint;

// 첫 lintText가 설정·플러그인·파서를 읽느라 느리다(루트 `pnpm test`는 BE·FE를 함께 돌려 더 느리다).
// 준비를 여기서 한 번 해 두고 넉넉히 기다린다(각 테스트의 5초 제한에 걸리지 않게, P1-07).
beforeAll(async () => {
  eslint = new ESLint({ cwd: FE_ROOT });
  await eslint.lintText('export const warm = 1;\n', { filePath: 'src/shared/lib/warm.ts' });
}, 60_000);

async function restrictedImports(filePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(`${source}\nexport const used = x;\n`, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'no-restricted-imports')
    .map((m) => m.message);
}

describe('ESLint 레이어 경계', () => {
  it('shared → features·pages·app import는 오류다', async () => {
    expect(
      await restrictedImports('src/shared/ui/X.tsx', "import { x } from '@/features/x';"),
    ).toEqual([expect.stringContaining('shared는 app·pages·features를 import하지 않습니다')]);
    expect(
      await restrictedImports('src/shared/lib/y.ts', "import { x } from '@/app/providers';"),
    ).toHaveLength(1);
    expect(
      await restrictedImports('src/shared/api/z.ts', "import { x } from '@/pages/a/A';"),
    ).toHaveLength(1);
  });

  it('pages → 다른 pages import는 오류다', async () => {
    expect(
      await restrictedImports('src/pages/a/A.tsx', "import { x } from '@/pages/b/B';"),
    ).toEqual([expect.stringContaining('다른 화면을 import하지 않습니다')]);
    expect(
      await restrictedImports('src/pages/a/A.tsx', "import { x } from '@/app/routes';"),
    ).toHaveLength(1);
  });

  it('feature 내부 파일 직접 import는 오류이고, @/features/x(index)는 허용한다', async () => {
    expect(
      await restrictedImports('src/pages/a/A.tsx', "import { x } from '@/features/x';"),
    ).toEqual([]);
    expect(
      await restrictedImports('src/pages/a/A.tsx', "import { x } from '@/features/x/api/useX';"),
    ).toEqual([expect.stringContaining('feature 내부 파일 직접 import 금지')]);
    expect(
      await restrictedImports('src/features/a/api/y.ts', "import { x } from '@/features/b';"),
    ).toEqual([]);
    expect(
      await restrictedImports(
        'src/features/a/api/y.ts',
        "import { x } from '@/features/b/model/m';",
      ),
    ).toEqual([expect.stringContaining('다른 feature는 @/features/<이름>(index.ts)으로만')]);
  });

  it('features → app·pages import는 오류다', async () => {
    expect(
      await restrictedImports('src/features/a/api/y.ts', "import { x } from '@/pages/a/A';"),
    ).toEqual([expect.stringContaining('features는 app·pages를 import하지 않습니다')]);
  });

  it('app은 pages·features·shared를 모두 부를 수 있다', async () => {
    expect(
      await restrictedImports(
        'src/app/X.tsx',
        "import { x } from '@/features/x';\nimport { y } from '@/pages/a/A';\nimport { z } from '@/shared/ui';\nexport const all = [y, z];",
      ),
    ).toEqual([]);
  });
});

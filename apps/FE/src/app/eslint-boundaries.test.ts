// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// 레이어 경계(03-2 §4·§5): apps/FE/eslint.config.js의 boundaries를 실제 ESLint로 검사한다.
const FE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: FE_ROOT });
});

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

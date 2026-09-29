// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 공통 부품 구조 규칙(04-3 §1·§2, P1-02 규칙 1·6).
 * - 부품 하나 = 폴더 하나(`<Name>/<Name>.tsx` + `<Name>.module.css`), 밖으로는 index.ts로만 낸다.
 * - 공통 부품은 데이터를 부르지 않는다(API 클라이언트·Query를 import하지 않는다).
 * - M2 부품(Meter·Dialog)은 만들지 않는다.
 */
const UI_DIR = fileURLToPath(new URL('.', import.meta.url));

/** 04-3 §2의 M1 shared/ui 부품 + 임시 ScreenPlaceholder. Field는 안쪽 틀(밖으로 내지 않음). */
const M1_COMPONENTS = [
  'Banner',
  'Button',
  'Checkbox',
  'Chip',
  'CommandBox',
  'DataTable',
  'DefinitionList',
  'DisabledReason',
  'Disclosure',
  'FilterToggleGroup',
  'GateBadge',
  'Icon',
  'IconButton',
  'Num',
  'PageHeader',
  'Panel',
  'ProgressBar',
  'Radio',
  'ScreenPlaceholder',
  'Select',
  'StatusChip',
  'Switch',
  'Tabs',
  'TextField',
  'Textarea',
];
const INTERNAL = ['Field'];

const folders = readdirSync(UI_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function filesIn(folder: string): string[] {
  return readdirSync(join(UI_DIR, folder)).filter((name) => /\.(tsx?|css)$/.test(name));
}

describe('shared/ui 구조', () => {
  it('폴더는 M1 부품(+안쪽 틀)뿐이다. Meter·Dialog(M2)는 없다', () => {
    expect(folders).toEqual([...M1_COMPONENTS, ...INTERNAL].sort());
    expect(folders).not.toContain('Meter');
    expect(folders).not.toContain('Dialog');
  });

  it.each(M1_COMPONENTS)('%s: <Name>.tsx + <Name>.module.css가 있고 index.ts로 낸다', (name) => {
    expect(existsSync(join(UI_DIR, name, `${name}.tsx`))).toBe(true);
    expect(existsSync(join(UI_DIR, name, `${name}.module.css`))).toBe(true);
    const index = readFileSync(join(UI_DIR, 'index.ts'), 'utf8');
    expect(index).toMatch(new RegExp(`from '\\./${name}/${name}'`));
  });

  it('공통 부품은 데이터를 부르지 않는다(API 클라이언트·Query·라우터 데이터 API import 없음)', () => {
    const offenders = folders.flatMap((folder) =>
      filesIn(folder)
        .filter((file) => !file.includes('.test.'))
        .filter((file) => {
          const text = readFileSync(join(UI_DIR, folder, file), 'utf8');
          return /from ['"](@\/shared\/api\/(client|errors|events|queryClient)|@tanstack\/react-query|openapi-fetch)['"]/.test(
            text,
          );
        })
        .map((file) => `${folder}/${file}`),
    );
    expect(offenders).toEqual([]);
  });
});

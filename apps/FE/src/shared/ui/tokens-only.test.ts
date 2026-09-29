// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 공통 부품 CSS는 tokens.css 변수만 쓴다(04-3 §1, 04-2 §5). 색을 직접 적으면 안 된다.
const UI_DIR = fileURLToPath(new URL('.', import.meta.url));

function moduleCssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return moduleCssFiles(path);
    return entry.name.endsWith('.module.css') ? [path] : [];
  });
}

describe('shared/ui CSS는 토큰 변수만 쓴다', () => {
  const files = moduleCssFiles(UI_DIR);

  it('CSS Module 파일이 부품마다 있다', () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it.each(files.map((file) => [relative(UI_DIR, file), file]))(
    '%s에 16진 색·rgb()·hsl()이 없다',
    (_name, file) => {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/\brgba?\(/);
      expect(css).not.toMatch(/\bhsla?\(/);
    },
  );
});

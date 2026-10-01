// 흐름 테스트용 가짜 연동 BE(P5-01)를 TypeScript 소스 그대로 띄우는 Node 로더.
// 사용: node --import ./test/flow/register-ts.mjs test/flow/flow-app.ts
// - 상대 import의 `.js`가 없고 같은 이름의 `.ts`가 있으면 `.ts`로 바꾼다(소스가 ESM `.js` 확장자로 import한다 — tsconfig nodenext)
// - `.ts`는 TypeScript `transpileModule`로 바꾼다. Nest DI가 쓰는 데코레이터 메타데이터(emitDecoratorMetadata)를 켠다
//   (Node 내장 타입 지우기는 데코레이터를 바꾸지 못한다). e2e(ts-jest, isolatedModules)와 같은 한 파일 단위 변환이다
// - 바꾼 결과는 os.tmpdir() 아래 캐시에 둔다(앱을 다시 켤 때 빨리 뜨게). 운영 코드에는 쓰지 않는다.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const CACHE_DIR = join(tmpdir(), 'autostore-flow-ts-cache');
mkdirSync(CACHE_DIR, { recursive: true });

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2023,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  isolatedModules: true,
  esModuleInterop: true,
  inlineSourceMap: true,
  inlineSources: false,
};
const OPTIONS_KEY = `${ts.version}:${JSON.stringify(COMPILER_OPTIONS)}`;

function transpile(path) {
  const stat = statSync(path);
  const key = createHash('sha256')
    .update(`${OPTIONS_KEY}\n${path}\n${stat.mtimeMs}\n${stat.size}`)
    .digest('hex');
  const cached = join(CACHE_DIR, `${key}.js`);
  if (existsSync(cached)) return readFileSync(cached, 'utf8');
  const out = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: COMPILER_OPTIONS,
    fileName: path,
  }).outputText;
  writeFileSync(cached, out);
  return out;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../');
      if (!relative || !specifier.endsWith('.js') || !context.parentURL) throw error;
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (!existsSync(fileURLToPath(tsUrl))) throw error;
      return { url: tsUrl.href, format: 'module', shortCircuit: true };
    }
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.ts')) {
      const path = fileURLToPath(url);
      return { format: 'module', source: transpile(path), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

export const FLOW_TS_LOADER = pathToFileURL(fileURLToPath(import.meta.url)).href;

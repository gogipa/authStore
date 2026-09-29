// 디자인 토큰 → CSS 변수 생성기.
// 원본: docs/design/design-system/tokens.json (SSOT). 결과: src/shared/styles/tokens.css (생성물, 직접 고치지 않는다).
// 라이트 테마만 쓴다(D-13). 다크 값은 tokens.json에 남겨 두고 여기서는 읽지 않는다.
// 사용: pnpm --filter @autostore/fe tokens:gen          → 파일을 다시 쓴다
//       pnpm --filter @autostore/fe tokens:gen --check  → 파일이 원본과 같은지만 본다(다르면 종료 코드 1)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const THEME = 'light';
const SOURCE = new URL('../../../docs/design/design-system/tokens.json', import.meta.url);
const TARGET = new URL('../src/shared/styles/tokens.css', import.meta.url);
const REF = /^\{([a-z0-9-]+)\}$/;

// 저장소의 Prettier(lint-staged)가 다시 고치지 않도록 같은 모양으로 쓴다:
// 16진 색은 소문자, 글꼴 이름은 작은따옴표, 쉼표 뒤 한 칸.
function prettierLike(value) {
  return value
    .replace(/#[0-9a-fA-F]{3,8}\b/g, (hex) => hex.toLowerCase())
    .replace(/"([^"]*)"/g, "'$1'")
    .replace(/,(?=\S)/g, ', ');
}

/** 색 값. `{accent}` 같은 참조는 var(--color-accent)로 바꾼다. */
function colorValue(token, names) {
  const raw = token.value?.[THEME];
  if (typeof raw !== 'string') throw new Error(`색 토큰 '${token.name}'에 ${THEME} 값이 없습니다`);
  const ref = REF.exec(raw);
  if (!ref) return raw;
  if (!names.has(ref[1]))
    throw new Error(`색 토큰 '${token.name}'이 없는 토큰 '${ref[1]}'을 가리킵니다`);
  return `var(--color-${ref[1]})`;
}

function themed(token) {
  const raw = typeof token.value === 'string' ? token.value : token.value?.[THEME];
  if (typeof raw !== 'string') throw new Error(`토큰 '${token.name}'에 ${THEME} 값이 없습니다`);
  return raw;
}

export function buildCss(tokens) {
  const lines = [];
  const section = (title) => lines.push('', `  /* ${title} */`);
  const decl = (name, value, usage) =>
    lines.push(
      `  --${name}: ${prettierLike(value)};${usage ? ` /* ${usage.replace(/\*\//g, '* /')} */` : ''}`,
    );

  const colors = tokens.color.tokens;
  const colorNames = new Set(colors.map((t) => t.name));
  section('색');
  for (const t of colors) decl(`color-${t.name}`, colorValue(t, colorNames), t.usage);

  section('글꼴 묶음 (런타임 외부 호출 없음: 설치된 글꼴이 없으면 시스템 글꼴로 내려간다)');
  for (const [name, stack] of Object.entries(tokens.type.families)) decl(`font-${name}`, stack);

  section('글자 스타일: --type-<이름>은 font 단축 속성 값');
  for (const group of tokens.type.groups) {
    const family = `var(--font-${group.family})`;
    for (const s of group.styles) {
      decl(`type-${s.name}`, `${s.fontWeight} ${s.fontSize}/${s.lineHeight} ${family}`, s.usage);
      decl(`type-${s.name}-size`, s.fontSize);
      decl(`type-${s.name}-line-height`, s.lineHeight);
      decl(`type-${s.name}-weight`, String(s.fontWeight));
      if (s.letterSpacing) decl(`type-${s.name}-letter-spacing`, s.letterSpacing);
    }
  }

  section('간격 (4px 격자)');
  for (const t of tokens.spacing.tokens) decl(t.name, themed(t), t.usage);

  section('모서리');
  for (const t of tokens.radius.tokens) decl(t.name, themed(t), t.usage);

  section('그림자');
  for (const t of tokens.shadow.tokens) decl(t.name, themed(t), t.usage);

  return [
    '/*',
    ' * 생성물 — 직접 고치지 말 것.',
    ' * 원본: docs/design/design-system/tokens.json',
    ' * 다시 만들기: pnpm --filter @autostore/fe tokens:gen',
    ` * 테마: ${THEME}만 (D-13)`,
    ' */',
    ':root {',
    ...lines.slice(1),
    '}',
    '',
  ].join('\n');
}

async function main() {
  const tokens = JSON.parse(await readFile(SOURCE, 'utf8'));
  const css = buildCss(tokens);
  const target = fileURLToPath(TARGET);

  if (process.argv.includes('--check')) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== css) {
      console.error(
        `tokens.css가 tokens.json과 다릅니다. 'pnpm --filter @autostore/fe tokens:gen'을 실행하세요.`,
      );
      process.exit(1);
    }
    console.info('tokens.css가 최신입니다.');
    return;
  }

  await writeFile(target, css, 'utf8');
  const count = css.split('\n').filter((l) => l.trimStart().startsWith('--')).length;
  console.info(`tokens.css를 만들었습니다: 변수 ${count}개 → ${target}`);
}

await main();

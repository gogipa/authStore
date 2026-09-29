// 문서 원본(docs/dev/04_데이터베이스)과 앱 사본(apps/BE/prisma)이 어긋나지 않는지 검사한다.
//  1) 04-4_V1__init.sql ↔ prisma/migrations/20260927000000_v1_init/migration.sql : 바이트 그대로
//  2) 04-3_schema.prisma ↔ prisma/schema.prisma : generator client 블록의 허용 키(output)만 다를 수 있다
// 사용: pnpm --filter @autostore/be db:check-sync   (어긋나면 exit 1)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const BE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(BE_ROOT, '..', '..');
const DOC_DIR = join(REPO_ROOT, 'docs', 'dev', '04_데이터베이스');

/** 앱 사본에서 달라도 되는 generator 키(빌드에 필요한 차이). 06-2 §4에 적었다 */
const ALLOWED_GENERATOR_KEYS = new Set(['output']);

const pairs = {
  sql: {
    doc: join(DOC_DIR, '04-4_V1__init.sql'),
    app: join(BE_ROOT, 'prisma', 'migrations', '20260927000000_v1_init', 'migration.sql'),
  },
  prisma: {
    doc: join(DOC_DIR, '04-3_schema.prisma'),
    app: join(BE_ROOT, 'prisma', 'schema.prisma'),
  },
};

const rel = (p) => relative(REPO_ROOT, p);
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
const problems = [];

// 1) SQL: 바이트 그대로
{
  const doc = readFileSync(pairs.sql.doc);
  const app = readFileSync(pairs.sql.app);
  if (!doc.equals(app)) {
    problems.push(
      `${rel(pairs.sql.app)}가 ${rel(pairs.sql.doc)}와 다릅니다(sha256 ${sha(app)} ≠ ${sha(doc)}).`,
    );
  } else {
    console.log(`OK  SQL 동일: ${rel(pairs.sql.app)} (${doc.length} bytes, sha256 ${sha(doc)})`);
  }
}

// 2) Prisma: generator client 블록 밖은 그대로, 블록 안은 허용 키만 다를 수 있다
const GENERATOR_RE = /generator\s+client\s*\{([^}]*)\}/;
function splitSchema(text, file) {
  const m = GENERATOR_RE.exec(text);
  if (!m) throw new Error(`${rel(file)}: generator client 블록이 없습니다.`);
  const entries = new Map();
  for (const line of m[1].split('\n')) {
    const kv = /^\s*(\w+)\s*=\s*(.+?)\s*$/.exec(line);
    if (kv) entries.set(kv[1], kv[2]);
  }
  return {
    rest: text.slice(0, m.index) + '<<generator>>' + text.slice(m.index + m[0].length),
    entries,
  };
}
{
  const docText = readFileSync(pairs.prisma.doc, 'utf8');
  const appText = readFileSync(pairs.prisma.app, 'utf8');
  const doc = splitSchema(docText, pairs.prisma.doc);
  const app = splitSchema(appText, pairs.prisma.app);
  if (doc.rest !== app.rest) {
    const a = doc.rest.split('\n');
    const b = app.rest.split('\n');
    const n = Math.max(a.length, b.length);
    let shown = 0;
    for (let i = 0; i < n && shown < 5; i += 1) {
      if (a[i] !== b[i]) {
        problems.push(
          `schema.prisma ${i + 1}행 다름\n  문서: ${a[i] ?? '(없음)'}\n  사본: ${b[i] ?? '(없음)'}`,
        );
        shown += 1;
      }
    }
  }
  const keys = new Set([...doc.entries.keys(), ...app.entries.keys()]);
  const allowedDiffs = [];
  for (const k of keys) {
    if (doc.entries.get(k) === app.entries.get(k)) continue;
    if (ALLOWED_GENERATOR_KEYS.has(k)) {
      allowedDiffs.push(
        `${k}: ${doc.entries.get(k) ?? '(없음)'} → ${app.entries.get(k) ?? '(없음)'}`,
      );
    } else {
      problems.push(
        `generator client.${k}가 다릅니다(허용 차이 아님): 문서 ${doc.entries.get(k) ?? '(없음)'} / 사본 ${app.entries.get(k) ?? '(없음)'}`,
      );
    }
  }
  if (doc.rest === app.rest) {
    console.log(`OK  Prisma 스키마 동일(generator 블록 밖 ${docText.split('\n').length}행)`);
  }
  for (const d of allowedDiffs) console.log(`    허용 차이 generator client.${d}`);
}

if (problems.length > 0) {
  console.error(`\n어긋남 ${problems.length}건:`);
  for (const p of problems) console.error(`- ${p}`);
  console.error(
    '\n문서를 고쳤다면 사본에 다시 복사하고, 사본을 고쳤다면 문서에도 반영하세요(06-2 §4).',
  );
  process.exit(1);
}
console.log('db:check-sync 통과');

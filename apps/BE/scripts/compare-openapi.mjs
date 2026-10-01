// 명세 대조(P5-01): 05-2(설계 원본, OpenAPI 3.1)의 M1 연산과 구현 명세(dist/openapi.impl.json, OpenAPI 3.0)를 비교한다.
// 사용: pnpm --filter @autostore/be openapi:compare  (= openapi:export 뒤 이 스크립트)
//   node scripts/compare-openapi.mjs [--json <파일>]
// 보는 것: 경로·메서드, operationId, 파라미터(이름·위치·필수), 요청 본문(유무·필수·필드), 응답 상태 코드,
//          성공 응답 스키마(필드·필수·nullable·기본 타입 — 중첩까지).
// 3.0·3.1 표기 차이는 같은 것으로 본다: nullable ↔ type:[x,'null'] ↔ oneOf/anyOf [X, null] ↔ allOf:[X]+nullable,
//   exclusiveMaximum(숫자 ↔ 불리언), const ↔ enum 한 값, $ref 이름(Dto 접미사 등)은 비교하지 않는다.
// 남긴 차이는 docs/dev/05_API/05-4_구현대조.md '남긴 차이' 표에 키와 이유가 있어야 한다(없으면 exit 1).
// 표에만 있고 실제로는 없어진 차이도 exit 1이다(문서가 낡지 않게).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const BE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(BE_ROOT, '..', '..');
const SPEC_FILE = join(REPO_ROOT, 'docs', 'dev', '05_API', '05-2_openapi.yaml');
const IMPL_FILE = join(BE_ROOT, 'dist', 'openapi.impl.json');
const ALLOW_FILE = join(REPO_ROOT, 'docs', 'dev', '05_API', '05-4_구현대조.md');
const API_PREFIX = '/api/v1';
const METHODS = ['get', 'put', 'post', 'delete', 'patch'];
/** 오류 응답(4xx·5xx)은 모두 05-3 공통 봉투(ErrorResponse)라 상태 코드만 본다 */
const isErrorStatus = (code) => /^[45]\d\d$/.test(code);

export function loadDocs() {
  const spec = YAML.parse(readFileSync(SPEC_FILE, 'utf8'));
  const impl = JSON.parse(readFileSync(IMPL_FILE, 'utf8'));
  return { spec, impl };
}

function operationsOf(doc, { stripPrefix }) {
  const ops = [];
  for (const [rawPath, item] of Object.entries(doc.paths ?? {})) {
    const path =
      stripPrefix && rawPath.startsWith(API_PREFIX) ? rawPath.slice(API_PREFIX.length) : rawPath;
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      ops.push({ path, method, op, shared: item.parameters ?? [] });
    }
  }
  return ops;
}

function resolver(doc) {
  const resolve = (node) => {
    let cur = node;
    const seen = new Set();
    while (cur && typeof cur === 'object' && typeof cur.$ref === 'string') {
      if (seen.has(cur.$ref)) break;
      seen.add(cur.$ref);
      const parts = cur.$ref.replace(/^#\//, '').split('/');
      let target = doc;
      for (const p of parts) target = target?.[p.replace(/~1/g, '/').replace(/~0/g, '~')];
      // $ref 옆의 description 등은 버린다(3.1은 형제 키를 허용하지만 뜻은 같다)
      cur = target;
    }
    return cur;
  };
  return resolve;
}

const isNullSchema = (s) => s && typeof s === 'object' && (s.type === 'null' || s.const === null);

/**
 * 스키마를 비교용 모양으로 바꾼다: { kind, nullable, type, properties, required, items, additional, variants }
 * kind: object | array | scalar | union | any
 */
function normalize(schema, resolve, depth = 0) {
  if (depth > 40) return { kind: 'any', nullable: false };
  let s = resolve(schema);
  if (!s || typeof s !== 'object' || Object.keys(s).length === 0)
    return { kind: 'any', nullable: false };
  let nullable = s.nullable === true;
  // 3.1 type 배열
  let type = s.type;
  if (Array.isArray(type)) {
    if (type.includes('null')) nullable = true;
    const rest = type.filter((t) => t !== 'null');
    if (rest.length > 1) {
      // type: [array, object] 같은 여러 타입 → 갈래마다 하나인 union(3.0은 oneOf로 쓴다)
      return {
        kind: 'union',
        nullable,
        variants: rest.map((t) => normalize({ ...s, type: t }, resolve, depth + 1)),
      };
    }
    type = rest.length === 1 ? rest[0] : undefined;
  }
  // oneOf/anyOf: [X, null] → X + nullable
  for (const key of ['oneOf', 'anyOf']) {
    const alts = s[key];
    if (!Array.isArray(alts)) continue;
    if (alts.some((a) => isNullSchema(resolve(a)))) nullable = true;
    const nonNull = alts.filter((a) => !isNullSchema(resolve(a)) && !isM2(a, resolve));
    if (nonNull.length === 1) {
      const inner = normalize(nonNull[0], resolve, depth + 1);
      return mergeSiblings(inner, s, resolve, depth, nullable);
    }
    if (nonNull.length > 1) {
      return {
        kind: 'union',
        nullable,
        variants: nonNull.map((a) => normalize(a, resolve, depth + 1)),
      };
    }
  }
  // allOf: [X] (+ nullable) 또는 여러 조각 합치기
  if (Array.isArray(s.allOf)) {
    const parts = s.allOf.map((a) => normalize(a, resolve, depth + 1));
    const merged = parts.reduce((acc, p) => mergeShapes(acc, p), null) ?? {
      kind: 'any',
      nullable: false,
    };
    return mergeSiblings(merged, s, resolve, depth, nullable || merged.nullable);
  }
  if (type === 'array' || s.items) {
    return { kind: 'array', nullable, items: normalize(s.items ?? {}, resolve, depth + 1) };
  }
  if (type === 'object' || s.properties || s.additionalProperties) {
    return objectShape(s, resolve, depth, nullable);
  }
  if (type === undefined && (s.enum || s.const !== undefined)) {
    const vals = s.enum ?? [s.const];
    const t = typeof vals.find((v) => v !== null);
    if (vals.includes(null)) nullable = true;
    return { kind: 'scalar', nullable, type: t === 'number' ? 'number' : t };
  }
  if (type === undefined) return { kind: 'any', nullable };
  return { kind: 'scalar', nullable, type: Array.isArray(type) ? type.join('|') : type };
}

/** 05-2가 M2로 표시한 조각(속성·oneOf 갈래)은 M1 구현에 없어도 된다 */
const isM2 = (raw, resolve) =>
  raw?.['x-milestone'] === 'M2' || resolve(raw)?.['x-milestone'] === 'M2';

function objectShape(s, resolve, depth, nullable) {
  const properties = {};
  const m2 = [];
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    if (isM2(v, resolve)) {
      m2.push(k);
      continue;
    }
    properties[k] = normalize(v, resolve, depth + 1);
  }
  const additional =
    s.additionalProperties && typeof s.additionalProperties === 'object'
      ? normalize(s.additionalProperties, resolve, depth + 1)
      : null;
  return {
    kind: 'object',
    nullable,
    properties,
    required: [...new Set(s.required ?? [])].filter((k) => !m2.includes(k)).sort(),
    additional,
    m2,
  };
}

function mergeSiblings(inner, s, resolve, depth, nullable) {
  // allOf/oneOf 옆에 properties가 붙은 경우(드묾)
  let out = { ...inner, nullable: nullable || inner.nullable };
  if (s.properties) out = mergeShapes(out, objectShape(s, resolve, depth, false));
  return out;
}

function mergeShapes(a, b) {
  if (!a) return b;
  if (a.kind === 'object' && b.kind === 'object') {
    return {
      kind: 'object',
      nullable: a.nullable || b.nullable,
      properties: { ...a.properties, ...b.properties },
      required: [...new Set([...a.required, ...b.required])].sort(),
      additional: a.additional ?? b.additional,
      m2: [...(a.m2 ?? []), ...(b.m2 ?? [])],
    };
  }
  return b.kind === 'any' ? a : b;
}

function mergeVariants(variants, nullable) {
  const properties = {};
  for (const v of variants) Object.assign(properties, v.properties);
  const required = variants
    .map((v) => v.required)
    .reduce((acc, r) => acc.filter((k) => r.includes(k)));
  return {
    kind: 'object',
    nullable,
    properties,
    required,
    additional: null,
    m2: variants.flatMap((v) => v.m2 ?? []),
    merged: true,
  };
}

const sameScalar = (a, b) =>
  a === b || (a === 'integer' && b === 'number') || (a === 'number' && b === 'integer');

/** 두 모양을 비교해 차이 [{ where, kind, spec, impl }]를 모은다 */
function compareShapes(spec, impl, where, out, depth = 0) {
  if (depth > 30) return;
  // 명세가 모양을 정하지 않은 자유 JSON({})이면 구현 표기는 보지 않는다
  if (spec.kind === 'any') return;
  if (impl.kind === 'any') {
    out.push({ where, kind: 'shape', spec: spec.kind, impl: impl.kind });
    return;
  }
  if (spec.nullable !== impl.nullable)
    out.push({ where, kind: 'nullable', spec: spec.nullable, impl: impl.nullable });
  if (
    spec.kind === 'union' &&
    impl.kind === 'object' &&
    spec.variants.every((v) => v.kind === 'object')
  ) {
    // 판별자(oneOf)로 나뉜 요청 본문을 구현은 한 DTO(+서비스 검사)로 받는다:
    // 필드 = 갈래 필드의 합집합, 구현 필수 ⊆ 모든 갈래가 필수인 필드
    compareShapes(mergeVariants(spec.variants, spec.nullable), impl, where, out, depth + 1);
    return;
  }
  if (spec.kind !== impl.kind) {
    out.push({ where, kind: 'shape', spec: spec.kind, impl: impl.kind });
    return;
  }
  if (spec.kind === 'scalar') {
    if (!sameScalar(spec.type, impl.type))
      out.push({ where, kind: 'type', spec: spec.type, impl: impl.type });
    return;
  }
  if (spec.kind === 'array') {
    compareShapes(spec.items, impl.items, `${where}[]`, out, depth + 1);
    return;
  }
  if (spec.kind === 'union') {
    if (spec.variants.length !== impl.variants.length)
      out.push({ where, kind: 'variants', spec: spec.variants.length, impl: impl.variants.length });
    return;
  }
  // object
  const sp = Object.keys(spec.properties);
  const ip = Object.keys(impl.properties);
  for (const k of sp)
    if (!ip.includes(k))
      out.push({
        where: `${where}.${k}`,
        // 명세가 선택으로 둔 칸을 구현이 쓰지 않으면(응답에서는 보내지 않으면) 호환이다 — 결함은 필수 칸 누락
        kind: spec.required.includes(k) ? 'field-missing' : 'optional-field-missing',
      });
  for (const k of ip)
    if (!sp.includes(k) && !(spec.m2 ?? []).includes(k))
      out.push({ where: `${where}.${k}`, kind: 'field-extra' });
  for (const k of spec.required)
    if (!impl.required.includes(k) && ip.includes(k))
      out.push({ where: `${where}.${k}`, kind: 'required-missing' });
  for (const k of impl.required)
    if (!spec.required.includes(k) && sp.includes(k))
      out.push({ where: `${where}.${k}`, kind: 'required-extra' });
  for (const k of sp)
    if (ip.includes(k))
      compareShapes(spec.properties[k], impl.properties[k], `${where}.${k}`, out, depth + 1);
  if (spec.additional || impl.additional) {
    if (!spec.additional || !impl.additional)
      out.push({
        where: `${where}{*}`,
        kind: 'additional',
        spec: Boolean(spec.additional),
        impl: Boolean(impl.additional),
      });
    else compareShapes(spec.additional, impl.additional, `${where}{*}`, out, depth + 1);
  }
}

/**
 * 응답에서 계약을 깨지 않는 차이(호환, 세지 않음):
 * - required-extra: 명세가 선택으로 둔 칸을 구현은 늘 보낸다(값이 null이어도 키는 있다)
 * - optional-field-missing: 명세의 선택 칸을 구현이 보내지 않는다(예 설정 오류의 rejectedValue — P1-03 결정)
 */
const COMPATIBLE_IN_RESPONSE = new Set(['required-extra', 'optional-field-missing']);

const templateOf = (path) => path.replace(/\{[^}]+\}/g, '{}');
const pathParamNames = (path) => [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);

function paramsOf(entry, resolve) {
  // 05-2가 M2로 표시한 파라미터(예 listCommerceCategories q)는 M1 구현에 없다(M1은 422)
  const list = [...entry.shared, ...(entry.op.parameters ?? [])]
    .map((p) => resolve(p))
    .filter((p) => p['x-milestone'] !== 'M2');
  const map = new Map();
  for (const p of list) map.set(`${p.in}:${p.name.toLowerCase()}`, p);
  return map;
}

function jsonContent(content) {
  if (!content) return null;
  const key = Object.keys(content).find((k) => k.includes('json')) ?? Object.keys(content)[0];
  return key ? { type: key, schema: content[key].schema } : null;
}

/** 연산 한 쌍 비교 → 차이 목록. 차이 키 = `<operationId> <영역> <위치> <종류>` */
function compareOperation(s, i, specResolve, implResolve) {
  const diffs = [];
  const id = s.op.operationId;
  // severity: defect(결함 — 고치거나 05-4에 이유) | compatible(호환 — 구현이 늘 보내는 키를 명세는 선택으로 둠, 세지 않음)
  const add = (area, where, kind, detail = '', severity = 'defect') =>
    diffs.push({ key: `${id} ${area} ${where} ${kind}`.trim(), detail, severity });

  if (s.method !== i.method) add('method', '-', 'mismatch', `${s.method} ≠ ${i.method}`);
  if (templateOf(s.path) !== templateOf(i.path))
    add('path', '-', 'mismatch', `${s.path} ≠ ${i.path}`);
  const sNames = pathParamNames(s.path);
  const iNames = pathParamNames(i.path);
  sNames.forEach((n, idx) => {
    if (iNames[idx] !== n) add('path', `{${n}}`, 'name', `구현 {${iNames[idx] ?? '-'}}`);
  });

  // 파라미터(path·query·header): 이름·위치·필수
  const sp = paramsOf(s, specResolve);
  const ip = paramsOf(i, implResolve);
  for (const [k, p] of sp) {
    const q = ip.get(k);
    if (!q) {
      add('param', k, 'missing');
      continue;
    }
    if (Boolean(p.required) !== Boolean(q.required))
      add('param', k, 'required', `명세 ${Boolean(p.required)} · 구현 ${Boolean(q.required)}`);
  }
  for (const k of ip.keys()) if (!sp.has(k)) add('param', k, 'extra');

  // 요청 본문
  const sb = specResolve(s.op.requestBody);
  const ib = implResolve(i.op.requestBody);
  if (Boolean(sb) !== Boolean(ib)) add('body', '-', sb ? 'missing' : 'extra');
  else if (sb && ib) {
    if (Boolean(sb.required) !== Boolean(ib.required))
      add('body', '-', 'required', `명세 ${Boolean(sb.required)} · 구현 ${Boolean(ib.required)}`);
    // 본문 형식(content type)마다 비교한다(예: 경쟁 태그 입력 = JSON 글 + multipart 파일)
    const sTypes = Object.keys(sb.content ?? {});
    const iTypes = Object.keys(ib.content ?? {});
    for (const t of sTypes) if (!iTypes.includes(t)) add('body', t, 'content-type-missing');
    for (const t of iTypes) if (!sTypes.includes(t)) add('body', t, 'content-type-extra');
    for (const t of sTypes) {
      if (!iTypes.includes(t)) continue;
      const out = [];
      compareShapes(
        normalize(sb.content[t].schema, specResolve),
        normalize(ib.content[t].schema, implResolve),
        sTypes.length > 1 ? `body(${t.split('/')[1]})` : 'body',
        out,
      );
      for (const d of out) add('body', d.where, d.kind, detailOf(d));
    }
  }

  // 응답 상태 코드
  const sr = s.op.responses ?? {};
  const ir = i.op.responses ?? {};
  for (const code of Object.keys(sr)) if (!(code in ir)) add('response', code, 'missing');
  for (const code of Object.keys(ir)) if (!(code in sr)) add('response', code, 'extra');

  // 성공 응답 스키마
  for (const code of Object.keys(sr)) {
    if (!(code in ir) || isErrorStatus(code)) continue;
    const sc = jsonContent(specResolve(sr[code]).content);
    const ic = jsonContent(implResolve(ir[code]).content);
    if (!sc && !ic) continue;
    if (!sc || !ic) {
      add('response', code, sc ? 'schema-missing' : 'schema-extra');
      continue;
    }
    if (sc.type !== ic.type) add('response', code, 'content-type', `${sc.type} ≠ ${ic.type}`);
    if (sc.type.startsWith('text/event-stream')) continue; // SSE 본문은 이벤트 이름별 oneOf — 05-2가 원본(구현은 문자열)
    const out = [];
    compareShapes(normalize(sc.schema, specResolve), normalize(ic.schema, implResolve), code, out);
    for (const d of out)
      add(
        'response',
        d.where,
        d.kind,
        detailOf(d),
        COMPATIBLE_IN_RESPONSE.has(d.kind) ? 'compatible' : 'defect',
      );
  }
  return diffs;
}

function detailOf(d) {
  if (d.spec === undefined && d.impl === undefined) return '';
  return `명세 ${d.spec} · 구현 ${d.impl}`;
}

/** 05-4 '남긴 차이' 표: 첫 칸이 `차이 키`(백틱), 이유 칸이 비어 있지 않은 줄 */
export function readAllowed(file = ALLOW_FILE) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return new Map();
  }
  const allowed = new Map();
  const start = text.indexOf('<!-- compare-openapi:allow:start -->');
  const end = text.indexOf('<!-- compare-openapi:allow:end -->');
  if (start < 0 || end < 0) return allowed;
  for (const line of text.slice(start, end).split('\n')) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const reason = m[2].split('|').pop().trim();
    allowed.set(m[1].trim(), reason);
  }
  return allowed;
}

export function compareSpecs({ spec, impl }) {
  const specResolve = resolver(spec);
  const implResolve = resolver(impl);
  const m1 = operationsOf(spec, { stripPrefix: false }).filter((o) => o.op['x-milestone'] === 'M1');
  const implOps = operationsOf(impl, { stripPrefix: true });
  const implById = new Map(implOps.map((o) => [o.op.operationId, o]));
  const m1Ids = new Set(m1.map((o) => o.op.operationId));
  const rows = [];
  const all = [];
  for (const s of m1) {
    const i = implById.get(s.op.operationId);
    if (!i) {
      const key = `${s.op.operationId} operation - missing`;
      all.push({ key, detail: `${s.method.toUpperCase()} ${s.path}`, severity: 'defect' });
      rows.push({
        id: s.op.operationId,
        method: s.method,
        path: s.path,
        paired: false,
        defects: 1,
        compatible: 0,
      });
      continue;
    }
    const d = compareOperation(s, i, specResolve, implResolve);
    all.push(...d);
    rows.push({
      id: s.op.operationId,
      method: s.method,
      path: s.path,
      paired: true,
      defects: d.filter((x) => x.severity === 'defect').length,
      compatible: d.filter((x) => x.severity === 'compatible').length,
    });
  }
  for (const i of implOps) {
    if (m1Ids.has(i.op.operationId)) continue;
    all.push({
      key: `${i.op.operationId ?? `${i.method}:${i.path}`} operation - extra`,
      detail: `${i.method.toUpperCase()} ${i.path}(05-2 M1 연산 아님)`,
      severity: 'defect',
    });
  }
  return {
    rows,
    diffs: all.filter((d) => d.severity === 'defect'),
    compatible: all.filter((d) => d.severity === 'compatible'),
    m1Count: m1.length,
    implCount: implOps.length,
  };
}

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const verbose = args.includes('--verbose');
  const result = compareSpecs(loadDocs());
  const allowed = readAllowed();
  const unexplained = result.diffs.filter((d) => !allowed.get(d.key));
  const seen = new Set(result.diffs.map((d) => d.key));
  const stale = [...allowed.keys()].filter((k) => !seen.has(k));
  const paired = result.rows.filter((r) => r.paired).length;

  const out = [];
  out.push(
    `05-2 M1 연산 ${result.m1Count}개 · 구현 연산 ${result.implCount}개 · 짝지음 ${paired}개`,
  );
  out.push('');
  out.push('| operationId | 메서드 | 경로 | 짝 | 차이 | 호환 |');
  out.push('|---|---|---|---|---|---|');
  for (const r of result.rows)
    out.push(
      `| ${r.id} | ${r.method.toUpperCase()} | ${r.path} | ${r.paired ? '○' : '×'} | ${r.defects} | ${r.compatible} |`,
    );
  out.push('');
  out.push(
    `차이 ${result.diffs.length}건(남긴 차이 ${result.diffs.length - unexplained.length}건 · 이유 없음 ${unexplained.length}건), 호환 ${result.compatible.length}건(세지 않음)`,
  );
  for (const d of result.diffs) {
    const mark = allowed.get(d.key) ? '남김' : '결함';
    out.push(`- [${mark}] ${d.key}${d.detail ? ` — ${d.detail}` : ''}`);
  }
  if (verbose)
    for (const d of result.compatible)
      out.push(`- [호환] ${d.key}${d.detail ? ` — ${d.detail}` : ''}`);
  if (stale.length) {
    out.push('');
    out.push(`05-4에만 있고 지금은 없는 차이 ${stale.length}건(표에서 지운다):`);
    for (const k of stale) out.push(`- ${k}`);
  }
  process.stdout.write(`${out.join('\n')}\n`);
  if (jsonOut)
    writeFileSync(jsonOut, `${JSON.stringify({ ...result, unexplained, stale }, null, 2)}\n`);
  if (unexplained.length > 0 || stale.length > 0 || paired !== result.m1Count) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

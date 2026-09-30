import type { Prisma } from '../../../../generated/prisma/client.js';
import { canonicalMetaJson, type MetaDocument } from '../mappers/meta-document.js';
import type { MetaDb } from './meta-target-syncer.js';

/** 자연키 캐시 표 공통 조작(Prisma 위임 객체에서 여기서 쓰는 부분만) */
interface KeyedDelegate {
  findMany(args: unknown): Promise<Record<string, unknown>[]>;
  createMany(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<unknown>;
}

export interface KeyedSyncResult {
  created: number;
  updated: number;
  restored: number;
  removed: number;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return canonicalMetaJson(a) === canonicalMetaJson(b);
}

/**
 * 자연키 upsert + 사라진 행 표시(규칙 3, ERD §1.3). `id`를 바꾸지 않는다(프로필 FK, P1-09).
 * 1. 새 키 → 넣는다  2. 값이 바뀐 행 → 고친다  3. 이번 응답에 있는 키 → `synced_at=now`, `removed_at=null`(다시 나타남)
 * 4. 이번 응답에 없는 키 → `removed_at=now`(지우지 않는다. 이미 표시된 행은 그대로)
 */
export async function syncKeyedRows<R extends object>(
  delegate: unknown,
  keyField: keyof R & string,
  valueFields: readonly (keyof R & string)[],
  input: readonly R[],
  now: Date,
): Promise<KeyedSyncResult> {
  const table = delegate as KeyedDelegate;
  const rows = input as readonly Record<string, unknown>[];
  const select: Record<string, true> = { id: true, [keyField]: true, removedAt: true };
  for (const f of valueFields) select[f] = true;
  const existing = await table.findMany({ select });
  const byKey = new Map(existing.map((row) => [String(row[keyField]), row]));

  const keys = rows.map((r) => String(r[keyField]));
  const keySet = new Set(keys);
  const toCreate = rows.filter((r) => !byKey.has(String(r[keyField])));
  if (toCreate.length > 0) {
    await table.createMany({
      data: toCreate.map((r) => ({ ...r, syncedAt: now, removedAt: null })),
    });
  }

  let updated = 0;
  let restored = 0;
  for (const row of rows) {
    const current = byKey.get(String(row[keyField]));
    if (!current) continue;
    if (current.removedAt !== null && current.removedAt !== undefined) restored += 1;
    const changed: Record<string, unknown> = {};
    for (const f of valueFields) {
      if (!sameValue(current[f] ?? null, row[f] ?? null)) changed[f] = row[f];
    }
    if (Object.keys(changed).length === 0) continue;
    await table.update({ where: { [keyField]: row[keyField] }, data: changed });
    updated += 1;
  }

  if (keys.length > 0) {
    await table.updateMany({
      where: { [keyField]: { in: keys } },
      data: { syncedAt: now, removedAt: null },
    });
  }
  const gone = existing.filter(
    (row) => !keySet.has(String(row[keyField])) && (row.removedAt ?? null) === null,
  );
  if (gone.length > 0) {
    await table.updateMany({
      where: { [keyField]: { in: gone.map((row) => row[keyField]) }, removedAt: null },
      data: { removedAt: now },
    });
  }
  return { created: toCreate.length, updated, restored, removed: gone.length };
}

/** 문서형 캐시: (kind, scope_key) 1행을 덮어쓴다(규칙 3) */
export async function upsertMetaDocument(tx: MetaDb, doc: MetaDocument, now: Date): Promise<void> {
  const payload = doc.payload as Prisma.InputJsonValue;
  await tx.commerceMetaDocument.upsert({
    where: { kind_scopeKey: { kind: doc.kind, scopeKey: doc.scopeKey } },
    create: {
      kind: doc.kind,
      scopeKey: doc.scopeKey,
      payload,
      payloadSha256: doc.payloadSha256,
      syncedAt: now,
    },
    update: { payload, payloadSha256: doc.payloadSha256, syncedAt: now },
  });
}

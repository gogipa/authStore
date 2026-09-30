import { FakeMetaPrisma } from '../../../../../test/helpers/fake-prisma.js';
import { metaFixtureBody } from '../../../../../test/support/fake-commerce-meta.js';
import { mapCategories } from '../mappers/category.mapper.js';
import { toMetaDocument } from '../mappers/meta-document.js';
import { mapReturnDeliveryCompanies } from '../mappers/return-delivery-company.mapper.js';
import { syncKeyedRows, upsertMetaDocument } from './cache-writes.js';
import { categorySyncer } from './category.syncer.js';
import type { MetaDb } from './meta-target-syncer.js';

const T1 = new Date('2026-09-28T00:10:00Z');
const T2 = new Date('2026-09-29T00:10:00Z');
const T3 = new Date('2026-09-30T00:10:00Z');

describe('캐시 쓰기(규칙 3): 자연키 upsert + removed_at, 문서 덮어쓰기', () => {
  let prisma: FakeMetaPrisma;
  const tx = () => prisma as unknown as MetaDb;
  const byKey = () =>
    new Map(prisma.commerceCategory.rows.map((r) => [r.categoryId as string, { ...r }]));

  beforeEach(() => {
    prisma = new FakeMetaPrisma();
  });

  it('categories-last → v2: 빠진 행 removed_at 채움·id 그대로·새 행 추가·바뀐 이름 고침. 다시 v1이면 removed_at=null', async () => {
    const v1 = mapCategories(metaFixtureBody('categories-last'));
    const v2 = mapCategories(metaFixtureBody('categories-last-v2'));

    expect(await categorySyncer.apply(tx(), v1, T1)).toBe(8);
    const first = byKey();
    expect(first.size).toBe(8);
    expect([...first.values()].every((r) => r.removedAt === null && r.syncedAt === T1)).toBe(true);

    await categorySyncer.apply(tx(), v2, T2);
    const second = byKey();
    expect(second.size).toBe(9);
    // 사라진 로퍼: 지우지 않고 removed_at, synced_at은 마지막으로 본 때 그대로
    expect(second.get('50000793')).toMatchObject({
      id: first.get('50000793')!.id,
      removedAt: T2,
      syncedAt: T1,
    });
    // 새 보트슈즈
    expect(second.get('50000795')).toMatchObject({ removedAt: null, syncedAt: T2 });
    // 남은 행은 id 그대로, 이름이 바뀐 행은 고친다
    for (const [key, row] of first) {
      expect(second.get(key)!.id).toBe(row.id);
    }
    expect(second.get('50000802')).toMatchObject({
      name: '플랫 슈즈',
      wholeCategoryName: '패션잡화>여성신발>단화>플랫 슈즈',
      syncedAt: T2,
    });

    await categorySyncer.apply(tx(), v1, T3);
    const third = byKey();
    expect(third.get('50000793')).toMatchObject({
      id: first.get('50000793')!.id,
      removedAt: null,
      syncedAt: T3,
    });
    expect(third.get('50000795')).toMatchObject({ removedAt: T3 });
    expect(third.get('50000802')!.name).toBe('플랫슈즈');
  });

  it('이미 사라진 행은 다시 사라져도 removed_at을 옮기지 않는다', async () => {
    const rows = mapReturnDeliveryCompanies(metaFixtureBody('return-delivery-companies'));
    const table = prisma.commerceReturnDeliveryCompany;
    await syncKeyedRows(table, 'code', ['name'], rows, T1);
    const r1 = await syncKeyedRows(table, 'code', ['name'], rows.slice(1), T2);
    expect(r1).toEqual({ created: 0, updated: 0, restored: 0, removed: 1 });
    const r2 = await syncKeyedRows(table, 'code', ['name'], rows.slice(1), T3);
    expect(r2.removed).toBe(0);
    expect(table.rows.find((r) => r.code === 'CJGLS')!.removedAt).toBe(T2);
    const r3 = await syncKeyedRows(table, 'code', ['name'], rows, T3);
    expect(r3).toMatchObject({ restored: 1, removed: 0 });
  });

  it('문서: 같은 payload 두 번 → 행 1개·sha 같음. 다른 payload → 덮어씀·sha 바뀜(소문자 hex 64자)', async () => {
    const payload = metaFixtureBody('provided-notice-shoes');
    await upsertMetaDocument(tx(), toMetaDocument('PROVIDED_NOTICE', 'SHOES', payload), T1);
    await upsertMetaDocument(
      tx(),
      toMetaDocument('PROVIDED_NOTICE', 'SHOES', JSON.parse(JSON.stringify(payload))),
      T2,
    );
    const docs = prisma.commerceMetaDocument.rows;
    expect(docs).toHaveLength(1);
    const sha1 = docs[0]!.payloadSha256 as string;
    expect(sha1).toMatch(/^[0-9a-f]{64}$/);
    expect(docs[0]!.syncedAt).toBe(T2);

    await upsertMetaDocument(
      tx(),
      toMetaDocument('PROVIDED_NOTICE', 'SHOES', { ...(payload as object), changed: true }),
      T3,
    );
    expect(prisma.commerceMetaDocument.rows).toHaveLength(1);
    const after = prisma.commerceMetaDocument.rows[0]!;
    expect(after.payloadSha256).not.toBe(sha1);
    expect(after.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((after.payload as { changed: boolean }).changed).toBe(true);

    // 다른 (kind, scope)는 다른 행
    await upsertMetaDocument(tx(), toMetaDocument('STANDARD_OPTIONS', '50000791', {}), T3);
    expect(prisma.commerceMetaDocument.rows).toHaveLength(2);
  });
});

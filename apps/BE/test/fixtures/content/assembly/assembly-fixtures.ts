import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssemblyFacts } from '../../../../src/modules/content/assembly/assembly-facts.js';
import type { CopyDraft } from '../../../../src/modules/content/copy/copy.schema.js';
import type { PurchaseAgencyProfileValues } from '../../../../src/modules/settings/purchase-agency-profile/profile-values.js';
import type { NoticeSettings } from '../../../../src/modules/settings/schema/settings.types.js';

/**
 * ⑥-3 fixture(P3-04 §5.3). 모두 합성 값이다(화면시안_명세 §4 후보 A). 단위 테스트(순수 조립)와 e2e(시드)가 같이 쓴다.
 * `_note` 칸은 설명이라 읽을 때 뺀다.
 */
export const ASSEMBLY_FIXTURE_DIR = import.meta.dirname;

function read<T>(name: string): T {
  const value = JSON.parse(readFileSync(join(ASSEMBLY_FIXTURE_DIR, name), 'utf8')) as Record<
    string,
    unknown
  >;
  delete value._note;
  return value as T;
}

export type ProfileFixtureName = 'profile-complete' | 'profile-missing-importer';
export type FactsFixtureName = 'facts-leather' | 'facts-textile-no-lining' | 'facts-multi-origin';

export function profileFixture(name: ProfileFixtureName): PurchaseAgencyProfileValues {
  return read<PurchaseAgencyProfileValues>(`${name}.json`);
}

export function factsFixture(name: FactsFixtureName): AssemblyFacts {
  return read<AssemblyFacts>(`${name}.json`);
}

export function saleSizesFixture(name: 'sale-sizes-gapped' | 'sale-sizes-contiguous'): number[] {
  return read<{ saleSizesMm: number[] }>(`${name}.json`).saleSizesMm;
}

export function copyFixture(): CopyDraft {
  return read<CopyDraft>('copy.json');
}

export interface OriginAreaFixtureRow {
  originAreaCode: string;
  name: string;
  parentCode: string | null;
}

export function originAreasFixture(): OriginAreaFixtureRow[] {
  return read<{ rows: OriginAreaFixtureRow[] }>('origin-areas.json').rows;
}

export function parallelItemFixture(): {
  itemName: string;
  modelCode: string;
  attributes: unknown[];
} {
  return read('rakuten-item-parallel.json');
}

/** 설정 notice 섹션(배송기간 10~20 채움) */
export function disclosureTemplateFixture(): NoticeSettings {
  return read<NoticeSettings>('disclosure-template.json');
}

export function expectedDetailHtml(): string {
  return readFileSync(join(ASSEMBLY_FIXTURE_DIR, 'expected', 'detail.html'), 'utf8').trim();
}

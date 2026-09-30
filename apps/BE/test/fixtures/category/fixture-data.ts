import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CategoryLeaf } from '../../../src/modules/category/rules/category-options.js';
import type { CategoryLeafMapping } from '../../../src/modules/settings/schema/settings.types.js';

/**
 * ④ 카테고리 fixture 값(P2-06 §5, 합성 — 커머스API를 부르지 않는다). 단위 테스트(순수 규칙)와 e2e(seed-candidate.ts)가 같이 쓴다.
 * - `commerce-categories.json`: 남성·여성 신발 리프(러닝화·워킹화·스니커즈), KC_CERTIFICATION 리프(남성 워킹화),
 *   CHILD_CERTIFICATION 리프(남성 트레이닝화), 아동 경로 리프(남성 주니어러닝화·여성 키즈운동화), CON-08 제외 품목 리프
 *   (남성 바퀴운동화), 사라진 리프(`removed`), 신발 경로 밖 리프(여성가방)
 * - `mapping.json`: 설정 `category.leafMapping` — 러닝화 장르(208025) → 남성 2개(러닝화·KC 워킹화)·여성 2개 + 거를 리프
 *   (아동·사라짐·신발 밖), 스니커즈 장르(208026) → 성별마다 스니커즈 1개(후보 하나 — 자동 완료)
 */

const DIR = import.meta.dirname;

interface CategoryFixtureRow {
  categoryId: string;
  name: string;
  wholeCategoryName: string;
  exceptionalCategories: string[];
  removed: boolean;
}

export const CATEGORY_FIXTURE: readonly CategoryFixtureRow[] = JSON.parse(
  readFileSync(join(DIR, 'commerce-categories.json'), 'utf8'),
) as CategoryFixtureRow[];

const MAPPING = JSON.parse(readFileSync(join(DIR, 'mapping.json'), 'utf8')) as {
  runningGenreId: number;
  sneakerGenreId: number;
  leafMapping: CategoryLeafMapping[];
};

/** 러닝화 장르 id(매핑표 → 남성 2개·여성 2개) */
export const RUNNING_GENRE_ID = MAPPING.runningGenreId;
/** 스니커즈 장르 id(매핑표 → 성별마다 1개 — 자동 완료) */
export const SNEAKER_GENRE_ID = MAPPING.sneakerGenreId;
/** 매핑표(설정 `category.leafMapping`) */
export const CATEGORY_MAPPING: readonly CategoryLeafMapping[] = MAPPING.leafMapping;

/** fixture 리프 id(이름으로 찾기 쉽게) */
export const LEAF = {
  MALE_RUNNING: '50000830',
  MALE_WALKING_KC: '50000831',
  MALE_SNEAKERS: '50000832',
  FEMALE_RUNNING: '50000840',
  FEMALE_WALKING: '50000841',
  FEMALE_SNEAKERS: '50000842',
  MALE_JUNIOR_CHILD_PATH: '50000850',
  FEMALE_KIDS_CHILD_PATH: '50000851',
  MALE_CHILD_CERTIFICATION: '50000860',
  MALE_WHEELED_EXCLUDED: '50000870',
  MALE_REMOVED: '50000880',
  NOT_SHOE: '50000990',
} as const;

/** 수집 시각(합성) */
export const SYNCED_AT = new Date('2026-09-28T00:00:00Z');

/** 순수 규칙 입력(`CategoryLeaf`)으로 */
export function fixtureLeaves(): CategoryLeaf[] {
  return CATEGORY_FIXTURE.map((row) => ({
    categoryId: row.categoryId,
    name: row.name,
    wholeCategoryName: row.wholeCategoryName,
    exceptionalCategories: row.exceptionalCategories,
    removedAt: row.removed ? SYNCED_AT : null,
  }));
}

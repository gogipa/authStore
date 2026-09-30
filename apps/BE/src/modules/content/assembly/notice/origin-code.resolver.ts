import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../../common/errors/api.exception.js';
import { CommerceMetaCacheService } from '../../../integrations/commerce-meta/commerce-meta-cache.service.js';
import type {
  MultiOriginMode,
  OriginCountryEntry,
} from '../../../settings/schema/settings.types.js';
import { countryOfArea } from '../../facts/fact-values.js';
import { compareKey } from '../../facts/fact-text.js';

/**
 * 원산지 코드(P3-04 규칙 7~9, F-CT-25~27, PRD §8.5 원산지 코드 규칙, ERD `content_draft_assembly.origin_area_*`).
 * - 나라(⑥-2 한국어 이름) → 나라 사전(설정 `content.originCountries`, P3-03과 공유)의 '대륙 > 국가' → 원산지 캐시
 *   (`commerce_origin_area`, P1-08 동기화 — integrations `CommerceMetaCacheService`로만 읽는다)에서 **수입산 02 계열** 코드
 *   (`02` 뒤에 숫자가 더 붙은 하위 코드)를 찾아 복사한다. 코드·id를 코드에 박지 않는다
 * - 여러 나라(F-CT-26, M0 S3 전 설정 스위치 `content.multiOriginMode`): FIRST_COUNTRY_PLURAL(기본) = 첫 나라 코드 +
 *   `plural=true`, CODE_03_CONTENT = `03` + `origin_area_content`(사양 블록 제조국 표기). 사양 블록에는 '입고 시기에 따라 다름'
 * - `03`(상세설명에 표시)·`04`(직접 입력)는 오너가 owner-edits로 고를 때만(+ 위 스위치). 사양 블록 제조국 표기에 실제 나라가
 *   있어야 하고, 없으면 422 ORIGIN_CODE_NOT_ALLOWED. 이때 `origin_area_content`가 필수다(`ck_cda_origin_detail`)
 */

/** 여러 나라 사양 블록 덧말(F-CT-26) */
export const MULTI_ORIGIN_NOTE = '입고 시기에 따라 다름';

export interface OriginAreaRow {
  originAreaCode: string;
  name: string;
}

/** 원산지 캐시 찾기(나라 또는 '대륙 > 국가' → 사라지지 않은 행) */
export type OriginAreaLookup = (area: string) => Promise<OriginAreaRow[]>;

/** 정한 원산지 칸(`content_draft_assembly.origin_area_*` + 사양 블록 표기) */
export interface OriginAreaPlan {
  code: string;
  plural: boolean;
  content: string | null;
  /** 화면 표시용 코드 이름(캐시 `name`, 예 `아시아>베트남`). 03·04면 null */
  name: string | null;
  /** 사양 블록 제조국 표기(`spec_origin_label`) */
  specOriginLabel: string;
  countries: string[];
}

/** 사양 블록 제조국 표기: 한 나라 `베트남`, 여러 나라 `베트남·인도네시아·중국(입고 시기에 따라 다름)` */
export function specOriginLabelOf(countries: readonly string[]): string {
  if (countries.length <= 1) return countries[0] ?? '';
  return `${countries.join('·')}(${MULTI_ORIGIN_NOTE})`;
}

/** 나라(한국어 이름) → 사전의 '대륙 > 국가'(없으면 나라 그대로) */
export function areaOfCountry(country: string, dictionary: readonly OriginCountryEntry[]): string {
  const key = compareKey(country);
  const entry = dictionary.find(
    (e) => compareKey(countryOfArea(e.area)) === key || compareKey(e.area) === key,
  );
  return entry?.area ?? country;
}

/** 수입산 02 계열 하위 코드인가(`02` 뒤에 숫자) */
export function isImportAreaCode(code: string): boolean {
  return /^02\d+$/.test(code);
}

/** 상세 표기 코드(`03` 상세설명에 표시·`04` 직접 입력)인가 — `ck_cda_origin_detail`과 같은 모양 */
export function isDetailAreaCode(code: string): boolean {
  return /^0[34]/.test(code);
}

/** 캐시 행 가운데 수입산 02 계열 첫 코드(코드 오름차순) */
export function importAreaOf(rows: readonly OriginAreaRow[]): OriginAreaRow | null {
  return (
    [...rows]
      .filter((row) => isImportAreaCode(row.originAreaCode))
      .sort((a, b) => a.originAreaCode.localeCompare(b.originAreaCode))[0] ?? null
  );
}

/**
 * 나라 목록 → 원산지 칸(규칙 7·8). 어느 나라의 02 계열 코드를 캐시에서 못 찾으면 `{ ok: false, country }`(⑥-3 실패 —
 * 메타 동기화가 필요하다). 나라가 없으면 `{ ok: false, country: null }`(⑥-2 원산지가 먼저 막으므로 보통 오지 않는다)
 */
export async function planOriginArea(
  countries: readonly string[],
  settings: { originCountries: readonly OriginCountryEntry[]; multiOriginMode: MultiOriginMode },
  lookup: OriginAreaLookup,
): Promise<{ ok: true; plan: OriginAreaPlan } | { ok: false; country: string | null }> {
  if (countries.length === 0) return { ok: false, country: null };
  const found: OriginAreaRow[] = [];
  for (const country of countries) {
    const row = importAreaOf(await lookup(areaOfCountry(country, settings.originCountries)));
    if (!row) return { ok: false, country };
    found.push(row);
  }
  const label = specOriginLabelOf(countries);
  if (countries.length > 1 && settings.multiOriginMode === 'CODE_03_CONTENT') {
    return {
      ok: true,
      plan: {
        code: '03',
        plural: false,
        content: label,
        name: null,
        specOriginLabel: label,
        countries: [...countries],
      },
    };
  }
  return {
    ok: true,
    plan: {
      code: found[0]!.originAreaCode,
      plural: countries.length > 1,
      content: null,
      name: found[0]!.name,
      specOriginLabel: label,
      countries: [...countries],
    },
  };
}

/**
 * 사양 블록 제조국 표기에 실제 나라가 있는가(규칙 9, RG-08 '03·04이면 실제 국가 표기'): 나라 사전의 나라 이름(한국어)·원문 표기
 * 가운데 하나가 들어 있으면 참(NFKC·대문자·공백 무시)
 */
export function hasActualCountry(
  label: string,
  dictionary: readonly OriginCountryEntry[],
): boolean {
  const key = compareKey(label);
  if (key === '') return false;
  return dictionary.some((entry) => {
    const names = [countryOfArea(entry.area), entry.raw];
    return names.some((name) => {
      const k = compareKey(name);
      return k !== '' && key.includes(k);
    });
  });
}

/** 오너 원산지 코드 고르기 값(`notice.origin_area` EDIT — Proposed 모양): 코드 글자 또는 `{code, content?, plural?}` */
export interface OriginAreaChoice {
  code: string;
  content: string | null;
  plural: boolean | null;
}

/** EDIT 값 모양 검사(어긋나면 null) */
export function parseOriginAreaChoice(value: unknown): OriginAreaChoice | null {
  if (typeof value === 'string') {
    const code = value.trim();
    return /^\d{2,20}$/.test(code) ? { code, content: null, plural: null } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => k !== 'code' && k !== 'content' && k !== 'plural')) return null;
  if (typeof v.code !== 'string' || !/^\d{2,20}$/.test(v.code.trim())) return null;
  if (v.content !== undefined && v.content !== null) {
    if (typeof v.content !== 'string' || v.content.trim().length > 200) return null;
  }
  if (v.plural !== undefined && v.plural !== null && typeof v.plural !== 'boolean') return null;
  return {
    code: v.code.trim(),
    content: typeof v.content === 'string' && v.content.trim() !== '' ? v.content.trim() : null,
    plural: typeof v.plural === 'boolean' ? v.plural : null,
  };
}

/**
 * 오너가 고른 원산지 코드 → 저장할 칸(규칙 9). 순서: 국산(`00`) 422 VALIDATION_FAILED → 03·04인데 사양 블록에 실제 나라 없음 422
 * ORIGIN_CODE_NOT_ALLOWED → 02 계열인데 캐시에 없음 422 VALIDATION_FAILED. 03·04의 상세 표기는 오너 값, 없으면 사양 블록 표기
 */
export async function resolveOwnerOriginArea(
  choice: OriginAreaChoice,
  context: {
    field: string;
    specOriginLabel: string;
    countries: readonly string[];
    dictionary: readonly OriginCountryEntry[];
    findCode: (code: string) => Promise<OriginAreaRow | null>;
  },
): Promise<Pick<OriginAreaPlan, 'code' | 'plural' | 'content' | 'name'>> {
  if (isDetailAreaCode(choice.code)) {
    if (!hasActualCountry(context.specOriginLabel, context.dictionary)) {
      throw new ApiException('ORIGIN_CODE_NOT_ALLOWED', {
        details: { code: choice.code, specOriginLabel: context.specOriginLabel },
      });
    }
    return {
      code: choice.code,
      plural: false,
      content: (choice.content ?? context.specOriginLabel).slice(0, 200),
      name: null,
    };
  }
  if (!isImportAreaCode(choice.code)) {
    throw new ApiException('VALIDATION_FAILED', {
      fieldErrors: [
        {
          field: context.field,
          message: '수입 상품은 수입산(02 계열)·03·04 원산지 코드만 쓸 수 있습니다.',
          rejectedValue: choice.code,
        },
      ],
    });
  }
  const row = await context.findCode(choice.code);
  if (!row) {
    throw new ApiException('VALIDATION_FAILED', {
      fieldErrors: [
        {
          field: context.field,
          message: '원산지 코드 목록(메타 동기화)에 없는 코드입니다.',
          rejectedValue: choice.code,
        },
      ],
    });
  }
  return {
    code: row.originAreaCode,
    plural: choice.plural ?? context.countries.length > 1,
    content: null,
    name: row.name,
  };
}

/** 원산지 캐시 읽기(integrations 창구 — 사라진 행은 빼고) */
@Injectable()
export class OriginCodeResolver {
  constructor(private readonly meta: CommerceMetaCacheService) {}

  readonly lookup: OriginAreaLookup = async (area) =>
    (await this.meta.findOriginAreasByCountry(area)).map((row) => ({
      originAreaCode: row.originAreaCode,
      name: row.name,
    }));

  async findCode(code: string): Promise<OriginAreaRow | null> {
    const row = await this.meta.findOriginArea(code);
    return row && row.removedAt === null
      ? { originAreaCode: row.originAreaCode, name: row.name }
      : null;
  }

  /** 코드 이름(화면 표시 — 사라진 행도) */
  async nameOf(code: string): Promise<string | null> {
    return (await this.meta.findOriginArea(code))?.name ?? null;
  }
}

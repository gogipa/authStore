import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { CommerceMetaCacheService } from '../../integrations/commerce-meta/commerce-meta-cache.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { splitCountries } from './fact-text.js';
import { countryFromDictionary, countryOfArea } from './fact-values.js';

/** 근거 URL 모양(http·https, 2048자 이하). 아니면 null */
export function evidenceUrlOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (url === '' || url.length > 2048) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * 오너가 넣은 원산지 나라 이름 검사(P3-03 규칙 12·13, 05-2 putContentFieldInput): 원산지 나라 사전(설정 `content.originCountries`
 * — 원문·'대륙 > 국가'·한국어 나라 이름) 또는 커머스API 원산지 캐시(`commerce_origin_area`의 마지막 '>' 조각)에 있는 나라만 받는다.
 * 여러 나라는 `、`·`,`·`/`·`・`로 나눈다. 값은 한국어 나라 이름 배열로 저장한다.
 */
@Injectable()
export class OriginInputResolver {
  constructor(
    private readonly settings: SettingsService,
    private readonly cache: CommerceMetaCacheService,
  ) {}

  /** 형식이 틀리면 422 VALIDATION_FAILED(field), 모르는 나라면 422 ORIGIN_COUNTRY_UNKNOWN(details.country) */
  async resolve(value: unknown, field: string): Promise<string[]> {
    if (typeof value !== 'string' || value.trim() === '' || value.trim().length > 100) {
      throw new ApiException('VALIDATION_FAILED', {
        fieldErrors: [
          { field, message: '원산지는 나라 이름(100자 이하)이어야 합니다.', rejectedValue: value },
        ],
      });
    }
    const dictionary = this.settings.currentOrNull()?.content.originCountries ?? [];
    const countries: string[] = [];
    for (const token of splitCountries(value)) {
      let country = countryFromDictionary(token, dictionary);
      if (!country) {
        const [row] = await this.cache.findOriginAreasByCountry(token);
        country = row ? countryOfArea(row.name) : null;
      }
      if (!country) {
        throw new ApiException('ORIGIN_COUNTRY_UNKNOWN', { details: { country: token } });
      }
      if (!countries.includes(country)) countries.push(country);
    }
    if (countries.length === 0) {
      throw new ApiException('ORIGIN_COUNTRY_UNKNOWN', { details: { country: value.trim() } });
    }
    return countries;
  }
}

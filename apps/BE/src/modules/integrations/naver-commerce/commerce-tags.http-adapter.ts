import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { CLOCK, type Clock } from '../http/clock.token.js';
import { EXTERNAL_TARGETS } from '../http/external-targets.js';
import { CommerceApiClient } from './commerce-api.client.js';
import {
  COMMERCE_RECOMMEND_TAGS_PATH,
  COMMERCE_RESTRICTED_TAGS_PATH,
  type CommerceTagsCallContext,
  type CommerceTagsPort,
  type RecommendedTag,
  type RestrictedTagVerdict,
} from './commerce-tags.port.js';

/** 추천 태그 캐시에 둘 키워드 수 상한(메모리) — 넘으면 가장 오래된 것부터 버린다 */
const RECOMMEND_CACHE_MAX_ENTRIES = 500;
/** 태그 글자 상한(tag_candidate.text varchar(100)) */
const TAG_TEXT_MAX = 100;
/** 태그 코드 상한(tag_candidate.code varchar(20), 숫자만) */
const TAG_CODE_PATTERN = /^[0-9]{1,20}$/;

/** 캐시 키: NFKC·앞뒤 공백·연속 공백·영문 소문자 */
export function recommendCacheKey(keyword: string): string {
  return keyword.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * JSON 원문을 읽되 `code` 숫자는 원문 글자 그대로 둔다(int64 정밀도 — Node 24 `JSON.parse` reviver의 `context.source`).
 * 읽을 수 없으면 undefined
 */
export function parseTagsJson(body: Buffer): unknown {
  if (body.length === 0) return undefined;
  try {
    const reviver = (key: string, value: unknown, context?: { source?: string }) =>
      key === 'code' && typeof value === 'number' && typeof context?.source === 'string'
        ? context.source
        : value;
    return JSON.parse(body.toString('utf8'), reviver) as unknown;
  } catch {
    return undefined;
  }
}

/** 응답 본문의 목록(배열, 또는 `{ tags | contents | data: [...] }` — M0 S3 전 모양 가정)을 꺼낸다 */
function listOf(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data as unknown[];
  if (data && typeof data === 'object') {
    for (const key of ['tags', 'contents', 'data', 'items']) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as unknown[];
    }
  }
  return null;
}

/** 추천 응답 → `{code, text}`(모양이 다른 원소·100자 넘는 글·숫자가 아닌 코드는 뺀다). 목록이 아니면 null */
export function toRecommendedTags(data: unknown): RecommendedTag[] | null {
  const list = listOf(data);
  if (!list) return null;
  const out: RecommendedTag[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    const rawCode = record.code;
    const code =
      typeof rawCode === 'string' ? rawCode : typeof rawCode === 'number' ? String(rawCode) : '';
    if (text.length === 0 || text.length > TAG_TEXT_MAX || !TAG_CODE_PATTERN.test(code)) continue;
    out.push({ code, text });
  }
  return out;
}

/** 제한 태그 응답 → `{tag, restricted}`. 목록이 아니면 null */
export function toRestrictedVerdicts(data: unknown): RestrictedTagVerdict[] | null {
  const list = listOf(data);
  if (!list) return null;
  const out: RestrictedTagVerdict[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.tag !== 'string' || typeof record.restricted !== 'boolean') continue;
    out.push({ tag: record.tag, restricted: record.restricted });
  }
  return out;
}

function commerceApiError(reason: string, label: string, httpStatus: number | null): ApiException {
  return new ApiException('EXTERNAL_API_ERROR', {
    message: formatErrorMessage('EXTERNAL_API_ERROR', {
      대상: EXTERNAL_TARGETS.COMMERCE_API.label,
      사유: label,
    }),
    details: { target: 'COMMERCE_API', reason, httpStatus },
  });
}

interface CacheEntry {
  expiresAt: number;
  tags: RecommendedTag[];
}

/**
 * 커머스API 태그 어댑터(P3-05, `COMMERCE_TAGS_PORT`). 추천 응답 메모리 캐시(TTL은 호출자가 준다)를 integrations가 가진다
 * (외부 응답 캐시는 integrations 소유 — ERD 결정 ⑭). 테스트는 가짜 커머스 서버를 HTTP_FETCH 뒤에 둔다(실제 관문·call_log를 지난다).
 */
@Injectable()
export class CommerceTagsHttpAdapter implements CommerceTagsPort {
  private readonly logger = new Logger(CommerceTagsHttpAdapter.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly client: CommerceApiClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async recommendTags(
    keyword: string,
    options: CommerceTagsCallContext & { cacheTtlMs: number },
  ): Promise<RecommendedTag[]> {
    const key = recommendCacheKey(keyword);
    if (key.length === 0) return [];
    const now = this.clock.now().getTime();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now && options.cacheTtlMs > 0) {
      return cached.tags.map((tag) => ({ ...tag }));
    }
    const res = await this.client.request('GET', COMMERCE_RECOMMEND_TAGS_PATH, {
      query: { keyword: keyword.trim() },
      candidateId: options.candidateId ?? null,
      stepRunId: options.stepRunId ?? null,
    });
    let tags: RecommendedTag[];
    if (res.status === 400) {
      // 키워드를 받지 않음(빈 값·형식) — 그 키워드의 추천은 없다고 본다(Proposed)
      this.logger.warn(`추천 태그: 키워드를 받지 않았습니다(HTTP 400, ${res.error?.code ?? '-'})`);
      tags = [];
    } else if (!res.ok) {
      throw commerceApiError(`HTTP_${res.status}`, `HTTP ${res.status}`, res.status);
    } else {
      const parsed = toRecommendedTags(parseTagsJson(res.body));
      if (parsed === null) throw commerceApiError('INVALID_RESPONSE', '응답 모양이 다름', 200);
      tags = parsed;
    }
    if (options.cacheTtlMs > 0) {
      this.cache.delete(key);
      this.cache.set(key, { expiresAt: now + options.cacheTtlMs, tags });
      while (this.cache.size > RECOMMEND_CACHE_MAX_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    }
    return tags.map((tag) => ({ ...tag }));
  }

  async restrictedTags(
    tags: readonly string[],
    context: CommerceTagsCallContext = {},
  ): Promise<RestrictedTagVerdict[]> {
    if (tags.length === 0) return [];
    const res = await this.client.request('GET', COMMERCE_RESTRICTED_TAGS_PATH, {
      query: { tags: [...tags] },
      candidateId: context.candidateId ?? null,
      stepRunId: context.stepRunId ?? null,
    });
    if (!res.ok) throw commerceApiError(`HTTP_${res.status}`, `HTTP ${res.status}`, res.status);
    const verdicts = toRestrictedVerdicts(parseTagsJson(res.body));
    if (verdicts === null) throw commerceApiError('INVALID_RESPONSE', '응답 모양이 다름', 200);
    return verdicts;
  }

  /** 캐시 비우기(테스트·설정 변경용) */
  clearCache(): void {
    this.cache.clear();
  }
}

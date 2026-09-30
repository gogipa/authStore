import { Inject, Injectable } from '@nestjs/common';
import { SECRET_STORE, type SecretStore } from '../../../common/secrets/secret-store.port.js';
import { SettingsService } from '../../settings/settings.service.js';
import { CLOCK, type Clock } from '../http/clock.token.js';
import { ExternalHttpGateway } from '../http/external-http.gateway.js';
import { callRakutenApi, invalidRakutenResponse } from './rakuten-api.caller.js';
import { readRakutenKeys } from './rakuten-keys.js';
import { RakutenSearchCacheRepository } from './rakuten-search-cache.repository.js';
import type {
  RakutenApiCallContext,
  RakutenSearchItem,
  RakutenSearchPort,
  RakutenSearchQuery,
  RakutenSearchResult,
} from './rakuten-search.port.js';
import {
  buildRakutenApiUrl,
  buildRakutenSearchParams,
  paramsWithoutSecrets,
  parseSearchResponse,
  rakutenSearchQueryHash,
  toSearchItem,
} from './rakuten-search.request.js';

const HOUR_MS = 3_600_000;

function itemsOf(raw: readonly unknown[]): RakutenSearchItem[] {
  return raw.map(toSearchItem).filter((item): item is RakutenSearchItem => item !== null);
}

/**
 * Item Search 어댑터(F-BS-34, P2-02 규칙 1·2). 순서: 요청 파라미터 → 캐시(6시간) → 키(키체인) → 관문 RAKUTEN_API
 * (429·503 백오프 최대 3회) → 200이면 캐시 저장. '다시 실행'도 같은 캐시를 쓴다.
 */
@Injectable()
export class RakutenSearchHttpAdapter implements RakutenSearchPort {
  constructor(
    private readonly gateway: ExternalHttpGateway,
    private readonly settings: SettingsService,
    private readonly cache: RakutenSearchCacheRepository,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async search(
    query: RakutenSearchQuery,
    ctx: RakutenApiCallContext = {},
  ): Promise<RakutenSearchResult> {
    const { sourcing } = this.settings.current();
    const params = buildRakutenSearchParams(query, sourcing);
    const queryHash = rakutenSearchQueryHash(params);
    const page = Number(params.page);
    const cached = await this.cache.findFresh(queryHash, this.clock.now());
    if (cached) {
      const raw = Array.isArray(cached.responseItems) ? (cached.responseItems as unknown[]) : [];
      return {
        items: itemsOf(raw),
        page,
        totalCount: null,
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        queryHash,
      };
    }

    const keys = await readRakutenKeys(this.secrets);
    const url = buildRakutenApiUrl(sourcing.rakutenApi.itemSearchUrl, keys, params);
    const bodyText = await callRakutenApi(
      this.gateway,
      this.clock,
      url,
      {
        maxRetries: sourcing.rakutenApi.maxRetries,
        countItems: (text) => parseSearchResponse(text)?.items.length ?? null,
      },
      ctx,
    );
    const parsed = parseSearchResponse(bodyText);
    if (!parsed) throw invalidRakutenResponse();
    const fetchedAt = this.clock.now();
    await this.cache.upsert({
      queryHash,
      keyword: params.keyword ?? null,
      genreId: params.genreId ? Number(params.genreId) : null,
      page,
      requestParams: paramsWithoutSecrets(params),
      responseItems: parsed.items,
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + sourcing.rakutenApi.searchCacheHours * HOUR_MS),
    });
    return {
      items: itemsOf(parsed.items),
      page,
      totalCount: parsed.totalCount,
      fetchedAt,
      fromCache: false,
      queryHash,
    };
  }
}

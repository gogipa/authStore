import { Inject, Injectable } from '@nestjs/common';
import { SECRET_STORE, type SecretStore } from '../../../common/secrets/secret-store.port.js';
import { SettingsService } from '../../settings/settings.service.js';
import { CLOCK, type Clock } from '../http/clock.token.js';
import { ExternalHttpGateway } from '../http/external-http.gateway.js';
import { RakutenApiError } from './rakuten-api-error.mapper.js';
import { callRakutenApi, invalidRakutenResponse } from './rakuten-api.caller.js';
import type {
  RakutenGenreLookup,
  RakutenGenreNode,
  RakutenGenrePort,
} from './rakuten-genre.port.js';
import { readRakutenKeys } from './rakuten-keys.js';
import type { RakutenApiCallContext } from './rakuten-search.port.js';
import { buildRakutenApiUrl } from './rakuten-search.request.js';

function toNode(value: unknown): RakutenGenreNode | null {
  if (!value || typeof value !== 'object') return null;
  // formatVersion=1은 { parent: {...} }·{ child: {...} }로 감싼다. 감싼 것도 받는다
  const v = value as Record<string, unknown>;
  const inner = (v.parent ?? v.child ?? v.current ?? v) as Record<string, unknown>;
  const genreId = Number(inner.genreId);
  const genreLevel = Number(inner.genreLevel);
  const genreName = typeof inner.genreName === 'string' ? inner.genreName : '';
  if (!Number.isInteger(genreId) || genreId <= 0 || genreName === '') return null;
  return {
    genreId,
    genreName,
    genreLevel: Number.isInteger(genreLevel) && genreLevel >= 1 ? genreLevel : 1,
  };
}

/**
 * IchibaGenre 응답(JSON)을 읽는다(순수 함수). 모양: `{ current: {genreId, genreName, genreLevel}, parents: [...],
 * children: [...] }`(formatVersion=2 — M0 S2에서 확정). current가 없으면 null(없는 장르). 부모는 레벨 순으로 둔다.
 */
export function parseGenreResponse(bodyText: string): RakutenGenreLookup | null | 'INVALID' {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return 'INVALID';
  }
  if (!parsed || typeof parsed !== 'object') return 'INVALID';
  const body = parsed as { current?: unknown; parents?: unknown };
  const current = toNode(body.current);
  if (!current) return null;
  const parents = (Array.isArray(body.parents) ? body.parents : [])
    .map(toNode)
    .filter((n): n is RakutenGenreNode => n !== null && n.genreId !== current.genreId)
    .sort((a, b) => a.genreLevel - b.genreLevel);
  return { current, parents };
}

/** IchibaGenre 어댑터(F-BS-35). 관문 RAKUTEN_API로만 보낸다 */
@Injectable()
export class RakutenGenreHttpAdapter implements RakutenGenrePort {
  constructor(
    private readonly gateway: ExternalHttpGateway,
    private readonly settings: SettingsService,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async fetchGenre(
    genreId: number,
    ctx: RakutenApiCallContext = {},
  ): Promise<RakutenGenreLookup | null> {
    const { rakutenApi } = this.settings.current().sourcing;
    const keys = await readRakutenKeys(this.secrets);
    const url = buildRakutenApiUrl(rakutenApi.genreSearchUrl, keys, {
      genreId: String(genreId),
      formatVersion: '2',
    });
    let bodyText: string;
    try {
      bodyText = await callRakutenApi(
        this.gateway,
        this.clock,
        url,
        { maxRetries: rakutenApi.maxRetries },
        ctx,
      );
    } catch (error) {
      // 없는 장르는 404(Proposed): 실패가 아니라 '모름'
      if (error instanceof RakutenApiError && error.httpStatus === 404) return null;
      throw error;
    }
    const parsed = parseGenreResponse(bodyText);
    if (parsed === 'INVALID') throw invalidRakutenResponse();
    return parsed;
  }
}

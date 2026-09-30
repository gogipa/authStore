import { Inject, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service.js';
import { CLOCK, type Clock } from '../http/clock.token.js';
import {
  RAKUTEN_GENRE_PORT,
  type RakutenGenreNode,
  type RakutenGenrePort,
} from './rakuten-genre.port.js';
import { RakutenGenreRepository, type RakutenGenreWrite } from './rakuten-genre.repository.js';
import type { RakutenApiCallContext } from './rakuten-search.port.js';

const DAY_MS = 86_400_000;

/** 장르 하나의 경로(루트 → 자기) */
export interface RakutenGenrePath {
  genreId: number;
  /** 루트(레벨 1)부터 자기까지 genreId(common/child-shoe `isGenreInScope`의 입력) */
  idPath: number[];
  /** rakuten_genre.id_path 모양(`/558885/110983/`) */
  idPathText: string;
  /** rakuten_item.genre_path 사본(ID·이름, Proposed 모양 `558885:靴 > 110983:メンズ靴`) */
  namePath: string;
  /** 캐시에서 읽었나 */
  fromCache: boolean;
}

/** `/1/2/3/` → [1, 2, 3] */
export function parseIdPath(text: string): number[] {
  return text
    .split('/')
    .filter((part) => part !== '')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

export function idPathText(ids: readonly number[]): string {
  return `/${ids.join('/')}/`;
}

/**
 * 라쿠텐 장르 경로(F-BS-35, P2-02 규칙 12). 상품 장르가 설정 장르(靴 558885)의 하위인지(`rakuten_genre.id_path LIKE
 * '/558885/%'`), 성별 장르 경로(メンズ靴 110983·レディース靴 100480)를 판단하는 데 쓴다.
 *
 * 갱신 규칙(Proposed — 문서에 없음, 05-1 §7.3 P2-02): 트리를 한 번에 받지 않고 **모르는 장르만 그때 한 번** IchibaGenre로
 * 물어(조상 포함) 캐시에 넣는다(靴 아래 수백 개를 1.5초 간격으로 모두 받으면 몇 분이 걸린다). 캐시가 `genreCacheDays`(30일)보다
 * 오래되면 다시 묻는다. 부를 수 없으면(키 없음·오류·응답 없음) 오래된 캐시라도 쓰고, 그것도 없으면 null(= 장르 모름).
 */
@Injectable()
export class RakutenGenreService {
  private readonly logger = new Logger(RakutenGenreService.name);

  constructor(
    @Inject(RAKUTEN_GENRE_PORT) private readonly port: RakutenGenrePort,
    private readonly repository: RakutenGenreRepository,
    private readonly settings: SettingsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async pathOf(genreId: number, ctx: RakutenApiCallContext = {}): Promise<RakutenGenrePath | null> {
    const now = this.clock.now();
    const cached = await this.repository.find(genreId);
    const maxAgeMs = this.settings.current().sourcing.rakutenApi.genreCacheDays * DAY_MS;
    if (cached && now.getTime() - cached.fetchedAt.getTime() < maxAgeMs) {
      return this.fromRows(genreId, cached.idPath, true);
    }
    try {
      const lookup = await this.port.fetchGenre(genreId, ctx);
      if (!lookup) return cached ? this.fromRows(genreId, cached.idPath, true) : null;
      const chain = [...lookup.parents, lookup.current];
      await this.repository.upsertMany(toWrites(chain), now);
      return {
        genreId,
        idPath: chain.map((n) => n.genreId),
        idPathText: idPathText(chain.map((n) => n.genreId)),
        namePath: namePathOf(chain),
        fromCache: false,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'Error';
      this.logger.warn(`라쿠텐 장르 ${genreId}의 경로를 받지 못했습니다(${reason})`);
      return cached ? this.fromRows(genreId, cached.idPath, true) : null;
    }
  }

  /** 캐시 행들로 경로·이름을 다시 만든다 */
  private async fromRows(
    genreId: number,
    text: string,
    fromCache: boolean,
  ): Promise<RakutenGenrePath> {
    const ids = parseIdPath(text);
    const names = await Promise.all(ids.map((id) => this.repository.find(id)));
    const chain = ids.map((id, i) => ({
      genreId: id,
      genreName: names[i]?.genreName ?? String(id),
      genreLevel: i + 1,
    }));
    return {
      genreId,
      idPath: ids,
      idPathText: idPathText(ids),
      namePath: namePathOf(chain),
      fromCache,
    };
  }
}

function toWrites(chain: readonly RakutenGenreNode[]): RakutenGenreWrite[] {
  return chain.map((node, i) => ({
    genreId: node.genreId,
    parentGenreId: i > 0 ? chain[i - 1]!.genreId : null,
    genreName: node.genreName.slice(0, 255),
    genreLevel: Math.max(1, node.genreLevel),
    idPath: idPathText(chain.slice(0, i + 1).map((n) => n.genreId)).slice(0, 255),
  }));
}

/** rakuten_item.genre_path 사본(500자까지) */
export function namePathOf(
  chain: readonly Pick<RakutenGenreNode, 'genreId' | 'genreName'>[],
): string {
  return chain
    .map((n) => `${n.genreId}:${n.genreName}`)
    .join(' > ')
    .slice(0, 500);
}

/** rakuten_item.genre_path 사본(`558885:靴 > 110983:メンズ靴`) → [558885, 110983]. 읽을 수 없으면 null */
export function idPathFromNamePath(text: string | null | undefined): number[] | null {
  if (!text) return null;
  const ids = text
    .split(' > ')
    .map((part) => Number(part.split(':', 1)[0]))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length > 0 ? ids : null;
}

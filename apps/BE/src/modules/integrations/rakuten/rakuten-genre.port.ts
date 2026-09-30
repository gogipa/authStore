import type { RakutenApiCallContext } from './rakuten-search.port.js';

/**
 * 라쿠텐 IchibaGenre Search 포트(F-BS-35, PRD §8.2 'genreId: 장르 트리는 IchibaGenre API로 캐시'). 호출 경로는 M0 S2에서
 * 확정한다(설정 `sourcing.rakutenApi.genreSearchUrl`, 기본값은 Proposed). 장르 하나를 물으면 그 장르와 조상(parents)을 준다.
 * - 관문 target=RAKUTEN_API, 429·503 백오프 최대 3회, 키는 키체인에서만(없으면 409 SECRET_NOT_CONFIGURED)
 * - 없는 장르(404·빈 current)는 null
 * 캐시·하위 판정은 `RakutenGenreService`(rakuten_genre, id_path)가 한다.
 */
export const RAKUTEN_GENRE_PORT = Symbol('RAKUTEN_GENRE_PORT');

export interface RakutenGenreNode {
  genreId: number;
  genreName: string;
  /** 1부터(靴 558885가 1) */
  genreLevel: number;
}

export interface RakutenGenreLookup {
  current: RakutenGenreNode;
  /** 루트(레벨 1)부터 부모까지. 현재 장르는 넣지 않는다 */
  parents: RakutenGenreNode[];
}

export interface RakutenGenrePort {
  fetchGenre(genreId: number, ctx?: RakutenApiCallContext): Promise<RakutenGenreLookup | null>;
}

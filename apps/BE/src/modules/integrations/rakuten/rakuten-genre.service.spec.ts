import { RakutenFixtureServer } from '../../../../test/support/rakuten-fixture.adapters.js';
import type { RakutenGenre } from '../../../generated/prisma/client.js';
import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import type { SettingsService } from '../../settings/settings.service.js';
import type { Clock } from '../http/clock.token.js';
import type { RakutenGenrePort } from './rakuten-genre.port.js';
import type { RakutenGenreRepository, RakutenGenreWrite } from './rakuten-genre.repository.js';
import { parseGenreResponse } from './rakuten-genre.http-adapter.js';
import { idPathFromNamePath, namePathOf, RakutenGenreService } from './rakuten-genre.service.js';

const DAY = 86_400_000;

class FakeClock implements Clock {
  constructor(public ms: number) {}
  now(): Date {
    return new Date(this.ms);
  }
  sleep(): Promise<void> {
    return Promise.resolve();
  }
}

/** rakuten_genre를 메모리에 두는 가짜(genre_id upsert) */
class MemoryGenres {
  rows = new Map<number, RakutenGenre>();
  find(genreId: number): Promise<RakutenGenre | null> {
    return Promise.resolve(this.rows.get(genreId) ?? null);
  }
  upsertMany(rows: readonly RakutenGenreWrite[], fetchedAt: Date): Promise<void> {
    for (const r of rows) this.rows.set(r.genreId, { ...r, fetchedAt } as RakutenGenre);
    return Promise.resolve();
  }
}

function setup(port?: RakutenGenrePort) {
  const clock = new FakeClock(Date.parse('2026-09-28T00:00:00Z'));
  const server = new RakutenFixtureServer(clock);
  const repo = new MemoryGenres();
  const settings = { current: () => DEFAULT_SETTINGS } as unknown as SettingsService;
  const service = new RakutenGenreService(
    port ?? server.genrePort,
    repo as unknown as RakutenGenreRepository,
    settings,
    clock,
  );
  return { service, server, repo, clock };
}

describe('라쿠텐 장르 트리 캐시(F-BS-35, P2-02 규칙 12)', () => {
  it('모르는 장르는 IchibaGenre로 한 번 물어 조상까지 캐시한다(id_path /558885/110983/208025/)', async () => {
    const { service, server, repo } = setup();
    const path = await service.pathOf(208025);
    expect(path).toEqual({
      genreId: 208025,
      idPath: [558885, 110983, 208025],
      idPathText: '/558885/110983/208025/',
      namePath: '558885:靴 > 110983:メンズ靴 > 208025:スニーカー',
      fromCache: false,
    });
    expect(server.callsOf('GENRE')).toHaveLength(1);
    expect([...repo.rows.keys()].sort()).toEqual([110983, 208025, 558885]);
    expect(repo.rows.get(110983)).toMatchObject({
      parentGenreId: 558885,
      idPath: '/558885/110983/',
      genreLevel: 2,
    });
  });

  it('캐시가 genreCacheDays(30일) 안이면 다시 묻지 않고, 지나면 다시 묻는다', async () => {
    const { service, server, clock } = setup();
    await service.pathOf(208025);
    clock.ms += 29 * DAY;
    await expect(service.pathOf(208025)).resolves.toMatchObject({ fromCache: true });
    expect(server.callsOf('GENRE')).toHaveLength(1);
    // 조상은 같이 캐시된다
    await expect(service.pathOf(110983)).resolves.toMatchObject({
      idPath: [558885, 110983],
      fromCache: true,
    });
    clock.ms += 2 * DAY;
    await expect(service.pathOf(208025)).resolves.toMatchObject({ fromCache: false });
    expect(server.callsOf('GENRE')).toHaveLength(2);
  });

  it('없는 장르 → null(장르 모름). 부를 수 없으면 오래된 캐시라도 쓴다', async () => {
    const { service } = setup();
    await expect(service.pathOf(999999)).resolves.toBeNull();

    let fail = false;
    const flaky: RakutenGenrePort = {
      fetchGenre: (id) =>
        fail
          ? Promise.reject(new Error('down'))
          : Promise.resolve({
              current: { genreId: id, genreName: '靴', genreLevel: 1 },
              parents: [],
            }),
    };
    const s2 = setup(flaky);
    await s2.service.pathOf(558885);
    s2.clock.ms += 40 * DAY;
    fail = true;
    await expect(s2.service.pathOf(558885)).resolves.toMatchObject({
      idPath: [558885],
      fromCache: true,
    });
    await expect(s2.service.pathOf(110983)).resolves.toBeNull();
  });

  it('응답 읽기: current 없음 → null, JSON 아님 → INVALID, 부모는 레벨 순', () => {
    expect(parseGenreResponse('{"current":null}')).toBeNull();
    expect(parseGenreResponse('<html>')).toBe('INVALID');
    expect(
      parseGenreResponse(
        JSON.stringify({
          current: { genreId: 3, genreName: 'c', genreLevel: 3 },
          parents: [
            { parent: { genreId: 2, genreName: 'b', genreLevel: 2 } },
            { parent: { genreId: 1, genreName: 'a', genreLevel: 1 } },
          ],
        }),
      ),
    ).toEqual({
      current: { genreId: 3, genreName: 'c', genreLevel: 3 },
      parents: [
        { genreId: 1, genreName: 'a', genreLevel: 1 },
        { genreId: 2, genreName: 'b', genreLevel: 2 },
      ],
    });
  });

  it('rakuten_item.genre_path 사본 ↔ id 경로', () => {
    const text = namePathOf([
      { genreId: 558885, genreName: '靴' },
      { genreId: 100480, genreName: 'レディース靴' },
    ]);
    expect(text).toBe('558885:靴 > 100480:レディース靴');
    expect(idPathFromNamePath(text)).toEqual([558885, 100480]);
    expect(idPathFromNamePath(null)).toBeNull();
    expect(idPathFromNamePath('?')).toBeNull();
  });
});

import { Injectable } from '@nestjs/common';
import type { RakutenGenre } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

export interface RakutenGenreWrite {
  genreId: number;
  parentGenreId: number | null;
  genreName: string;
  genreLevel: number;
  /** 루트 → 자기 genreId 경로(`/558885/110983/`) */
  idPath: string;
}

/** 장르 트리 캐시(ERD `rakuten_genre`, integrations 소유). 캐시라 genre_id로 덮어쓴다 */
@Injectable()
export class RakutenGenreRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(genreId: number): Promise<RakutenGenre | null> {
    return this.prisma.rakutenGenre.findUnique({ where: { genreId } });
  }

  async upsertMany(rows: readonly RakutenGenreWrite[], fetchedAt: Date): Promise<void> {
    await this.prisma.$transaction(
      rows.map((row) =>
        this.prisma.rakutenGenre.upsert({
          where: { genreId: row.genreId },
          create: { ...row, fetchedAt },
          update: { ...row, fetchedAt },
        }),
      ),
    );
  }

  /** 캐시의 경로(`/558885/110983/`). 캐시에 없으면 null */
  async idPathOf(genreId: number): Promise<string | null> {
    return (await this.find(genreId))?.idPath ?? null;
  }

  /** 하위 판정(`id_path LIKE '/558885/%'`) — 이 장르가 root 아래(또는 root 자신)인가. 캐시에 없으면 null */
  async isUnder(genreId: number, rootGenreId: number): Promise<boolean | null> {
    const row = await this.find(genreId);
    if (!row) return null;
    return row.idPath.startsWith(`/${rootGenreId}/`);
  }
}

import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { isRakutenApiError } from '../integrations/rakuten/rakuten-api-error.mapper.js';
import { rakutenApiErrorToException } from '../integrations/rakuten/rakuten-api.caller.js';
import { idPathFromNamePath } from '../integrations/rakuten/rakuten-genre.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type {
  RakutenItemFetchResultDto,
  RakutenItemSnapshotDto,
  RakutenQueryValidationDto,
} from './dto/rakuten.dto.js';
import { RakutenItemFetcher } from './rakuten-item-fetcher.js';
import { RakutenItemRepository } from './rakuten-item.repository.js';
import { toSnapshot } from './rakuten-item.view.js';
import { validateRakutenQuery } from './rakuten-query.validator.js';
import { requireRakutenItemUrl } from './rakuten-url.js';

/**
 * 라쿠텐 검색어 검사·URL 입구·스냅샷 조회(05-2 태그 sourcing, P2-02).
 * - `validateQuery`: 저장 없는 계산(규칙 위반도 200 valid=false)
 * - `fetchFromUrl`: URL 형식(422 RAKUTEN_URL_INVALID) → 페이지 1건(하루 상한 1건, entry_source=MANUAL·fetch_reason=URL_ENTRY)
 *   → 스냅샷 + 입구 검사. 동기 201(05-2 x-decision §7-24). 점검·삭제 페이지·파싱 실패는 502 EXTERNAL_API_ERROR(행 없음)
 * - `get`: 스냅샷 한 건(설명 HTML·원본 경로 뺌). 없으면 404 RAKUTEN_ITEM_NOT_FOUND
 */
@Injectable()
export class RakutenItemsService {
  constructor(
    private readonly fetcher: RakutenItemFetcher,
    private readonly items: RakutenItemRepository,
    private readonly settings: SettingsService,
  ) {}

  validateQuery(rakutenQuery: string): RakutenQueryValidationDto {
    const { sourcing } = this.settings.current();
    return validateRakutenQuery(rakutenQuery, {
      genreId: sourcing.genreId,
      ngKeywords: sourcing.ngKeywords,
    });
  }

  async fetchFromUrl(sourceUrl: string): Promise<RakutenItemFetchResultDto> {
    const url = requireRakutenItemUrl(sourceUrl);
    try {
      const { item, checks } = await this.fetcher.fetchSnapshot(url, {
        entrySource: 'MANUAL',
        fetchReason: 'URL_ENTRY',
      });
      return { rakutenItem: toSnapshot(item), checks };
    } catch (error) {
      if (isRakutenApiError(error)) throw rakutenApiErrorToException(error);
      throw error;
    }
  }

  async get(rakutenItemId: number): Promise<RakutenItemSnapshotDto> {
    const item = await this.items.findWithSkus(rakutenItemId);
    if (!item) throw new ApiException('RAKUTEN_ITEM_NOT_FOUND');
    return toSnapshot(item);
  }

  /** 스냅샷의 입구 검사(다시 계산 — 설정이 바뀌면 결과도 바뀐다) */
  async checks(rakutenItemId: number) {
    const item = await this.items.findWithSkus(rakutenItemId);
    if (!item) throw new ApiException('RAKUTEN_ITEM_NOT_FOUND');
    return this.fetcher.checksOf(item, idPathFromNamePath(item.genrePath));
  }
}

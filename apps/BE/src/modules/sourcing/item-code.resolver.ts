import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import {
  RAKUTEN_SEARCH_PORT,
  type RakutenApiCallContext,
  type RakutenSearchPort,
} from '../integrations/rakuten/rakuten-search.port.js';
import { isWordLongEnough, splitQueryWords } from './domain/rakuten-query.rules.js';
import { PAGE_ITEM_CODE_MATCHES_API } from './page-json.constants.js';
import type { ParsedItemPage } from './page-json.parser.js';
import { type RakutenItemUrl, sameItemUrl } from './rakuten-url.js';

export interface ResolvedItemCode {
  itemCode: string;
  shopCode: string;
  /** PAGE_JSON = 페이지 JSON, ITEM_SEARCH = F-BS-37 보완 조회 */
  source: 'PAGE_JSON' | 'ITEM_SEARCH';
}

/** 상품명 → 보완 조회 검색어(검색어 규칙을 지키는 앞 단어 몇 개, 괄호 속 광고 문구는 뺀다) */
export function keywordFromItemName(name: string): string | null {
  const cleaned = name
    .normalize('NFKC')
    .replace(/[【[(（][^】\])）]*[】\])）]/g, ' ')
    .replace(/[★☆◆◇■□●○※!！]/g, ' ');
  const words = splitQueryWords(cleaned).filter(isWordLongEnough).slice(0, 5);
  const keyword = words.join(' ').slice(0, 60).trim();
  return keyword === '' ? null : keyword;
}

/**
 * itemCode 정리(F-SO-32·F-BS-37, P2-02 규칙 11). itemCode는 URL 조각이 아니라 페이지 JSON에서 얻어 API 형식
 * `샵코드:상품관리번호`로 맞춘다. 페이지에 없거나(키 누락) 두 경로 키가 다르다고 M0 S2가 확인하면(`PAGE_ITEM_CODE_MATCHES_API`
 * =false) URL의 샵 코드 + 型番(없으면 상품명 앞 단어)으로 Item Search를 불러 `itemUrl`이 같은 항목의 itemCode를 쓴다.
 * 못 찾으면 422 RAKUTEN_ITEM_CODE_UNRESOLVED(Proposed) — 후보·스냅샷을 만들지 않는다. 키 없음(409)·API 오류는 그대로 던진다.
 */
@Injectable()
export class ItemCodeResolver {
  constructor(@Inject(RAKUTEN_SEARCH_PORT) private readonly search: RakutenSearchPort) {}

  async resolve(
    page: ParsedItemPage,
    url: RakutenItemUrl,
    ctx: RakutenApiCallContext = {},
  ): Promise<ResolvedItemCode> {
    if (PAGE_ITEM_CODE_MATCHES_API && page.itemCode && page.shopCode) {
      return { itemCode: page.itemCode, shopCode: page.shopCode, source: 'PAGE_JSON' };
    }
    const keywords = [page.modelCode, keywordFromItemName(page.itemName)].filter(
      (k, i, all): k is string => !!k && all.indexOf(k) === i,
    );
    for (const keyword of keywords) {
      const result = await this.search.search(
        { shopCode: url.shopCode, keyword, sourcingFilters: false },
        ctx,
      );
      const hit = result.items.find((item) => sameItemUrl(item.itemUrl, url.url));
      if (hit) return { itemCode: hit.itemCode, shopCode: hit.shopCode, source: 'ITEM_SEARCH' };
    }
    throw new ApiException('RAKUTEN_ITEM_CODE_UNRESOLVED', {
      details: { shopCode: url.shopCode },
    });
  }
}

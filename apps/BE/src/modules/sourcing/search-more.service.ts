import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { isRakutenApiError } from '../integrations/rakuten/rakuten-api-error.mapper.js';
import { rakutenApiErrorToException } from '../integrations/rakuten/rakuten-api.caller.js';
import {
  RAKUTEN_SEARCH_PORT,
  type RakutenSearchPort,
} from '../integrations/rakuten/rakuten-search.port.js';
import { SettingsService } from '../settings/settings.service.js';
import { ComparisonScope } from './comparison-scope.js';
import { checkRakutenQuery } from './domain/rakuten-query.rules.js';
import type { SourcingSearchMoreResultDto } from './dto/sourcing-comparison.dto.js';
import { SourcingComparisonRepository } from './sourcing-comparison.repository.js';
import { apiRowCreateData } from './sourcing-comparison.store.js';
import { filterSearchRows } from './sourcing-rows.js';

type Db = Prisma.TransactionClient;

const SEARCH_KEYWORD_FIELD = 'searchKeyword';

/**
 * 검색 결과 더 보기(05-2 loadMoreSourcingSearchRows, D-47 — 화면시안 명세 §13 '상품 고르기' 목록의 [더 보기]).
 * 기준 상품을 정하기 전(탐색 모드)에 이 비교표의 검색어로 Item Search 다음 페이지(관련도 순, 6시간 캐시·1.5초 간격 관문은 검색
 * 포트가 지킨다)를 받아 아동용 단어 행을 뺀 새 행을 API 행으로 더한다. 분류·성별·AI·페이지 조회는 하지 않는다(탐색 모드).
 * 검사 순서: 404 SOURCING_COMPARISON_NOT_FOUND → 잠금·제외 409(CANDIDATE_LOCKED·CANDIDATE_EXCLUDED) → ② 입력 대기 아님·비교를 하지
 * 않은 버전 409 STEP_RUN_NOT_WAITING_INPUT → 기준 상품이 이미 정해짐 409 ANCHOR_ALREADY_FIXED → 검색어 없음·형식 위반 422
 * RAKUTEN_QUERY_INVALID.
 * 외부 호출 동안 후보 잠금을 쥐지 않도록 둘로 나눈다: ① 검사 + 다음 페이지 번호(짧은 트랜잭션) → 검색(트랜잭션 밖) → ② 같은 검사를 다시
 * 하고(그 사이 앵커가 정해졌을 수 있다) 행 저장. 라쿠텐 오류는 502 EXTERNAL_API_ERROR(details.reason=라쿠텐 오류 코드)다.
 */
@Injectable()
export class SearchMoreService {
  constructor(
    private readonly scope: ComparisonScope,
    private readonly repo: SourcingComparisonRepository,
    private readonly settings: SettingsService,
    @Inject(RAKUTEN_SEARCH_PORT) private readonly search: RakutenSearchPort,
  ) {}

  async loadMore(sourcingComparisonId: number): Promise<SourcingSearchMoreResultDto> {
    const found = await this.repo.findHead(sourcingComparisonId);
    if (!found) throw new ApiException('SOURCING_COMPARISON_NOT_FOUND');
    const candidateId = found.stepRun.candidateId;
    const stepRunId = found.stepRunId;
    const hits = this.settings.current().sourcing.rakutenApi.hits;

    // ① 검사 + 다음 페이지 번호
    const { keyword, page } = await this.scope.forRequest(candidateId, stepRunId, async (scope) => {
      const head = await this.exploreHead(scope.tx, sourcingComparisonId);
      const keyword = head.searchKeyword?.trim() ?? '';
      const fieldErrors = keyword === '' ? [] : checkRakutenQuery(keyword, SEARCH_KEYWORD_FIELD);
      if (keyword === '' || fieldErrors.length > 0) {
        throw new ApiException('RAKUTEN_QUERY_INVALID', {
          fieldErrors:
            keyword === ''
              ? [{ field: SEARCH_KEYWORD_FIELD, message: '라쿠텐 검색어가 없습니다.' }]
              : fieldErrors,
        });
      }
      return { keyword, page: await this.nextPage(scope.tx, head.id, hits) };
    });

    // 검색(트랜잭션 밖). 관련도 순 — 첫 검색과 같은 정렬이라 다음 페이지가 이어진다
    let result;
    try {
      result = await this.search.search(
        { keyword, page, sort: 'standard' },
        { candidateId, stepRunId },
      );
    } catch (error) {
      if (isRakutenApiError(error)) throw rakutenApiErrorToException(error);
      throw error;
    }
    const settings = this.settings.current();
    const { rows } = filterSearchRows(result.items, settings, result.fetchedAt);
    if (rows.length === 0) return { addedRowCount: 0, hasMore: false };

    // ② 다시 검사하고 저장. 검색 순위는 (page-1)×hits + 그 페이지 안 순번(첫 검색 page 1과 이어진다)
    const addedRowCount = await this.scope.forRequest(candidateId, stepRunId, async (scope) => {
      const head = await this.exploreHead(scope.tx, sourcingComparisonId);
      const { count } = await scope.tx.sourcingComparisonRow.createMany({
        data: rows.map((row) =>
          apiRowCreateData(head.id, { ...row, searchRank: row.searchRank + (page - 1) * hits }),
        ),
        skipDuplicates: true,
      });
      return count;
    });
    // 받은 페이지가 가득 찼고 새 행이 있었을 때만 더 있다고 본다(전부 겹침·제외로 0건이면 같은 페이지를 되풀이 요청하지 않게)
    return { addedRowCount, hasMore: result.items.length >= hits && addedRowCount > 0 };
  }

  /** 입력 대기 중인 비교한 버전이고 기준 상품 전(탐색 모드)인 머리 행 */
  private async exploreHead(tx: Db, id: number) {
    const head = (await this.repo.findHead(id, tx))!;
    if (!head.comparisonPerformed) throw new ApiException('STEP_RUN_NOT_WAITING_INPUT');
    if (head.anchorInputMethod !== null) throw new ApiException('ANCHOR_ALREADY_FIXED');
    return head;
  }

  /** 다음 페이지 번호: 이미 가진 API 행 검색 순위 최댓값으로 `ceil(최댓값 / hits) + 1`, 순위가 있는 행이 없으면 2 */
  private async nextPage(tx: Db, sourcingComparisonId: number, hits: number): Promise<number> {
    const { _max } = await tx.sourcingComparisonRow.aggregate({
      where: { sourcingComparisonId, rowSource: 'API', searchRank: { not: null } },
      _max: { searchRank: true },
    });
    return _max.searchRank === null ? 2 : Math.ceil(_max.searchRank / hits) + 1;
  }
}

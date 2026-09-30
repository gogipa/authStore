import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { idPathFromNamePath } from '../integrations/rakuten/rakuten-genre.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { classifyRow } from './anchor-match.js';
import { ComparisonScope } from './comparison-scope.js';
import { RakutenItemFetcher } from './rakuten-item-fetcher.js';
import { RakutenItemRepository } from './rakuten-item.repository.js';
import { anchorOfHead, SourcingComparisonRepository } from './sourcing-comparison.repository.js';
import { toComparisonRow } from './sourcing-comparison.view.js';
import { excludedWordException } from './url-candidate.rules.js';

/**
 * 비교표 '수동' 행 넣기(05-2 addSourcingComparisonManualRow, F-SO-31·33·34, P2-03 규칙 14). `POST /rakuten-items`로 읽은
 * 스냅샷(`rakutenItemId`)을 `row_source=MANUAL` **검증 행**으로 넣는다(외부 호출 없음). 그 뒤 재고 판정·실질가·선택은 API 행과 같다.
 * 검사 순서: 404 비교표 → 404 스냅샷 → 잠금·제외 409 → ② 입력 대기 아님 409 STEP_RUN_NOT_WAITING_INPUT → 앵커 없음 409
 * ANCHOR_NOT_FIXED → 상품명 제외어 422 RAKUTEN_ITEM_EXCLUDED_WORD → 같은 itemCode 행 409 ROW_ALREADY_EXISTS.
 * API 값이 없어 검색 순위·가격·pointRate·postageFlag는 NULL이다 — 포인트는 기본 1배 + 샵·이벤트 + SPU만(수동 행 배율 출처는
 * M0 S2 전 Proposed — ERD §7.3-3), 송료는 페이지 SKU `postageIncluded`로 정한다.
 */
@Injectable()
export class ManualRowService {
  constructor(
    private readonly scope: ComparisonScope,
    private readonly repo: SourcingComparisonRepository,
    private readonly items: RakutenItemRepository,
    private readonly fetcher: RakutenItemFetcher,
    private readonly settings: SettingsService,
  ) {}

  async add(sourcingComparisonId: number, rakutenItemId: number) {
    const found = await this.repo.findHead(sourcingComparisonId);
    if (!found) throw new ApiException('SOURCING_COMPARISON_NOT_FOUND');
    const item = await this.items.findWithSkus(rakutenItemId);
    if (!item) throw new ApiException('RAKUTEN_ITEM_NOT_FOUND');
    const candidateId = found.stepRun.candidateId;
    return this.scope.forRequest(candidateId, found.stepRunId, async (scope, c) => {
      const head = (await this.repo.findHead(sourcingComparisonId, scope.tx))!;
      if (!head.comparisonPerformed) throw new ApiException('STEP_RUN_NOT_WAITING_INPUT');
      if (head.anchorInputMethod === null) throw new ApiException('ANCHOR_NOT_FIXED');
      const checks = this.fetcher.checksOf(item, idPathFromNamePath(item.genrePath));
      if (checks.excludedWords.length > 0) throw excludedWordException(checks.excludedWords);
      const exists = await scope.tx.sourcingComparisonRow.findUnique({
        where: {
          sourcingComparisonId_itemCode: { sourcingComparisonId: head.id, itemCode: item.itemCode },
        },
        select: { id: true },
      });
      if (exists) throw new ApiException('ROW_ALREADY_EXISTS', { details: { rowId: exists.id } });
      const classification = classifyRow(anchorOfHead(head), {
        itemCode: item.itemCode,
        itemName: item.itemName,
        modelCode: item.modelCode,
      });
      const created = await scope.tx.sourcingComparisonRow.create({
        data: {
          sourcingComparisonId: head.id,
          rowSource: 'MANUAL',
          itemCode: item.itemCode,
          shopCode: item.shopCode,
          shopName: item.shopName,
          itemName: item.itemName,
          itemUrl: item.itemUrl,
          modelCodeNorm: classification.modelCodeNorm?.slice(0, 128) ?? null,
          colorCode: classification.colorCode?.slice(0, 64) ?? null,
          anchorMatch: classification.anchorMatch,
        },
      });
      const ctx = await this.repo.contextOf(scope.tx, head, c.candidate, this.settings.current());
      const { row } = await this.repo.applySnapshot(scope.tx, created.id, item, ctx);
      this.scope.publishRowUpdated(scope, candidateId, row);
      return toComparisonRow(await this.repo.rowWithItem(scope.tx, row.id));
    });
  }
}

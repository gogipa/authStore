import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { SettingsService } from '../settings/settings.service.js';
import { ComparisonScope } from './comparison-scope.js';
import { SourcingComparisonRepository } from './sourcing-comparison.repository.js';
import { toComparisonRow } from './sourcing-comparison.view.js';
import type { RowPatchRequest } from './sourcing-requests.js';

/**
 * 비교표 행 수정·실질가 재계산(05-2 updateSourcingComparisonRow, F-SO-25·26·27, P2-03 규칙 11). 바꾼 칸만 받는다
 * (쿠폰 금액·샵·이벤트 배율·오너 동일 상품 판단). 저장하면 바로 포인트·실질가를 다시 계산하고(검증 행만 — 대표 SKU가·송료는
 * 그대로) 200 `{ row, rankedRowIds }`(검증 행의 실질가 순). 검사: 404 행 → 잠금·제외 409 → ② 입력 대기 아님 409
 * STEP_RUN_NOT_WAITING_INPUT(닫힌 버전은 `trg_output_frozen`이 한 번 더 막는다). 본문 검사(빈 본문·음수 422)는 컨트롤러.
 */
@Injectable()
export class RowUpdateService {
  constructor(
    private readonly scope: ComparisonScope,
    private readonly repo: SourcingComparisonRepository,
    private readonly settings: SettingsService,
  ) {}

  async update(rowId: number, patch: RowPatchRequest) {
    const found = await this.repo.findRow(rowId);
    if (!found) throw new ApiException('SOURCING_COMPARISON_ROW_NOT_FOUND');
    const head = found.sourcingComparison;
    return this.scope.forRequest(head.stepRun.candidateId, head.stepRunId, async (scope) => {
      const written = await scope.tx.sourcingComparisonRow.update({
        where: { id: rowId },
        data: {
          ...(patch.couponYen !== undefined ? { couponYen: patch.couponYen } : {}),
          ...(patch.shopEventMultiplier !== undefined
            ? { shopEventMultiplier: patch.shopEventMultiplier.toFixed(4) }
            : {}),
          ...(patch.ownerMatchDecision !== undefined
            ? { ownerMatchDecision: patch.ownerMatchDecision }
            : {}),
        },
      });
      await this.repo.repriceRow(scope.tx, written, head, this.settings.current());
      const row = await this.repo.rowWithItem(scope.tx, rowId);
      return {
        row: toComparisonRow(row),
        rankedRowIds: await this.repo.rankedIds(scope.tx, head.id),
      };
    });
  }
}

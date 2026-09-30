import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { idPathFromNamePath } from '../integrations/rakuten/rakuten-genre.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { Db, StepEngineTx } from '../step-engine/candidates/step-engine-tx.js';
import type { CandidateEffects, StepOutcome } from '../step-engine/contracts/step-runner.js';
import type {
  CandidateCreationExtension,
  UrlCandidateCreationInput,
} from '../step-engine/ports/candidate-creation.extension.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { detectGender } from './gender-signal.js';
import { RakutenItemFetcher } from './rakuten-item-fetcher.js';
import { RakutenItemRepository, type RakutenItemWithSkus } from './rakuten-item.repository.js';
import { anchorKeyOfHead } from './sourcing.step-runner.js';
import {
  SOURCING_WAITING_REASONS,
  sourcingParamsOf,
  type UrlCreateOutput,
} from './sourcing-output.js';
import { excludedWordException, shippingForColor, urlItemAnchor } from './url-candidate.rules.js';

/** 앵커·성별로 ② 완료 때의 후보 효과(앵커 확정·② 자동 성별). 성별을 모르면 넣지 않는다(오너가 고른다 — P2-03 F-SO-19) */
export function urlCreateEffects(head: {
  anchorModelCode: string | null;
  anchorModelCodeNorm: string | null;
  anchorItemCode: string | null;
  anchorColorCode: string | null;
  detectedGender: string | null;
}): CandidateEffects {
  const effects: CandidateEffects = {};
  const anchor = anchorKeyOfHead(head);
  if (anchor) effects.anchor = anchor;
  if (head.detectedGender === 'MALE' || head.detectedGender === 'FEMALE') {
    effects.step2Gender = head.detectedGender;
  }
  return effects;
}

/**
 * 'URL로 만들기'(F-SO-35, 05-2 createCandidate RAKUTEN_URL, P2-02 규칙 14). P1-04 후보 만들기 확장 자리를 채운다
 * (`StepEngineApi.registerCandidateCreationExtension`).
 * - 트랜잭션 전: 상품명 제외어 → 422 RAKUTEN_ITEM_EXCLUDED_WORD(후보를 만들지 않는다, F-SO-33)
 * - 후보를 만든 같은 트랜잭션: ② URL_CREATE 버전(비교 안 함, 행 0개, 앵커 = URL 상품, 송료, 아동화 신호·장르 범위) —
 *   아동화 의심·대상 외 장르·장르 모름이면 ② 입력 대기('성인용 상품 확인'), 아니면 완료(앵커 확정·② 자동 성별)
 * 외부 호출은 하지 않는다(스냅샷은 `POST /rakuten-items`가 이미 읽었다). 장르 경로는 스냅샷의 genre_path 사본으로 본다.
 */
@Injectable()
export class UrlCandidateExtension implements CandidateCreationExtension {
  constructor(
    private readonly items: RakutenItemRepository,
    private readonly fetcher: RakutenItemFetcher,
    private readonly settings: SettingsService,
    private readonly api: StepEngineApi,
  ) {}

  private async item(db: Db, rakutenItemId: number): Promise<RakutenItemWithSkus> {
    const item = await this.items.findWithSkus(rakutenItemId, db);
    if (!item) throw new ApiException('RAKUTEN_ITEM_NOT_FOUND');
    return item;
  }

  async validateUrlItem(
    db: Db,
    input: Omit<UrlCandidateCreationInput, 'candidateId'>,
  ): Promise<void> {
    const item = await this.item(db, input.rakutenItemId);
    const checks = this.fetcher.checksOf(item, idPathFromNamePath(item.genrePath));
    if (checks.excludedWords.length > 0) throw excludedWordException(checks.excludedWords);
  }

  async createUrlSourcingVersion(
    scope: StepEngineTx,
    input: UrlCandidateCreationInput,
  ): Promise<void> {
    const settings = this.settings.current();
    const item = await this.item(scope.tx, input.rakutenItemId);
    const genreIdPath = idPathFromNamePath(item.genrePath);
    const checks = this.fetcher.checksOf(item, genreIdPath);
    if (checks.excludedWords.length > 0) throw excludedWordException(checks.excludedWords);
    const anchor = urlItemAnchor(item, input.selectedColor);
    const shipping = shippingForColor(
      item.skus,
      input.selectedColor,
      settings.sourcing.defaultShippingYen,
    );
    const gender = detectGender({ genreIdPath, itemName: item.itemName });
    const output: UrlCreateOutput = {
      action: 'URL_CREATE',
      sourceUrl: item.itemUrl,
      rakutenItemId: item.id,
      params: sourcingParamsOf(settings),
      anchor,
      shippingYen: shipping.shippingYen,
      shippingSource: shipping.shippingSource,
      childSizeSuspect: checks.childSizeSuspect,
      genreScope: checks.genreScope,
      detectedGender: gender?.gender ?? null,
      genderBasis: gender?.basis ?? null,
    };
    const outcome: StepOutcome = checks.adultConfirmationRequired
      ? {
          kind: 'WAITING_INPUT',
          waitingReasonCode: SOURCING_WAITING_REASONS.ADULT.code,
          pendingInputs: [...SOURCING_WAITING_REASONS.ADULT.pending],
          output,
        }
      : {
          kind: 'COMPLETED',
          output,
          candidateEffects: urlCreateEffects({
            ...anchor,
            detectedGender: output.detectedGender,
          }),
        };
    await this.api.recordInlineRun(scope, input.candidateId, 'SOURCING', () =>
      Promise.resolve(outcome),
    );
  }
}

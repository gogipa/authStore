import { Inject, Injectable } from '@nestjs/common';
import { childShoeRulesOf, judgeChildShoe } from '../../common/child-shoe/child-shoe.rules.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { ProgressEventsService } from '../../common/events/progress-events.service.js';
import { SECRET_STORE, type SecretStore } from '../../common/secrets/secret-store.port.js';
import type { Candidate, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ExternalHttpGateway } from '../integrations/http/external-http.gateway.js';
import { isRakutenApiError } from '../integrations/rakuten/rakuten-api-error.mapper.js';
import {
  missingRakutenKeys,
  rakutenKeysMissingException,
} from '../integrations/rakuten/rakuten-keys.js';
import {
  RAKUTEN_SEARCH_PORT,
  type RakutenSearchItem,
  type RakutenSearchPort,
} from '../integrations/rakuten/rakuten-search.port.js';
import type { AppSettings } from '../settings/schema/settings.types.js';
import type { AnchorKeyInput } from '../step-engine/candidates/candidate-identity.service.js';
import {
  type CandidateEffects,
  type StepInput,
  type StepInputContext,
  type StepOutcome,
  type StepPersistHooks,
  type StepRunContext,
  type StepRunner,
  StepRunnerFor,
  type StepStartContext,
  type Tx,
} from '../step-engine/contracts/step-runner.js';
import { readSettingsPath, settingsPathOf } from '../step-engine/domain/input-keys.js';
import { STEP_INPUT_SPECS } from '../step-engine/domain/step-graph.js';
import { checkRakutenQuery } from './domain/rakuten-query.rules.js';
import { keywordFromItemName } from './item-code.resolver.js';
import { normalizeModelCode } from './page-json.parser.js';
import { RakutenItemFetcher } from './rakuten-item-fetcher.js';
import { parseRakutenItemUrl } from './rakuten-url.js';
import {
  copyComparison,
  findComparisonByRun,
  insertRefetch,
  insertSearchCompare,
  insertUrlCreate,
} from './sourcing-comparison.store.js';
import {
  type AnchorPreset,
  isSourcingOutput,
  type RefetchOutput,
  type SearchCompareOutput,
  type SearchRowDraft,
  SOURCING_WAITING_REASONS,
  sourcingParamsOf,
} from './sourcing-output.js';
import { latestSelectionBase } from './sourcing-selection.reader.js';
import { excludedWordException, shippingForColor } from './url-candidate.rules.js';

type Db = Prisma.TransactionClient;

/** 실행 중 오너 입력 칸(05-2 StepRunOwnerInputs.searchKeyword) */
const SEARCH_KEYWORD_FIELD = 'ownerInputs.searchKeyword';

/** 외부 호출 관문·라쿠텐 API 실패 → FAILED(EXTERNAL_API). 그 밖 ApiException → INPUT_VALIDATION. 나머지는 던진다 */
export function sourcingFailureOf(error: unknown): Extract<StepOutcome, { kind: 'FAILED' }> {
  if (isRakutenApiError(error)) {
    return {
      kind: 'FAILED',
      failureKind: 'EXTERNAL_API',
      errorCode: error.errorCode,
      errorMessage: error.userMessage,
    };
  }
  if (error instanceof ApiException) {
    const external = ['EXTERNAL_API_ERROR', 'DAILY_LIMIT_REACHED', 'EXTERNAL_CALL_COOLDOWN'];
    return {
      kind: 'FAILED',
      failureKind: external.includes(error.code) ? 'EXTERNAL_API' : 'INPUT_VALIDATION',
      errorCode: error.code,
      errorMessage: error.message,
    };
  }
  throw error;
}

/** 검색 결과 한 건 → 비교표 API 행 초안 */
export function toRowDraft(item: RakutenSearchItem, rank: number, fetchedAt: Date): SearchRowDraft {
  return {
    searchRank: rank,
    itemCode: item.itemCode,
    shopCode: item.shopCode,
    shopName: item.shopName,
    itemName: item.itemName,
    itemUrl: item.itemUrl,
    apiItemPriceYen: item.itemPrice,
    apiItemPriceMin3Yen: item.itemPriceMin3,
    apiPointRate: item.pointRate,
    apiPostageFlag: item.postageFlag,
    reviewCount: item.reviewCount,
    reviewAverage: item.reviewAverage,
    shipOverseas: item.shipOverseasFlag === null ? null : item.shipOverseasFlag === 1,
    apiCollectedAt: fetchedAt.toISOString(),
  };
}

/**
 * 검색 결과에서 비교표 행으로 둘 것(F-SO-04, P2-02 규칙 5): 상품명에 아동 단어(P2-01 공통 규칙 — 바퀴·고령자 단어 포함)가 있으면
 * 저장하지 않는다. 같은 itemCode는 한 번만(ERD UNIQUE). 검색 순위는 원래 순서(뺀 행 자리는 비운다).
 */
export function filterSearchRows(
  items: readonly RakutenSearchItem[],
  settings: Readonly<AppSettings>,
  fetchedAt: Date,
): { rows: SearchRowDraft[]; excluded: number } {
  const rules = childShoeRulesOf(settings);
  const seen = new Set<string>();
  const rows: SearchRowDraft[] = [];
  let excluded = 0;
  items.forEach((item, i) => {
    if (judgeChildShoe({ texts: [item.itemName] }, rules).excluded) {
      excluded += 1;
      return;
    }
    if (seen.has(item.itemCode)) return;
    seen.add(item.itemCode);
    rows.push(toRowDraft(item, i + 1, fetchedAt));
  });
  return { rows, excluded };
}

/**
 * ② 소싱 실행기(`stepCode='SOURCING'`, F-BS-15 규약, P2-02). SourcingModule이 providers에 넣으면 step-engine 레지스트리가
 * 앱 시작 때 찾는다(엔진 → 단계 방향만). 앞 단계 값·설정은 엔진이 넘긴 입력(ctx)만 읽는다.
 * 세 동작(PRD §5.3):
 * - 검색·비교(`run`): 검색어 검사 → Item Search(6시간 캐시) → 상품명 아동 단어 행 빼기 → `sourcing_comparison` + API 행 →
 *   SSE `sourcing.search-completed` → 앵커 입력 대기(앵커가 이미 있으면 선택 대기 — P2-03이 앵커 분류·페이지 조회·선택을 붙인다)
 * - URL로 만들기: 후보 만들기 트랜잭션 안에서 `UrlCandidateExtension`이 `StepEngineApi.recordInlineRun`으로 버전을 쓴다
 * - 재조회(`refetch`): 고른 상품 페이지 1건만 새로 읽어(fetch_reason=REFETCH) 새 버전 + 행·쿠폰 복사
 * 시작 전 검사(`beforeStart`): 검색어 형식 422, 키 409, 재조회면 선택 없음 409·페이지 하루 상한·쉼 409.
 */
@StepRunnerFor('SOURCING')
@Injectable()
export class SourcingStepRunner implements StepRunner {
  readonly stepCode = 'SOURCING' as const;
  /** ② 자체는 AI를 부르지 않는다(동일 상품 AI 보조 F-BS-38은 P2-03 — 05-1 표 A 분류는 열린질문 P2-03) */
  readonly usesAi = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RAKUTEN_SEARCH_PORT) private readonly search: RakutenSearchPort,
    private readonly fetcher: RakutenItemFetcher,
    private readonly events: ProgressEventsService,
    private readonly gateway: ExternalHttpGateway,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
  ) {}

  // ── 입력 ────────────────────────────────────────────────────────────────

  /** STEP_INPUT_SPECS.SOURCING: 검색어·URL·앵커 키(후보 필드)·재고 판정 설정 5개·실행 중 검색어 직접 입력 */
  readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    const c = ctx.candidate;
    const values: Record<string, unknown> = {
      'candidate.rakutenQuery': c.rakutenQuery,
      'candidate.sourceUrl': c.sourceUrl,
      'candidate.anchorKey': c.anchorFixedAt
        ? { modelCode: c.anchorModelCode, itemCode: c.anchorItemCode, colorCode: c.anchorColorCode }
        : null,
    };
    return Promise.resolve(
      STEP_INPUT_SPECS.SOURCING.map((spec): StepInput => {
        const base = {
          inputKey: spec.inputKey,
          isStartCondition: spec.isStartCondition,
          required: spec.required,
        };
        if (spec.source === 'SETTINGS') {
          const path = settingsPathOf(spec.inputKey)!;
          return {
            ...base,
            sourceType: 'SETTINGS',
            value: readSettingsPath(ctx.settings, path) ?? null,
          };
        }
        // 후보 필드는 오너가 넣은 값(검색어·URL)과 ② 앵커다. 실행 중 검색어 직접 입력은 지문 밖(값 없음)
        return { ...base, sourceType: 'OWNER_INPUT', value: values[spec.inputKey] ?? null };
      }),
    );
  }

  /**
   * 검색어(규칙 4·F-SO-01·F-SO-36): 실행 중 입력 → 후보 검색어 → URL 후보면 앵커 상품의 型番(없으면 상품명 앞 단어, Proposed).
   * 없으면 null
   */
  async resolveQuery(
    db: Db,
    candidate: Readonly<Candidate>,
    ownerInputs: Readonly<Record<string, unknown>>,
  ): Promise<string | null> {
    const owner = ownerInputs.searchKeyword;
    if (typeof owner === 'string' && owner.trim() !== '') return owner.trim();
    if (candidate.rakutenQuery) return candidate.rakutenQuery;
    const base = await latestSelectionBase(db, candidate.id);
    if (!base) return null;
    const item = await db.rakutenItem.findUnique({
      where: { id: base.rakutenItemId },
      select: { modelCode: true, itemName: true },
    });
    if (!item) return null;
    return item.modelCode ?? keywordFromItemName(item.itemName);
  }

  // ── 시작 전 검사 ─────────────────────────────────────────────────────────

  async beforeStart(ctx: StepStartContext): Promise<void> {
    if (ctx.refetch) {
      // 재조회(F-SO-17): 소싱 선택이 없으면 409. 페이지 하루 상한·쉼은 202 전에 409로 알린다(실제로 보낼 때 관문이 다시 본다)
      const base = await latestSelectionBase(ctx.db, ctx.candidate.id);
      if (!base) throw new ApiException('SOURCING_SELECTION_REQUIRED');
      await this.gateway.assertCallable('RAKUTEN_PAGE');
      return;
    }
    const owner = ctx.ownerInputs.searchKeyword;
    if (owner !== undefined && owner !== null && typeof owner !== 'string') {
      throw new ApiException('VALIDATION_FAILED', {
        fieldErrors: [{ field: SEARCH_KEYWORD_FIELD, message: '글자여야 합니다.' }],
      });
    }
    const query = await this.resolveQuery(ctx.db, ctx.candidate, ctx.ownerInputs);
    if (!query) {
      throw new ApiException('RAKUTEN_QUERY_INVALID', {
        fieldErrors: [{ field: SEARCH_KEYWORD_FIELD, message: '라쿠텐 검색어를 넣어 주세요.' }],
      });
    }
    const field =
      typeof owner === 'string' && owner.trim() !== '' ? SEARCH_KEYWORD_FIELD : 'rakutenQuery';
    const fieldErrors = checkRakutenQuery(query, field);
    if (fieldErrors.length > 0) throw new ApiException('RAKUTEN_QUERY_INVALID', { fieldErrors });
    // 키는 키체인에만(없으면 ② 시작 전 409 — 캐시가 있어도 같다, P2-02 규칙 1)
    const missing = await missingRakutenKeys(this.secrets);
    if (missing.length > 0) throw rakutenKeysMissingException(missing);
  }

  // ── 실행 ────────────────────────────────────────────────────────────────

  /** 검색·비교(SEARCH_COMPARE) */
  async run(ctx: StepRunContext): Promise<StepOutcome> {
    const candidate = await this.prisma.candidate.findUniqueOrThrow({
      where: { id: ctx.candidateId },
    });
    const query = await this.resolveQuery(this.prisma, candidate, ctx.ownerInputs);
    if (!query || checkRakutenQuery(query).length > 0) {
      return {
        kind: 'FAILED',
        failureKind: 'INPUT_VALIDATION',
        errorCode: 'RAKUTEN_QUERY_INVALID',
        errorMessage: new ApiException('RAKUTEN_QUERY_INVALID').message,
      };
    }
    let result;
    try {
      result = await this.search.search(
        { keyword: query, page: 1 },
        { candidateId: ctx.candidateId, stepRunId: ctx.stepRunId },
      );
    } catch (error) {
      return sourcingFailureOf(error);
    }
    const { rows, excluded } = filterSearchRows(result.items, ctx.settings, result.fetchedAt);
    const anchor = await this.anchorPreset(candidate, ctx.stepRunId);
    const output: SearchCompareOutput = {
      action: 'SEARCH_COMPARE',
      searchKeyword: query,
      sourceUrl: candidate.sourceUrl,
      params: sourcingParamsOf(ctx.settings),
      anchor,
      rows,
      excludedRowCount: excluded,
    };
    const reason = anchor ? SOURCING_WAITING_REASONS.SELECTION : SOURCING_WAITING_REASONS.ANCHOR;
    return {
      kind: 'WAITING_INPUT',
      waitingReasonCode: reason.code,
      pendingInputs: [...reason.pending],
      output,
    };
  }

  /** 다시 실행이면 후보의 앵커 키(F-SO-36: URL 후보는 그 상품이 앵커). 앵커가 없으면 null(탐색 모드) */
  private async anchorPreset(
    candidate: Readonly<Candidate>,
    stepRunId: number,
  ): Promise<AnchorPreset | null> {
    if (candidate.anchorFixedAt === null || candidate.anchorColorCode === null) return null;
    const prev = await this.prisma.sourcingComparison.findFirst({
      where: {
        stepRun: { candidateId: candidate.id, stepCode: 'SOURCING', id: { lt: stepRunId } },
        anchorInputMethod: { not: null },
      },
      orderBy: { stepRunId: 'desc' },
    });
    return {
      anchorInputMethod: (prev?.anchorInputMethod ??
        (candidate.anchorItemCode
          ? 'URL_ITEM'
          : 'CODE_ENTRY')) as AnchorPreset['anchorInputMethod'],
      anchorItemCode: prev?.anchorItemCode ?? candidate.anchorItemCode,
      anchorModelCode: prev?.anchorModelCode ?? candidate.anchorModelCode,
      anchorModelCodeNorm:
        prev?.anchorModelCodeNorm ?? normalizeModelCode(candidate.anchorModelCode),
      anchorColorCode: candidate.anchorColorCode,
      anchorColorLabel: prev?.anchorColorLabel ?? candidate.selectedColor,
    };
  }

  /** 재조회(REFETCH, F-SO-17): 고른 상품 페이지 1건만 새로 읽는다 */
  async refetch(ctx: StepRunContext): Promise<StepOutcome> {
    const base = await latestSelectionBase(this.prisma, ctx.candidateId, ctx.stepRunId);
    if (!base) {
      return {
        kind: 'FAILED',
        failureKind: 'INPUT_VALIDATION',
        errorCode: 'SOURCING_SELECTION_REQUIRED',
        errorMessage: new ApiException('SOURCING_SELECTION_REQUIRED').message,
      };
    }
    const baseItem = await this.prisma.rakutenItem.findUniqueOrThrow({
      where: { id: base.rakutenItemId },
      select: { entrySource: true, shopCode: true, itemUrl: true },
    });
    const url = parseRakutenItemUrl(baseItem.itemUrl) ?? {
      shopCode: baseItem.shopCode,
      itemSlug: '',
      url: baseItem.itemUrl,
    };
    let fetched;
    try {
      fetched = await this.fetcher.fetchSnapshot(url, {
        entrySource: baseItem.entrySource as 'API' | 'MANUAL',
        fetchReason: 'REFETCH',
        candidateId: ctx.candidateId,
        stepRunId: ctx.stepRunId,
        knownItemCode: { itemCode: base.itemCode, shopCode: baseItem.shopCode },
      });
    } catch (error) {
      return sourcingFailureOf(error);
    }
    const { item, checks } = fetched;
    if (checks.excludedWords.length > 0) {
      return sourcingFailureOf(excludedWordException(checks.excludedWords));
    }
    const shipping = base.comparisonPerformed
      ? null
      : shippingForColor(
          item.skus,
          base.anchorColorLabel,
          ctx.settings.sourcing.defaultShippingYen,
        );
    const output: RefetchOutput = {
      action: 'REFETCH',
      baseSourcingComparisonId: base.sourcingComparisonId,
      rakutenItemId: item.id,
      childSizeSuspect: checks.childSizeSuspect,
      genreScope: checks.genreScope,
      adultProductConfirmedAt: base.adultProductConfirmedAt?.toISOString() ?? null,
      shippingYen: shipping?.shippingYen ?? null,
      shippingSource: shipping?.shippingSource ?? null,
    };
    if (checks.adultConfirmationRequired && base.adultProductConfirmedAt === null) {
      return {
        kind: 'WAITING_INPUT',
        waitingReasonCode: SOURCING_WAITING_REASONS.ADULT.code,
        pendingInputs: [...SOURCING_WAITING_REASONS.ADULT.pending],
        output,
      };
    }
    return { kind: 'COMPLETED', output };
  }

  // ── 산출물 ──────────────────────────────────────────────────────────────

  async persist(
    tx: Tx,
    stepRunId: number,
    outcome: StepOutcome,
    hooks?: StepPersistHooks,
  ): Promise<void> {
    if (outcome.kind === 'FAILED') return;
    const output = outcome.output;
    if (!isSourcingOutput(output) || output.action === 'RESUMED') return;
    // 입력 대기를 끝내며 다시 불리면 이미 쓴 산출물을 두고 넘어간다
    if (await findComparisonByRun(tx, stepRunId)) return;
    if (output.action === 'SEARCH_COMPARE') {
      const head = await insertSearchCompare(tx, stepRunId, output);
      const run = await tx.stepRun.findUniqueOrThrow({
        where: { id: stepRunId },
        select: { candidateId: true },
      });
      const rowCount = await tx.sourcingComparisonRow.count({
        where: { sourcingComparisonId: head.id },
      });
      hooks?.afterCommit(() => {
        this.events.publish(
          'sourcing.search-completed',
          {
            candidateId: run.candidateId,
            sourcingComparisonId: head.id,
            stepRunId,
            rowCount,
            exploreMode: head.anchorInputMethod === null,
          },
          { candidateId: run.candidateId },
        );
      });
      return;
    }
    if (output.action === 'URL_CREATE') {
      await insertUrlCreate(tx, stepRunId, output);
      return;
    }
    await insertRefetch(tx, stepRunId, output);
  }

  /** 이전 버전 다시 고르기(RESTORE_VERSION): 머리 행·행 복사. 소싱 선택이 있는 버전이면 후보의 선택을 그 값으로 */
  async copyOutput(
    tx: Tx,
    fromStepRunId: number,
    toStepRunId: number,
    edit?: unknown,
  ): Promise<CandidateEffects | void> {
    if (edit !== undefined && edit !== null) throw new ApiException('FIELD_NOT_EDITABLE');
    const head = await copyComparison(tx, fromStepRunId, toStepRunId);
    if (!head) return;
    const selected = head.comparisonPerformed
      ? await tx.sourcingComparisonRow.findFirst({
          where: { sourcingComparisonId: head.id, isSelected: true },
          select: { itemCode: true },
        })
      : head.selectedRakutenItemId
        ? await tx.rakutenItem.findUnique({
            where: { id: head.selectedRakutenItemId },
            select: { itemCode: true },
          })
        : null;
    if (!selected || !head.anchorColorLabel) return;
    return {
      sourcingSelection: { itemCode: selected.itemCode, selectedColor: head.anchorColorLabel },
    };
  }

  /** 다시 실행 기본값(규칙 7): 그 버전의 검색어 */
  async ownerInputsOf(db: Tx, stepRunId: number): Promise<Record<string, unknown>> {
    const head = await findComparisonByRun(db, stepRunId);
    return head?.action === 'SEARCH_COMPARE' && head.searchKeyword
      ? { searchKeyword: head.searchKeyword }
      : {};
  }

  /** 버전의 앵커 키(이전 버전 다시 고르기 409 ANCHOR_KEY_MISMATCH 검사) */
  async anchorKeyOf(db: Tx, stepRunId: number): Promise<AnchorKeyInput | null> {
    const head = await findComparisonByRun(db, stepRunId);
    return head ? anchorKeyOfHead(head) : null;
  }
}

/**
 * 머리 행의 앵커 → 후보 앵커 키(型番이 있으면 型番 **정규화값**(candidate.anchor_model_code — ERD), 없으면 앵커 상품 —
 * ck_candidate_anchor_one). 색상 코드가 없으면 null
 */
export function anchorKeyOfHead(head: {
  anchorModelCodeNorm: string | null;
  anchorModelCode: string | null;
  anchorItemCode: string | null;
  anchorColorCode: string | null;
}): AnchorKeyInput | null {
  if (!head.anchorColorCode) return null;
  const model = head.anchorModelCodeNorm ?? normalizeModelCode(head.anchorModelCode);
  if (model) return { anchorModelCode: model, anchorColorCode: head.anchorColorCode };
  if (head.anchorItemCode) {
    return { anchorItemCode: head.anchorItemCode, anchorColorCode: head.anchorColorCode };
  }
  return null;
}

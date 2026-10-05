import type {
  Prisma,
  SourcingComparison,
  SourcingComparisonRow,
} from '../../generated/prisma/client.js';
import type {
  AnchorPreset,
  RefetchOutput,
  SearchCompareOutput,
  SearchRowDraft,
  UrlCreateOutput,
} from './sourcing-output.js';

/**
 * ② 산출물 쓰기(ERD `sourcing_comparison`·`sourcing_comparison_row`). 실행기 `persist`·`copyOutput`이 끝 트랜잭션
 * 안에서 부른다(`trg_output_frozen`: ② StepRun이 실행 중·입력 대기일 때만 고칠 수 있다 — 새 버전 쓰기는 그 버전이 열려 있을 때다).
 * 버전마다 자기완결: 재조회·이전 버전 다시 고르기는 새 머리 행 + 행 복사(ERD §7.2-12).
 */
type Tx = Prisma.TransactionClient;

function anchorColumns(anchor: AnchorPreset | null) {
  return {
    anchorInputMethod: anchor?.anchorInputMethod ?? null,
    anchorItemCode: anchor?.anchorItemCode ?? null,
    anchorModelCode: anchor?.anchorModelCode ?? null,
    anchorModelCodeNorm: anchor?.anchorModelCodeNorm ?? null,
    anchorColorCode: anchor?.anchorColorCode ?? null,
    anchorColorLabel: anchor?.anchorColorLabel ?? null,
  };
}

/** 평점 0.00~5.00(ck_scr_review). 범위 밖이면 null */
function reviewAverage(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 5) return null;
  return Math.round(value * 100) / 100;
}

/** smallint 범위 */
function smallint(value: number | null): number | null {
  if (value === null || !Number.isInteger(value) || value < -32768 || value > 32767) return null;
  return value;
}

export function findComparisonByRun(db: Tx, stepRunId: number): Promise<SourcingComparison | null> {
  return db.sourcingComparison.findUnique({ where: { stepRunId } });
}

/**
 * 검색 결과 한 행 → API 행 INSERT 값(더 보기 행·앵커 뒤 '같은 상품 검색' 행도 같은 모양).
 * 같은 상품 검색으로 더한 행은 검색 순위가 없다(null — 순위를 쓰는 정렬은 null을 가장 뒤로 둔다)
 */
export function apiRowCreateData(
  sourcingComparisonId: number,
  row: Omit<SearchRowDraft, 'searchRank'> & { searchRank: number | null },
): Prisma.SourcingComparisonRowCreateManyInput {
  return {
    sourcingComparisonId,
    rowSource: 'API',
    searchRank: smallint(row.searchRank),
    itemCode: row.itemCode.slice(0, 128),
    shopCode: row.shopCode.slice(0, 64),
    shopName: row.shopName?.slice(0, 255) ?? null,
    itemName: row.itemName,
    itemUrl: row.itemUrl.slice(0, 2048),
    // 2048자를 넘는 주소는 잘라 쓰면 깨지므로 비운다(사진 칸은 비어 있어도 된다)
    imageUrl: row.imageUrl !== null && row.imageUrl.length <= 2048 ? row.imageUrl : null,
    apiItemPriceYen: row.apiItemPriceYen,
    apiItemPriceMin3Yen: row.apiItemPriceMin3Yen,
    apiPointRate: smallint(row.apiPointRate),
    apiPostageFlag: smallint(row.apiPostageFlag),
    reviewCount: row.reviewCount,
    reviewAverage: reviewAverage(row.reviewAverage),
    shipOverseas: row.shipOverseas,
    apiCollectedAt: new Date(row.apiCollectedAt),
  };
}

/**
 * 검색·비교 버전(SEARCH_COMPARE): 머리 행 + API 행(아동 단어 행은 이미 뺐다). 같은 후보의 앞 비교 버전이 있으면(② 다시
 * 실행, P2-03 — ERD §7.2-12) `base_sourcing_comparison_id`로 잇고 같은 itemCode 행의 쿠폰·샵·이벤트 배율을 기본값으로
 * 옮기며, 앞 버전의 수동 행(오너가 넣은 상품)을 가져온다(선택 표시는 빼고)
 */
export async function insertSearchCompare(
  tx: Tx,
  stepRunId: number,
  output: SearchCompareOutput,
): Promise<SourcingComparison> {
  const run = await tx.stepRun.findUniqueOrThrow({
    where: { id: stepRunId },
    select: { candidateId: true },
  });
  const base = await tx.sourcingComparison.findFirst({
    where: {
      comparisonPerformed: true,
      stepRun: { candidateId: run.candidateId, stepCode: 'SOURCING', id: { lt: stepRunId } },
    },
    orderBy: { stepRunId: 'desc' },
    include: { rows: { orderBy: { id: 'asc' } } },
  });
  const head = await tx.sourcingComparison.create({
    data: {
      stepRunId,
      baseSourcingComparisonId: base?.id ?? null,
      action: 'SEARCH_COMPARE',
      searchKeyword: output.searchKeyword.slice(0, 128),
      sourceUrl: output.sourceUrl,
      comparisonPerformed: true,
      params: output.params as Prisma.InputJsonValue,
      ...anchorColumns(output.anchor),
    },
  });
  if (output.rows.length > 0) {
    await tx.sourcingComparisonRow.createMany({
      data: output.rows.map((row) => apiRowCreateData(head.id, row)),
      skipDuplicates: true,
    });
  }
  if (base) await carryOverRows(tx, head.id, base.rows);
  return head;
}

/** 앞 버전의 행별 쿠폰·배율(같은 itemCode)과 수동 행을 새 버전으로(P2-03) */
async function carryOverRows(
  tx: Tx,
  sourcingComparisonId: number,
  baseRows: readonly SourcingComparisonRow[],
): Promise<void> {
  const current = await tx.sourcingComparisonRow.findMany({
    where: { sourcingComparisonId },
    select: { id: true, itemCode: true },
  });
  const byCode = new Map(current.map((r) => [r.itemCode, r.id]));
  for (const row of baseRows) {
    const id = byCode.get(row.itemCode);
    if (id !== undefined) {
      if (row.couponYen !== 0 || !row.shopEventMultiplier.isZero()) {
        await tx.sourcingComparisonRow.update({
          where: { id },
          data: { couponYen: row.couponYen, shopEventMultiplier: row.shopEventMultiplier },
        });
      }
      continue;
    }
    if (row.rowSource === 'MANUAL') {
      await tx.sourcingComparisonRow.create({
        data: { ...rowCopy(row, sourcingComparisonId), isSelected: false, fetchOrder: null },
      });
    }
  }
}

/** URL로 만들기 버전(URL_CREATE): 비교 안 함, 행 0개, 소싱 선택 = URL 상품(ck_sc_url_no_compare·ck_sc_selection_uncompared) */
export function insertUrlCreate(
  tx: Tx,
  stepRunId: number,
  output: UrlCreateOutput,
): Promise<SourcingComparison> {
  return tx.sourcingComparison.create({
    data: {
      stepRunId,
      action: 'URL_CREATE',
      sourceUrl: output.sourceUrl.slice(0, 2048),
      comparisonPerformed: false,
      selectedRakutenItemId: output.rakutenItemId,
      shippingYen: output.shippingYen,
      shippingSource: output.shippingSource,
      detectedGender: output.detectedGender,
      genderBasis: output.detectedGender ? output.genderBasis : null,
      childSizeSuspect: output.childSizeSuspect,
      genreScope: output.genreScope,
      params: output.params as Prisma.InputJsonValue,
      ...anchorColumns(output.anchor),
    },
  });
}

/** 행을 복사할 때 새로 정하는 열(id·소속·시각) */
const ROW_COPY_SKIP = new Set(['id', 'sourcingComparisonId', 'createdAt', 'updatedAt']);

/** 행 복사용 값(id·소속·시각 빼고 그대로) */
function rowCopy(
  row: SourcingComparisonRow,
  sourcingComparisonId: number,
): Prisma.SourcingComparisonRowCreateManyInput {
  const rest = Object.fromEntries(
    Object.entries(row).filter(([key]) => !ROW_COPY_SKIP.has(key)),
  ) as Omit<SourcingComparisonRow, 'id' | 'sourcingComparisonId' | 'createdAt' | 'updatedAt'>;
  return { ...rest, aiMatch: rest.aiMatch ?? undefined, sourcingComparisonId };
}

/** 머리 행 복사용 값(새 버전) */
function headCopy(
  base: SourcingComparison,
  stepRunId: number,
): Prisma.SourcingComparisonUncheckedCreateInput {
  return {
    stepRunId,
    baseSourcingComparisonId: base.id,
    action: base.action,
    searchKeyword: base.searchKeyword,
    sourceUrl: base.sourceUrl,
    anchorInputMethod: base.anchorInputMethod,
    anchorItemCode: base.anchorItemCode,
    anchorModelCode: base.anchorModelCode,
    anchorModelCodeNorm: base.anchorModelCodeNorm,
    anchorColorCode: base.anchorColorCode,
    anchorColorLabel: base.anchorColorLabel,
    comparisonPerformed: base.comparisonPerformed,
    selectedRakutenItemId: base.selectedRakutenItemId,
    shippingYen: base.shippingYen,
    shippingSource: base.shippingSource,
    detectedGender: base.detectedGender,
    genderBasis: base.genderBasis,
    ownerGender: base.ownerGender,
    childSizeSuspect: base.childSizeSuspect,
    genreScope: base.genreScope,
    adultProductConfirmedAt: base.adultProductConfirmedAt,
    params: base.params as Prisma.InputJsonValue,
  };
}

/**
 * 재조회 버전(REFETCH, F-SO-17): 앞 버전의 머리 행·행과 행별 쿠폰·배율을 복사하고, 고른 상품만 새 페이지 스냅샷으로 바꾼다.
 * - 비교를 한 버전: `is_selected` 행의 rakuten_item_id를 새 스냅샷으로(재고·실질가 다시 계산은 실행기 persist가
 *   `SourcingComparisonRepository.applySnapshot`으로 한다 — P2-03)
 * - 비교를 하지 않은 버전(URL로 만들기와 그 재조회): selected_rakuten_item_id·송료를 새 값으로. action은 REFETCH
 *   (ck_sc_url_no_compare는 URL_CREATE에만 걸려 REFETCH는 comparison_performed=false를 그대로 둘 수 있다)
 */
export async function insertRefetch(
  tx: Tx,
  stepRunId: number,
  output: RefetchOutput,
): Promise<SourcingComparison> {
  const base = await tx.sourcingComparison.findUniqueOrThrow({
    where: { id: output.baseSourcingComparisonId },
    include: { rows: { orderBy: { id: 'asc' } } },
  });
  const data = headCopy(base, stepRunId);
  data.action = 'REFETCH';
  if (output.params) data.params = output.params as Prisma.InputJsonValue;
  data.childSizeSuspect = output.childSizeSuspect;
  data.genreScope = output.genreScope;
  data.adultProductConfirmedAt = output.adultProductConfirmedAt
    ? new Date(output.adultProductConfirmedAt)
    : null;
  if (!base.comparisonPerformed) {
    data.selectedRakutenItemId = output.rakutenItemId;
    if (output.shippingSource !== null && output.shippingYen !== null) {
      data.shippingYen = output.shippingYen;
      data.shippingSource = output.shippingSource;
    }
  }
  const head = await tx.sourcingComparison.create({ data });
  if (base.comparisonPerformed && base.rows.length > 0) {
    await tx.sourcingComparisonRow.createMany({
      data: base.rows.map((row) => {
        const copy = rowCopy(row, head.id);
        if (row.isSelected) {
          copy.rakutenItemId = output.rakutenItemId;
          copy.isVerified = true;
        }
        return copy;
      }),
    });
  }
  return head;
}

/** 버전 통째 복사(이전 버전 다시 고르기 — 실행기 copyOutput) */
export async function copyComparison(
  tx: Tx,
  fromStepRunId: number,
  toStepRunId: number,
): Promise<SourcingComparison | null> {
  const base = await tx.sourcingComparison.findUnique({
    where: { stepRunId: fromStepRunId },
    include: { rows: { orderBy: { id: 'asc' } } },
  });
  if (!base) return null;
  const head = await tx.sourcingComparison.create({ data: headCopy(base, toStepRunId) });
  if (base.rows.length > 0) {
    await tx.sourcingComparisonRow.createMany({
      data: base.rows.map((row) => rowCopy(row, head.id)),
    });
  }
  return head;
}

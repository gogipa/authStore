import { api, installApiRuntime } from '@/shared/api/client';
import { createDemoApi, type DemoApi } from '../demoApi';

/**
 * 따라 하기 모델 시험 도구: 지연 없는(0ms) 체험 API를 만들고 `api`의 전송을 바꾼다. `demo.world.flush()`가 맡겨 둔 결과(입력 대기·
 * 완료·수집 진행)를 기다리지 않고 지금 모두 낸다. 시험이 끝나면 `off()`.
 */
export function startDemoKit(): { demo: DemoApi; off: () => void } {
  const demo = createDemoApi({ delays: { short: 0, medium: 0, long: 0 } });
  return { demo, off: installApiRuntime(demo) };
}

const CANDIDATE = 1;

/** ① [수집] → 남성신발 '아식스 젤카야노14' 고르기 → [이 검색어로 소싱](여정 만들기 + ② 실행) → ② 입력 대기 */
export async function reachSourcingSearch(demo: DemoApi): Promise<void> {
  await api.POST('/keyword-snapshots', { body: { method: 'BUTTON', rankLimit: 100 } as never });
  demo.world.flush();
  await api.PUT('/keywords/{keywordId}/selection', { params: { path: { keywordId: 101 } } });
  await api.POST('/candidates', {
    body: {
      creationPath: 'KEYWORD',
      sourceKeywordId: 101,
      rakutenQuery: '아식스 젤카야노14',
    } as never,
  });
  await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
    params: { path: { candidateId: CANDIDATE, stepCode: 'SOURCING' } },
    body: {},
  });
  demo.world.flush();
}

/** ② 앵커(ショップA) → 페이지 조회 → ショップA 고르기 = ② 완료 */
export async function reachSourcingDone(demo: DemoApi): Promise<void> {
  await reachSourcingSearch(demo);
  const comparison = await api.GET('/candidates/{candidateId}/sourcing-comparison', {
    params: { path: { candidateId: CANDIDATE } },
  });
  const id = comparison.data!.id;
  await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/anchor', {
    params: { path: { sourcingComparisonId: id } },
    body: {
      anchorInputMethod: 'SEARCH_PICK',
      anchorItemCode: 'shop-a:10000123',
      anchorColorCode: null,
    } as never,
  });
  demo.world.flush();
  await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/selection', {
    params: { path: { sourcingComparisonId: id } },
    body: { rowId: 411 },
  });
}

export const FULL_CHECKLIST = {
  shoeRatioOver70: true,
  detailMatch: true,
  colorMatchesSelectedColor: true,
  referenceNoPerson: true,
  noRealPersonResemblance: true,
  noTextOrPrice: true,
  singleProductSingleModel: true,
};

const pathOf = { params: { path: { candidateId: CANDIDATE } } };

/** ③ 국내 기준가 169,000원 [저장] → [실행] → [소싱 확정(G2)] */
export async function reachPricingDone(demo: DemoApi): Promise<void> {
  await reachSourcingDone(demo);
  await api.POST('/candidates/{candidateId}/domestic-prices', {
    ...pathOf,
    body: { pRefKrw: 169_000, sourceUrl: null, sourceKind: 'MANUAL' } as never,
  });
  await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
    params: { path: { candidateId: CANDIDATE, stepCode: 'PRICING' } },
    body: {},
  });
  demo.world.flush();
  const judgement = await api.GET('/candidates/{candidateId}/price-judgement', pathOf);
  await api.POST('/candidates/{candidateId}/gates/{gateCode}/pass', {
    params: { path: { candidateId: CANDIDATE, gateCode: 'G2' } },
    body: { basisStepRunId: judgement.data!.stepRunId },
  });
}

/** ④ [실행] → 러닝화 → [이 카테고리로 확정] */
export async function reachCategoryDone(demo: DemoApi): Promise<void> {
  await reachPricingDone(demo);
  await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
    params: { path: { candidateId: CANDIDATE, stepCode: 'CATEGORY' } },
    body: {},
  });
  demo.world.flush();
  const decision = await api.GET('/candidates/{candidateId}/category-decision', pathOf);
  const leaf = decision.data!.categoryOptions!.find((o) => o.wholeCategoryName.endsWith('러닝화'))!;
  await api.PUT('/category-decisions/{categoryDecisionId}/selection', {
    params: { path: { categoryDecisionId: decision.data!.id } },
    body: { leafCategoryId: leaf.leafCategoryId, kcExemptAdultConfirmed: false } as never,
  });
}

/** ⑤ [실행] → 레퍼런스·사람 없음 → 만들기 → 대표·추가 → G3 */
export async function reachThumbnailDone(demo: DemoApi): Promise<void> {
  await reachCategoryDone(demo);
  await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
    params: { path: { candidateId: CANDIDATE, stepCode: 'THUMBNAIL' } },
    body: {},
  });
  demo.world.flush();
  const run = (await api.GET('/candidates/{candidateId}/thumbnail', pathOf)).data!.stepRunId;
  await api.PUT('/step-runs/{stepRunId}/thumbnail-references', {
    params: { path: { stepRunId: run } },
    body: { references: [{ imageAssetId: 1, sortOrder: 1 }], noPersonConfirmed: true },
  });
  await api.POST('/step-runs/{stepRunId}/generation-runs', {
    params: { path: { stepRunId: run } },
    body: { slotNos: [1, 2], faceOption: 'FULL_FACE', promptAdjustment: null },
  });
  demo.world.flush();
  const images = (
    await api.GET('/candidates/{candidateId}/thumbnail', pathOf)
  ).data!.generationRuns.map((g) => g.resultImageAssetId!);
  await api.POST('/candidates/{candidateId}/gates/{gateCode}/pass', {
    params: { path: { candidateId: CANDIDATE, gateCode: 'G3' } },
    body: {
      basisStepRunId: run,
      representativeImageAssetId: images[0],
      additionalImageAssetIds: [images[1]],
      checklist: FULL_CHECKLIST,
    } as never,
  });
}

/** ⑥ [여기부터 연속 실행] → ⑥-1~⑧ 완료 → 최종 승인 앞에서 멈춤(승인대기) */
export async function reachUploadDone(demo: DemoApi): Promise<void> {
  await reachThumbnailDone(demo);
  await api.POST('/candidates/{candidateId}/continuous-runs', {
    ...pathOf,
    body: { kind: 'FROM_HERE', startStepCode: 'COPY' },
  });
  demo.world.flush();
}

/** 최종 승인에서 [승인·등록] 한 번(차단 상태 그대로 — 켬이면 드라이런) */
export async function approveOnce(demo: DemoApi): Promise<void> {
  const preview = await api.GET('/candidates/{candidateId}/approval', pathOf);
  await api.POST('/candidates/{candidateId}/registrations', {
    ...pathOf,
    params: { ...pathOf.params, header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: {
      optionType: 'COMBINATION',
      expectedUploadResultId: preview.data!.uploadResultId,
      expectedPriceJudgementId: preview.data!.priceJudgementId,
    },
  });
  demo.world.flush();
}

/** 드라이런 승인 → 차단 끄기 → 승인 = 등록됨 */
export async function reachRegistered(demo: DemoApi): Promise<void> {
  await reachUploadDone(demo);
  await approveOnce(demo);
  await api.PUT('/registration-switch', { body: { apiBlocked: false } });
  await approveOnce(demo);
}

/** ⑤ 현재 버전 id와 이 버전에서 만든 후보 이미지 id(슬롯 순서) */
export async function thumbnailImages(): Promise<{ stepRunId: number; images: number[] }> {
  const output = (await api.GET('/candidates/{candidateId}/thumbnail', pathOf)).data!;
  return {
    stepRunId: output.stepRunId,
    images: output.generationRuns.map((g) => g.resultImageAssetId!),
  };
}

/** G3 [썸네일 선택(G3)]: 대표 1장 + 추가 N장(체크 7개 모두 체크) */
export function passG3(basisStepRunId: number, representative: number, additional: number[] = []) {
  return api.POST('/candidates/{candidateId}/gates/{gateCode}/pass', {
    params: { path: { candidateId: CANDIDATE, gateCode: 'G3' } },
    body: {
      basisStepRunId,
      representativeImageAssetId: representative,
      additionalImageAssetIds: additional,
      checklist: FULL_CHECKLIST,
    } as never,
  });
}

/** ④ 입력 대기에서 이름이 `suffix`로 끝나는 리프를 고른다(워킹화는 KC 면제 성인용 확인이 필요) */
export async function chooseLeaf(suffix: string, kcExemptAdultConfirmed = false) {
  const decision = (await api.GET('/candidates/{candidateId}/category-decision', pathOf)).data!;
  const leaf = decision.categoryOptions!.find((o) => o.wholeCategoryName.endsWith(suffix))!;
  return api.PUT('/category-decisions/{categoryDecisionId}/selection', {
    params: { path: { categoryDecisionId: decision.id } },
    body: { leafCategoryId: leaf.leafCategoryId, kcExemptAdultConfirmed } as never,
  });
}

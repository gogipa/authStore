import type { DemoWorld } from '../../demoWorld';
import { get, post, type DemoRoute } from '../../router';
import {
  domesticPriceEntryOf,
  judgeSale,
  judgementFingerprint,
  MIN_DOMESTIC_PRICE_KRW,
  naverShoppingLinksOf,
  priceJudgementOf,
  type DomesticPriceRec,
} from '../../sample/pricing';
import { STORY } from '../../sample/story';
import type { Schema } from '../../sample/types';
import { fakeSha256, pageOf } from '../../sample/util';
import { currentRun, ownerInputChanged, reevaluate, resumeToComplete } from '../engine';
import { httpError } from '../errors';
import { pageQuery } from '../query';
import type { StepRunner } from '../runner';
import {
  assertMutable,
  assertQueryKeys,
  findStepRun,
  invalidQuery,
  isId,
  isInt,
  outputNotFound,
  stepLocked,
  stepNotCompleted,
  stepRunIdQuery,
  stepRunNotFound,
  throwIfFieldErrors,
  versionNotCurrent,
  type FieldErrors,
} from './guards';

/**
 * ③ 판정 + G2 소싱 확정 + 국내 기준가 + 네이버쇼핑 링크. 환율·요금표는 설정 라우트(`settingsRoutes`)가 답한다.
 * 근거: BE `modules/pricing`(pricing-step.runner · domestic-prices · price-judgement · g2-basis.provider)와
 * `step-engine/gates`(G2 통과).
 *
 * - 국내 기준가가 없으면 ③은 입력 대기(`PRICING_DOMESTIC_PRICE_REQUIRED`), 있으면 곧바로 판정한다. 입력 대기에서 국내 기준가를
 *   넣으면 같은 실행을 이어 계산한다. 완료된 뒤 다른 금액을 넣으면 재실행 필요, 같은 금액이면 그대로(금액 해시만 본다).
 * - 판정 결과는 입력한 국내 기준가로 계산한다(`judgeSale`: 169,000원 → 판매가 167,300원 · 순이익 27,418원 · 16.4%).
 * - 판정 스냅샷(`judgement`)은 실행이 끝나야 생긴다 — 새 실행이 시작되면 포인터가 스냅샷 없는 새 실행으로 옮겨 가 조회가 404다.
 */
export interface PricingState {
  /** 국내 기준가 입력 기록(최신이 앞). 추가만 한다 */
  domesticPrices: DomesticPriceRec[];
  /** 현재 ③ 실행의 판정 스냅샷(실행이 끝나기 전·다시 시작한 직후는 null). `fingerprint`는 G2 구성값(판매 사이즈·사이즈별 판매가)이다 */
  judgement: {
    stepRunId: number;
    domesticPriceId: number;
    pRefKrw: number;
    salePriceKrw: number;
    fingerprint: string;
  } | null;
  /** G2를 통과할 때의 판정 지문. 현재 판정의 지문과 다르면 G2는 무효(MISMATCH)다 — 판매가가 달라졌을 때만 */
  g2Fingerprint: string | null;
  /** G2를 통과할 때의 판매가(원) — 무효일 때 '바뀐 구성값'(`salePrices.*`)을 알리는 데 쓴다 */
  g2SalePriceKrw: number | null;
}

export const initialPricing = (): PricingState => ({
  domesticPrices: [],
  judgement: null,
  g2Fingerprint: null,
  g2SalePriceKrw: null,
});

/** 국내 기준가를 넣었는가(띠의 '다음에 할 일' 판단) */
export const domesticPriceEntered = (s: PricingState): boolean => s.domesticPrices.length > 0;

const latestDomesticPrice = (s: PricingState): DomesticPriceRec | undefined => s.domesticPrices[0];

// ── 실행기 ─────────────────────────────────────────────────────────────────

export const pricingRunner: StepRunner = {
  stepCode: 'PRICING',
  delay: 'short',
  beforeStart(_w, body) {
    // 예시 여정은 비교표를 거친 키워드 여정이라 쿠폰은 비교표 행에 있다(URL 여정만 실행 때 쿠폰을 넣는다)
    const coupon = body.ownerInputs?.couponYen;
    if (coupon !== undefined && coupon !== null) {
      throw httpError(
        422,
        'COUPON_NOT_ALLOWED',
        '비교표가 있는 여정은 비교표 행에서 쿠폰을 넣어 주세요.',
        {
          fieldErrors: [
            {
              field: 'ownerInputs.couponYen',
              message: '비교표가 있는 여정은 비교표 행에서 쿠폰을 넣어 주세요.',
              rejectedValue: coupon,
            },
          ],
        },
      );
    }
  },
  onStart(w) {
    // 새 실행은 판정 스냅샷이 아직 없다(국내 기준가·G2 통과 기록은 그대로 둔다)
    w.s.pricing.judgement = null;
  },
  outcome(w) {
    if (!latestDomesticPrice(w.s.pricing)) {
      return {
        status: 'WAITING_INPUT',
        reasonCode: 'PRICING_DOMESTIC_PRICE_REQUIRED',
        pendingInputs: ['owner.domesticPrice'],
      };
    }
    return { status: 'COMPLETED' };
  },
  onSettled(w, outcome) {
    if (outcome.status !== 'COMPLETED') return;
    const run = currentRun(w, 'PRICING');
    const price = latestDomesticPrice(w.s.pricing);
    if (!run || !price) return;
    // 판매 사이즈·판매가가 달라지면 이미 통과한 G2는 무효가 된다(BE 게이트 지문 불일치 — `gateValid`가 지문을 견준다)
    w.s.pricing.judgement = {
      stepRunId: run.id,
      domesticPriceId: price.id,
      pRefKrw: price.pRefKrw,
      salePriceKrw: judgeSale(price.pRefKrw).salePriceKrw,
      fingerprint: judgementFingerprint(price.pRefKrw),
    };
  },
};

// ── 국내 기준가 ────────────────────────────────────────────────────────────

const PRICE_MAX = 2_147_483_647;

/** 요청 모양 검사(BE `CreateDomesticPriceDto` + M1에서 받지 않는 값) */
function checkDomesticPriceBody(body: Record<string, unknown>): void {
  const errors: FieldErrors = [];
  const { pRefKrw, sourceLabel, sourceUrl, sourceKind, domesticPriceImportRowId } = body;
  if (!isInt(pRefKrw)) {
    errors.push({ field: 'pRefKrw', message: '정수여야 합니다.', rejectedValue: pRefKrw });
  } else if (pRefKrw < 1) {
    errors.push({ field: 'pRefKrw', message: '0보다 커야 합니다.', rejectedValue: pRefKrw });
  } else if (pRefKrw > PRICE_MAX) {
    errors.push({
      field: 'pRefKrw',
      message: '2,147,483,647 이하여야 합니다.',
      rejectedValue: pRefKrw,
    });
  }
  if (sourceLabel !== undefined && sourceLabel !== null) {
    if (typeof sourceLabel !== 'string') {
      errors.push({
        field: 'sourceLabel',
        message: '글자여야 합니다.',
        rejectedValue: sourceLabel,
      });
    } else if (sourceLabel.length > 100) {
      errors.push({ field: 'sourceLabel', message: '100자 이내여야 합니다.' });
    }
  }
  if (sourceUrl !== undefined && sourceUrl !== null) {
    if (typeof sourceUrl !== 'string') {
      errors.push({ field: 'sourceUrl', message: '글자여야 합니다.', rejectedValue: sourceUrl });
    } else if (sourceUrl.length > 2048) {
      errors.push({ field: 'sourceUrl', message: '2048자 이내여야 합니다.' });
    } else if (!/^https?:\/\/\S+$/i.test(sourceUrl.trim())) {
      errors.push({
        field: 'sourceUrl',
        message: 'http(s) 주소여야 합니다.',
        rejectedValue: sourceUrl,
      });
    }
  }
  if (sourceKind !== undefined && sourceKind !== 'MANUAL' && sourceKind !== 'SELLAFINDER') {
    errors.push({
      field: 'sourceKind',
      message: 'MANUAL 또는 SELLAFINDER여야 합니다.',
      rejectedValue: sourceKind,
    });
  }
  throwIfFieldErrors(errors);
  // M1에서 받지 않는 값(셀라파인더)
  const m2: FieldErrors = [];
  if (sourceKind !== undefined && sourceKind !== 'MANUAL') {
    m2.push({
      field: 'sourceKind',
      message: 'M1에서는 직접 입력(MANUAL)만 받습니다.',
      rejectedValue: sourceKind,
    });
  }
  if (domesticPriceImportRowId !== undefined && domesticPriceImportRowId !== null) {
    m2.push({
      field: 'domesticPriceImportRowId',
      message: '셀라파인더 가져오기는 M2입니다.',
      rejectedValue: domesticPriceImportRowId,
    });
  }
  throwIfFieldErrors(m2);
}

/**
 * `POST …/domestic-prices`(201): 입력 기록을 더한다. ③을 실행하지는 않는다 — ③이 입력 대기면 같은 실행을 이어 계산한다(RUNNING으로
 * 답하고 곧 완료). 검사 순서: 모양 → 잠금·제외 → ③ 실행 중(409).
 */
function createDomesticPrice(
  w: DemoWorld,
  body: Record<string, unknown>,
): Schema<'DomesticPriceCreated'> {
  checkDomesticPriceBody(body);
  assertMutable(w);
  const pricing = w.s.steps.PRICING;
  if (pricing.status === 'RUNNING') {
    throw stepLocked('PRICING', { stepCode: 'PRICING', runningStepCode: 'PRICING' });
  }
  if (pricing.status === 'WAITING_INPUT') {
    // 입력 대기를 이어 가려면 앞(②)·뒤(⑥-3) 단계가 실행 중이 아니어야 한다
    for (const code of ['SOURCING', 'NOTICE_HTML'] as const) {
      if (w.s.steps[code].status === 'RUNNING') {
        throw stepLocked(code, { stepCode: 'PRICING', runningStepCode: code });
      }
    }
  }
  const pRefKrw = body.pRefKrw as number;
  if (pRefKrw < MIN_DOMESTIC_PRICE_KRW) {
    // 실제 BE는 이 값도 받고 '판매 후보 아님'으로 여정을 제외한다. 체험은 거기서 이어 갈 수 없어 미리 안내한다
    throw httpError(
      403,
      'DEMO_READ_ONLY',
      `체험에서는 국내 기준가를 ${MIN_DOMESTIC_PRICE_KRW.toLocaleString('ko-KR')}원 이상으로 넣어 주세요. 이보다 낮으면 판매 가능한 사이즈가 없어 여정이 제외되는데, 체험은 거기서 이어 갈 수 없습니다.`,
    );
  }
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : '';
  const rec: DomesticPriceRec = {
    id: w.s.pricing.domesticPrices.length + 1,
    pRefKrw,
    sourceUrl: sourceUrl === '' ? null : sourceUrl,
    enteredAt: w.now(),
  };
  w.s.pricing.domesticPrices.unshift(rec);
  w.mark('domesticPriceEntered');

  let status: Schema<'DomesticPriceCreated'>['pricingStepStatus'] = pricing.status;
  if (pricing.status === 'WAITING_INPUT') {
    resumeToComplete(w, 'PRICING', 'short');
    status = 'RUNNING';
  } else if (pricing.status === 'COMPLETED' || pricing.status === 'RERUN_REQUIRED') {
    // 완료 뒤 값(금액)이 바뀌면 ③을 재실행 필요로 둔다(BE `ownerInputChanged('owner.domesticPrice')` — 쓴 값과 견준다)
    ownerInputChanged(w, 'owner.domesticPrice');
    status = pricing.status;
  }
  return { ...domesticPriceEntryOf(w.candidate().id, rec), pricingStepStatus: status };
}

// ── 판정 조회 ──────────────────────────────────────────────────────────────

/** `GET …/price-judgement`: 현재(또는 `?stepRunId=`) 버전의 판정 스냅샷. 실행 전·입력 대기·다시 실행 중이면 404 STEP_OUTPUT_NOT_FOUND */
function judgementView(w: DemoWorld, query: URLSearchParams): Schema<'PriceJudgementDetail'> {
  assertQueryKeys(query, ['stepRunId']);
  const asked = stepRunIdQuery(query);
  const current = currentRun(w, 'PRICING');
  const runId = asked ?? current?.id ?? null;
  if (runId === null) throw outputNotFound('PRICING');
  const found = findStepRun(w, runId);
  if (!found) throw stepRunNotFound();
  if (found.code !== 'PRICING')
    throw invalidQuery('stepRunId', '이 여정의 ③ 판정 실행이 아닙니다.');
  const snapshot = w.s.pricing.judgement;
  if (!snapshot || snapshot.stepRunId !== found.run.id) throw outputNotFound('PRICING');
  const isCurrent = current?.id === found.run.id;
  return priceJudgementOf(w.clock, {
    stepRunId: found.run.id,
    version: found.run.version,
    stepStatus: isCurrent ? w.s.steps.PRICING.status : 'COMPLETED',
    isCurrent,
    candidateId: w.candidate().id,
    pageCollectedAt: w.s.times.pageCollected ?? found.run.startedAt,
    domesticPriceId: snapshot.domesticPriceId,
    pRefKrw: snapshot.pRefKrw,
    judgedAt: found.run.endedAt ?? w.now(),
  });
}

// ── G2 소싱 확정 ───────────────────────────────────────────────────────────

/**
 * `POST …/gates/G2/pass`(201, 같은 판정으로 이미 통과했으면 200): 화면이 본 ③ 현재 버전(`basisStepRunId`)을 소싱 확정으로 기록한다.
 * 검사 순서(BE `GateService.blockersOf`): 본문 모양 → 잠금·제외 → ② 실행 중 → 현재 버전이 아님 → ③ 미완료 → 판매 후보 아님.
 * 예시 여정은 비교표를 거친 여정이라 '비교 없이 확정'이 필요 없고, 국내 기준가 하한을 두어 판매 후보 아님도 나오지 않는다.
 */
export function passG2(
  w: DemoWorld,
  body: Record<string, unknown>,
): Schema<'GatePassResult'> | Response {
  const errors: FieldErrors = [];
  for (const key of Object.keys(body)) {
    if (body[key] !== undefined && key !== 'basisStepRunId') {
      errors.push({
        field: key,
        message: 'G2 통과에서는 받지 않는 칸입니다.',
        rejectedValue: body[key],
      });
    }
  }
  if (!isId(body.basisStepRunId)) {
    errors.push({
      field: 'basisStepRunId',
      message: '1 이상의 정수여야 합니다.',
      rejectedValue: body.basisStepRunId,
    });
  }
  throwIfFieldErrors(errors);

  const candidate = w.candidate();
  assertMutable(w);
  if (w.s.steps.SOURCING.status === 'RUNNING') throw stepLocked('SOURCING');
  const run = currentRun(w, 'PRICING');
  if (!run || run.id !== body.basisStepRunId) throw versionNotCurrent('PRICING', run?.id ?? null);
  const status = w.s.steps.PRICING.status;
  const snapshot = w.s.pricing.judgement;
  if (status !== 'COMPLETED' || !snapshot) throw stepNotCompleted('PRICING', status);

  const before = candidate.status;
  const fingerprint = fakeSha256(`g2:${snapshot.fingerprint}`);
  const known = w.s.gates.G2;
  if (known && w.s.pricing.g2Fingerprint === snapshot.fingerprint) {
    // 같은 판정이면 새 기록 없이 기존 통과(200)
    return Response.json(
      gateResult(
        known.gatePassId,
        'G2',
        fingerprint,
        known.basisStepRunId,
        known.passedAt,
        candidate.status,
        false,
      ),
      { status: 200 },
    );
  }
  const now = w.now();
  const record = { gatePassId: w.s.next.gatePass++, passedAt: now, basisStepRunId: run.id };
  w.s.gates.G2 = record;
  w.s.pricing.g2Fingerprint = snapshot.fingerprint;
  w.s.pricing.g2SalePriceKrw = snapshot.salePriceKrw;
  w.mark('g2Passed', now);
  reevaluate(w);
  return gateResult(
    record.gatePassId,
    'G2',
    fingerprint,
    run.id,
    now,
    candidate.status,
    candidate.status !== before,
  );
}

/** 게이트 통과 응답(05-2 GatePassResult). 선택본 칸은 G3만 채운다 */
export function gateResult(
  gatePassId: number,
  gate: 'G2' | 'G3',
  fingerprint: string,
  basisStepRunId: number,
  passedAt: number,
  candidateStatus: Schema<'GatePassResult'>['candidateStatus'],
  statusChanged: boolean,
  selection: { thumbnailSelectionId: number; thumbnailStepRunId: number } | null = null,
): Schema<'GatePassResult'> {
  return {
    gatePassId,
    gate,
    fingerprint,
    basisStepRunId,
    passedAt: new Date(passedAt).toISOString(),
    candidateStatus,
    statusChanged,
    thumbnailSelectionId: selection?.thumbnailSelectionId ?? null,
    thumbnailStepRunId: selection?.thumbnailStepRunId ?? null,
    warnings: [],
  };
}

// ── 라우트 ─────────────────────────────────────────────────────────────────

export const pricingRoutes: DemoRoute[] = [
  post('/candidates/{candidateId}/domestic-prices', 201, async ({ world, json }) =>
    createDomesticPrice(world, (await json<Record<string, unknown>>()) as Record<string, unknown>),
  ),
  get('/candidates/{candidateId}/domestic-prices', ({ world, query }) => {
    const { page, size } = pageQuery(query);
    const candidateId = world.candidate().id;
    return pageOf(
      world.s.pricing.domesticPrices.map((rec) => domesticPriceEntryOf(candidateId, rec)),
      page,
      size,
    );
  }),
  get('/candidates/{candidateId}/naver-shopping-links', ({ world }) => {
    const candidate = world.candidate();
    return naverShoppingLinksOf({
      sourceKeyword: candidate.sourceKeyword || STORY.sourceKeyword,
      anchorModelCode: candidate.anchorModelCode,
    });
  }),
  get('/candidates/{candidateId}/price-judgement', ({ world, query }) =>
    judgementView(world, query),
  ),
];

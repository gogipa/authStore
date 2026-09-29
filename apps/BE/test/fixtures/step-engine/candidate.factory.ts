import type { Candidate, RakutenItem } from '../../../src/generated/prisma/client.js';
import {
  READY_REQUIRED_STATUSES,
  STEP_FLOW,
  type CandidateExcludedReason,
  type CandidateStatus,
  type StepCode,
  type StepStatus,
} from '../../../src/modules/step-engine/domain/steps.js';
import type { PrismaService } from '../../../src/prisma/prisma.service.js';
import { createKeyword } from './keyword.factory.js';
import { ensureSettingsSnapshot } from './settings-snapshot.factory.js';

/** 예시 값(화면시안_명세 §4 후보 A: 아식스 젤카야노 14 · 크림/블랙). 실제 상품이 아니다 */
export const SAMPLE = {
  rakutenQuery: 'アシックス ゲルカヤノ14',
  itemCode: 'shop-a:10000123',
  selectedColor: '크림/블랙',
  anchorModelCode: '1201A019108',
  anchorColorCode: '108',
  leafCategoryId: '50000830',
  wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
  itemName: 'アシックス ゲルカヤノ14 1201A019-108',
  itemUrl: 'https://item.rakuten.co.jp/shop-a/10000123/',
} as const;

const FIXED_NOW = new Date('2026-09-28T00:00:00Z');
const FINGERPRINT = 'a'.repeat(64);
/** 승인대기 이상 후보의 기본 itemCode를 후보마다 다르게(진행 중 같은 itemCode+색상은 부분 UNIQUE가 막는다) */
let itemSeq = 0;

export interface CandidateFactoryInput {
  status?: CandidateStatus;
  creationPath?: 'KEYWORD' | 'SEARCH_QUERY' | 'RAKUTEN_URL';
  rakutenQuery?: string | null;
  sourceKeywordId?: number;
  sourceUrl?: string;
  /** 앵커 키(확정). 型番 또는 앵커 itemCode 중 하나 + 색상 코드 */
  anchor?: { modelCode?: string; itemCode?: string; colorCode: string } | null;
  itemCode?: string | null;
  selectedColor?: string | null;
  gender?: 'MALE' | 'FEMALE' | null;
  genderSource?: 'STEP2' | 'OWNER';
  genderRecheckRequired?: boolean;
  leafCategoryId?: string | null;
  excludedReason?: CandidateExcludedReason;
  /** 단계 상태(주지 않은 단계는 NOT_RUN). NOT_RUN이 아닌 단계는 step_run 버전 1을 만들어 가리킨다 */
  steps?: Partial<Record<StepCode, StepStatus>>;
  /** RERUN_REQUIRED 단계의 바뀐 입력(기본 ['settings.costs']) */
  staleInputs?: Partial<Record<StepCode, string[]>>;
  statusChangedAt?: Date;
}

export interface CandidateFixture {
  candidate: Candidate;
  /** 단계별 현재 step_run id */
  stepRunIds: Partial<Record<StepCode, number>>;
}

/**
 * 후보 fixture: candidate + candidate_step 10행 + 상태 이력 CREATED 1행(to_status = 주어진 상태).
 * 승인대기 이상이면 ck_candidate_ready 값(itemCode·색상 코드·성별·리프 카테고리)을 채운다.
 */
export async function createCandidate(
  prisma: PrismaService,
  input: CandidateFactoryInput = {},
): Promise<CandidateFixture> {
  const status = input.status ?? 'WORKING';
  const ready = (READY_REQUIRED_STATUSES as readonly string[]).includes(status);
  const creationPath = input.creationPath ?? 'SEARCH_QUERY';
  const sourceKeywordId =
    creationPath === 'KEYWORD'
      ? (input.sourceKeywordId ?? (await createKeyword(prisma, { state: 'SELECTED' })).id)
      : null;
  const anchor =
    input.anchor ??
    (ready ? { modelCode: SAMPLE.anchorModelCode, colorCode: SAMPLE.anchorColorCode } : null);
  const itemCode =
    input.itemCode !== undefined ? input.itemCode : ready ? `shop-f:${(itemSeq += 1)}` : null;
  const selectedColor =
    input.selectedColor !== undefined
      ? input.selectedColor
      : itemCode !== null
        ? SAMPLE.selectedColor
        : null;
  const gender = input.gender !== undefined ? input.gender : ready ? 'MALE' : null;
  const leafCategoryId =
    input.leafCategoryId !== undefined
      ? input.leafCategoryId
      : ready
        ? SAMPLE.leafCategoryId
        : null;
  const at = input.statusChangedAt ?? FIXED_NOW;

  const candidate = await prisma.candidate.create({
    data: {
      creationPath,
      status,
      statusChangedAt: at,
      excludedReason: status === 'EXCLUDED' ? (input.excludedReason ?? 'OWNER_EXCLUDED') : null,
      sourceKeywordId,
      rakutenQuery:
        input.rakutenQuery !== undefined
          ? input.rakutenQuery
          : creationPath === 'RAKUTEN_URL'
            ? null
            : SAMPLE.rakutenQuery,
      sourceUrl: creationPath === 'RAKUTEN_URL' ? (input.sourceUrl ?? SAMPLE.itemUrl) : null,
      anchorModelCode: anchor?.modelCode ?? null,
      anchorItemCode: anchor?.itemCode ?? null,
      anchorColorCode: anchor?.colorCode ?? null,
      anchorFixedAt: anchor ? at : null,
      itemCode,
      selectedColor,
      gender,
      genderSource: gender === null ? null : (input.genderSource ?? 'STEP2'),
      genderRecheckRequired: input.genderRecheckRequired ?? false,
      leafCategoryId,
      wholeCategoryName: leafCategoryId === null ? null : SAMPLE.wholeCategoryName,
      createdAt: at,
    },
  });

  const stepRunIds: Partial<Record<StepCode, number>> = {};
  const settingsSnapshotId = await ensureSettingsSnapshot(prisma);
  for (const stepCode of STEP_FLOW) {
    const stepStatus = input.steps?.[stepCode] ?? 'NOT_RUN';
    let currentStepRunId: number | null = null;
    if (stepStatus !== 'NOT_RUN') {
      const runStatus = stepStatus === 'RERUN_REQUIRED' ? 'COMPLETED' : stepStatus;
      const open = runStatus === 'RUNNING' || runStatus === 'WAITING_INPUT';
      const run = await prisma.stepRun.create({
        data: {
          candidateId: candidate.id,
          stepCode,
          version: 1,
          executionMode: 'STEP',
          settingsSnapshotId,
          status: runStatus,
          failureKind: runStatus === 'FAILED' ? 'EXTERNAL_API' : null,
          errorMessage: runStatus === 'FAILED' ? '라쿠텐 페이지 조회가 막혔습니다(fixture).' : null,
          inputFingerprintStart: FINGERPRINT,
          inputFingerprintEnd: open ? null : FINGERPRINT,
          waitingSince: runStatus === 'WAITING_INPUT' ? at : null,
          startedAt: at,
          endedAt: open ? null : at,
        },
      });
      currentStepRunId = run.id;
      stepRunIds[stepCode] = run.id;
    }
    const stale = stepStatus === 'RERUN_REQUIRED';
    await prisma.candidateStep.create({
      data: {
        candidateId: candidate.id,
        stepCode,
        status: stepStatus,
        currentStepRunId,
        lastVersion: currentStepRunId === null ? 0 : 1,
        staleInputs: stale ? (input.staleInputs?.[stepCode] ?? ['settings.costs']) : [],
        staleSince: stale ? at : null,
      },
    });
  }

  await prisma.candidateStatusHistory.create({
    data: {
      candidateId: candidate.id,
      fromStatus: null,
      toStatus: status,
      reason: 'CREATED',
      changedAt: at,
    },
  });
  return { candidate, stepRunIds };
}

/** 필수 9단계 COMPLETED(⑨ 미실행) */
export function allRequiredCompleted(
  extra: Partial<Record<StepCode, StepStatus>> = {},
): Partial<Record<StepCode, StepStatus>> {
  const steps: Partial<Record<StepCode, StepStatus>> = {};
  for (const code of STEP_FLOW) if (code !== 'REGISTER') steps[code] = 'COMPLETED';
  return { ...steps, ...extra };
}

/** rakuten_item 스냅샷 1행('URL로 만들기' 앞의 POST /rakuten-items 결과를 흉내) */
export async function createRakutenItem(
  prisma: PrismaService,
  patch: { itemCode?: string; itemName?: string; collectedAt?: Date } = {},
): Promise<RakutenItem> {
  const itemCode = patch.itemCode ?? SAMPLE.itemCode;
  const [shopCode, itemId] = itemCode.split(':');
  return prisma.rakutenItem.create({
    data: {
      itemCode,
      shopCode: shopCode ?? 'shop-a',
      itemName: patch.itemName ?? SAMPLE.itemName,
      itemUrl: `https://item.rakuten.co.jp/${shopCode}/${itemId}/`,
      modelCode: '1201A019-108',
      modelCodeNorm: SAMPLE.anchorModelCode,
      entrySource: 'MANUAL',
      fetchReason: 'URL_ENTRY',
      collectedAt: patch.collectedAt ?? FIXED_NOW,
      genreSource: 'NOT_FOUND',
    },
  });
}

/** ② 버전(step_run)에 'URL로 만들기' 소싱 선택(비교 안 함)을 붙인다. 표시명·페이지 수집 시각 fixture */
export async function attachUrlSelection(
  prisma: PrismaService,
  stepRunId: number,
  rakutenItem: RakutenItem,
): Promise<void> {
  await prisma.sourcingComparison.create({
    data: {
      stepRunId,
      action: 'URL_CREATE',
      sourceUrl: rakutenItem.itemUrl,
      comparisonPerformed: false,
      selectedRakutenItemId: rakutenItem.id,
      params: {},
    },
  });
}

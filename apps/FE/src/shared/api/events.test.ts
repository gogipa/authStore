import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { components } from './schema';
import { FakeEventSource } from '@/test/fakeEventSource';
import { callUsageChanged } from '@/test/fixtures/callUsage';
import {
  connectProgressEvents,
  EVENT_INVALIDATIONS,
  onProgressEvent,
  PROGRESS_EVENT_NAMES,
  PROGRESS_EVENTS_URL,
  type ProgressEventData,
  type ProgressEventName,
} from './events';

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  return { queryClient, invalidate };
}

const disposers: Array<() => void> = [];
function connect(queryClient: QueryClient, reconnectDelaysMs?: number[]) {
  const dispose = connectProgressEvents(queryClient, {
    EventSourceImpl: FakeEventSource,
    reconnectDelaysMs,
  });
  disposers.push(dispose);
  return dispose;
}

afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  vi.useRealTimers();
});

describe('진행 알림 이름', () => {
  it('M1 이벤트 22개이고 schema.d.ts의 ProgressEventFrame에서 온다', () => {
    expect(PROGRESS_EVENT_NAMES).toHaveLength(22);
    expect(new Set(PROGRESS_EVENT_NAMES).size).toBe(22);
    expectTypeOf<(typeof PROGRESS_EVENT_NAMES)[number]>().toEqualTypeOf<ProgressEventName>();
    expectTypeOf<ProgressEventData<'call-usage.changed'>>().toEqualTypeOf<
      components['schemas']['CallUsageChangedEvent']
    >();
  });

  it('무효화 표: call-usage.changed(P1-02), settings.reloaded(P1-03), 후보 이벤트 2개(P1-04), 단계 실행(P1-05), 연속 실행·게이트(P1-06), auth.failed(P1-07), commerce-meta-sync.completed(P1-08), ai-cli-check.completed(P1-11)', () => {
    expect(Object.keys(EVENT_INVALIDATIONS)).toEqual([
      'call-usage.changed',
      'settings.reloaded',
      'candidate.status-changed',
      'candidate-step.changed',
      'step-run.status-changed',
      'continuous-run.stopped',
      'gate.passed',
      'gate.invalidated',
      'content-field.recheck-flagged',
      'generation-run.updated',
      'auth.failed',
      'ai-cli-check.completed',
      'keyword-collection.progress',
      'sourcing.search-completed',
      'sourcing.row-updated',
      'sourcing.page-fetch-finished',
      'keyword-collection.completed',
      'keyword-collection.aborted',
      'fx-rate.updated',
      'registration.status-changed',
      'registration-switch.changed',
      'commerce-meta-sync.completed',
    ]);
    // ⑥(P3-03): ⑥-1·⑥-2 실행 상태 → 카피·고시 원자료, 재확인 필요 → 고시 원자료·단계 레일
    const stepRun = (stepCode: 'COPY' | 'NOTICE_RAW' | 'NOTICE_HTML') =>
      EVENT_INVALIDATIONS['step-run.status-changed']?.({
        stepRunId: 104,
        candidateId: 1,
        stepCode,
        version: 1,
        status: 'COMPLETED',
        stepChainId: null,
      } as ProgressEventData<'step-run.status-changed'>);
    expect(stepRun('COPY')).toContainEqual([
      'content',
      'getCandidateContentCopy',
      { candidateId: 1 },
    ]);
    expect(stepRun('NOTICE_RAW')).toContainEqual([
      'content',
      'getCandidateContentFact',
      { candidateId: 1 },
    ]);
    expect(
      EVENT_INVALIDATIONS['content-field.recheck-flagged']?.({
        candidateId: 1,
        stepCode: 'NOTICE_RAW',
        stepRunId: 105,
        fieldKeys: ['fact.origin'],
        recheckReason: 'ITEM_CODE_CHANGED',
      }),
    ).toEqual([
      ['content', 'getCandidateContentFact', { candidateId: 1 }],
      ['step-engine', 'listCandidateSteps', { candidateId: 1 }],
    ]);
    // ⑥-3(P3-04): 실행 상태·재확인 필요 → 조립 결과, G3 통과(다시 고르기) → 조립 결과(미리보기 다시 열기)
    expect(stepRun('NOTICE_HTML')).toContainEqual([
      'content',
      'getCandidateContentAssembly',
      { candidateId: 1 },
    ]);
    expect(stepRun('COPY')).not.toContainEqual([
      'content',
      'getCandidateContentAssembly',
      { candidateId: 1 },
    ]);
    // ⑦(P3-05): 실행·태그 편집 재검증이 끝나면 ⑦ 산출물과 경쟁 태그 입력 목록
    const tagsRun = EVENT_INVALIDATIONS['step-run.status-changed']?.({
      stepRunId: 107,
      candidateId: 1,
      stepCode: 'TAGS',
      version: 2,
      status: 'COMPLETED',
      stepChainId: null,
    } as ProgressEventData<'step-run.status-changed'>);
    expect(tagsRun).toContainEqual(['tags', 'getCandidateTagSet', { candidateId: 1 }]);
    expect(tagsRun).toContainEqual(['tags', 'listTagCompetitorInputs', { candidateId: 1 }]);
    expect(stepRun('COPY')).not.toContainEqual(['tags', 'getCandidateTagSet', { candidateId: 1 }]);
    // ⑧(P4-01): 업로드 실행이 끝나면(완료·실패) ⑧ 산출물, ⑧이 재실행 필요로 바뀌어도 산출물과 단계 레일
    const uploadKey = ['registration', 'getCandidateUploadResult', { candidateId: 1 }];
    const uploadRun = EVENT_INVALIDATIONS['step-run.status-changed']?.({
      stepRunId: 108,
      candidateId: 1,
      stepCode: 'UPLOAD',
      version: 1,
      status: 'FAILED',
      stepChainId: null,
    } as ProgressEventData<'step-run.status-changed'>);
    expect(uploadRun).toContainEqual(uploadKey);
    expect(uploadRun).toContainEqual(['step-engine', 'listCandidateSteps', { candidateId: 1 }]);
    expect(tagsRun).not.toContainEqual(uploadKey);
    const uploadStale = EVENT_INVALIDATIONS['candidate-step.changed']?.({
      candidateId: 1,
      stepCode: 'UPLOAD',
      status: 'RERUN_REQUIRED',
      currentStepRunId: 108,
      staleInputs: ['noticeHtml.html'],
      staleSince: '2026-09-28T00:00:00.000Z',
    });
    expect(uploadStale).toContainEqual(uploadKey);
    expect(uploadStale).toContainEqual(['step-engine', 'listCandidateSteps', { candidateId: 1 }]);
    // G4 승인 화면(P4-02): 단계·게이트·후보 상태가 바뀌면 미리보기와 사전 검증을 다시
    const approvalKey = ['registration', 'getCandidateApproval', { candidateId: 1 }];
    const preValidationKey = ['registration', 'runCandidatePreValidation', { candidateId: 1 }];
    expect(uploadStale).toContainEqual(approvalKey);
    expect(uploadStale).toContainEqual(preValidationKey);
    expect(
      EVENT_INVALIDATIONS['gate.invalidated']?.({
        candidateId: 1,
        gate: 'G2',
        previousGatePassId: 3,
        changedBasisKeys: ['salePrices.250'],
      }),
    ).toEqual(expect.arrayContaining([approvalKey, preValidationKey]));
    expect(
      EVENT_INVALIDATIONS['candidate.status-changed']?.({
        candidateId: 1,
        fromStatus: 'WORKING',
        toStatus: 'EXCLUDED',
        reason: 'OWNER_EXCLUDED',
        excludedReason: 'OWNER_EXCLUDED',
        changedAt: '2026-09-28T00:00:00.000Z',
      }),
    ).toEqual(expect.arrayContaining([approvalKey, preValidationKey]));
    expect(uploadRun).not.toContainEqual(preValidationKey);
    // ⑨ 등록(P4-03): 등록 기록 상태가 바뀌면 그 후보의 이력·그 기록·게이트(G4)·단계 레일·승인 화면
    const registrationChanged = EVENT_INVALIDATIONS['registration.status-changed']?.({
      registrationId: 31,
      candidateId: 1,
      stepRunId: 210,
      status: 'RESULT_CHECK_REQUIRED',
      originProductNo: null,
      errorCode: 'TIMEOUT',
      errorMessage: '…',
      traceId: null,
      failureKind: null,
      candidateStatus: 'RESULT_CHECK_REQUIRED',
    });
    expect(registrationChanged).toEqual(
      expect.arrayContaining([
        ['registration', 'listCandidateRegistrations', { candidateId: 1 }],
        ['registration', 'getRegistration', { registrationId: 31 }],
        ['step-engine', 'listCandidateGates', { candidateId: 1 }],
        ['step-engine', 'listCandidateSteps', { candidateId: 1 }],
        approvalKey,
        preValidationKey,
      ]),
    );
    // 차단 스위치(P4-03): 내비 칩·띠·모든 후보의 미리보기(apiBlocked)·이력. 사전 검증(외부 조회)은 다시 돌리지 않는다
    const switched = EVENT_INVALIDATIONS['registration-switch.changed']?.({
      apiBlocked: false,
      changedAt: '2026-09-28T00:00:00.000Z',
      revertedCandidateIds: [1],
    });
    expect(switched).toEqual([
      ['registration', 'getRegistrationSwitch'],
      ['registration', 'getCandidateApproval'],
      ['registration', 'listCandidateRegistrations'],
    ]);
    expect(
      EVENT_INVALIDATIONS['content-field.recheck-flagged']?.({
        candidateId: 1,
        stepCode: 'NOTICE_HTML',
        stepRunId: 106,
        fieldKeys: ['notice.size'],
        recheckReason: 'SALE_SIZES_CHANGED',
      }),
    ).toEqual([
      ['content', 'getCandidateContentAssembly', { candidateId: 1 }],
      ['step-engine', 'listCandidateSteps', { candidateId: 1 }],
    ]);
    expect(
      EVENT_INVALIDATIONS['gate.passed']?.({
        candidateId: 1,
        gate: 'G3',
      } as ProgressEventData<'gate.passed'>),
    ).toContainEqual(['content', 'getCandidateContentAssembly', { candidateId: 1 }]);
    // 환율(P2-04): 새 최신값·수집 실패·±20% 차이 → 최신값과 이력 전체
    expect(
      EVENT_INVALIDATIONS['fx-rate.updated']?.({
        rateKind: 'COST',
        currency: 'JPY',
        fxRateId: null,
        warningCode: 'FX_FETCH_FAILED',
      }),
    ).toEqual([
      ['pricing', 'getLatestFxRates'],
      ['pricing', 'listFxRates'],
    ]);
    // ② 검색이 끝나면 그 후보의 비교표, 행·페이지 조회 이벤트는 비교표 전체(data에 후보 id가 없다, P2-02)
    expect(
      EVENT_INVALIDATIONS['sourcing.search-completed']?.({
        candidateId: 12,
        sourcingComparisonId: 3,
        stepRunId: 40,
        rowCount: 28,
        exploreMode: true,
      }),
    ).toEqual([['sourcing', 'getSourcingComparison', { candidateId: 12 }]]);
    expect(
      EVENT_INVALIDATIONS['sourcing.page-fetch-finished']?.({
        sourcingComparisonId: 3,
        fetchedCount: 4,
        passedCount: 3,
        stopReason: 'NO_MORE_ROWS',
      }),
    ).toEqual([['sourcing', 'getSourcingComparison']]);
    // 데이터랩 수집(P2-01): 페이지마다 그 묶음·키워드, 끝나면 목록·수집 상태까지
    expect(
      EVENT_INVALIDATIONS['keyword-collection.progress']?.({
        keywordSnapshotId: 5,
        cid: '50000173',
        page: 3,
        pagesPerCid: 5,
        requestsDone: 3,
        requestsTotal: 10,
      }),
    ).toEqual([
      ['keywords', 'getKeywordSnapshot', { keywordSnapshotId: 5 }],
      ['keywords', 'listSnapshotKeywords', { keywordSnapshotId: 5 }],
    ]);
    const endKeys = [
      ['keywords', 'listKeywordSnapshots'],
      ['keywords', 'getKeywordSnapshot', { keywordSnapshotId: 5 }],
      ['keywords', 'listSnapshotKeywords', { keywordSnapshotId: 5 }],
      ['keywords', 'getKeywordCollectionStatus'],
    ];
    expect(
      EVENT_INVALIDATIONS['keyword-collection.completed']?.({
        keywordSnapshotId: 5,
        keywordCount: 200,
        excludedCount: 3,
        rangeMatched: true,
      }),
    ).toEqual(endKeys);
    expect(
      EVENT_INVALIDATIONS['keyword-collection.aborted']?.({
        keywordSnapshotId: 5,
        abortReason: 'HTTP_429',
        httpStatus: 429,
        structureChangeSuspected: false,
        blockedUntil: '2026-09-29T00:00:00Z',
      }),
    ).toEqual(endKeys);
    // 아동 단어를 더하면(설정 safety.childKeywords 변경) 아동 단어 목록도 다시 읽는다(P2-01)
    expect(
      EVENT_INVALIDATIONS['settings.reloaded']?.({
        settingsSnapshotId: 5,
        changedKeys: ['safety.childKeywords'],
        valid: true,
        errors: [],
        rerunRequiredStepCount: 0,
      }),
    ).toEqual([['settings'], ['keywords', 'listChildKeywordTerms']]);
    // AI 엔진 하나의 점검이 끝나면 최신 점검·이력을 다시 읽는다. AGY면 agy models 목록이 바뀌었을 수 있어 설정도(P1-11)
    const aiCheck = {
      installed: true,
      cliVersion: '1.2.9',
      authStatus: 'UNKNOWN',
      smokeStatus: 'SKIPPED',
      latencyMs: null,
      errorCode: null,
    } as const;
    expect(
      EVENT_INVALIDATIONS['ai-cli-check.completed']?.({ ...aiCheck, engineCode: 'CLAUDE' }),
    ).toEqual([
      ['system', 'getLatestAiCliChecks'],
      ['system', 'listAiCliChecks'],
    ]);
    expect(
      EVENT_INVALIDATIONS['ai-cli-check.completed']?.({ ...aiCheck, engineCode: 'AGY' }),
    ).toEqual([
      ['system', 'getLatestAiCliChecks'],
      ['system', 'listAiCliChecks'],
      ['settings', 'getAiEngineSettings'],
    ]);
    // 메타 대상 하나가 끝나면 동기화 상태와 주소록·반품 택배사 캐시 목록을 다시 읽는다(P1-08).
    // 프로필의 주소 경고도 바뀔 수 있어 프로필을 다시 읽는다(P1-09)
    expect(
      EVENT_INVALIDATIONS['commerce-meta-sync.completed']?.({
        runId: 1,
        target: 'ADDRESSBOOK',
        status: 'SUCCEEDED',
        finishedAt: '2026-09-28T09:10:00+09:00',
        itemCount: 4,
        errorMessage: null,
      }),
    ).toEqual([
      ['integrations', 'getLatestCommerceMetaSyncRuns'],
      ['integrations', 'listCommerceAddressbooks'],
      ['integrations', 'listCommerceReturnDeliveryCompanies'],
      ['settings', 'getPurchaseAgencyProfile'],
    ]);
    // 재발급까지 실패하면 인증 상태(원인 안내)를 다시 읽는다(P1-07)
    expect(
      EVENT_INVALIDATIONS['auth.failed']?.({
        target: 'COMMERCE_API',
        errorCode: 'GW.IP_NOT_ALLOWED',
        causeCategory: 'IP_NOT_ALLOWED',
        occurredAt: '2026-09-28T09:00:00+09:00',
      }),
    ).toEqual([['system', 'getAuthStatus']]);
    expect(EVENT_INVALIDATIONS['call-usage.changed']?.(callUsageChanged())).toEqual([
      ['integrations', 'getCallUsage'],
    ]);
    // 다시 읽기 실패(settingsSnapshotId null)에도 settings 태그 전체를 다시 읽는다
    for (const valid of [true, false]) {
      expect(
        EVENT_INVALIDATIONS['settings.reloaded']?.({
          settingsSnapshotId: valid ? 3 : null,
          changedKeys: valid ? ['costs.targetMarginPct'] : [],
          valid,
          errors: valid ? [] : ['/costs/cardSurchargePct: 숫자여야 합니다.'],
          rerunRequiredStepCount: 0,
        }),
      ).toEqual([['settings']]);
    }
    // 설정 변경이 재실행 필요 단계를 만들었으면 step-engine 태그 전체도(P1-05)
    expect(
      EVENT_INVALIDATIONS['settings.reloaded']?.({
        settingsSnapshotId: 4,
        changedKeys: ['costs.targetMarginPct'],
        valid: true,
        errors: [],
        rerunRequiredStepCount: 2,
      }),
    ).toEqual([['settings'], ['step-engine']]);
    // candidate.status-changed → 목록·그 후보 상세·상태별 수·이어서 할 곳·그 후보 이력·재실행 필요 모아 보기
    expect(
      EVENT_INVALIDATIONS['candidate.status-changed']?.({
        candidateId: 12,
        fromStatus: 'WORKING',
        toStatus: 'EXCLUDED',
        reason: 'OWNER_EXCLUDED',
        excludedReason: 'OWNER_EXCLUDED',
        changedAt: '2026-09-28T00:00:00.000Z',
      }),
    ).toEqual([
      ['step-engine', 'listCandidates'],
      ['step-engine', 'getCandidate', { candidateId: 12 }],
      ['step-engine', 'getCandidateStatusCounts'],
      ['step-engine', 'getCandidateResumeTarget'],
      ['step-engine', 'listCandidateStatusHistory', { candidateId: 12 }],
      ['step-engine', 'listAttentionCandidateSteps'],
      // P4-02: G4 승인 미리보기·사전 검증
      ['registration', 'getCandidateApproval', { candidateId: 12 }],
      ['registration', 'runCandidatePreValidation', { candidateId: 12 }],
    ]);
    expect(
      EVENT_INVALIDATIONS['candidate-step.changed']?.({
        candidateId: 12,
        stepCode: 'PRICING',
        status: 'RERUN_REQUIRED',
        currentStepRunId: 4,
        staleInputs: ['candidate.gender'],
        staleSince: '2026-09-28T00:00:00.000Z',
      }),
    ).toEqual([
      ['step-engine', 'listCandidateSteps', { candidateId: 12 }],
      ['step-engine', 'listCandidateStepRuns', { candidateId: 12 }],
      ['step-engine', 'getCandidateStepStaleDiff', { candidateId: 12 }],
      ['step-engine', 'getCandidate', { candidateId: 12 }],
      ['step-engine', 'listCandidates'],
      ['step-engine', 'getCandidateResumeTarget'],
      ['step-engine', 'listAttentionCandidateSteps'],
      ['step-engine', 'getStepRun'],
      // 그 후보의 ④ 카테고리 결정도(P2-06 — 성별이 바뀌면 ③·⑥-3·⑦과 함께 후보를 다시 뽑는다)
      ['category', 'getCategoryDecision', { candidateId: 12 }],
      // G4 승인 미리보기·사전 검증(P4-02)
      ['registration', 'getCandidateApproval', { candidateId: 12 }],
      ['registration', 'runCandidatePreValidation', { candidateId: 12 }],
    ]);
    // step-run.status-changed → 그 후보 레일·이력·바뀐 입력·상세·목록 + 그 실행 한 건(P1-05)
    expect(
      EVENT_INVALIDATIONS['step-run.status-changed']?.({
        stepRunId: 40,
        candidateId: 12,
        stepCode: 'SOURCING',
        version: 2,
        executionMode: 'STEP',
        stepChainId: null,
        status: 'COMPLETED',
        occurredAt: '2026-09-28T00:00:00.000Z',
      }),
    ).toEqual([
      ['step-engine', 'listCandidateSteps', { candidateId: 12 }],
      ['step-engine', 'listCandidateStepRuns', { candidateId: 12 }],
      ['step-engine', 'getCandidateStepStaleDiff', { candidateId: 12 }],
      ['step-engine', 'getCandidate', { candidateId: 12 }],
      ['step-engine', 'listCandidates'],
      ['step-engine', 'getCandidateResumeTarget'],
      ['step-engine', 'listAttentionCandidateSteps'],
      ['step-engine', 'getStepRun', { stepRunId: 40 }],
      ['step-engine', 'listCandidateGates', { candidateId: 12 }],
      // ② 실행이면 그 후보의 비교표도(P2-02)
      ['sourcing', 'getSourcingComparison', { candidateId: 12 }],
    ]);
    // 연속 실행 묶음 안의 실행이면 그 묶음도(P1-06 연속 실행 띠)
    expect(
      EVENT_INVALIDATIONS['step-run.status-changed']?.({
        stepRunId: 41,
        candidateId: 12,
        stepCode: 'PRICING',
        version: 1,
        executionMode: 'CHAIN',
        stepChainId: 7,
        status: 'RUNNING',
        occurredAt: '2026-09-28T00:00:00.000Z',
      }),
    ).toContainEqual(['step-engine', 'getContinuousRun', { stepChainId: 7 }]);
    // ③ 실행이면 그 후보의 판정·국내 기준가 이력도(P2-05)
    const pricingRun = EVENT_INVALIDATIONS['step-run.status-changed']?.({
      stepRunId: 42,
      candidateId: 12,
      stepCode: 'PRICING',
      version: 2,
      executionMode: 'STEP',
      stepChainId: null,
      status: 'COMPLETED',
      occurredAt: '2026-09-28T00:00:00.000Z',
    });
    expect(pricingRun).toContainEqual(['pricing', 'getPriceJudgement', { candidateId: 12 }]);
    expect(pricingRun).toContainEqual(['pricing', 'listDomesticPrices', { candidateId: 12 }]);
    expect(pricingRun).not.toContainEqual([
      'sourcing',
      'getSourcingComparison',
      { candidateId: 12 },
    ]);
    expect(pricingRun).not.toContainEqual(['category', 'getCategoryDecision', { candidateId: 12 }]);
    // ④ 실행이면 그 후보의 카테고리 결정도(P2-06)
    expect(
      EVENT_INVALIDATIONS['step-run.status-changed']?.({
        stepRunId: 43,
        candidateId: 12,
        stepCode: 'CATEGORY',
        version: 1,
        executionMode: 'STEP',
        stepChainId: null,
        status: 'WAITING_INPUT',
        waitingReasonCode: 'CATEGORY_SELECTION_REQUIRED',
        pendingInputs: ['owner.categorySelection'],
        occurredAt: '2026-09-28T00:00:00.000Z',
      }),
    ).toContainEqual(['category', 'getCategoryDecision', { candidateId: 12 }]);
    // continuous-run.stopped·gate.passed·gate.invalidated → 게이트 목록·상세·레일·목록·이어서 할 곳(P1-06)
    const gateKeys = [
      ['step-engine', 'listCandidateGates', { candidateId: 12 }],
      ['step-engine', 'getCandidate', { candidateId: 12 }],
      ['step-engine', 'listCandidateSteps', { candidateId: 12 }],
      ['step-engine', 'listCandidates'],
      ['step-engine', 'getCandidateResumeTarget'],
    ];
    expect(
      EVENT_INVALIDATIONS['continuous-run.stopped']?.({
        stepChainId: 7,
        candidateId: 12,
        kind: 'FROM_HERE',
        stopReason: 'AWAIT_G2',
        stopStepCode: 'PRICING',
        endedAt: '2026-09-28T00:00:00.000Z',
      }),
    ).toEqual([['step-engine', 'getContinuousRun', { stepChainId: 7 }], ...gateKeys]);
    expect(
      EVENT_INVALIDATIONS['gate.passed']?.({
        candidateId: 12,
        gate: 'G2',
        gatePassId: 3,
        passedAt: '2026-09-28T00:00:00.000Z',
      }),
    ).toEqual([
      ...gateKeys,
      ['pricing', 'getPriceJudgement', { candidateId: 12 }],
      // P3-02: ⑤ 산출물의 G3 유효·선택본
      ['thumbnails', 'getCandidateThumbnail', { candidateId: 12 }],
      // P3-04: G3을 다시 고르면 ⑥-3 미리보기를 새로 연다
      ['content', 'getCandidateContentAssembly', { candidateId: 12 }],
    ]);
    expect(
      EVENT_INVALIDATIONS['gate.invalidated']?.({
        candidateId: 12,
        gate: 'G2',
        previousGatePassId: 3,
        changedBasisKeys: ['salePrices.250'],
      }),
    ).toEqual([
      ...gateKeys,
      // P2-03: 다른 샵을 고르면 G2가 무효 → 그 후보 비교표도 다시 읽는다
      ['sourcing', 'getSourcingComparison', { candidateId: 12 }],
      // P2-05: 판정 화면의 소싱 확정(G2) 줄
      ['pricing', 'getPriceJudgement', { candidateId: 12 }],
      // P3-02: ⑤ 산출물의 G3 유효
      ['thumbnails', 'getCandidateThumbnail', { candidateId: 12 }],
      // P4-02: G4 승인 미리보기·사전 검증(승인 버튼 꺼짐 GATE_NOT_PASSED·STEP_FRESHNESS)
      ['registration', 'getCandidateApproval', { candidateId: 12 }],
      ['registration', 'runCandidatePreValidation', { candidateId: 12 }],
    ]);
    // P3-02: 생성 시도 상태가 바뀌면 그 후보 ⑤ 산출물(후보 칸)과 그 시도 한 건
    expect(
      EVENT_INVALIDATIONS['generation-run.updated']?.({
        candidateId: 12,
        stepRunId: 40,
        generationRunId: 7,
        slotNo: 1,
        attemptNo: 1,
        triggerType: 'INITIAL',
        status: 'SUCCEEDED',
        resultImageAssetId: 90,
      }),
    ).toEqual([
      ['thumbnails', 'getCandidateThumbnail', { candidateId: 12 }],
      ['thumbnails', 'getThumbnailGenerationRun', { generationRunId: 7 }],
    ]);
  });
});

describe('connectProgressEvents', () => {
  it('여러 번 연결해도 EventSource는 1개이고 URL은 /api/v1/events다', () => {
    const a = setup();
    const b = setup();
    connect(a.queryClient);
    connect(b.queryClient);
    connect(a.queryClient);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.latest().url).toBe('/api/v1/events');
    expect(PROGRESS_EVENTS_URL).toBe('/api/v1/events');
  });

  it("call-usage.changed가 오면 ['integrations','getCallUsage']를 무효화한다", () => {
    const { queryClient, invalidate } = setup();
    connect(queryClient);

    FakeEventSource.latest().emit('call-usage.changed', callUsageChanged(39));

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['integrations', 'getCallUsage'] });
  });

  it('구독한 QueryClient 모두에 무효화를 보낸다', () => {
    const a = setup();
    const b = setup();
    connect(a.queryClient);
    connect(b.queryClient);

    FakeEventSource.latest().emit('call-usage.changed', callUsageChanged(39));

    expect(a.invalidate).toHaveBeenCalledTimes(1);
    expect(b.invalidate).toHaveBeenCalledTimes(1);
  });

  it('모르는 이벤트·표에 없는 이벤트·읽을 수 없는 data는 무시한다', () => {
    const { queryClient, invalidate } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    connect(queryClient);
    const source = FakeEventSource.latest();

    source.emit('unknown.event', { x: 1 });
    // P4-03으로 M1 이벤트 22개가 모두 표에 들어갔다 — 모르는 이벤트와 읽을 수 없는 data만 남는다
    source.emitRaw('call-usage.changed', '{not json');

    expect(invalidate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('onProgressEvent: 그 이벤트의 data를 구독자에게 준다(무효화 뒤), 풀면 더 받지 않는다(P2-01)', () => {
    const { queryClient, invalidate } = setup();
    connect(queryClient);
    const got: unknown[] = [];
    const off = onProgressEvent('keyword-collection.progress', (data) => got.push(data.page));
    const source = FakeEventSource.latest();
    const progress = {
      keywordSnapshotId: 5,
      cid: '50000173',
      page: 3,
      pagesPerCid: 5,
      requestsDone: 3,
      requestsTotal: 10,
    };
    source.emit('keyword-collection.progress', progress);
    expect(got).toEqual([3]);
    expect(invalidate).toHaveBeenCalledTimes(2);
    off();
    source.emit('keyword-collection.progress', { ...progress, page: 4 });
    expect(got).toEqual([3]);
  });

  it('처음 열릴 때는 다시 읽지 않는다', () => {
    const { queryClient, invalidate } = setup();
    connect(queryClient);
    FakeEventSource.latest().open();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('fail() 뒤 reopen()이면 활성 쿼리 전체를 무효화한다', () => {
    const { queryClient, invalidate } = setup();
    connect(queryClient);
    const source = FakeEventSource.latest();
    source.open();

    source.fail();
    expect(invalidate).not.toHaveBeenCalled();
    source.reopen();

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ refetchType: 'active' });
    // 브라우저가 스스로 다시 붙는 경우라 새 EventSource를 만들지 않는다.
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('브라우저가 포기하면(CLOSED) 간격을 두고 새 연결을 열고, 열리면 다시 읽는다', () => {
    vi.useFakeTimers();
    const { queryClient, invalidate } = setup();
    connect(queryClient, [1000, 5000]);
    const first = FakeEventSource.latest();

    first.fail({ closed: true });
    expect(first.closeCount).toBe(1);
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    const second = FakeEventSource.latest();
    second.fail({ closed: true });
    vi.advanceTimersByTime(4999);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    const third = FakeEventSource.latest();
    expect(FakeEventSource.instances).toHaveLength(3);

    third.open();
    expect(invalidate).toHaveBeenCalledWith({ refetchType: 'active' });
    // 닫힌 옛 연결의 이벤트는 무시한다.
    first.emit('call-usage.changed', callUsageChanged());
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('마지막 구독이 풀리면 close()를 부른다', () => {
    const a = setup();
    const b = setup();
    const disposeA = connect(a.queryClient);
    const disposeB = connect(b.queryClient);
    const source = FakeEventSource.latest();

    disposeA();
    disposeA(); // 두 번 불러도 한 번만 푼다
    expect(source.closeCount).toBe(0);
    disposeB();
    expect(source.closeCount).toBe(1);

    // 다시 연결하면 새 EventSource를 연다.
    connect(a.queryClient);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('다시 붙기를 기다리는 중에 구독이 풀리면 새 연결을 열지 않는다', () => {
    vi.useFakeTimers();
    const { queryClient } = setup();
    const dispose = connect(queryClient, [1000]);
    FakeEventSource.latest().fail({ closed: true });
    dispose();
    vi.advanceTimersByTime(5000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('EventSource가 없는 환경에서는 아무것도 하지 않는다', () => {
    const { queryClient } = setup();
    const original = (globalThis as { EventSource?: unknown }).EventSource;
    expect(original).toBeUndefined();
    const dispose = connectProgressEvents(queryClient);
    expect(FakeEventSource.instances).toHaveLength(0);
    dispose();
  });
});

# 05-1. Route 맵

| 항목 | 내용 |
|---|---|
| 버전 | 0.1 (2026-09-27) |
| 상태 | **Proposed** (D-11). 경로는 스캐폴딩 공통 명세 §3과 같다 — 이 표가 FE 경로의 SSOT다 |
| 근거 | [04 기능 리스트 §2 IA](../../../prd/04_기능리스트.md) · [03-1 렌더링](../03_아키텍처/03-1_렌더링전략맵.md) · [05-2 OpenAPI](../../05_API/05-2_openapi.yaml) · [공통부품 §A·§G](../../../design/spec/공통부품_마크업.md) |
| 코드 | `apps/FE/src/app/routes.tsx` · `apps/FE/src/shared/lib/steps.ts` |

## 1. 공통

- **렌더링**: 모두 CSR(03-1).
- **접근**: 모두 "로컬 1인 · 가드 없음". 로그인·권한 화면이 없다. 보안은 BE가 헤더로 지킨다(Host 검사, 변경 요청의 Origin 검사와 `X-AutoStore-Client: 1`, 05-1 §1.2). FE는 client.ts 미들웨어로 헤더만 붙인다.
- **API 열**: 05-2의 `x-features`(기능 ID) → 04 기능 리스트의 화면 열로 **스크립트 역추적**했다. 한 기능이 여러 화면에 걸치면 여러 행에 나온다. M1 연산만 적고 M2는 §4에 모았다.
- **모든 화면 공통**(앱 틀 `AppLayout`·`AppNav`): `streamProgressEvents`(SSE 하나) · `getRegistrationSwitch`(내비 상태 상자 '등록 API 차단') · `getCallUsage`(내비 '오늘 페이지 조회').

## 2. 화면 → 경로

| 화면 | 경로 | 라우트 파일(`src/pages/…`) | 렌더링 | 접근 | 연동 API (M1 operationId) |
|---|---|---|---|---|---|
| SCR-01 대시보드 | `/` (index) | `dashboard/DashboardPage.tsx` | CSR | 로컬 1인 · 가드 없음 | `listAttentionCandidateSteps` · `getCandidateResumeTarget` · `listCandidates` · `getCandidateStatusCounts` (역추적으로 더 걸림: `getCandidate` · `passCandidateGate` · `listCandidateStatusHistory` · `getSettings` · `createSettingsSnapshot`) |
| SCR-02 키워드 | `/keywords` | `keywords/KeywordsPage.tsx` | CSR | 〃 | `createKeywordSnapshot` · `getKeywordSnapshot` · `listKeywordSnapshots` · `listSnapshotKeywords` · `getKeywordCollectionStatus` · `selectKeyword` · `unselectKeyword` · `listChildKeywordTerms` · `addChildKeywordTerm` · `validateRakutenQuery` · `createCandidate` · `startCandidateStepRun` |
| SCR-12 후보 작업(목록) | `/candidates` | `candidates/CandidatesPage.tsx` | CSR | 〃 | `listCandidates` · `getCandidateStatusCounts` · `createCandidate` · `fetchRakutenItem` · `getCandidateResumeTarget` · `listAttentionCandidateSteps` · `createSettingsSnapshot` + 고른 후보 단계 표(§3의 4): 틀 공통 연산 + `getCandidateThumbnail` · `getCandidateContentFact` · `getCandidateContentAssembly` · `getCandidateTagSet` · `getCandidateUploadResult` · `createDomesticPrice` · `requestSourcingRowStockCheck` |
| SCR-12 후보 작업(틀) | `/candidates/:candidateId` | `candidate/CandidateLayout.tsx` · index `candidate/CandidateIndexRedirect.tsx` | CSR | 〃 | **틀 공통**: `getCandidate` · `listCandidateSteps` · `listCandidateGates` · `listCandidateStatusHistory` · `startCandidateStepRun` · `listCandidateStepRuns` · `getStepRun` · `getCandidateStepStaleDiff` · `createCandidateStepOwnerEdit` · `startCandidateContinuousRun` · `getContinuousRun` · `passCandidateGate` · `setCandidateGender` · `refetchCandidate` · `excludeCandidate` · `reopenCandidate` |
| SCR-03 ② 소싱 | `/candidates/:candidateId/sourcing` | `sourcing/SourcingPage.tsx` | CSR | 〃 | 틀 공통 + `getSourcingComparison` · `fixSourcingAnchor` · `updateSourcingComparisonRow` · `requestSourcingRowStockCheck` · `addSourcingComparisonManualRow` · `confirmSourcingAdultProduct` · `selectSourcingComparisonRow` · `validateRakutenQuery` · `fetchRakutenItem` · `getRakutenItem` · `createCandidate` |
| SCR-04 ③ 판정 · ④ 카테고리 | `/candidates/:candidateId/judgement` (④는 `#category`) | `judgement/JudgementPage.tsx` | CSR | 〃 | 틀 공통 + `createDomesticPrice` · `listDomesticPrices` · `listNaverShoppingLinks` · `getPriceJudgement` · `getLatestFxRates` · `listFxRates` · `createManualFxRate` · `confirmCandidateNoComparison` · `revokeCandidateNoComparison` · `getCategoryDecision` · `selectCategoryDecisionLeaf` · `listCommerceCategories` |
| SCR-05 ⑤ 썸네일 | `/candidates/:candidateId/thumbnail` | `thumbnail/ThumbnailPage.tsx` | CSR | 〃 | 틀 공통 + `listCandidateSourceImages` · `getCandidateThumbnail` · `putThumbnailReferences` · `createThumbnailPromptPreview` · `createThumbnailGenerationRuns` · `getThumbnailGenerationRun` · `getImageAsset` · `getImageAssetFile` · `createSettingsSnapshot` |
| SCR-06 ⑥ 상세 콘텐츠 | `/candidates/:candidateId/content` | `content/ContentPage.tsx` | CSR | 〃 | 틀 공통 + `getCandidateContentCopy` · `getCandidateContentFact` · `putContentFieldInput` · `getCandidateContentAssembly` · `getContentAssemblyPreview` · `listCommerceOriginAreas` · `runCandidatePreValidation` · `getImageAssetFile` |
| SCR-07 ⑦ 태그 | `/candidates/:candidateId/tags` | `tags/TagsPage.tsx` | CSR | 〃 | 틀 공통 + `getCandidateTagSet` · `listTagCompetitorInputs` · `createTagCompetitorInput` · `removeTagCompetitorInput` |
| SCR-08 ⑧⑨ 최종 승인·등록 | `/candidates/:candidateId/approval` | `approval/ApprovalPage.tsx` | CSR | 〃 | 틀 공통 + `getCandidateApproval` · `getCandidateUploadResult` · `getCandidateContentAssembly` · `runCandidatePreValidation` · `createCandidateRegistration`(Idempotency-Key) · `listCandidateRegistrations` · `getRegistration` · `checkRegistrationResult` · `putRegistrationSwitch` · `fetchRakutenItem` · `requestSourcingRowStockCheck` |
| SCR-09 등록 상품 | `/products` | `products/ProductsPage.tsx` | CSR | 〃 | M1 없음(화면 전체 M2 — 자리표시자) |
| SCR-10 설정 | `/settings` | `settings/SettingsPage.tsx` | CSR | 〃 | `getSettings` · `createSettingsSnapshot` · `getPurchaseAgencyProfile` · `replacePurchaseAgencyProfile` · `listDispatchDeliveryCompanies` · `listCommerceAddressbooks` · `listCommerceReturnDeliveryCompanies` · `importForwarderRateTable` · `listForwarderRateTables` · `getForwarderRateTable` · `getLatestFxRates` · `listFxRates` · `createManualFxRate` |
| SCR-13 AI 엔진 | `/settings/ai-engine` | `ai-engine/AiEnginePage.tsx` | CSR | 〃 | `getAiEngineSettings` · `updateAiEngineSettings` · `getLatestAiCliChecks` · `createAiCliCheck` |
| SCR-11 시스템 상태 | `/system` | `system/SystemPage.tsx` | CSR | 〃 | `listSecrets` · `saveSecret` · `getAuthStatus` · `createAuthCheck` · `getLatestCommerceMetaSyncRuns` · `createCommerceMetaSyncRuns` · `getLatestAiCliChecks` · `createAiCliCheck` |
| (없는 화면) | `*` | `not-found/NotFoundPage.tsx` | CSR | 〃 | — |

## 3. 경로 규칙

1. **단계 코드 → 화면**(`steps.ts`): `SOURCING`→`sourcing` · `PRICING`·`CATEGORY`→`judgement` · `THUMBNAIL`→`thumbnail` · `COPY`·`NOTICE_RAW`·`NOTICE_HTML`→`content` · `TAGS`→`tags` · `UPLOAD`·`REGISTER`→`approval`. `CATEGORY`는 `#category`(시안 `Judgement.dc.html#category`).
2. **`/candidates/:candidateId` index**: 현재 단계로 `replace` 이동한다. 현재 단계 = 흐름상 첫 입력 대기·미실행·실패·재실행 필요 단계(05-2 `resumeStepCode` 정의). 없으면(모두 완료) `approval`. 스캐폴딩은 API를 붙이기 전이라 `sourcing`으로 보낸다.
3. **`candidateId`**: 정수(ERD serial). 정수가 아니거나 `getCandidate`가 404 `CANDIDATE_NOT_FOUND`면 틀 안에 "후보를 찾을 수 없습니다" + '후보 목록' 링크를 그린다([05-2 layout §3](05-2_layout구조.md)).
4. **search params(경로 추가 아님, Proposed)**:
   - `/candidates?candidateId=12` — 목록 화면 오른쪽에 그 후보의 단계 표를 연다(SCR-12 시안이 목록 + 고른 후보 단계 표를 한 화면에 둔다).
   - `/candidates?runnableStep=PRICING` — '입력 고르기'(F-CW-22). `listCandidates`의 `runnableStep` 필터를 그대로 쓴다.
   - `/candidates?runnableStep=SOURCING` — SCR-02 '키워드 없이 시작하려면 소싱 화면으로 갑니다' 링크(P2-01 Proposed). SCR-03 경로에 `candidateId`가 있어야 해서 후보 없는 소싱 입구가 없다. 검색어·URL로 후보를 만드는 입구는 P2-02가 정한다.
     P2-02(Proposed): 이 주소의 '입력 고르기' 위에 '검색어로 시작'(`createCandidate` SEARCH_QUERY → ② 실행 → `/candidates/:id/sourcing`)과 'URL로 바로 후보 만들기'(id `rakuten-url`, `fetchRakutenItem` → 색상 → `createCandidate` RAKUTEN_URL → 그 후보 ② 화면, 중복이면 기존 후보)를 둔다. SCR-12 목록 머리 'URL로 만들기'는 `/candidates?runnableStep=SOURCING#rakuten-url`로 간다.
   - 상태 필터(`status`)도 search params로 둔다. 새로고침·뒤로 가기에 남는다.
5. **재작명 없음**: 경로 조각은 화면 이름(시안 파일 이름)에서 왔고 API 경로와 섞지 않는다. API 경로·operationId는 05-2 그대로 쓴다.
6. **SCR-04가 더 읽는 것(P2-05 Proposed)**: 틀 공통 + 표의 연산에 더해 `getSourcingComparison`(② 현재 버전이 비교를 했는지 — 쿠폰 칸·'비교 없이 확정'을 URL 후보에만 보이려고)과 `getForwarderRateTable`(비용 분해 배대지 줄의 요금표 버전 'v2026-09')을 부른다. '실행'·'다시 실행'은 틀 공통 `startCandidateStepRun`(URL 후보면 `ownerInputs.couponYen`), '소싱 확정(G2)'은 `passCandidateGate`(G2)다.

## 4. M2 연산 (시안에만 있고 M1에서 만들지 않음)

| 화면 | M2 operationId |
|---|---|
| SCR-01 | `getDashboardSummary` · `listDashboardCleanupCandidates` · `listDashboardSystemWarnings` · `createBatchRun` · `getBatchRun` · `listSmartstoreProducts` · `createSalesRatioRecord` · `listSalesRatioRecords` · `importSalesRatioRecordCsv` · `listCredentialLifecycles` · `listCredentialAlerts` |
| SCR-02 | `getRakutenQuerySuggestion` · `listDatalabCategories` · `listBrandPolicies` |
| SCR-12 | `createCandidateDirectInput` · `listCandidateDirectInputs` · `linkCandidate` · `createBatchRun` · `getBatchRun` |
| SCR-03 | `linkCandidate` · `getRakutenQuerySuggestion` |
| SCR-04 | `simulatePrice` · `previewPriceJudgementCriteria` · `recalculatePriceJudgement` · `listDomesticPriceQueue` · `importDomesticPriceFile` · `listDomesticPriceImportMatches` · `createCandidateDirectInput` |
| SCR-05 | `listThumbnailReviews` · `createImageBackgroundRemoval` · `putCandidateAiDisclosure` · `createCandidateDirectInput` |
| SCR-06 | `listContentLintWaivers` · `createContentLintWaiver` · `revokeContentLintWaiver` · `createCandidateDirectInput` |
| SCR-07 | `createCandidateDirectInput` |
| SCR-08 | `listApprovalQueue` · `createRegistrationBatch` · `retryRegistration` · `downloadRegistrationRequestJson` · `getCatalogMatchSuggestions` · `putCandidateCatalogMatch` · `createContentLintWaiver` · `listCandidateDirectInputs` |
| SCR-09 | `listSmartstoreProducts` · `getSmartstoreProduct` · `updateSmartstoreProduct` · `deleteSmartstoreProduct` · `displaySmartstoreProduct` · `displaySmartstoreProductsInBulk` · `updateSmartstoreProductSaleStatus` · `createSmartstoreProductSync` · `listSmartstoreProductSyncs` |
| SCR-10 | `listBrandPolicies` · `createBrandPolicy` · `updateBrandPolicy` · `deleteBrandPolicy` · `listSettingsSnapshots` · `updateSettingsSection` · `listAiProviders` |
| SCR-11 | `listCallLogs` · `getAiUsage` · `listPrerequisiteChecks` · `updatePrerequisiteCheck` · `createPrerequisiteCheckRun` · `getInstallInfo` · `createInstallNoticeConsent` · `updateAutoUpdateCheck` · `createAppUpdateCheck` · `listCredentialLifecycles` · `updateCredentialLifecycle` · `listCredentialAlerts` · `listRegisteredIps` · `createRegisteredIp` · `deleteRegisteredIp` · `getLatestNoticeMonitorChecks` |
| 앱 전체 | `createScreenEvent`(화면 체류 기록) |

## 5. 교차 점검

| 점검 | 결과 |
|---|---|
| 화면 13개가 모두 경로를 가졌나 | 예. SCR-12만 경로 2개(목록 · 후보 틀) |
| 화면 없는 경로(고아) | `/candidates/:candidateId` index(이동 전용), `*`(없는 화면). 둘 다 의도한 것 |
| 03-1 렌더링과 일치 | 예(모두 CSR) |
| 경로 없는 M1 기능 | F-CW-22 '입력 고르기'(단계 화면을 후보 없이 열기): 후보 없는 단계 경로가 없다 → §3의 4 search params로 처리(Proposed) |
| 화면 없는 M1 연산 | 없음. `listKeywordSnapshots`(F-KW-06, 화면 열 비어 있음)는 SCR-02에 붙였다 |
| OpenAPI에 없는 경로를 만들었나 | 아니오. FE 경로는 화면 경로이고 API는 `/api/v1` 아래 05-2 그대로 |

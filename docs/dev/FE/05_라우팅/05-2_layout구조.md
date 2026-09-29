# 05-2. Layout 구조

| 항목 | 내용 |
|---|---|
| 버전 | 0.1 (2026-09-27) |
| 상태 | **Proposed** (D-11) |
| 근거 | [공통부품 §A·§F·§G·§H](../../../design/spec/공통부품_마크업.md) · [디자인 README §3·§6](../../../design/README.md) · [05-1](05-1_route맵.md) |

## 1. route group

**해당 없음** — Next.js의 `(group)` 폴더 개념이다. React Router에서는 **layout route**(자식을 가진 route의 `<Outlet/>`)가 같은 일을 한다. 모든 화면이 같은 앱 틀을 쓰고 로그인 전/후 구분이 없어서 layout은 두 층이면 된다.

## 2. 중첩 트리

```
RouterProvider
└─ AppLayout                      path "/"          왼쪽 내비(220px) + <main><Outlet/></main>
   ├─ DashboardPage               index
   ├─ KeywordsPage                "keywords"
   ├─ CandidatesPage              "candidates"
   ├─ CandidateLayout             "candidates/:candidateId"   후보 머리 + [단계 레일 260px | <Outlet/>]
   │  ├─ CandidateIndexRedirect   index → 현재 단계로 replace
   │  ├─ SourcingPage             "sourcing"
   │  ├─ JudgementPage            "judgement"
   │  ├─ ThumbnailPage            "thumbnail"
   │  ├─ ContentPage              "content"
   │  ├─ TagsPage                 "tags"
   │  └─ ApprovalPage             "approval"
   ├─ ProductsPage                "products"
   ├─ SettingsPage                "settings"
   ├─ AiEnginePage                "settings/ai-engine"   (설정의 자식 route가 아님 — §4-3)
   ├─ SystemPage                  "system"
   └─ NotFoundPage                "*"
```

## 3. layout이 공유하는 것

| layout | 공유 요소 | 데이터 | 규칙 |
|---|---|---|---|
| `AppLayout`(+ `AppNav`) | 왼쪽 내비(순서·아이콘·라벨은 공통부품 §A), 내비 아래 상태 상자, 본문 여백(`24px 32px`, gap 24) | `getRegistrationSwitch` · `getCallUsage` · SSE 연결 1개 | 현재 항목은 `NavLink`가 `aria-current="page"`. 아래 §5 |
| `CandidateLayout` | 후보 머리(§F: 상품명·앵커 키·게이트·페이지 받은 시각), 단계 레일(§G), 레일 아래 '재실행 필요 단계 모두 실행' | `getCandidate` · `listCandidateSteps` · `listCandidateGates` · SSE(해당 후보) | 레일 현재 행 `aria-current="step"`. 404면 "후보를 찾을 수 없습니다" + '후보 목록' |
| (단계 화면 각자) | 단계 본문 맨 위 상태 줄(§H) | `listCandidateStepRuns` · `getCandidateStepStaleDiff` | layout이 아니라 공통 부품 `StepStatusBar`로 각 화면이 둔다. ③④·⑧⑨처럼 한 화면에 단계가 둘이면 상태 줄도 둘이다 |

## 4. 경계가 애매한 곳 (옵션 2개)

### 4-1. SCR-12 시안: 목록 + 고른 후보 단계 표가 한 화면

시안 `CandidateWork.dc.html`은 왼쪽 후보 목록, 오른쪽 고른 후보의 머리 + 단계 **표**(버전 이력 펼침)다. 공통 명세 §3의 경로는 `/candidates/:candidateId`를 "현재 단계로 이동"으로 정했다.

| 옵션 | 내용 | 장점 | 단점 |
|---|---|---|---|
| **A (Proposed)** | `/candidates?candidateId=12` — 목록 화면이 search param으로 오른쪽 단계 표를 연다. `/candidates/:candidateId`는 명세대로 이동 전용 | 공통 명세 §3 경로표를 바꾸지 않는다. 시안 그대로 한 화면 | 같은 후보를 가리키는 URL이 두 모양(`?candidateId=`와 `/:candidateId/…`) |
| B | `/candidates/:candidateId` index가 이동 대신 단계 표를 그린다 | URL 하나로 후보를 가리킨다 | 명세 §3("기본은 현재 단계로 이동")을 바꿔야 한다. 목록이 사라져 시안과 다르다 |

### 4-2. 오류 화면을 어느 층에 둘까

| 옵션 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A | 루트 route(`/`)에 `ErrorBoundary` | 한 곳 | 오류 때 내비까지 사라진다(루트 element가 바뀐다) |
| **B (Proposed)** | `AppLayout` 아래 경로 없는 layout route 하나에 `ErrorBoundary`를 두고 화면들을 그 자식으로 | 오류가 나도 내비가 남는다. 경로는 그대로 | route 객체가 한 층 늘어난다(URL 변화 없음) |

### 4-3. AI 엔진(SCR-13)의 하단 저장 바

| 옵션 | 내용 | 장점 | 단점 |
|---|---|---|---|
| **A (Proposed)** | `AiEnginePage` 안에서 본문을 [내용 스크롤 영역 \| 고정 저장 바 64px]로 나눈다(화면시안_명세 §6) | 저장 바를 쓰는 화면이 하나뿐이다 | 다른 화면이 쓰게 되면 옮겨야 한다 |
| B | `AppLayout`에 하단 액션 바 자리를 둔다 | 재사용 | 지금 한 화면을 위해 앱 틀이 커진다 |

AI 엔진은 URL이 `/settings/ai-engine`이지만 설정의 **자식 route로 두지 않는다**. 설정 화면(탭)과 AI 엔진 화면이 공유하는 틀이 없어서다(시안: 서로 다른 보드). 내비에서는 '설정'의 하위 항목으로 보인다.

## 5. 내비 현재 항목 규칙

| 항목 | `NavLink` | 현재 항목이 되는 경로 | 근거 |
|---|---|---|---|
| 대시보드 | `to="/" end` | `/`만 | `/`는 모든 경로의 앞부분이라 `end` 필수 |
| 후보 작업 | `to="/candidates"` | `/candidates`, `/candidates/:id/…` 전부 | 단계 화면의 현재 항목은 '후보 작업'(공통부품 §A) |
| 설정 | `to="/settings" end` | `/settings`만 | AI 엔진 화면에서는 '설정'이 보통 모양(디자인 README §6-10) |
| AI 엔진 | `to="/settings/ai-engine"` | `/settings/ai-engine` | 하위 항목만 현재 항목 |
| 나머지 | 기본 | 그 경로와 하위 | — |

`*`(없는 화면)에서는 현재 항목이 없다.

## 6. 상태 화면 자리

| 상태 | 어디서 | 모양 |
|---|---|---|
| 화면 코드 받는 중(lazy) | 이동 중에는 이전 화면을 유지. 첫 진입은 앱 틀 + 빈 본문 | 05-4 |
| 데이터 받는 중 | 각 화면·부품(Query `isPending`) | 표·패널 자리에 로딩 표시. route loader는 쓰지 않는다(03-2 §6) |
| 없는 경로 | `*` → `NotFoundPage`(앱 틀 안) | "없는 화면입니다" + 대시보드 링크 |
| 없는 후보 | `CandidateLayout`(`CANDIDATE_NOT_FOUND`) | 틀 안에 안내 + '후보 목록' |
| 아직 안 한 단계 | 단계 화면(`STEP_OUTPUT_NOT_FOUND`) | "아직 {단계}를 실행하지 않았습니다" + 상태 줄의 '실행' |
| 예상 못 한 오류 | §4-2의 `ErrorBoundary` | 오류 봉투 `message` + 다시 시도 |

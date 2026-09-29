---
name: fe-auth-guard
description: >-
  BE 07 인증 계약을 받아 프론트 토큰 저장 전략·Next middleware 라우트 가드·권한별 UI·
  위협 점검(XSS/CSRF)을 만든다. 토큰 저장 ADR → useAuth/Zustand → middleware 1차 차단 →
  서버 컴포넌트 2차 인가·<Can> UI → 카카오 OAuth·refresh 인터셉터 → security-review.
  "프론트 인증", "라우트 가드", "토큰 저장", "middleware", "권한별 UI", "토큰 갱신",
  "카카오 OAuth 연동", "open redirect", "auth guard", "route guard", "token storage",
  "XSS CSRF", "auth middleware" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# 인증·라우트 가드 (Auth & Route Guard)

BE 07이 발급하는 토큰(access/refresh JWT)과 카카오 OAuth 흐름을 프론트에서 안전하게 받아
저장하고, 화면을 권한에 따라 막는 작업을 자동화한다. 산출물 = **토큰 저장 전략(ADR) →
middleware 가드 → 권한별 UI → 위협 점검**. **AI는 보일러플레이트 생성·회수율(middleware
matcher·refresh 큐·`<Can>` 패턴), "이 저장 전략·리다이렉트가 안전한가"라는 보안 판단은
사람 + security-review가 의심한다.** 인증은 한 번 뚫리면 전체가 무너지므로 사람 검수를
건너뛰지 않는다.

<!-- 변경 포인트 (배포본 → 본인 환경에 맞게 수정):
  1. 출력 경로: 기본 frontend-output/<주제-슬러그>/12_인증가드/. 볼트 설치본은 FE/실행산출물/<주제>로 고정 가능.
  2. 계승 출처: BE 07 인증 규약·05 openapi.yaml(/api/v1/auth 경로)·FE 05 라우팅·09 상태·10 fetch 클라이언트 경로를 본인 폴더 구조로 수정.
  3. 도구(MCP/CLI): Context7(Next 15 middleware·cookies()·TanStack Query 최신) / security-review 스킬 / gh(브랜치 변경분). 없으면 degrade.
  4. 스택 버전: React 19 / Next.js 15(App Router) / TS strict / TanStack Query v5 / Zustand. 팀 스택이 다르면 교체.
  5. 역할 모델: 포밋 GUARDIAN/SITTER는 예시 — BE 07 클레임 값으로 1:1 교체(임의 재작명 금지).
     ⚠️ **역할이 없는 단일 actor 도메인**(BE 07에 role 컬럼·클레임 부재): `<Can role>`·역할 2차 인가는 **만들지 않고**(억지 발명 금지), 차등은 전적으로 **소유권(BE 403·IDOR 방어)** + 로그인 여부로 한다. 12-3은 `<Can role>` 대신 `<Authenticated>`(로그인 게이트) + 소유권 403 화면 분기로 대체.
  6. 토큰 발급 형태: 포밋은 BE가 refresh를 **httpOnly 쿠키로 Set-Cookie**(→ 정본 (b) 직행). BE 07이 refresh를 **응답 바디**로 주면((b)/(a) 전제 붕괴) BE가 직접 Set-Cookie 못 하므로, **Next Route Handler(BFF)에서 refresh를 httpOnly 쿠키로 승격**((b') 절충)하거나 BE에 Set-Cookie 추가 요청. Stage 1에서 BE 발급 형태부터 확인.
-->

## 핵심 원칙

- **상위 산출물 계승, 재발명 금지 — 단 확정 상태일 때만.**
  - **BE 07 인증 계약이 정본**: 역할 값(`GUARDIAN`/`SITTER`)·콜백 경로(`/api/v1/auth/kakao`·
    `/api/v1/auth/refresh`·`/api/v1/auth/logout`)·쿠키 규약은 **BE 07에서 1:1 계승(재작명 금지)**. 타입은
    FE 10 생성 타입(openapi-typescript) 사용. BE 07 미확정/부재면 ⚠️ + 가정 명시 후 진행.
  - **FE 05 계승 → 보호/공개 라우트 목록**(middleware matcher 출처), **FE 09 계승 → 상태 분리**
    (프로필=TanStack Query, 로그인 여부·역할=Zustand 얇게), **FE 10 계승 → fetch 클라이언트**
    (refresh 인터셉터는 새로 만들지 말고 10 클라이언트를 확장). 보조 입력 부재 시 degrade.
- **저장 전략을 코드보다 먼저 글로 박는다(ADR)**: Step 1 ADR이 이후 다섯 단계의 전제다.
  결정 근거가 있어야 보안 리뷰에서 "왜 메모리인가"에 답한다. 저장소를 바꾸면
  middleware·인터셉터·로그인 흐름을 전부 다시 짜므로 순서를 고정한다.
- **가드를 계층으로 나눈다**: middleware(서버 1차 차단·쿠키 유무만)·서버 컴포넌트 레이아웃
  (2차 인가·`/me`로 역할 확인)·`<Can>`(UI 노출). 한 군데 몰면 Edge에서 무거운 검증을
  돌리거나 UI 숨김을 보안으로 착각한다.
- **UI 숨김은 보안이 아니다**: `<Can>`으로 버튼을 숨겨도 사용자는 API를 직접 호출한다. 프론트
  권한 분기는 UX이고 **최종 인가는 항상 BE**. JWT 페이로드를 프론트가 디코드해 신뢰하지
  않는다 — 권한 데이터는 BE 검증 응답으로만 판단.
- **AI 초안의 보안성을 그대로 믿지 않는다**: 저장 전략·쿠키 옵션·리다이렉트 대상은 사람이
  검토하고 `security-review`로 교차 점검한다(Stage 5는 필수 단계). 상세는 "주의" 참조.

## 입력

- **필수**: **BE 07 인증 규약**(토큰 발급·카카오 콜백·역할 클레임 — `<BE루트>/07_인증인가/`
  또는 BE 05 `openapi.yaml`의 `/auth` 경로). 없으면 **중단**(또는 위치 질의·계약 가정 명시).
  <!-- 변경 포인트(입력 경로): 본인 설치본은 <BE루트>=BE/실행산출물/<주제>. 다른 폴더면 수정 -->
- **권장(없으면 degrade)**:
  - `<루트>/05_라우팅/05-1_route맵.md` — 보호/공개 라우트 목록 출처(없으면 포밋 예시 가정 + ⚠️)
  - `<루트>/09_상태관리/` — 서버/클라 상태 분리 기준(없으면 09 기본 분리 가정)
  - `<루트>/10_API연동/` — refresh 인터셉터가 붙는 fetch 클라이언트(없으면 인터셉터 골격만 + "10 클라이언트에 연결 필요")
  - `<루트>/06_개발환경/06-3_env분리.md` — 카카오 키 `NEXT_PUBLIC_`/서버전용 구분 규약

## 출력 위치: `frontend-output/<주제-슬러그>/12_인증가드/`

<!-- 변경 포인트(출력 경로): 기본은 현재 작업 폴더의 frontend-output/<주제-슬러그>/.
     볼트 설치본은 FE/실행산출물/<주제>로 고정 가능. 전 FE 스킬이 같은 <루트>를 공유한다. -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `12-1_토큰저장전략.md` | ADR(0012): (a)쿠키전부 / (b)access메모리+refresh쿠키 / (c)localStorage 비교표(XSS/CSRF/SSR/복잡도/refresh흐름) + 권장안·근거 + 따라오는 방어(CSRF) + localStorage 탈락 사유 | Stage 1 |
| `12-2_middleware가드.md` | `src/middleware.ts` 초안 — 보호/공개 라우트 matcher, refresh 쿠키 유무 1차 차단, `/login?next=` 리다이렉트, open redirect 방지(내부 경로 검증), 정적/`_next`/`api` 제외, "왜 1차 차단만 하는지" 주석 | Stage 2 |
| `12-3_권한별UI.md` | `useAuth()` 훅(Zustand+TanStack Query `["me"]`)·`<Can role>` 컴포넌트·`/sitter/*` 서버 컴포넌트 레이아웃 2차 인가·권한 상수 + "UI 숨김은 보안 아님" 주석. **역할 부재 도메인이면** `<Can role>` 대신 `<Authenticated>`(로그인 게이트)·소유권 403 화면 분기로 대체(변경포인트 5) | Stage 3 |
| `12-4_위협점검.md` | 로그인 흐름(카카오 OAuth의 state CSRF·콜백 / **또는 BE 07이 자체 로그인이면 그 흐름**)·refresh single-flight 인터셉터(FE 10 연결)·`security-review` 점검 항목·발견 결함 표 | Stage 4·5 |
| `_검증체크리스트.md` | 사람 확인 항목(🔴 보안 전수) | Stage 5 |

- 출력 폴더가 없으면 생성. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`).
- 관통 예시 = 포밋(펫시터 매칭). BE 07: 카카오 OAuth 콜백으로 access(짧음)/refresh(긺) 발급,
  역할 `GUARDIAN`/`SITTER`를 토큰 클레임에 담음.

## 파이프라인

### Stage 0 — 입력 확인·계약 감지·도구 probe·degrade
- **BE 07 인증 규약 로드(필수)**: 역할 값·콜백 경로·쿠키 규약 추출. 없으면 **중단**(위치 질의).
  부분 확정이면 미확정 부분 ⚠️ + 가정 명시.
- FE 05 라우트 맵(보호/공개 목록)·09 상태 분리·10 fetch 클라이언트 로드 시도(없으면 degrade).
- **도구 probe**: Context7(ToolSearch 존재로 판별)·security-review(스킬 가용)·gh(bash 시도).
  부재 시 아래 "도구 정확성"대로 degrade.

### Stage 1 — 토큰 저장 전략 ADR → 12-1
- **먼저 BE 07 토큰 발급 형태 확인**: refresh를 **httpOnly 쿠키(Set-Cookie)** 로 주는가(포밋 → (b) 직행)
  vs **응답 바디**(`TokenResponse{accessToken,refreshToken}`)로 주는가. **바디면 (a)/(b)의 "BE가 쿠키 발급"
  전제가 깨지므로** → BE가 직접 Set-Cookie 못 함. 이때는 **Next Route Handler(BFF)에서 refresh를
  httpOnly 쿠키로 승격**하는 **(b') 절충안**(BE 변경 불필요)을 권장안으로, 또는 BE에 Set-Cookie 추가 요청.
- **코드 전에 저장 위치부터 합의**. Context7로 Next 15 App Router 인증·`cookies()` 처리 최신
  문서를 확인한 뒤(부재 시 내장 지식 + ⚠️ 버전주의), 세(네) 안을 비교 표로:
  (a) access·refresh 모두 httpOnly 쿠키 / (b) access 메모리·refresh httpOnly 쿠키(BE Set-Cookie) /
  (b') access 메모리·refresh BFF 승격 httpOnly 쿠키(BE 바디 발급 시) / (c) localStorage.
  각 안에 **XSS 노출 / CSRF 노출 / SSR 가능 / 구현 복잡도 / refresh 흐름** 컬럼.
- 권장안·근거 + 그 안에서 따라오는 방어(CSRF 토큰·SameSite) + localStorage 탈락 사유 명시.
  > 포밋 정본 결론: **(b) access 메모리 + refresh httpOnly·SameSite 쿠키**. refresh가 JS에서
  > 안 읽혀 XSS 장기 탈취 차단, access는 새로고침 시 refresh로 재발급. 쿠키를 쓰므로 상태변경
  > 요청에 CSRF 방어(SameSite=Strict/Lax + 필요 시 CSRF 토큰). localStorage는 XSS 즉시 탈취로 탈락.
- → `docs/adr/0012-token-storage.md` 성격의 `12-1_토큰저장전략.md`. **이 ADR이 게이트 확정 전엔
  Stage 2 이후로 넘어가지 않는다**(저장 전략이 모든 가드의 전제).

### 🚦 게이트 — 🔴 토큰 저장 전략 + 보안 결정 사람 확정 (필수)
AskUserQuestion으로 12-1 ADR(세 안 비교 + 권장안)을 제시 → 사람이 확정/수정. **🔴 보안 단계:
사람 확정 없이 Stage 2(가드 구현)로 넘어가지 않는다.** 사람이 쥐는 결정 항목:
- **저장 위치 확정** — (b) 권장이 우리 위협 모델에 맞는지(결제·개인정보 노출 면적).
- **CSRF 방어 수준** — SameSite만으로 충분한지 CSRF 토큰 동반 여부.
- **역할 모델 확인** — BE 07 클레임 값(`GUARDIAN`/`SITTER`)이 맞는지(임의 재작명 금지).
- **보호 라우트 목록 확정** — 05 route map에서 파생한 목록이 맞는지(누락 화면 점검).

### Stage 2 — Next.js middleware 라우트 가드 → 12-2
- Context7로 Next 15 middleware의 `matcher`·`NextResponse.redirect` 최신 시그니처 확인 후 생성:
  - **보호 라우트**(05 계승, 포밋 예: `/pets`,`/bookings`,`/chat`,`/mypage`,`/payments`,`/sitter/*`)
    / **공개 라우트**(`/`,`/login`,`/oauth/kakao/callback`,`/sitters`,`/sitters/[id]`).
  - refresh 쿠키 없으면 보호 라우트 접근 시 `/login?next=<원래경로>` 리다이렉트. 로그인 상태로
    `/login` 접근 시 `/`로.
  - **역할 검증(`/sitter/*`)은 middleware에서 토큰 디코드로 하지 말고** 서버 컴포넌트 레이아웃
    (Stage 3)에서 `/me`로. middleware는 Edge라 신뢰경계·검증 비용 주의 → "쿠키 유무" 1차만.
  - 정적 파일·`_next`·`api`는 matcher 제외(불필요 실행 방지).
  - **open redirect 방지**: `next` 파라미터는 자기 도메인 내부 경로(앞이 `/`이고 `//` 아님)인지
    검증 후 redirect. 외부 URL이면 `/`로 폴백.
- 주석으로 "왜 middleware는 1차 차단만 하고 정밀 인가는 안 하는지" 근거 명시. → `src/middleware.ts`.

### Stage 3 — 인증 상태·권한별 UI·2차 인가 → 12-3
- **`useAuth()` 훅**: access token은 메모리만(Zustand store, **persist 미사용** — 새로고침 시
  의도적으로 사라짐). 프로필은 TanStack Query `useQuery(["me"])`로 `GET /api/v1/members/me`
  (BE 07 계약·10단계 타입). 반환 `{ user, role, isAuthenticated, isLoading }`. `role` 타입은
  BE 클레임 그대로 `"GUARDIAN" | "SITTER"` 유니온(재작명 금지). 로그아웃: `POST /api/v1/auth/logout`
  → store 비우고 `["me"]` 캐시 무효화.
- **`<Can role="SITTER">`**: `useAuth().role`과 비교해 children 노출, 아니면 null.
- **`/sitter/*` 서버 컴포넌트 레이아웃(2차 인가)**: 서버에서 `/me` 조회해 `role !== "SITTER"`면
  `notFound()` 또는 `/`로 redirect — Stage 2 middleware 1차 차단을 보완.
- GNB의 "시터 정산"·"예약 받기" 메뉴를 `<Can>`으로 감싼다. 주석에 **"UI 숨김은 UX이지 보안이
  아니다 — 모든 권한은 BE API가 최종 인가한다"** 명시. → `src/features/auth/` 아래 분리.

### Stage 4 — 로그인 플로우(카카오 OAuth 등) + refresh 인터셉터 → 12-4
- **BE 07이 카카오 OAuth가 아니면**(자체 email/password `/auth/login` 등, 소셜 식별자 컬럼·콜백 부재):
  아래 1·2의 카카오 인가 URL·콜백 대신 **BE 07이 정의한 로그인 흐름**(자체 로그인 폼 → BFF/직접 `/auth/login`
  → 토큰 수신)으로 대체한다. 카카오 OAuth는 **차기 도입 시 선결**(BE 콜백·소셜 컬럼 추가)로만 보존(임의 엔드포인트 발명 금지).
  3의 refresh 인터셉터는 발급 방식과 무관하게 공통.
- BE 07 규약(openapi의 `/auth` 경로)을 읽고:
  1. **로그인 버튼**: 카카오 인가 URL 이동(`NEXT_PUBLIC_KAKAO_*` env, **`state` 파라미터로
     CSRF 방지** — 콜백에서 검증). 리다이렉트 URI는 카카오 콘솔 등록값과 정확히 일치.
  2. **`/oauth/kakao/callback`**: `code`·`state` 검증 → `POST /api/v1/auth/kakao` → BE가 refresh를
     httpOnly 쿠키로 Set-Cookie, access는 응답 바디 → 메모리 store 저장 → `next`(Stage 2가 넘긴
     원래 경로, open redirect 검증 동일) 복귀.
  3. **refresh 인터셉터(FE 10 클라이언트 확장)**: 401 응답 시 `POST /api/v1/auth/refresh`(쿠키 자동 동봉)
     로 access 재발급 후 원요청 1회 재시도. **동시 401은 refresh 한 번만(single-flight 큐)**,
     실패 시 로그아웃 처리. `state` 검증 실패·refresh 실패·BE 에러 코드별 사용자 메시지 분기.
- → `12-4_위협점검.md`(코드 초안 + 흐름 설명).

### Stage 5 — 보안 자가 점검(security-review) + 검증 체크리스트
- **`security-review` 스킬로 변경분 스캔**(가용 시 `/security-review` 호출, 부재 시 아래 점검
  항목을 수기 체크리스트로 degrade). 특히:
  - 토큰이 localStorage·sessionStorage·로그·URL 쿼리로 새는 경로
  - middleware 리다이렉트의 open redirect(`next`가 외부 URL로 가는지)
  - `dangerouslySetInnerHTML` 등 XSS 싱크에 사용자 입력이 닿는지
  - 쿠키 옵션(httpOnly·Secure·SameSite) 누락
  - 권한 분기를 클라이언트에만 의존하고 서버 인가가 빠진 화면
- 발견 결함을 `12-4_위협점검.md` 결함 표에 등재(사람이 판단·해소). **🔴 결함은 사람 확정 전
  완료 보고 금지.**
- `_검증체크리스트.md` 생성(`<주제>`/`<날짜>` 치환, 아래 본문).

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(ToolSearch 존재로 probe) = Next 15 middleware·`cookies()` 비동기화·TanStack
  Query 토큰 갱신 패턴 최신 조회. 인증 API는 Next 버전마다 권장 패턴이 바뀌므로(`cookies()`
  비동기화 등) 기억에 의존 금지. **부재 시 내장 지식 + "⚠️ Next 15 시그니처 확인 필요"** 표기.
- **security-review 스킬**(가용 시) = Stage 5 변경분 보안 스캔(`/security-review`). 단 이 스킬은
  **변경된 코드 diff(PR/working tree)** 를 대상으로 동작한다 → **설계 초안(.md)만 만든 단계·git repo 아닌
  환경에서는 diff가 없어 스캔 불가**. 이때(또는 스킬 부재 시)는 **Stage 5 OWASP 점검 항목을 수기
  체크리스트로 degrade**하고 "실코드 작성·커밋 후 `/security-review` 재점검 필수 ⚠️" 표기(보안 점검 자체는 생략 금지).
- **gh / git**(bash probe) = 브랜치 변경분 식별. 부재 시 변경 파일을 수기 지정해 점검.
- **중단**은 필수 입력(BE 07 인증 규약) 부재 시에만. 05·09·10 보조 입력은 degrade(골격은 생성하되
  "해당 단계 산출물에 연결 필요" 표기).

## _검증체크리스트 본문 (Stage 5 생성)
```markdown
# 검증 체크리스트 — <주제> 인증·라우트 가드 (작성일: <날짜>)

> AI는 보일러플레이트·회수율까지. 저장 전략·리다이렉트 안전성은 사람 + security-review의 판단이다.

- [ ] 🔴 토큰 저장 전략(12-1 ADR)을 사람이 확정한 뒤 가드 구현으로 넘어갔는가 (저장 위치가 모든 가드의 전제)
- [ ] access token이 메모리에만 있고 localStorage·sessionStorage·로그·URL 쿼리로 새지 않는가
- [ ] refresh 쿠키 옵션(httpOnly·Secure·SameSite) 누락 없는가
- [ ] middleware matcher가 보호 라우트(05 계승) 전부 포함·정적/_next/api 제외 (가드 누락 0)
- [ ] open redirect 방지: /login?next= 가 자기 도메인 내부 경로(/시작·// 아님)인지 검증
- [ ] 역할 값(GUARDIAN/SITTER)이 BE 07 클레임과 1:1 (프론트 임의 재작명 0건)
- [ ] /sitter/* 2차 인가가 서버 컴포넌트에서 /me로 확인 (middleware 1차 차단만으로 끝나지 않음)
- [ ] <Can> 등 UI 숨김에 보안 의존 0 — 권한 걸린 화면 모두 서버 인가 존재
- [ ] 프론트가 JWT 페이로드를 검증 없이 신뢰해 권한 판단하는 곳 0
- [ ] 카카오 OAuth: state 파라미터로 CSRF 방지·콜백에서 state 검증·리다이렉트 URI 콘솔 등록값 일치
- [ ] refresh 인터셉터: 동시 401에 single-flight(refresh 1회)·실패 시 로그아웃 (FE 10 클라이언트에 연결)
- [ ] 카카오 시크릿이 NEXT_PUBLIC_ 접두사로 번들에 노출되지 않음 (공개 가능 값만 NEXT_PUBLIC_)
- [ ] security-review(또는 수기 점검) 통과 — 발견 결함을 사람이 해소
```

## 주의
- **AI 초안의 보안성을 그대로 믿지 않는다** — localStorage 토큰 저장을 무비판 생성하기도 한다.
  저장 전략·쿠키 옵션·리다이렉트 대상은 사람이 검토 + security-review 교차 점검.
- **UI 숨김을 보안으로 착각하지 않는다** — `<Can>`으로 버튼을 숨겨도 API는 직접 호출 가능.
  프론트 권한 분기는 UX, 최종 인가는 항상 BE. JWT 페이로드는 위변조 검증 없이 읽는 정보이므로
  프론트가 디코드해 권한을 판단하지 않는다.
- **middleware는 Edge 런타임** — Node API·무거운 검증·DB 접근 금지/고비용. matcher에 정적·api 제외.
- **흔한 실수 — open redirect**: `/login?next=`를 검증 없이 `redirect(next)`에 넘기면 외부 피싱
  경로. next는 자기 도메인 내부 경로(앞 `/`·`//` 아님)인지 검증.
- **흔한 실수 — env 키 노출**: 카카오 REST API 시크릿을 `NEXT_PUBLIC_`로 두면 번들에 박혀 공개.
  공개 가능 값과 서버 전용 시크릿을 06 규약대로 구분.
- 디자인 시리즈와 중복 금지(시안·토큰 정의는 디자인 몫). 스택 정본 고정(React 19·Next 15·TS strict·
  TanStack Query v5·Zustand). 없는 스킬/도구 인용 금지(security-review·Context7는 정본).

## 원본 가이드
- 이 스킬은 FE 가이드 **"12. 인증·라우트 가드"**를 자동화한 것입니다.

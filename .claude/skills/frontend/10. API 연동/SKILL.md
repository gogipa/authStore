---
name: fe-api-integration
description: >-
  BE 05 OpenAPI 계약을 타입의 출처로 삼아 화면의 서버 상태를 실제 API와 연결한다.
  openapi-typescript로 타입·클라이언트 생성 → queryKey 팩토리·query/mutation 훅 초안 →
  로딩/에러/빈/성공 4분기 → 낙관적 업데이트·롤백·메서드별 재시도. AI는 골격·회수율,
  캐시 전략·낙관적 적용 여부는 사람이 확정. "API 연동", "데이터 페칭", "openapi-typescript",
  "TanStack Query 훅", "낙관적 업데이트", "캐시 무효화", "에러 매핑", "api integration",
  "data fetching", "optimistic update", "query mutation hooks" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# API 연동 (API Integration)

09에서 그은 "서버 상태=TanStack Query, 전역 클라 상태=Zustand" 경계 위에, 화면의 서버 상태를 **실제 BE API와 연결**한다. 산출물 = BE 05 OpenAPI에서 생성한 타입·클라이언트(10-1) → queryKey 팩토리·query/mutation 훅 초안(10-2) → 로딩/에러/빈/성공 4분기(10-3) → 낙관적 업데이트·롤백·재시도 정책(10-4). **AI는 계약→타입 생성과 훅 보일러플레이트·상태 분기·에러 매핑 초안(회수율), staleTime·캐시 무효화 범위·낙관적 업데이트 적용 여부 같은 도메인 판단은 사람이 확정.**

<!-- 변경 포인트 (배포본 → 본인 환경에 맞게 수정):
  1. 출력 경로: 기본 frontend-output/<주제-슬러그>/10_API연동/. 볼트 설치본은 FE/실행산출물/<주제>로 고정 가능.
  2. 계승 출처: BE 05 openapi.yaml(backend-output/<주제>/05_API/05-2_openapi.yaml 또는 로컬 ./openapi.yaml), FE 09(<루트>/09_상태관리/) 경로를 본인 폴더 구조로 수정.
  3. 도구(MCP/CLI): Context7(TanStack Query v5·openapi-typescript 최신) / openapi-typescript·openapi-fetch·pnpm(타입 생성·typecheck) — 없으면 degrade.
  4. 스택 버전: React 19 / Next 15(App Router) / TS strict / TanStack Query v5 / openapi-typescript+openapi-fetch. v4 패턴(isLoading 단독·query onSuccess·cacheTime) 혼용 금지.
-->

## 핵심 원칙

- **타입의 출처를 BE 명세로 단일화 — 손으로 쓴 interface 금지.** FE가 직접 작성한 타입은 BE가 필드명 하나만 바꿔도 거짓말이 되지만 컴파일은 통과한다. `openapi-typescript`로 `openapi.yaml`에서 타입을 생성하면 `pnpm gen:api` 후 타입 에러가 나는 곳이 곧 "고쳐야 할 화면 목록" — 계약 불일치를 런타임이 아니라 컴파일 타임으로 당긴다.
- **상위 산출물 계승, 재발명 금지 — 단 확정 상태일 때만.**
  - **BE 05 OpenAPI → 10-1 타입**: 스키마 이름·필드·경로를 그대로 계승(예시 포밋: Member·Pet·SitterProfile·Booking·Payment·Review·Chat·Notification — **본인 BE 명세의 `components.schemas` 이름을 그대로 따르라**). **임의 재작명 금지.** 생성된 `schema.d.ts`는 **수정 금지**(재생성 산출물 — 주석 명시). 타입을 바꾸려면 BE 명세 수정(=BE 협의).
    - ⚠️ **id 타입 = BE 명세가 진실(string≠number 주의).** BE가 `integer/int64`면 생성 타입은 `number` — FE 09 queryKey가 `id: string`으로 짰더라도 BE 정본(`number`)으로 정정. path 세그먼트(`useParams`)는 string이므로 호출부에서 `Number(params.id)` 변환 + NaN 가드. (09가 라우트 파라미터와 API 식별자를 혼동해 string으로 둔 경우 흔함.)
  - **FE 09 → 10-2**: `09-2_query키설계.md` queryKey 컨벤션과 `09-1_상태분류표.md` 서버/클라 경계를 계승. 09가 확정한 QueryClient·캐시 정책 위에 훅을 얹는다. 09 부재 시 ⚠️(09 미대조) + queryKey 컨벤션을 본 단계에서 제안하고 게이트 회부.
  - BE 명세에 잔존한 `⚠️`/`[확인 필요]`/`x-proposal`은 그 화면 훅 주석에 보존(임의 확정 금지).
- **로딩/에러/빈 상태는 1급.** 행복한 경로만 그리면 화면 절반이 빈다. 모든 query 화면에 `isPending`/`isError`/`empty`/`success` **4분기를 강제**하고, 디자인 시리즈에서 넘어온 상태 화면 컴포넌트(로딩 스켈레톤·에러·빈 상태)에 1:1 연결한다 — **상태 화면을 새로 디자인하지 않는다**(디자인 몫). 단 **08-2가 그 컴포넌트(EmptyState/Skeleton/ErrorBanner)를 "07 부재"로 표시**하면(역질의 보존), 이 단계는 **컴포넌트명 플레이스홀더 + 인라인 마크업으로 연결만** 하고 새 컴포넌트를 임의 생성하지 않는다(반복 시 07 승격 회부 — 08-2 결함 보존).
- **낙관적 업데이트는 기본값이 아니라 선택.** 모두 낙관적으로 처리하면 롤백 UX가 복잡해지고 금전·상태 변경에서 사고가 난다. "어디는 낙관적, 어디는 보수적"을 표로 분리해 사람이 확정(취소·토글=OK / 결제 생성=금지).
- **재시도는 메서드별로 다르게.** GET은 일시 네트워크 오류에 재시도가 이득(기본 2회, 4xx 제외). 결제·예약 같은 상태 변경 mutation은 중복 요청 사고 → `retry: false`.
- **데이터 접근은 생성된 클라이언트로 단일화 — raw fetch 잔존 금지.** openapi-fetch를 우회한 fetch는 타입 안전성·토큰 주입·에러 매핑을 모두 우회한다.
- **단계별 파일로 끊는다 — 한 방 프롬프트 금지.** 도메인별(시터·예약·결제)로 끊어 각 묶음의 staleTime·무효화·재시도를 사람이 검토. "모든 API 한 번에"는 캐시 전략 판단을 전부 AI에 떠넘기는 것.

## 입력

- **필수**: BE 05 OpenAPI 명세 — `backend-output/<주제-슬러그>/05_API/05-2_openapi.yaml`(형제 BE 산출물) 또는 프로젝트 루트 `./openapi.yaml`(BE에서 받은 파일). 없으면 **위치를 묻고 중단**(타입의 출처가 없으면 이 단계는 성립하지 않는다).
  <!-- 변경 포인트(입력 경로): BE 명세가 URL(/openapi.json)로만 제공되면 그 URL을 openapi-typescript 입력으로. 볼트 설치본은 경로 고정. -->
- **권장**:
  - `<루트>/09_상태관리/09-1_상태분류표.md`·`09-2_query키설계.md` — queryKey 컨벤션·서버/클라 경계 계승. 없으면 ⚠️(09 미대조) + queryKey 컨벤션 본 단계 제안.
  - `<루트>/08_화면구현/08-2_상태화면커버리지.md` — 어떤 상태 화면 컴포넌트(스켈레톤/에러/빈)에 연결할지. 없으면 컴포넌트명을 플레이스홀더로 두고 ⚠️.
- 그 외 보조 입력 부재는 degrade(중단은 BE OpenAPI 부재 시에만).

> 시안의 로딩 스켈레톤·에러·빈 상태 디자인은 디자인 시리즈에서 이미 정의돼 넘어온다. 이 단계는 그 상태 화면들을 **어떤 query 상태에 연결할지**를 코드로 구현하는 일이지, 상태 화면을 새로 디자인하는 일이 아니다.

## 출력 위치: `frontend-output/<주제-슬러그>/10_API연동/`

<!-- 변경 포인트(출력 경로): 기본은 현재 작업 폴더의 frontend-output/<주제-슬러그>/. 볼트 설치본은 FE/실행산출물/<주제>로 고정 가능. 모든 FE 스킬은 같은 <루트>=frontend-output/<주제-슬러그>를 공유(이전 단계는 형제 폴더에서 읽음). -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `10-1_타입생성.md` | openapi-typescript `gen:api` 스크립트(package.json) + openapi-fetch 타입드 클라이언트 초안(baseUrl=NEXT_PUBLIC_API_BASE_URL, Authorization 주입 지점만 — 토큰 저장은 12 소관). 도메인 타입 재노출. `schema.d.ts` "수정 금지" 주석 명시 | Stage 1 |
| `10-2_query훅초안.md` | queryKey 팩토리(all/list(filters)/detail(id) 계층, 09-2 계승) + query/mutation 훅 골격(GET=useQuery, 변경=useMutation). 각 훅 staleTime 제안 + 근거 주석 | Stage 2 |
| `10-3_로딩에러빈상태.md` | 화면별 4분기(isPending/isError/empty/success) 연결 패턴 + 디자인 상태 화면 컴포넌트 매핑 + `errorMessage.ts` 에러코드→사용자문구 매핑 표(미매핑=폴백+콘솔/Sentry 로깅) | Stage 3 |
| `10-4_낙관적업데이트.md` | onMutate/onError/onSettled 롤백·재동기화 패턴 + mutation별 무효화 대상 표 + **낙관적 적용/금지 기준 표**(사람 확정 대상) + 메서드별 retry 정책(GET 2회·4xx 제외 / 변경 retry:false) | Stage 4 |
| `_검증체크리스트.md` | 사람 확인 항목 | Stage 5 |

- 출력 폴더가 없으면 생성. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`).

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- BE 05 `openapi.yaml`(또는 `./openapi.yaml`·`/openapi.json` URL)을 찾는다. **없으면 위치를 묻고 중단.**
- `<루트>/09_상태관리/` 로드 시도(있으면 queryKey·경계 계승 모드, 없으면 ⚠️ + 본 단계 제안). `08-2_상태화면커버리지.md` 로드 시도(상태 화면 컴포넌트명 확보).
- **도구 probe**: Context7(ToolSearch 존재) / openapi-typescript·openapi-fetch·pnpm·node(bash 시도). 없으면 degrade(아래 "도구 정확성").
- BE 명세를 읽고 **도메인 스키마·엔드포인트 목록을 추출**해 계승 대상으로 정리(시터·예약·결제·리뷰 등 도메인별 묶음).

### Stage 1 — 타입·클라이언트 생성 → 10-1
- `package.json`에 `"gen:api": "openapi-typescript <명세경로> -o ./src/shared/api/schema.d.ts"` 등록 스크립트 제시. 가용하면 1회 실행(degrade 시 "로컬 실행 필요" 안내).
- openapi-fetch 타입드 클라이언트 `./src/shared/api/client.ts` 초안:
  - `baseUrl`은 `NEXT_PUBLIC_API_BASE_URL` 환경변수에서 읽기.
  - 요청 인터셉터(미들웨어)에 access token을 `Authorization`에 붙이는 **자리만** 남긴다(토큰 저장 전략은 12 소관 — 주입 지점만, 실제 저장/갱신 구현 금지).
  - 도메인 타입은 `schema.d.ts`의 `components["schemas"]`를 재노출(Member/Pet/SitterProfile/Booking/Payment/Review 등 BE 정본 이름 그대로).
- 생성된 `schema.d.ts` 상단에 **"BE 명세에서 재생성되는 파일 — 직접 수정 금지"** 주석을 명시.

### Stage 2 — queryKey 팩토리 + query/mutation 훅 골격 → 10-2
- TanStack Query **v5 기준**(Context7로 v5 API 확인 — v4 혼용 금지). 도메인별로:
  - queryKey 팩토리: `<도메인>Keys = { all, list(filters), detail(id) }` 계층(09-2 컨벤션 계승). list는 filters 객체를 키에 그대로 넣어 필터 변경 시 자동 리페치.
  - query 훅(예 `useSitterList(filters)`): openapi-fetch 클라이언트로 GET 호출, 응답 타입은 `schema.d.ts`에서 추론, filters를 queryKey·쿼리파라미터에 반영. **staleTime은 데이터 변동성 근거를 주석으로**(검색 결과 ≈1분 등 — 제안값, 사람 확정 대상).
  - mutation 훅(예 `useCreateBooking`): POST 호출, 요청·응답 타입 계승, `onSuccess` 무효화 대상은 Stage 4에서 확정. 반환은 TanStack Query 결과를 그대로 노출(컴포넌트가 status를 직접 다룸).
- 상태머신을 가진 리소스(예시 포밋 Booking: REQUESTED→ACCEPTED→IN_PROGRESS→COMPLETED|CANCELED / 그 외 도메인은 본인 BE enum)는 **BE 정본 enum을 따르며 FE에서 임의 전이 금지** — 낙관적 업데이트도 BE enum 범위 안에서만 임시 반영.

### 🚦 게이트 — API 계약 대조 + 캐시 전략 확정 (사람 개입, 필수)
AskUserQuestion으로 10-1·10-2 초안과 함께 결정 항목을 제시 → 사용자가 OK/수정. **확정 전에는 Stage 3·4로 넘어가지 않는다**("한 방 생성" 방지 — 캐시 전략은 도메인 판단).
- 핵심 결정 항목(사람이 쥐는 판단):
  - **계약 대조** — 생성 타입이 BE 명세와 일치하는가, 재작명/임의 필드 없는가, 잔존 ⚠️/x-proposal 화면은 어디인가.
  - **queryKey 컨벤션** — 09-2 계승 여부(09 부재 시 본 단계 제안 확정).
  - **staleTime / 무효화 범위** — 도메인별(검색·예약·결제) 데이터 변동성에 맞게.
  - **낙관적 업데이트 적용 대상** — 어떤 mutation을 낙관적으로 처리할지(취소=OK / 결제=금지 등).
  - **재시도 정책** — GET 기본 2회·4xx 제외 / 변경 mutation retry:false.

### Stage 3 — 로딩/에러/빈 상태 4분기 → 10-3
- 화면별로 query 상태를 **4분기로 강제** 연결(08-2 상태 화면 컴포넌트에 1:1, 없으면 컴포넌트명 플레이스홀더 + ⚠️):
  - `isPending` → 로딩 스켈레톤 컴포넌트(시안의 스켈레톤).
  - `isError` → 에러 상태 컴포넌트 + `onRetry={refetch}` + 에러를 사용자 메시지로 변환.
  - 성공 & `data.length === 0` → 빈 상태 컴포넌트(예: "조건에 맞는 시터가 없어요").
  - 성공 & 데이터 있음 → 본 콘텐츠.
- `./src/shared/api/errorMessage.ts` 매핑 함수: BE 에러 코드(OpenAPI 에러 스키마 기준)→사용자 문구 표. **미매핑 코드는 폴백 문구("일시적인 오류가 발생했어요") + 콘솔/Sentry 로깅**(17 모니터링에서 새 코드 발견). 폴백을 비워두지 않는다.
- 전역 mutation 에러 토스트를 `QueryClient`의 `MutationCache onError`에 둘지 검토안 제시(컴포넌트 개별 vs 전역).

### Stage 4 — 낙관적 업데이트·롤백·재시도 → 10-4
- mutation별 **무효화 대상 표**: 각 mutation이 바꾸는 데이터를 보는 화면만 무효화(queryKey 계층 `all`/`list`/`detail` 기준 — 너무 좁으면 옛 데이터, 너무 넓으면 리페치 폭증). 무효화 키 선택 근거를 주석으로.
- 낙관적 업데이트 패턴(게이트에서 OK 받은 mutation만, 예 `useCancelBooking`):
  - `onMutate`: `cancelQueries` 후 이전 캐시 스냅샷 저장 + 즉시 낙관적 반영(목록의 해당 항목 status를 CANCELED로).
  - `onError`: 스냅샷으로 롤백 + 사용자 안내("취소에 실패했어요").
  - `onSettled`: `invalidateQueries`로 서버 진실과 재동기화.
- **낙관적 적용/금지 기준 표**(사람 확정 대상): 액션 | 낙관적? | 근거(변동 빈도·실패 시 사용자 피해). 예) 예약 취소=OK / 결제 생성=금지.
- **재시도 정책**: 상태 변경 mutation은 `retry: false`(중복 요청 사고 방지). GET query는 `QueryClient` `defaultOptions`에 retry 함수 — 기본 2회, 단 4xx는 재시도 안 함.
- v5 표기 점검: query에는 `onSuccess`/`onError` 콜백이 **없다**(mutation에만 남음). `isPending`/`isError`, `gcTime`(≠cacheTime) 사용.

### Stage 5 — typecheck + 검증 체크리스트
- 가용하면 `pnpm typecheck`(또는 `pnpm tsc --noEmit`)로 생성 코드의 타입 정합 확인(degrade 시 "로컬 실행 필요" 안내). 타입 에러가 곧 계약 불일치 지점.
- `_검증체크리스트.md` 생성(`<주제>`/`<날짜>` 치환):

```markdown
# 검증 체크리스트 — <주제> API 연동 (작성일: <날짜>)

> AI는 계약→타입 생성·훅 골격·상태 분기까지. 캐시 전략·낙관적 적용 여부는 사람의 판단이다.

- [ ] 게이트에서 계약 대조·캐시 전략을 사람이 확정한 뒤 10-3/10-4로 넘어갔는가 (한 방 생성 금지)
- [ ] 생성 타입이 BE 05 OpenAPI와 1:1 (스키마명·필드 재작명 0건, schema.d.ts "수정 금지" 주석)
- [ ] schema.d.ts를 직접 수정하지 않았는가 (타입 변경은 BE 명세 수정 = BE 협의)
- [ ] TanStack Query v5 표기 (isPending/isError·gcTime·query에 onSuccess 없음 — v4 혼용 없는가)
- [ ] 모든 query 화면에 loading/error/empty/success 4분기 + 디자인 상태 화면 컴포넌트 연결
- [ ] errorMessage 폴백 비어있지 않음 + 미매핑 코드 콘솔/Sentry 로깅 (17 연계)
- [ ] mutation 무효화 범위가 "이 데이터를 보는 화면"으로 적정 (너무 좁/넓지 않은가)
- [ ] 낙관적 적용/금지 기준 표를 사람이 도메인 관점에서 확정 (결제 생성=낙관적 금지)
- [ ] 낙관적 업데이트의 onError 롤백·onSettled 재동기화를 실패 주입으로 테스트 (500/네트워크 끊기)
- [ ] 재시도: 상태 변경 mutation retry:false / GET 4xx 재시도 제외
- [ ] raw fetch 잔존 0건 (데이터 접근이 openapi-fetch 클라이언트로 단일화)
- [ ] Booking 등 상태 전이는 BE 정본 따름 (FE 임의 전이 없음)
- [ ] pnpm typecheck 통과 (또는 로컬 실행 안내)
```

- 마지막으로 산출물 폴더 경로와 "타입의 출처는 BE OpenAPI — BE 명세 변경 시 `pnpm gen:api` 재실행, 낙관적/재시도 정책 표는 사람 확정" 고지를 보고한다.

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe) = TanStack Query v5(`isLoading`→`isPending`, query `onSuccess` 제거, `gcTime`, 낙관적 업데이트 패턴) + openapi-typescript/openapi-fetch 옵션 최신 확인. 없으면 **내장 지식 + "v5 마이그레이션 문서 대조 필요 ⚠️"** 표기(v4 패턴 혼용 위험 경고).
- **openapi-typescript / openapi-fetch**(bash probe) = 타입·클라이언트 생성. 없으면 설치 스크립트는 생성하되 **"로컬에서 `pnpm gen:api` 직접 실행 필요"** 안내(타입 수기 작성 금지 — BE 명세에서 생성이 원칙).
  - ⚠️ **경로 주의**: 한글·공백 포함 경로(볼트 폴더)에서 `pnpm`/`npx`가 깨질 수 있음 — 실제 생성은 ASCII 프로젝트 경로에서 실행하도록 스크립트만 남기고 안내.
- **pnpm / node**(bash probe) = `gen:api`·`typecheck` 실행. 없으면 산출물(스크립트·훅 코드)은 생성하되 "로컬 실행 필요".
- **중단**은 필수 입력(BE OpenAPI) 부재 시에만. 그 외는 degrade.

## 주의
- **TanStack Query v4/v5 혼용 주의(한계).** AI가 학습 데이터의 v4 패턴(`isLoading` 단독, query의 `onSuccess`/`onError`, `cacheTime`)을 섞을 수 있다. v5는 `isPending`/`isError`·`gcTime`·mutation에만 남은 콜백. Context7로 확인하고 의심되면 v5 마이그레이션 문서와 대조.
- **낙관적 업데이트의 롤백을 반드시 테스트한다(한계).** `onError` 롤백·`onSettled` 재동기화가 빠지면 행복한 경로만 멀쩡해 보이고 실패 시 화면이 거짓 상태로 남는다. 네트워크를 끊거나 BE를 500으로 만들어 직접 확인.
- **흔한 실수 — 한 방 프롬프트로 전 엔드포인트 연동**: 캐시 전략·낙관적 처리 판단을 모두 AI에 떠넘기는 것. 도메인별(시터·예약·결제)로 끊어 사람이 검토.
- **흔한 실수 — fetch 직접 호출 잔존**: openapi-fetch 클라이언트를 우회한 raw fetch는 타입 안전성·토큰 주입·에러 매핑을 모두 우회한다. 데이터 접근을 생성된 클라이언트로 단일화.
- (그 외 schema.d.ts 수정 금지·캐시 무효화 범위·에러 폴백·토큰 저장 12 소관은 「핵심 원칙」·각 Stage 참조.)

## 원본 가이드
- 이 스킬은 FE 가이드 **"10. API 연동"**을 자동화한 것입니다.

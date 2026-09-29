---
name: fe-monitoring
description: >-
  16 배포·13 성능을 받아 프론트 관측성(observability)을 깐다. Sentry 에러 트래킹
  +sourcemap → web-vitals RUM(LCP/INP/CLS) → GA4 이벤트 택소노미·타입 래퍼 →
  beforeSend 노이즈/PII 스크럽 → 알림 룰. "프론트 모니터링", "에러 트래킹",
  "Sentry", "sourcemap 업로드", "web-vitals RUM", "Core Web Vitals 수집",
  "GA4 이벤트 택소노미", "이벤트 계측", "PII 스크럽", "알림 룰",
  "frontend monitoring", "error tracking", "RUM", "event taxonomy",
  "alert rules" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# 모니터링·에러 트래킹 (Frontend Monitoring & Error Tracking)

프로덕션에 올라간 포밋 프론트엔드를 **관측 가능하게(observable)** 만든다. 세 관측 축
— Sentry 에러 트래킹(+sourcemap), web-vitals RUM(현장 Core Web Vitals), GA4 제품 분석 —
을 깔고 그 위에 알림 룰을 얹는다. 산출물 = SDK 초기화·계측 모듈·이벤트 택소노미·노이즈/PII
필터·알림 룰 명세. **AI는 SDK 초기화·계측·알림 룰 초안까지, 무엇을 노이즈로 거를지·어떤 이벤트가
제품적으로 의미 있는지·PII를 어디서 마스킹할지는 사람이 판단.** 이 단계는 디버깅의 **입력(재현
정보)을 잘 모으는** 일이지 수정 자체가 아니다(수정은 `systematic-debugging`).

<!-- 변경 포인트 (배포본 → 본인 환경에 맞게 수정):
  1. 출력 경로: 기본 frontend-output/<주제-슬러그>/17_모니터링/. 볼트 설치본은 FE/실행산출물/<주제> 고정 가능.
  2. 계승 출처: 16 배포(.github/workflows·env 규약), 13 성능(CWV 기준선), 기획 17 지표 정의서(이벤트 택소노미) 경로를 본인 폴더 구조로.
  3. 도구(MCP/CLI): Context7(@sentry/nextjs·web-vitals 최신) / sentry-cli·sentry wizard / @next/third-parties — 없으면 degrade.
  4. 스택 버전: React 19 / Next 15 App Router / TS strict. Sentry는 instrumentation.ts 구조, web-vitals v4(INP) 전제. 팀 버전이 다르면 Context7로 재확인.
-->

## 핵심 원칙

- **상위 산출물 계승, 재발명 금지 — 단 확정 상태일 때만.**
  - **16 배포 → CI·env 계승**: sourcemap 스텝은 16의 `.github/workflows/*.yml` 빌드 잡에 **끼워 넣는다**(새 파이프라인 신설 금지). `environment` 태그(development/preview/production)는 16 배포 환경과 **1:1 일치**. 시크릿은 16 규약(GitHub Secrets·Vercel)대로. 16이 없으면 ⚠️ "16 미대조" 표기 + CI 스텝은 초안만.
  - **기획 17 지표 정의서 → GA4 이벤트 택소노미**: 이벤트명·파라미터·퍼널 단계는 기획 17 정의서를 **단일 원본**으로. 정의서가 없으면 BE 도메인(Booking/Payment/Review)에서 직접 도출 + ⚠️ "기획 17 미대조".
  - **BE 도메인 용어 계승**: 이벤트 단계 값은 **그 서비스의 BE 도메인 상태**와 매핑(예 포밋=`Booking` `REQUESTED→ACCEPTED→IN_PROGRESS→COMPLETED|CANCELED` / 다른 서비스는 그 서비스의 핵심 엔티티 상태머신 — 예 구독형이면 `Subscription` `active|paused|cancelling|cancelled`·`Payment` `REQUESTED|PAID|FAILED|CANCELED`). **BE 05 OpenAPI의 실제 enum을 그대로 쓴다**(임의 재작명 금지 — GA4 퍼널↔BE 데이터 대조 시 용어 흔들림 방지). `Booking`은 포밋 예시일 뿐, 도메인이 다르면 그 도메인 상태로.
  - **13 성능 → RUM 검증 대상**: 13 Lighthouse(합성·lab)로 잡은 최적화가 web-vitals RUM(현장·field p75)에서 실제 먹혔는지 검증. 13 기준선이 있으면 RUM 임계값(LCP 2.5s·INP 200ms)과 정렬.
- **sourcemap은 옵션이 아니라 전제다**: 업로드를 CI에 못박지 않으면 압축 스택만 쌓여 가치가 절반 이하. 동시에 `.map`을 공개 경로에 남기면 전체 소스가 유출 → "업로드는 하되 노출은 막는다"를 한 스텝에서 함께.
- **무엇을 안 보낼지가 무엇을 보낼지만큼 중요하다**: `beforeSend` 노이즈 필터·PII 스크럽이 알림 품질(진짜 에러가 안 묻히게)과 컴플라이언스(개인정보가 외부 SaaS로 안 새게)를 동시에 지킨다. 드롭 규칙마다 **근거 주석** + 사용자 식별은 **가명 ID**만.
- **샘플링은 보수적으로 시작**: 에러 이벤트는 전량, 성능 트레이스(`tracesSampleRate`)는 프로덕션 0.1(10%)부터 → 쿼터 폭증 방지. 트래픽 기준 조정은 18단계.
- **이벤트 택소노미를 코드보다 먼저 글로 박는다**: `signup`/`sign_up`/`SignUp` 표기 흔들림은 카탈로그 합의 후 타입 래퍼로 컴파일 타임에 강제.
- **단계별 파일로 끊는다**: SDK 초기화(17-1) → RUM(17-2) → 이벤트(17-3) → 알림(17-4). 한 방 생성 금지(중간 판단 검토 불가).

## 입력

- **필수**: 없음(상위 산출물 부재여도 초안 생성은 가능). 단 아래 권장 입력이 없으면 해당 영역에 ⚠️ 표기 + 직접 도출.
- **권장(있으면 계승, 없으면 degrade)**:
  - `frontend-output/<주제-슬러그>/16_배포/` — CI 워크플로우 파일·env/시크릿 규약·배포 환경(sourcemap 스텝·`environment` 태그 정합). <!-- 변경 포인트(입력 경로): 볼트 설치본은 <루트>=FE/실행산출물/<주제>. 상위 산출물이 다른 폴더면 수정 -->
  - `frontend-output/<주제-슬러그>/13_성능/` — Core Web Vitals 기준선(RUM 임계값 정렬).
  - **기획 17 지표 정의서** — 이벤트 택소노미·북극성 지표·AARRR 퍼널의 원본(이벤트 카탈로그 입력).
  - **BE 도메인 용어**(BE 05 OpenAPI·도메인 모델) — 이벤트 단계 값 매핑.

## 출력 위치: `frontend-output/<주제-슬러그>/17_모니터링/`

<!-- 변경 포인트(출력 경로): 기본은 현재 작업 폴더의 frontend-output/<주제-슬러그>/.
     볼트 설치본은 FE/실행산출물/<주제> 고정 가능. 전 FE 스킬이 같은 <루트>를 공유. -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `17-1_sentry설정.md` | client/server/edge 초기화 분리·`instrumentation.ts`·`withSentryConfig`·`global-error.tsx`/route `error.tsx` ErrorBoundary 헬퍼, `tracesSampleRate=0.1`, `environment` 태그(16 일치), `beforeSend` 노이즈/PII 스크럽(근거 주석), CI sourcemap 스텝(업로드+`.map` 삭제+release=git SHA) | Stage 1·2·5 |
| `17-2_web-vitals·RUM.md` | `onLCP/onINP/onCLS/onTTFB/onFCP` 구독 리포터, Sentry·GA4 양쪽 전송, root layout 클라 마운트, 라우트/디바이스 분해 차원, `sendBeacon`·개발환경 미전송 | Stage 3 |
| `17-3_GA4이벤트.md` | 이벤트 카탈로그 표(event_name snake_case·트리거·파라미터·퍼널 단계), 유니온 타입 `trackEvent()` 래퍼(미정의 이벤트=컴파일 에러), PII 가드, `@next/third-parties` 주입, consent 미동의 보류 분기 | Stage 4 |
| `17-4_알림룰.md` | Sentry Alerts+Slack 룰 표(트리거 조건·채널·우선순위·담당·대응 가이드): 릴리즈 회귀·에러 급증·결제/예약 경로·웹바이탈 악화, thresholding·해소 조건, systematic-debugging 연결 | Stage 6 |
| `_검증체크리스트.md` | 사람 확인 항목 | Stage 7 |

- 출력 폴더가 없으면 생성. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`).

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- 16 배포(CI·env·환경 태그)·13 성능(CWV 기준선)·기획 17 지표 정의서·BE 도메인 용어 로드 시도. 없으면 해당 영역 ⚠️ + 직접 도출 모드(중단하지 않음 — 필수 입력 없음).
- **도구 probe**: Context7(ToolSearch 존재) / sentry-cli·`@sentry/wizard`(bash 시도). 없으면 degrade(아래 "도구 정확성").
- **PII·시크릿 경고**: 산출물에 실제 DSN·`SENTRY_AUTH_TOKEN`·GA4 ID를 박지 않는다(플레이스홀더). `SENTRY_AUTH_TOKEN`은 서버 전용 — `NEXT_PUBLIC_` 접두 절대 금지를 명시.

### Stage 1 — Sentry 초기화·React 에러 경계 → 17-1
- Context7로 `@sentry/nextjs`의 Next 15 App Router 최신 설정(`instrumentation.ts`·`withSentryConfig`·`global-error.tsx`) 확인 후 작성(부재 시 내장 지식 + ⚠️ "버전 확인 필요").
- client/server/edge 초기화 **분리**. `tracesSampleRate` 프로덕션 0.1로 시작.
- `next.config.ts`를 `withSentryConfig`로 감싸기(소스맵 업로드 옵션 포함).
- `app/global-error.tsx`: 렌더 트리 최상위 에러를 `Sentry.captureException` 후 "잠시 후 다시 시도해주세요" 폴백(08 에러 상태 패턴 재사용). route 세그먼트 `error.tsx` 공통 ErrorBoundary 헬퍼.
- `environment` 태그 development/preview/production 분리(**16 배포 환경과 일치**).
- 결과 파일 분리: `instrumentation.ts`·`app/global-error.tsx`·`src/lib/monitoring/sentry.ts`. TS strict.

### Stage 2 — sourcemap 업로드를 CI에 끼우기 → 17-1에 CI 스텝 추가
- **16의 `.github/workflows/*.yml` 빌드 잡에 추가**(신규 파이프라인 금지). 16 부재 시 ⚠️ + 독립 스텝 초안.
- 빌드 후 sentry-cli(또는 `withSentryConfig` 플러그인)로 sourcemap 업로드. **release 이름=git SHA**(Stage 1 release와 일치, 에러를 정확한 배포에 귀속).
- **핵심: 업로드 후 `.map`을 산출물에서 삭제**(공개 노출 시 전체 소스 유출). "왜 `.map`을 반드시 지우는가" 근거 주석.
- `SENTRY_AUTH_TOKEN`은 GitHub Secrets 주입·로그 마스킹. 업로드 실패가 배포를 막지 않게(soft-fail) 하되 실패 경고는 남김.

### Stage 3 — web-vitals RUM 계측 → 17-2
- Context7로 `web-vitals` 최신(v4 — FID 제거·INP 승격) 확인.
- `onLCP/onINP/onCLS/onTTFB/onFCP` 구독 → (a) Sentry 측정값 (b) GA4 커스텀 이벤트 양쪽 전송.
- App Router root layout에서 클라 컴포넌트로 **한 번만** 마운트. 지표에 **라우트 경로 태그**(화면별 분해: `/sitters` 검색 vs `/bookings`)·디바이스/접속 유형(`navigator.connection`) 분해 차원 첨부.
- `sendBeacon`(이탈 시에도 유실 없이), **개발 환경 미전송**.
- 결과: `src/lib/monitoring/web-vitals.ts` + 마운트용 클라 컴포넌트.

### Stage 4 — GA4 이벤트 택소노미·타입 래퍼 → 17-3
- **기획 17 지표 정의서를 입력**으로 이벤트 카탈로그 표 먼저: `event_name(snake_case) | 트리거 시점 | 파라미터 | 퍼널 단계`. **이벤트명·파라미터는 정의서를 글자 그대로 계승**(추가·재작명 0). 정의서의 snake_case 컨벤션(예 `목적어_동사`)을 그대로 따른다. 포밋 예시: `sign_up, pet_register, search_sitter, request_booking, complete_payment, write_review`(BE `Booking/Payment/Review` 계승) — **단 이는 포밋 도메인 예시일 뿐, 실제 카탈로그는 그 서비스의 정의서가 결정**(예 구독형이면 `subscription_start`/`cancel_complete` 등, 단계 값은 그 도메인 BE 상태에 매핑). 정의서가 없을 때만 BE 도메인에서 직접 도출 + ⚠️ "기획 17 미대조".
- 이벤트명·파라미터를 **유니온 타입으로 고정한 `trackEvent()` 래퍼** — 정의 안 된 이벤트는 컴파일 에러.
- **PII 가드**: 결제 금액 같은 값은 보내되 이메일·전화·이름은 절대 파라미터에 넣지 않도록.
- `@next/third-parties`의 `GoogleAnalytics`를 root layout 주입(`NEXT_PUBLIC_GA_ID`). **consent 미동의 사용자 전송 보류 분기** 포함.
- 결과: `docs/analytics/event-taxonomy.md`(카탈로그) + `src/lib/analytics/track.ts`.

### Stage 5 — 노이즈 필터·PII 스크럽(beforeSend) → 17-1의 beforeSend로 통합
- 노이즈 드롭: `chrome-extension://` 스택, `ResizeObserver loop` 경고, `AbortError`(네트워크 취소), 알려진 서드파티(카카오 SDK 등) 무해 에러.
- PII 스크럽: 요청 URL 쿼리·breadcrumb·extra에서 이메일/전화/토큰 패턴 마스킹.
- `denyUrls`로 우리 도메인 외 스크립트 에러 제외. 사용자 식별은 내부 `memberId`(가명)만 — 이메일·이름 전송 금지.
- **드롭 규칙마다 근거 주석**("나중에 진짜 에러를 못 받는 사고 방지"). 결과는 `src/lib/monitoring/sentry.ts`의 `beforeSend`로 통합.

### 🚦 게이트 — 알림 임계값·노이즈/PII 정책 합의 (사람 개입, 필수)
AskUserQuestion(AI 추천 1안)으로 제시 → 사용자 OK/수정. **17-2~17-3·beforeSend 초안이 게이트 시점에 존재**(검수 대상이 있어야 함).
- 핵심 결정 항목(사람이 쥐는 판단):
  - **알림 임계값** — 에러 급증 시간당 N건, 웹바이탈 악화 기준(LCP p75 2.5s·INP p75 200ms는 디폴트 제안), 채널(#pomit-fe-alert).
  - **노이즈 드롭 목록** — `ignoreErrors`/`denyUrls`에 무엇을 넣을지("이 규칙이 진짜 에러를 삼키지 않는가" 확인).
  - **PII 마스킹 범위** — 어떤 필드를 마스킹·어떤 가명 ID를 식별자로.
  - **consent 정책** — 동의 전 전송 보류 적용 지역/대상(원본은 기획 정책 정의서).
- 합의 전에는 Stage 6(알림 룰 확정)으로 넘어가지 않는다.

### Stage 6 — 알림 룰 정의·systematic-debugging 연결 → 17-4
- Sentry Alerts+Slack 기준 명세 표:
  - **릴리즈 회귀**: 새 release(git SHA)에서 신규 이슈 → 즉시 Slack `#pomit-fe-alert`.
  - **에러 급증**: 특정 이슈 1시간 기준 임계 `{{N}}`건 초과(임계는 게이트 합의값).
  - **결제·예약 경로 에러**: `complete_payment`/`request_booking` 관련 이슈는 별도 높은 우선순위.
  - **웹바이탈 악화**: LCP p75 > 2.5s 또는 INP p75 > 200ms 지속 시 경고(18단계 연계).
  - 컬럼: `트리거 조건 | 채널 | 우선순위 | 담당 | 대응 가이드`. 노이즈 방지 thresholding·해소 조건 명시.
- 결과: `docs/monitoring/alert-rules.md`.
- **systematic-debugging 연결**: 새 이슈가 떴을 때 원본 스택(소스맵 해독)·breadcrumb·release·재현 환경을 컨텍스트로 모아 `/systematic-debugging`에 넘기는 운영 흐름을 문서화(이 단계는 디버깅 입력 수집까지).

### Stage 7 — 마무리·검증 체크리스트
- `_검증체크리스트.md` 생성(`<주제>`/`<날짜>` 치환):

```markdown
# 검증 체크리스트 — <주제> 모니터링·에러 트래킹 (작성일: <날짜>)

> AI는 SDK 초기화·계측·알림 룰 초안까지. 무엇을 노이즈로 거를지·어떤 이벤트가 의미 있는지·PII 마스킹은 사람의 판단이다.

- [ ] Sentry: client/server/edge 초기화 분리 + global-error.tsx/route error.tsx에서 captureException
- [ ] sourcemap: CI에서 업로드 + 업로드 후 .map 삭제(공개 경로에 .map 없음 — 배포물에서 직접 확인)
- [ ] release 이름=git SHA로 에러가 정확한 배포에 귀속 (한 이슈가 원본 파일·라인으로 풀리는지)
- [ ] environment 태그(development/preview/production)가 16 배포 환경과 일치
- [ ] tracesSampleRate 프로덕션 0.1로 시작 (1.0 켜두지 않았는가)
- [ ] beforeSend: 노이즈 드롭 규칙마다 근거 주석 + "진짜 에러를 삼키지 않는가" 사람 확인
- [ ] PII 스크럽: breadcrumb/request/GA4 파라미터에서 이메일·전화·이름·토큰 마스킹, 식별은 가명 ID만
- [ ] web-vitals RUM: Sentry·GA4 양쪽 전송, 라우트별 분해, sendBeacon, 개발환경 미전송
- [ ] GA4 이벤트: 카탈로그(기획 17 정의서 단일 원본)와 trackEvent() 유니온 타입 일치, 단계 값이 BE Booking 상태와 매핑
- [ ] GA4 consent 미동의 시 전송 보류 분기 존재
- [ ] 알림 룰: 임계값 게이트 합의값 반영 + thresholding/해소 조건 + 담당·대응 가이드
- [ ] 이슈 트리아지·systematic-debugging 닫는 루프가 운영 약속으로 정해졌는가
- [ ] 산출물에 실제 DSN·AUTH_TOKEN·GA ID 미포함(플레이스홀더), AUTH_TOKEN에 NEXT_PUBLIC_ 접두 없음
```

- 마지막으로 산출물 폴더 경로와 "모니터링은 관측이지 수정이 아니다 — 트리아지·디버깅 닫는 루프까지 운영 약속으로" 고지를 보고한다.

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe) = `@sentry/nextjs`(instrumentation.ts 구조 이동)·`web-vitals`(v3→v4 FID 제거·INP 승격) 최신 설정 조회. 버전마다 권장 설정이 크게 바뀌어 학습 기억으로 쓰면 deprecated API 위험. 없으면 **내장 지식 + "버전 확인 필요 ⚠️"**.
- **sentry-cli / `@sentry/wizard`**(bash probe) = sourcemap 업로드·릴리즈 생성·대화형 설정. 없으면 설정·스크립트는 **생성하되 "로컬에서 `pnpm dlx @sentry/wizard@latest -i nextjs` 직접 실행 필요"** 안내.
- **@next/third-parties**(GA4 스크립트 주입) 부재 시 설치 안내 + 수기 Script 주입 대안 ⚠️.
- **중단은 없음** — 이 단계는 필수 입력이 없다(상위 부재여도 초안 생성, ⚠️로 미대조 표기). 그 외 전부 degrade.

## 주의
- **한계 — 관측이지 수정이 아니다**: 이 단계는 원본 스택·breadcrumb·release·디바이스를 잘 *모으는* 데까지. 실제 버그 수정은 `systematic-debugging`의 몫이고, 이슈 트리아지(누가·언제)와 닫는 루프까지 운영 약속으로 정해야 살아 있는 관측성이 된다.
- **한계 — PII·consent는 법적 직결**: breadcrumb·GA4 파라미터에 이메일·전화·토큰이 쉽게 섞이고, 동의 전 추적은 지역/정책에 따라 법적 리스크다. beforeSend 스크럽·PII 가드·consent 보류 분기는 옵션이 아니다(원본은 기획 정책 정의서).
- **흔한 실수 — 노이즈 필터를 너무 세게**: 공격적 `ignoreErrors`/`denyUrls`는 진짜 회귀까지 삼킨다. 한 번 시끄럽다고 통째로 막아 두 달 뒤 같은 버그를 아무도 못 받는 사고가 잦다 — 드롭 규칙마다 근거를 남기고 주기적으로 의심.
- **흔한 실수 — 환경 태그 누락·`.map` 노출**: development/preview/production을 안 나누면 로컬·프리뷰 에러가 프로덕션 알림에 섞인다(16 배포 환경과 `environment` 일치). 업로드와 별개로 `.map`이 정적 호스팅에 노출되면 전체 소스 유출 — Stage 2 삭제 스텝이 빠졌는지 배포물에서 직접 확인.

## 원본 가이드
- 이 스킬은 FE 가이드 **"17. 모니터링·에러 트래킹"**을 자동화한 것입니다.

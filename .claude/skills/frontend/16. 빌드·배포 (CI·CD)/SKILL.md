---
name: fe-build-deploy
description: >-
  06 형상관리 규약·15 테스트 위에 프론트 CI·CD 파이프라인을 설계도→실행으로 세운다.
  GitHub Actions(lint·typecheck·test·build) workflow → 환경변수/시크릿 매핑표 →
  Vercel 프리뷰/프로덕션 배포·캐시 정책 → 머지 게이트(required status checks).
  "프론트 배포", "CI/CD", "GitHub Actions", "Vercel", "프리뷰 배포", "workflow",
  "환경변수 매핑", "시크릿 등록", "캐시 정책", "머지 게이트", "frontend deploy",
  "preview deploy", "CI pipeline", "branch protection" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# 빌드·배포 (CI·CD) (Build & Deploy)

"내 노트북에서 돌아간다"를 "PR을 올리면 자동 검증되고, 머지하면 사용자에게 나간다"로 바꾼다.
산출물 = **CI workflow(GitHub Actions)** + **환경변수/시크릿 매핑표** + **Vercel 배포·캐시 설정** +
**머지 게이트(required status checks)**. **AI는 현행 문법 확정·매핑표 회수율·설계도/초안, 게이트 정책과
시크릿 실제 값 입력은 사람.** 시크릿을 AI 컨텍스트에 넣지 않는 것은 타협 불가 규칙이다.

<!-- ───────────────────────────────────────────────────────────────
변경 포인트 (배포본 → 본인 환경에 맞게 수정)
  1. 출력 경로: 기본 frontend-output/<주제-슬러그>/16_배포/. 볼트 설치본은 FE/실행산출물/<주제> 고정 가능.
  2. 계승 출처: 06_개발환경(env 규약·브랜치 보호)·15_테스트(테스트 명령) 경로를 본인 폴더 구조로 수정.
  3. 도구(MCP/CLI): Context7(Actions·pnpm·Next 15·Vercel 현행 문법) / gh·pnpm·vercel CLI — 없으면 degrade.
  4. 스택 버전: React 19 / Next 15(App Router·Turbopack) / TS strict / pnpm / Vercel. 다른 호스트(CDN+Node)면
     vercel.json·배포 job을 해당 플랫폼 설정으로 교체.
  5. 배포 호스트: 기본 Vercel. AWS Amplify/Cloudflare/직접 CDN이면 Stage 3 배포·캐시 산출물을 해당 호스트로 교체.
──────────────────────────────────────────────────────────────── -->

## 핵심 원칙

- **상위 산출물 계승, 재발명 금지 — 단 확정 상태일 때만.**
  - **06 형상관리 규약 계승**: 브랜치 전략(main 직접 push 금지·PR 필수)·Conventional Commits·pnpm·
    env 분리(12-Factor)·`.env.example`·Zod env 스키마는 06에서 확정된 것을 따른다. CI 트리거·캐시 키·
    env 매핑이 06 규약과 어긋나면 재발명 금지 — 06을 따르고 불일치는 ⚠️로 게이트 회부.
  - **15 테스트 계승**: CI가 머지 게이트로 강제하는 대상은 15에서 만든 lint·typecheck·Vitest+RTL·
    Playwright E2E다. 테스트 **명령(`pnpm test`·`pnpm test:e2e` 등)은 15 산출물 1:1 계승**(임의 재작명 금지).
    15가 없으면 ⚠️(테스트 job은 placeholder + "15 확정 후 채움").
  - 06/15에 잔존한 `⚠️`/`[확인 필요]`는 파이프라인에 보존(임의 확정 금지).
- **파이프라인은 한 방 YAML이 아니라 설계도→실행이다.** job 의존(빌드는 lint·test 통과 후)·게이트·
  환경 분기가 얽힌 큰 YAML을 한 번에 생성하면 빨간불이 떴을 때 원인을 좁힐 수 없다. `writing-plans`로
  설계도(16-0)를 먼저 합의하고 `executing-plans`로 job 하나씩 초록불을 확인하며 쌓는다.
- **버전 민감 설정은 Context7로 현행 문법을 먼저 확정한다.** Actions 버전(`checkout`·`setup-node`·
  `cache`·`pnpm/action-setup`)·pnpm 캐시 키·Next 15 빌드 캐시 경로(`.next/cache`)·Turbopack 플래그·
  Vercel CLI는 자주 바뀌고 AI 학습 시점 문법은 deprecated된 경우가 많다. **workflow 작성 전 반드시 Context7로
  현행 메이저 버전을 박는다**(부재 시 내장 지식 + "버전 확인 필요 ⚠️").
- **시크릿 실제 값은 AI에게 절대 주지 않는다.** AI는 `${{ secrets.* }}` 참조·`gh secret set`·
  `vercel env add` **명령까지만** 만들고, 값 입력은 사람이 CLI 프롬프트로 한다. 매핑표 값은 `{{등록 필요}}`로
  비운다. 결제 키·`VERCEL_TOKEN`·OAuth 시크릿을 프롬프트나 파일에 넣지 않는다.
- **프리뷰 환경에 프로덕션 키를 주입하지 않는다.** 프리뷰는 URL로 외부 접근 가능한 격리 환경 — 결제는
  샌드박스 키, 외부 API는 스테이징 엔드포인트. 프로덕션 DB·결제에 닿는 키는 production 환경에만 둔다.
- **캐시는 자산 유형별로 가른다.** 해시 파일명이 붙는 `/_next/static`은 immutable·1년으로 공격적,
  갱신돼야 하는 HTML/RSC는 재검증으로. 03 렌더링 전략(03-1 렌더링전략맵·ISR 페이지)이 여기서 캐시 정책으로 회수된다.
- **CI 작성과 머지 차단은 별개의 설정 — 둘 다 해야 게이트가 작동한다.** workflow가 돌아도 브랜치 보호에 required status check를 안 걸면 빨간불이 떠도 머지된다.

## 입력

- **필수**: `<루트>/15_테스트/`(15-1 테스트계획·테스트 명령 — CI가 강제하는 대상) — 없으면 **degrade**
  (테스트 job placeholder + ⚠️, 중단 아님).
- **권장**:
  - `<루트>/06_개발환경/`(06-3 env분리·`.env.example`·Zod env 스키마, 06-4 브랜치·커밋 규약) — CI 트리거·
    env 매핑·브랜치 보호의 근거. 부재 시 ⚠️ + 06 먼저 권장.
  - `<루트>/03_아키텍처/`(03-1 렌더링전략맵·ISR 페이지) — HTML/RSC 캐시 재검증 정책의 대상.
    (05-1 route맵이 있으면 어떤 경로가 ISR인지 함께 참고.)
  - 코드베이스(`process.env`·`NEXT_PUBLIC_` 사용처) — env 매핑표 스캔 원천. 없으면 매핑표는 06 규약 기반 초안.
  <!-- 변경 포인트(입력 경로): 본인 설치본은 <루트>=FE/실행산출물/<주제>. 상위 산출물이 다른 폴더면 수정 -->
- **필수 입력 부재로 중단하지 않는다** — 모두 degrade 가능. 단 15·06 부재 시 ⚠️로 미확정 보존.

## 출력 위치: `frontend-output/<주제-슬러그>/16_배포/`

<!-- 변경 포인트(출력 경로): 기본은 현재 작업 폴더의 frontend-output/<주제-슬러그>/16_배포/.
     볼트 설치본은 FE/실행산출물/<주제>로 고정 가능. -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `16-0_CICD설계도.md` | job 그래프(lint→typecheck→test→build)·E2E 분리 트레이드오프·머지 게이트·캐시 전략·env 분리 지점·각 단계 검증 방법. 코드 전 설계도(SSOT) | Stage 1 |
| `16-1_github-actions.yml` | `.github/workflows/ci.yml`(+필요 시 `e2e.yml`). install→lint→typecheck→test→build, pnpm store·`.next/cache` 캐싱, Node 버전 `.nvmrc`/engines 일치, 시크릿은 `${{ secrets.* }}` 참조만. **Context7 현행 액션 버전** | Stage 2 |
| `16-2_vercel설정.md` | `vercel.json`(headers/rewrites)·프리뷰/프로덕션 빌드 설정·자산 유형별 캐시·CDN 정책표·프리뷰 URL PR 코멘트 흐름 | Stage 3 |
| `16-3_env시크릿매핑.md` | 키 \| 공개여부(`NEXT_PUBLIC_`) \| local \| preview \| production \| 비고. 값은 `{{등록 필요}}`. `gh secret set`/`vercel env add` 명령 목록(값 입력은 사람) | Stage 4 |
| `_검증체크리스트.md` | 사람 확인 항목(게이트·시크릿·캐시·머지 차단) | Stage 6 |

- 출력 폴더가 없으면 생성. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`). 모든 FE 스킬은 같은
  `<루트>=frontend-output/<주제-슬러그>`를 공유(06·15는 형제 폴더에서 읽음).
- ⚠️ `16-1_github-actions.yml`은 **본 폴더에 산출물로 둔다**. 실제 적용은 사람이 `.github/workflows/`로
  옮긴다(Stage 5에서 안내) — 스킬이 임의로 레포 루트에 쓰지 않는다.

## 파이프라인

### Stage 0 — 입력 확인·계승 감지·도구 probe·degrade
- 15(테스트 명령)·06(env 규약·브랜치 보호)·03(렌더링 전략) 로드 시도. **15 부재→테스트 job placeholder+⚠️,
  06 부재→env 매핑·브랜치 보호 ⚠️ + 06 먼저 권장, 03 부재→캐시 재검증 대상 일반 디폴트+⚠️**(모두 중단 아님).
- 코드베이스 `process.env`·`NEXT_PUBLIC_` 스캔 가능 여부 확인(없으면 매핑표는 06 규약 기반 초안).
- **도구 probe**: Context7(ToolSearch 존재) / gh·pnpm·vercel·node(bash 시도). 가용은 호출 성공으로만 판별.

### Stage 1 — 파이프라인 설계도 → 16-0 (writing-plans)
- YAML을 쓰지 않고 **무엇을 자동화할지 설계도부터**(`writing-plans` 활용). 담을 것:
  - **CI job 그래프**: install → lint → typecheck → test(단위/컴포넌트) → build 순서/병렬.
  - **E2E(Playwright) 트레이드오프**: 무겁다 — PR 전체에서 돌릴지, 라벨(`run-e2e`)·`main` 한정으로 분리할지.
    **정답이 하나가 아니다 — 게이트에서 정책 결정**.
  - **머지 게이트**: 어떤 status check를 "required"로 강제할지(테스트 실패 머지 차단? 커버리지 하한?).
  - **캐시 전략**: pnpm store·`.next/cache`·Playwright 브라우저 캐시(키는 lockfile 해시 기반).
  - **환경**: preview / production env 분리 지점.
  - **각 단계 검증 방법**(예: PR 올려 초록불 확인, 일부러 lint 에러로 머지 차단 검증).
- 코드는 아직 안 쓴다. `16-0_CICD설계도.md`만.

### 🚦 게이트 — 배포·시크릿·게이트 정책 사람 검토 (🔴 필수, 사람 개입)
**이 단계는 🔴 — 배포·시크릿이 걸린 결정이므로 사람 확정 게이트를 반드시 통과한다.**
AskUserQuestion으로 설계도(16-0)를 제시 → 사용자가 OK/수정. 사람이 쥐는 결정:
- **머지 게이트 정책** — lint·typecheck·test·build 중 무엇을 required로 강제? 테스트 실패 머지 차단? 커버리지 하한?
- **E2E 실행 정책** — PR 전체 vs 라벨/`main` 한정(CI 속도 ↔ 회귀 안전 트레이드오프).
- **환경 분리·시크릿 배치** — 프리뷰에 어떤 키(샌드박스/스테이징)? 프로덕션 전용 키는?
- **배포 호스트 확정** — Vercel(디폴트) vs 다른 플랫폼.
- **설계도(16-0)를 사람이 확정하기 전에는 Stage 2(YAML 생성)로 넘어가지 않는다**(한 방 생성 방지).

### Stage 2 — CI workflow → 16-1 (Context7로 현행 문법 확정 후)
- **먼저 Context7**로 `actions/checkout`·`actions/setup-node`·`pnpm/action-setup`·`actions/cache`의 현행
  메이저 버전, Next 15 빌드 캐시 경로·Turbopack 빌드 플래그, Node LTS를 확인(부재 시 내장 지식 + "버전 확인 필요 ⚠️").
- `ci.yml` 생성:
  - 트리거: `pull_request`(main 대상) + `push`(main).
  - job: install → lint → typecheck → test(단위/컴포넌트) → build (16-0 의존관계대로).
  - pnpm store·`.next/cache`를 `actions/cache`로 캐싱(키는 lockfile 해시 기반).
  - Node 버전은 `.nvmrc`/`package.json` engines와 일치(06 계승).
  - 테스트 명령은 **15 산출물 1:1 계승**(15 부재 시 placeholder+⚠️).
  - **커버리지를 머지 게이트로 강제하려면 coverage 실행 명령이 선행 조건이다.** 15/06 scripts에
    coverage 명령(예: `test:coverage = vitest run --coverage`)이 있는지 확인 — **없으면 임의 재작명
    금지, 06 scripts에 추가가 필요함을 ⚠️로 표기**하고 그 전까지 test job은 `pnpm test`(통과만)로 둔다.
    (15가 커버리지 하한만 정의하고 실행 명령은 미정의인 경우가 흔하다.)
- **E2E는 별도 `e2e.yml`**: 게이트에서 정한 정책대로(PR 라벨 `run-e2e` 또는 `main` push 한정),
  Playwright 브라우저 캐시 포함.
- 빌드용 `NEXT_PUBLIC_*`는 더미/프리뷰 값, 시크릿은 `${{ secrets.* }}` 참조만 — **실제 값 절대 YAML에 넣지 않는다.**
- 액션 버전은 메이저로 핀(`@v4`)하고 deprecated 알림 시 Context7로 갱신.

### Stage 3 — Vercel 배포·캐시 설정 → 16-2 (Context7로 현행 문법 확정 후)
- Context7로 Next 15 + Vercel 현행 배포 설정 확인 후 `vercel.json`·배포 설정 작성:
  - 빌드: Next 15 build(필요 시 Turbopack 플래그 현행 기준).
  - 프리뷰: PR마다 자동 배포·preview env. 프로덕션: main 머지 시 배포·production env.
  - **자산 유형별 캐시·CDN 헤더표**:
    - `/_next/static/*` : immutable, `max-age=31536000`(해시 파일명이라 안전).
    - 이미지(`next/image`): Vercel 기본 + 캐시 TTL.
    - HTML/RSC: 재검증 정책(ISR 페이지는 **03 렌더링전략맵 계승**, 부재 시 일반 디폴트+⚠️).
  - `vercel.json`의 headers/rewrites는 코드로 남겨 대시보드와 동기화.
- 프리뷰 URL을 PR에 코멘트로 남기는 Vercel GitHub 연동 흐름 설명.
- 다른 호스트면(변경 포인트 5) 이 산출물을 해당 플랫폼 설정으로 교체.

### Stage 4 — 환경변수/시크릿 매핑표 + 등록 명령 → 16-3
- 코드 전체 `process.env`·`NEXT_PUBLIC_` 사용처 스캔(06 `.env.example`·Zod env 스키마 기준). 표:
  `키 | 공개여부(NEXT_PUBLIC_) | local | preview | production | 비고`.
  - 포밋 도메인 키: `API_BASE_URL`(BE 05 API 게이트웨이)·KAKAO OAuth 키(BE 07 연계)·결제 키·
    Sentry DSN(17 단계에서 채움) 등.
  - **결제·시크릿 키는 preview에 프로덕션 값 절대 금지** — 테스트/샌드박스 값으로 표기.
  - **값은 전부 `{{등록 필요}}`로 비운다**(AI가 채우지 않는다).
- 공개 키(`NEXT_PUBLIC_*`)와 시크릿(서버 전용) 구분:
  - 공개/프리뷰 값: `vercel env add` 명령 목록.
  - 시크릿: `gh secret set`/`vercel env add (Production)` 명령 목록.
  - **명령만 출력 — 값은 사람이 CLI 프롬프트로 직접 입력.**

### Stage 5 — 단계별 실행·검증 안내 + 머지 게이트 (executing-plans)
- `executing-plans` 관점으로 16-0 설계도를 하나씩 적용·검증하는 안내(스킬은 명령·절차를 제시, 실행·확인은 사람):
  - `16-1_github-actions.yml`을 `.github/workflows/`로 옮기고 푸시 → 테스트 PR로 lint/typecheck/test/build 초록불 확인.
    (`ci.yml`+`e2e.yml`을 한 산출물 파일에 담았다면 **2개 파일로 분리**해 옮긴다 — 하나의 .yml에 `name:`이 둘일 수 없다.)
  - 일부러 lint 에러를 낸 PR로 "빨간불이 머지를 막는지" 검증.
  - **머지 게이트**: `gh`로 main 브랜치 보호에 required status checks(ci 필수) 추가(`gh api` branch protection 또는 명령 안내).
    **CI 작성과 머지 차단은 별개 — 둘 다 해야 게이트 작동.**
  - 프리뷰 배포 URL이 실제로 뜨는지, preview env가 주입됐는지 확인.
- 빌드가 빨간불이면 로그를 그대로 붙여 `systematic-debugging` 관점으로 원인 분류(캐시 무효/env 누락/타입/테스트).
  여기 목표는 "파이프라인 자체가 초록불이 되게 하는" 것까지(운영 모니터링은 17).
- 각 단계는 "검증 통과"를 확인하고 다음으로. 실패하면 멈추고 로그를 본다.

### Stage 6 — 마무리
- `_검증체크리스트.md`(아래) 생성. 산출물 폴더 경로 + "시크릿 실제 값은 사람이 CLI로,
  머지 게이트는 CI 작성과 별개 설정" 고지를 보고.
- 잔존 ⚠️/🔴(15·06 미확정, 시크릿 미등록, 머지 게이트 미설정)이 있으면 보존하고 완료 보고 금지.

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe) = Actions 액션 버전·pnpm 캐시·Next 15 빌드 캐시 경로/Turbopack·Vercel CLI 현행 문법
  확정(workflow·vercel.json 작성 전 필수 2-step: resolve-library-id → query-docs). 없으면 **내장 지식 +
  "버전 확인 필요 ⚠️"**(액션은 메이저 핀 권장, deprecated 가능성 경고).
- **gh CLI**(bash probe) = 시크릿 등록·브랜치 보호 required status checks. 없으면 명령은 생성하되 "로컬에서 직접 실행 필요" 안내.
- **vercel CLI**(bash probe) = `vercel link`·`vercel env add/pull`·배포. 없으면 vercel.json·env 명령은 생성하되 "로컬 실행 필요" 안내.
- **pnpm / node**(bash probe) = 캐시 키·버전 일치 확인용. 없으면 설정은 생성하되 로컬 검증 안내.
- **중단하지 않는다** — 필수 입력도 degrade(15·06 ⚠️). CLI/MCP 부재는 설정·스크립트는 생성하되 "로컬 실행 필요" degrade.

## _검증체크리스트 본문 (Stage 6 생성)
```markdown
# 검증 체크리스트 — <주제> 빌드·배포 (CI·CD) (작성일: <날짜>)

> AI는 현행 문법·매핑·초안까지. 게이트 정책과 시크릿 실제 값은 사람의 일이다.

- [ ] 설계도(16-0)를 사람이 확정한 뒤 YAML로 넘어갔는가 (한 방 거대 workflow 생성 금지)
- [ ] CI workflow 액션 버전을 Context7 현행으로 확정 (deprecated 버전 0건) / 메이저 핀
- [ ] 테스트 job 명령이 15 산출물과 1:1 일치 (재작명 0건, 15 부재 시 placeholder+⚠️ 표기)
- [ ] 🔴 시크릿 실제 값이 YAML·매핑표·프롬프트 어디에도 없는가 (값은 전부 {{등록 필요}})
- [ ] 🔴 프리뷰 env에 프로덕션 키(결제·DB) 없는가 — 샌드박스/스테이징 값으로 표기
- [ ] 캐시: /_next/static immutable·1년 (해시 자산 한정), HTML/RSC 재검증 (03 렌더링전략맵 ISR 계승) — 배포 후 새 자산 실제 내려오는지 1회 확인
- [ ] 머지 게이트: 브랜치 보호 required status checks 설정됨 (CI 작성과 별개 — 빨간불이 머지를 막는지 검증)
- [ ] E2E 실행 정책 확정 (PR 전체 vs 라벨/main 한정 — 트레이드오프 합의)
- [ ] 프리뷰 URL이 PR에 뜨고 preview env 주입 확인 (디자인 14 검수 대상)
- [ ] 16-1_github-actions.yml을 .github/workflows/로 옮겨 적용했는가
```

## degrade vs 중단 vs 게이트 블로킹
- **중단**: 없음 — 모든 입력 degrade(15·06 부재도 ⚠️ 보존하고 진행). degrade 규칙은 위 `도구 정확성`·Stage 0 참조.
- **게이트 블로킹**: 🔴 게이트(설계도 확정·머지 정책·환경/시크릿 배치·배포 호스트) 미통과 시 Stage 2 진입 차단.
  시크릿 실제 값 미등록·머지 게이트 미설정은 ⚠️로 보존(완료 보고 금지).

## 주의
- **시크릿 실제 값은 AI에게 절대 주지 않는다**(핵심 원칙 참조) — 실수로 커밋된 시크릿은 즉시 폐기·재발급
  (히스토리에서 지워도 노출된 것으로 간주).
- **캐시 무효화를 검증 없이 믿지 않는다** — immutable 1년은 해시 자산에만. 배포 후 새 자산이 내려오는지 1회 직접 확인.
- **흔한 실수 — 한 방에 거대한 workflow 생성**: 빨간불 원인을 좁힐 수 없다. 설계도(Stage 1)→단계별 실행(Stage 5)으로 끊는다.
- **흔한 실수 — 게이트 없는 CI**: 브랜치 보호에 required status check를 안 걸면 빨간불이 떠도 머지된다.
  CI 작성과 머지 차단은 별개 설정 — 둘 다 해야 게이트가 작동한다.
- 운영 에러·성능 관측(Sentry·RUM·sourcemap)은 17 단계 — 여기는 "파이프라인이 초록불이 되게 하는" 것까지.

## 원본 가이드
- 이 스킬은 FE 가이드 **"16. 빌드·배포 (CI·CD)"**를 자동화한 것입니다.

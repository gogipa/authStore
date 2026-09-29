---
name: fe-dev-environment
description: >-
  02 ADR·03 폴더구조·05 라우트맵을 받아 프론트 개발 환경을 스캐폴딩하고 코드품질·환경변수·형상관리
  규약을 코드로 강제한다. create-next-app 스캐폴딩 → ESLint 9 flat config·Prettier·TS strict →
  env 12-Factor 분리(.env.example+Zod) → 브랜치·커밋 규약+commitlint → husky pre-commit.
  "프론트 개발환경", "개발 환경 구축", "스캐폴딩", "ESLint Prettier 설정", "TS strict",
  "env 분리", "12-Factor", "Conventional Commits", "commitlint", "husky pre-commit",
  "브랜치 커밋 규약", "frontend dev environment", "scaffolding", "create-next-app",
  "eslint flat config", "pre-commit hook" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# 개발 환경 구축 (형상관리) (Frontend Dev Environment)

02 ADR로 확정한 스택(React 19 / Next 15 App Router / pnpm / TanStack Query v5 / Zustand / Tailwind / RHF+Zod)과
03 폴더 구조·05 라우트 맵을 입력으로, **첫 커밋 이전에 팀 합의를 코드로 강제할 빈 프로젝트 골격**을 세운다.
산출물 = 스캐폴딩 절차 + lint/format/tsconfig 설정 + env 분리 규칙 + 형상관리 규약(브랜치·커밋·pre-commit).
**AI는 보일러플레이트 생성·strict 에러 분류, 규약의 강도(strict 범위·lint error/warn·브랜치 보호) 결정과 시크릿 값 주입은 사람.**

<!-- 변경 포인트 (배포본 → 본인 환경에 맞게 수정)
  1. 출력 경로: 기본 frontend-output/<주제-슬러그>/06_개발환경/. 볼트 설치본은 FE/실행산출물/<주제> 고정 가능.
  2. 계승 출처: 02 ADR(02_기술스택/)·03 폴더구조(03_아키텍처/)·05 라우트맵(05_라우팅/) 경로를 본인 폴더 구조로.
  3. 도구(MCP/CLI): Context7 / pnpm·gh(bash) — 없으면 degrade(설정 생성+로컬 실행 안내).
  4. 스택 버전: React 19 / Next 15 / TS strict / pnpm — 02 ADR과 어긋나면 ADR을 정본으로. -->

## 핵심 원칙

- **상위 산출물 계승, 재발명 금지 — 단 확정 상태일 때만.**
  - **02 ADR이 스택·버전 정본**: React 19 / Next 15(App Router) / pnpm / Tailwind를 그대로 쓴다. 스캐폴딩 옵션·`package.json` 메이저 버전이 ADR과 어긋나면 ADR을 따르고, ADR에 `⚠️`/`[확인 필요]`가 남아 있으면 그 플래그를 게이트로 회부(임의 버전 확정 금지).
  - **03 폴더 구조 그대로 정렬**: feature-based 디렉터리(`src/features/{...}`, `src/shared`, `src/app`)는 03 산출물을 1:1 따른다. 도메인/디렉터리 이름은 **그 서비스의 BE 정본 용어를 03에 적힌 그대로** 쓰고 재작명 금지. ⚠️ 도메인 예시(시터매칭의 SitterProfile·Booking 등)는 예시일 뿐 — **03/05가 해당 주제에 없다고 한 feature는 만들지 않는다.**
  - **05 route groups 골격만**: app 디렉터리의 route groups(`(auth)`, `(main)` 등)는 05 라우트 맵을 따라 **빈 골격만** 만든다(화면 구현은 07·08).
- **규약을 "문서"가 아니라 "차단 장치"로**: 위키 문서로만 합의하면 지키는 사람만 지킨다. ESLint·commitlint·pre-commit 훅·브랜치 보호로 코드에 박아둔다. 첫 커밋 전에 까는 이유 — 나중은 이미 어긋난 코드를 되돌리는 일.
- **버전 민감 설정은 반드시 Context7를 거친다**: 이 단계 산출물은 코드가 아니라 설정이고, 설정은 라이브러리 메이저 버전과 강하게 묶인다. AI 기억으로 만든 `.eslintrc`(폐기)·구버전 Next 옵션은 그럴듯해도 빌드에서 깨진다. "기억이 아니라 현행 문서로 생성"이 안전핀.
- **순서 의존 — 한 방 셋업 금지**: strict는 lint 위에서, pre-commit은 lint/commitlint가 있어야 의미가 있다. "스캐폴딩 → lint/format → strict → env → 커밋 규약 → pre-commit" 순으로 **각 단계 완료 검증을 통과한 뒤** 다음으로. 한 프롬프트로 시키면 중간 오류가 묻힌다.
- **시크릿은 AI·저장소에 절대 넣지 않는다**: env 키 "이름"·분리 규칙(`NEXT_PUBLIC_` 여부)·Zod 검증 스키마는 AI가 만들되, 실제 값은 전부 `{{PLACEHOLDER}}`. 비밀키에 `NEXT_PUBLIC_` 미부착, `.env.local`의 `.gitignore` 포함을 사람이 확인.
- **strict 에러를 any로 끄지 않는다**: "에러 없애줘"라고만 하면 `any`·`@ts-ignore`로 덮어 strict를 켠 의미를 없앤다. 유형별 분류 후 판단 필요 항목은 **"확인 필요"**로 남긴다.
- **디자인 토큰 중복 작업 금지**: Tailwind 설정에 색·간격 값을 여기서 손으로 박지 않는다. 토큰 코드화는 [[04. 디자인 토큰·컴포넌트 설계]] 산출물(tailwind config·CSS 변수)을 가져오는 것이지 여기서 새로 정의하는 게 아니다.

## 입력

- **필수**: `<루트>/02_기술스택/`(02 ADR — 스택·버전 정본). 없으면 사용자에게 스택을 확인받거나 정본 스택(React 19/Next 15/pnpm/Tailwind)으로 진행하되 ⚠️ 표기.
  <!-- 변경 포인트(입력 경로): 본인 설치본은 <루트>=FE/실행산출물/<주제>. 상위 산출물이 다른 폴더면 수정 -->
- **권장**:
  - `03_아키텍처/03-2_폴더구조.md` — feature-based 디렉터리 재배치 입력(없으면 기본 `src/features|shared|app` 골격 + ⚠️ 03 미대조)
  - `05_라우팅/05-1_route맵.md` — route groups 골격 입력(없으면 app 기본 골격만 + ⚠️ 05 미대조)
  - `04_디자인토큰컴포넌트/` — Tailwind 토큰을 여기서 만들지 말고 04 산출물을 가져옴(부재면 Tailwind 기본값 + "04에서 코드화 예정" 표기)
- 02 ADR이 없어도 정본 스택으로 degrade 진행한다(중단은 사용자가 스택을 확정 못 줄 때만).

## 출력 위치: `frontend-output/<주제-슬러그>/06_개발환경/`

<!-- 변경 포인트(출력 경로): 기본은 현재 작업 폴더의 frontend-output/<주제-슬러그>/06_개발환경/.
     볼트 설치본은 FE/실행산출물/<주제> 고정 가능. 모든 FE 스킬이 같은 <루트>를 공유한다. -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `06-1_스캐폴딩.md` | create-next-app(pnpm/TS/ESLint/Tailwind/App Router/src-dir) 절차 + 03 폴더 재배치·05 route groups 골격 + 완료 검증(pnpm dev·200) + 변경포인트 주석 | Stage 1 |
| `06-2_eslint·prettier·tsconfig.md` | ESLint 9 flat config(`eslint.config.mjs`)·Prettier·`eslint-config-prettier`·jsx-a11y 기본 + tsconfig strict 풀세트·path alias + package.json scripts(lint/format/typecheck) | Stage 2 |
| `06-3_env분리.md` | 12-Factor env 분리: `.env.example`·`NEXT_PUBLIC_` 분리 규칙·`src/shared/config/env.ts` Zod 스키마. 키 이름만, 값은 `{{PLACEHOLDER}}` | Stage 3 |
| `06-4_브랜치커밋규약.md` | 브랜치 네이밍·Conventional Commits·commitlint.config·PR 템플릿·husky+lint-staged pre-commit/commit-msg + 브랜치 보호 규칙 안내 | Stage 4 |
| `_검증체크리스트.md` | 사람 확인 항목 | Stage 5 |

- 출력 폴더가 없으면 생성. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`). 산출물은 "절차·설정 내용·검증 방법" 문서이며, 실제 파일 생성·명령 실행은 사용자가 셋업할 때 적용(도구 부재 시 degrade).

## 파이프라인

### Stage 0 — 입력 확인·셋업 플랜·도구 probe·degrade
- `<루트>/02_기술스택/`(ADR) 로드. 부재면 정본 스택으로 진행 + ⚠️. `03-2_폴더구조.md`·`05-1_route맵.md` 로드 시도(부재면 기본 골격 + ⚠️ 미대조).
- **셋업 플랜 우선(writing-plans)**: "스캐폴딩 → lint/format → strict → env → 커밋 규약 → pre-commit" 순서에 **각 단계 완료 검증**을 박은 체크리스트를 먼저 `06-1`에 포함시키거나 별도로 보인다. 한 방 생성 금지.
- **도구 probe**: Context7(ToolSearch 존재) / pnpm·gh(bash 시도). vercel-react-best-practices 스킬 가용 여부.
- degrade: Context7 부재→내장 지식 + "ESLint/Next 메이저 버전 현행 확인 필요 ⚠️" / pnpm·gh 부재→설정·절차는 생성하되 "로컬에서 직접 실행 필요" 안내(중단 아님).

### 🚦 게이트 — 형상관리 규약 강도 확정 (사람 개입, 필수)
AskUserQuestion으로 **규약의 강도**를 AI 추천 1안과 함께 제시 → 사용자가 OK/수정. 규약은 팀 문화·일정과 얽힌 사람 판단이므로 설정 파일을 굳히기 전에 확정한다.
- 핵심 결정: **lint 강도**(미사용 변수·`console.log`를 error/warn, `console.error/warn` 허용) / **strict 범위**(`strict: true`만 vs `noUncheckedIndexedAccess`·`noImplicitOverride`·`exactOptionalPropertyTypes` 풀세트) / **브랜치 보호**(main 직접 push 금지·PR 필수·CI 통과 필수 — gh 가용 시 적용, 부재 시 안내만) / **커밋·브랜치 컨벤션**(Conventional Commits 타입·`feature/{도메인}-{요약}`, 도메인은 BE 용어).
- **규약 강도를 사람이 확정하기 전에는 Stage 2 이후 설정 파일을 "확정"으로 굳히지 않는다.**

### Stage 1 — 스캐폴딩 + 03 폴더 정렬 → 06-1
- Context7로 `create-next-app`(Next 15)·pnpm 현행 옵션 확정 후 절차 작성: `pnpm create next-app@latest <project> --typescript --eslint --tailwind --app --src-dir --use-pnpm`(옵션은 Context7로 현행 확인).
- 스캐폴딩 후 **03 폴더 구조**(`src/features/{...}`, `src/shared`, `src/app`)로 재배치. 도메인 이름은 BE 정본 용어 그대로.
- **05 route groups**(`(auth)`, `(main)` 등) 골격만 비워서 생성(화면 구현은 07·08).
- 완료 검증 명시: `pnpm dev`가 뜨고 기본 라우트 200.

### Stage 2 — ESLint 9 flat config + Prettier → 그 위에 TS strict → 06-2
> 셋업 플랜의 lint/format 단계와 strict 단계가 한 파일(06-2)에 담기지만 **순서 의존이라 한 방 적용 금지** — 2a(lint/format)를 검증 통과시킨 **뒤** 그 위에 2b(strict)를 올린다.
- **2a. lint/format**: Context7로 `eslint.config.mjs`(flat config)·`eslint-config-next`·`prettier`·`eslint-config-prettier`·`eslint-plugin-jsx-a11y` 현행 설정법 확인.
  - ESLint: TypeScript 권장 + import 순서 정렬 + 미사용 변수·`console.log`(강도는 게이트) + jsx-a11y **기본 룰만**(접근성 정본은 [[14. 접근성·반응형 대응]]) + Prettier 충돌 룰은 `eslint-config-prettier`로 off.
  - 검증: `pnpm lint` 통과·`pnpm format` 멱등(도구 부재면 "로컬 실행 필요"). **이 검증을 통과한 뒤 2b로.**
- **2b. TS strict**(2a 위에서): tsconfig strict 풀세트(게이트 범위) + path alias(`@/features`, `@/shared`, `@/app` — 03 구조 일치).
  - strict 적용 후 `pnpm typecheck` 에러를 **유형별(null 가능성 / 인덱스 접근 / any 추론 등)** 분류·목록화 + 안전한 수정안 제안. **any 도배·`@ts-ignore` 금지, 판단 필요는 "확인 필요"**.
- package.json scripts: `lint`/`format`/`typecheck`를 추가해 위 검증을 명령으로 고정(`pnpm typecheck` 0 에러까지). `.eslintrc`(폐기)가 아닌 flat config인지, ESLint·Next 메이저가 02 ADR과 맞는지 확인 항목으로 남김.

### Stage 3 — 환경변수 12-Factor 분리 → 06-3
- `.env.example` 생성, `.env.local`이 `.gitignore`에 있는지 확인. 브라우저 노출 변수(`NEXT_PUBLIC_API_BASE_URL` 등)와 서버 전용 변수를 `NEXT_PUBLIC_` 규칙으로 분리. **비밀키는 절대 `NEXT_PUBLIC_` 금지.**
- `src/shared/config/env.ts`에 **Zod 스키마**로 env 검증 → 필수 키 없으면 빌드/부팅 시점 즉시 실패.
- 키 초안(주제별로 다름): `(NEXT_PUBLIC_)API_BASE_URL`(=BE 05 OpenAPI 서버), OAuth 클라이언트 키(BE 인증 방식 확인 후), 결제 PG 공개키 등 → **키 "이름"만, 값은 전부 `{{PLACEHOLDER}}`**. BE 미정의(API 갭) 키는 `[확인 필요]`로.

### Stage 4 — 브랜치/커밋 규약 + commitlint + pre-commit → 06-4
- Context7로 commitlint + Conventional Commits + husky + lint-staged 현행 설정 확인.
- 브랜치 네이밍 `main`/`develop`/`feature/{도메인}-{요약}`/`fix/...`/`chore/...`(도메인은 **03 산출물의 feature 도메인명** — 예시: booking/pet, 또는 plan/subscription/payment 등 주제별로 다름). 커밋 Conventional Commits(`feat`/`fix`/`chore`/`refactor`/`test`/`docs`/`style`), scope는 feature 도메인명 권장.
- `commitlint.config` + PR 템플릿(`.github/PULL_REQUEST_TEMPLATE.md`) 생성. 규약 자체는 `06-4_브랜치커밋규약.md`로 팀이 읽도록 문서화.
- **husky + lint-staged**: `pre-commit`=스테이징 파일에만 `eslint --fix`+prettier, `commit-msg`=commitlint. lint-staged **변경 파일 한정**(전체 typecheck·테스트는 [[16. 빌드·배포 (CI·CD)]]로 미룸 — 무거우면 `--no-verify` 우회).
- 검증(이 단계 최종): 잘못된 커밋 메시지("update")가 거부되고, lint 에러 파일 스테이징 시 커밋 차단·정상 파일은 통과(둘 다).
- gh CLI 가용 시 main 브랜치 보호 규칙(직접 push 금지·PR 필수·CI 통과 필수) 안내. CI 본격 구성은 16단계 — 여기서는 보호 규칙 + 최소 lint/typecheck 게이트까지만.

### Stage 5 — 검증 체크리스트 + 마무리
- `_검증체크리스트.md` 생성(아래 본문, `<주제>`/`<날짜>` 치환).
- 마지막으로 산출물 폴더 경로와 "규약 강도는 게이트에서 확정한 값 — 시크릿 값은 사람이 로컬·Vercel에 주입, 설정 버전은 한 번 직접 확인" 고지를 보고한다. strict "확인 필요" 항목이나 ADR ⚠️가 남으면 완료 보고에 ⚠️ 표기.

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe = ToolSearch 존재) = flat config·Next 15 옵션·commitlint/husky 현행 문법 확정(안전핀). 부재 시 **내장 지식 + "메이저 버전·flat config 문법 현행 확인 필요 ⚠️"**. 2-step(resolve-library-id → query-docs).
- **pnpm / gh CLI**(bash probe) = 스캐폴딩·브랜치 보호 실행. 부재 시 절차·설정은 **생성하되 "로컬 직접 실행 필요"** 안내(중단 아님).
- **vercel-react-best-practices 스킬**(가용 시) = 스캐폴딩 직후 `next.config`·디렉터리 경계·RSC 친화 구조 점검. **writing-plans 스킬** = Stage 0 셋업 플랜(단계별 완료 검증) 작성.
- **중단**은 사용자가 스택을 확정 못 줄 때만. 02 ADR 부재는 정본 스택 + ⚠️로 degrade.

## _검증체크리스트 본문 (Stage 5 생성)
```markdown
# 검증 체크리스트 — <주제> 개발 환경 구축 (작성일: <날짜>)

> AI는 보일러플레이트·strict 에러 분류까지. 규약의 강도·시크릿 값 주입은 사람의 일이다.

- [ ] 스캐폴딩 후 pnpm dev 가 뜨고 기본 라우트 200 / 03 폴더 구조·05 route groups 골격 반영(도메인명 BE 용어 그대로)
- [ ] eslint.config.mjs (flat config)인가 — .eslintrc(폐기) 아님 / ESLint·Next 메이저 버전이 02 ADR과 일치
- [ ] pnpm lint 통과 · pnpm format 멱등 · pnpm typecheck 0 에러
- [ ] strict 에러를 any/@ts-ignore로 덮지 않았는가 — "확인 필요" 항목은 사람이 직접 검토
- [ ] .env.local 이 .gitignore에 있고, .env.example 에 실제 시크릿 값이 섞이지 않았는가(전부 {{PLACEHOLDER}})
- [ ] 비밀키에 NEXT_PUBLIC_ 접두사가 붙지 않았는가 / Zod env 스키마가 필수 키 누락 시 빌드 실패
- [ ] 잘못된 커밋 메시지("update")가 commitlint에서 거부되는가
- [ ] lint 에러 파일이 pre-commit에서 차단되고, 정상 파일은 통과하는가(둘 다)
- [ ] pre-commit이 변경 파일 한정인가(전체 typecheck·테스트는 16 CI로 미룸)
- [ ] lint error/warn 강도·브랜치 보호 수준을 팀과 합의했는가(게이트 확정값)
- [ ] Tailwind 색·간격 값을 여기서 손으로 박지 않았는가(04 토큰 코드화 계승)
```

## 주의
- **한계** — 이 스킬은 설정·절차 "문서"를 만든다. 실제 저장소 파일 생성·`pnpm`/`gh` 명령 실행은 사용자 셋업 시 적용(도구 부재 시 degrade). 규약의 강도와 시크릿 값은 사람의 일.
- **시크릿을 AI·저장소에 넣지 않는다**(가장 중요한 경계) — `.env.local`의 `.gitignore` 포함·비밀키 `NEXT_PUBLIC_` 미부착·`.env.example` 실제 값 미혼입을 커밋 전 직접 확인.
- **생성된 설정 버전을 한 번은 직접 확인** — Context7를 거쳐도 옛 문법으로 되돌아갈 수 있다. `eslint.config.mjs`(flat config) 여부·ESLint/Next 메이저 버전이 02 ADR과 맞는지 `package.json`을 눈으로.
- **흔한 실수 — 한 방 셋업**: 한 프롬프트로 스캐폴딩~pre-commit을 시키면 중간 오류(strict 에러·lint 충돌)가 묻힌다. Stage 0 플랜대로 단계마다 완료 검증 후 다음으로.
- **흔한 실수 — 디자인 토큰 중복**: Tailwind 색·간격을 여기서 새로 정의하지 마라. [[04. 디자인 토큰·컴포넌트 설계]] 산출물을 계승.

## 원본 가이드
- 이 스킬은 FE 가이드 **"06. 개발 환경 구축 (형상관리)"**를 자동화한 것입니다.

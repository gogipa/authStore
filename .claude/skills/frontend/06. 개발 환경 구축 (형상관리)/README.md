# fe-dev-environment — 개발 환경 구축 (형상관리) 자동화 스킬

02 ADR로 확정한 스택과 03 폴더 구조·05 라우트 맵을 넣으면, **첫 커밋 이전에 팀 합의를 코드로 강제할
빈 프로젝트 골격**을 세워주는 Claude Code 스킬입니다. 스캐폴딩 → ESLint/Prettier/TS strict →
env 12-Factor 분리 → 브랜치·커밋 규약·pre-commit 훅까지 한 번에 깝니다.

> FE 프로세스 06단계 "개발 환경 구축 (형상관리)"를 자동화합니다.
> 역할 분담: AI는 보일러플레이트 생성·strict 에러 분류, **규약의 강도 결정과 시크릿 값 주입은 사람**.

## 무엇을 만들어 주나

`frontend-output/<주제>/06_개발환경/`에 생성:

| 파일 | 내용 |
|---|---|
| `06-1_스캐폴딩.md` | create-next-app(pnpm/TS/ESLint/Tailwind/App Router/src-dir) 절차 + 03 폴더 재배치·05 route groups 골격 + 완료 검증 |
| `06-2_eslint·prettier·tsconfig.md` | ESLint 9 flat config·Prettier·jsx-a11y 기본 + tsconfig strict 풀세트·path alias + lint/format/typecheck scripts |
| `06-3_env분리.md` | 12-Factor env 분리: `.env.example`·`NEXT_PUBLIC_` 규칙·Zod env 스키마 (키 이름만, 값은 `{{PLACEHOLDER}}`) |
| `06-4_브랜치커밋규약.md` | 브랜치 네이밍·Conventional Commits·commitlint·PR 템플릿·husky pre-commit + 브랜치 보호 안내 |
| `_검증체크리스트.md` | 사람이 확인할 항목 |

## 준비물 (입력)

1. **(필수) 02 ADR** — `02_기술스택/`. 스택·버전 정본(React 19/Next 15/pnpm/Tailwind). 없으면 정본 스택으로 진행하되 ⚠️ 표기.
2. **(권장) 03 폴더 구조** — `03_아키텍처/03-2_폴더구조.md`. feature-based 디렉터리 재배치 입력.
3. **(권장) 05 라우트 맵** — `05_라우팅/05-1_route맵.md`. app route groups 골격 입력.
4. **(연결) 04 디자인 토큰** — Tailwind 토큰은 여기서 만들지 않고 `04_디자인토큰컴포넌트/` 산출물을 가져옵니다.

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| Context7 MCP | 권장 | 내장 지식 + "ESLint 9·Next 15 메이저 버전·flat config 문법 현행 확인 필요 ⚠️" |
| pnpm / gh CLI | 선택 | 절차·설정은 생성하되 "로컬에서 직접 실행 필요" 안내 |
| vercel-react-best-practices 스킬 | 선택 | 스캐폴딩 직후 RSC 친화 구조 점검 생략 |

## 설치

```bash
mkdir -p ~/.claude/skills/fe-dev-environment
cp SKILL.md ~/.claude/skills/fe-dev-environment/SKILL.md
```

## 사용법

02 ADR(과 03·05 산출물)을 준비한 뒤:

```
02 ADR 따라서 pomit-web 개발 환경 구축해줘
```

1. **셋업 플랜** → "스캐폴딩 → lint/format → strict → env → 커밋 규약 → pre-commit" 순서에 각 단계 완료 검증을 박은 체크리스트
2. **형상관리 규약 강도 확정** → 당신이 OK/수정 (유일한 개입: lint error/warn·strict 범위·브랜치 보호·커밋 컨벤션)
3. 스캐폴딩 → ESLint/Prettier/TS strict → env 분리 → 커밋 규약·pre-commit 자동 (단계마다 완료 검증)

발동 키워드: `개발 환경 구축`, `스캐폴딩`, `ESLint Prettier 설정`, `TS strict`, `env 분리`, `commitlint`, `husky pre-commit`, `브랜치 커밋 규약`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `frontend-output/`를 원하는 경로로(볼트 설치본은 FE/실행산출물/<주제>) |
| 계승 출처 | `## 입력` | 02·03·05 산출물 경로를 본인 폴더 구조로 |
| 도구(Context7/pnpm/gh) | `## 도구 정확성` | 부재 시 degrade 동작 조정 |
| 스택 버전 | `## 핵심 원칙` | 02 ADR과 어긋나면 ADR을 정본으로(임의 변경 금지) |
| 규약 기본 강도 | `### 🚦 게이트` | lint error/warn·strict 범위·브랜치 보호 기본안 |
| 트리거 키워드 | frontmatter `description` | 자기 표현으로 |

## 주의

- **시크릿을 AI·저장소에 넣지 마세요.** `.env.local`의 `.gitignore` 포함, 비밀키 `NEXT_PUBLIC_` 미부착, `.env.example` 실제 값 미혼입을 커밋 전 직접 확인.
- **strict 에러를 any로 끄지 마세요.** AI에게 "에러 없애줘"라고만 하면 `any`·`@ts-ignore`로 덮습니다. 변경 diff를 직접 검토.
- **lint 룰 강도는 팀과 합의.** 너무 빡세면 개발이 멈추고, 너무 느슨하면 차단 장치 의미가 없습니다.
- **pre-commit을 무겁게 만들지 마세요.** 변경 파일 한정. 전체 typecheck·테스트는 16(CI)로 미룹니다.
- **설정 버전을 한 번은 직접 확인.** `eslint.config.mjs`(flat config) 여부·ESLint/Next 메이저 버전이 02 ADR과 맞는지 `package.json`을 눈으로.
- **디자인 토큰은 여기서 정의하지 않습니다.** Tailwind 색·간격은 [[04. 디자인 토큰·컴포넌트 설계]] 산출물을 가져오는 것입니다.

## 원본 가이드

이 스킬은 FE 가이드 **"06. 개발 환경 구축 (형상관리)"**를 자동화한 것입니다.

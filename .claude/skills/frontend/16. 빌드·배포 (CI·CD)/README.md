# fe-build-deploy — 빌드·배포 (CI·CD) 자동화 스킬

06 형상관리 규약과 15 테스트 위에, 프론트엔드 CI·CD 파이프라인을 **설계도→실행** 순서로 세우는
Claude Code 스킬입니다. GitHub Actions workflow·환경변수/시크릿 매핑표·Vercel 프리뷰/프로덕션
배포·캐시 정책·머지 게이트를 만들어 줍니다.
역할 분담: **AI는 현행 문법 확정·매핑표 회수율·설계도/초안**, **게이트 정책과 시크릿 실제 값 입력은 사람**.
시크릿을 AI 컨텍스트에 넣지 않는 것은 타협 불가 규칙입니다.

> FE 프로세스 16단계 "빌드·배포 (CI·CD)"를 자동화합니다.

## 무엇을 만들어 주나

`frontend-output/<주제-슬러그>/16_배포/`에 생성:

| 파일 | 내용 |
|---|---|
| `16-0_CICD설계도.md` | job 그래프(lint→typecheck→test→build)·E2E 분리 트레이드오프·머지 게이트·캐시 전략·env 분리 지점·각 단계 검증 방법 (코드 전 SSOT) |
| `16-1_github-actions.yml` | `ci.yml`(+필요 시 `e2e.yml`): install→lint→typecheck→test→build, pnpm store·`.next/cache` 캐싱, Node 버전 일치, 시크릿은 `${{ secrets.* }}` 참조만 |
| `16-2_vercel설정.md` | `vercel.json`·프리뷰/프로덕션 빌드·자산 유형별 캐시/CDN 정책표·프리뷰 URL PR 코멘트 흐름 |
| `16-3_env시크릿매핑.md` | 키·공개여부·환경별 매핑표(값은 `{{등록 필요}}`)·`gh secret set`/`vercel env add` 명령 목록 |
| `_검증체크리스트.md` | 사람이 확인할 항목(게이트·시크릿·캐시·머지 차단) |

`16-1_github-actions.yml`은 본 폴더에 산출물로 두고, 실제 적용은 사람이 `.github/workflows/`로 옮깁니다.

## 준비물 (입력)

1. **(필수) 15 테스트** — `frontend-output/<주제>/15_테스트/`. CI가 머지 게이트로 강제하는 테스트 명령의
   원천. 없으면 테스트 job은 placeholder + ⚠️로 degrade(중단하지 않음).
2. **(권장) 06 개발환경** — `06_개발환경/`(env 분리·`.env.example`·Zod env 스키마·브랜치 보호·커밋 규약).
   CI 트리거·env 매핑·머지 게이트의 근거.
3. **(권장) 03 아키텍처** — `03_아키텍처/`(03-1 렌더링전략맵·ISR 페이지). HTML/RSC 캐시 재검증 정책의 대상.
4. **(권장) 코드베이스** — `process.env`·`NEXT_PUBLIC_` 사용처. env 매핑표 스캔 원천(없으면 06 규약 기반 초안).

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| Context7 MCP | 선택(강력 권장) | 내장 지식 + "버전 확인 필요 ⚠️" (액션 메이저 핀·deprecated 가능성 경고) |
| gh CLI | 선택 | 시크릿 등록·브랜치 보호 명령은 생성하되 "로컬 실행 필요" |
| vercel CLI | 선택 | `vercel.json`·env 명령은 생성하되 "로컬 실행 필요" |
| pnpm / node | 선택 | 캐시 키·버전 일치 검증을 로컬에서 |

## 설치

```bash
mkdir -p ~/.claude/skills/fe-build-deploy
cp SKILL.md ~/.claude/skills/fe-build-deploy/SKILL.md
```

## 사용법

15·06 산출물을 준비한 뒤:

```
포밋 프론트엔드 CI·CD 파이프라인 세워줘
```

1. 설계도(16-0) 작성 (writing-plans) — job 그래프·E2E 정책·머지 게이트·캐시·env 분리
2. **🔴 배포·시크릿·게이트 정책 확정** → 당신이 OK (머지 게이트/E2E 정책/환경·시크릿 배치/배포 호스트)
3. CI workflow(16-1) — Context7로 현행 액션 버전 확정 후 생성
4. Vercel 배포·캐시(16-2) → env/시크릿 매핑표(16-3, 값은 비움)
5. 단계별 실행·검증 안내 (executing-plans) + 머지 게이트(브랜치 보호) 설정

발동 키워드: `CI/CD`, `프론트 배포`, `GitHub Actions`, `Vercel`, `프리뷰 배포`,
`환경변수 매핑`, `시크릿 등록`, `캐시 정책`, `머지 게이트`, `preview deploy`, `branch protection`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `frontend-output/`를 볼트 `FE/실행산출물/` 등으로 |
| 계승 출처 | `## 입력` | 06·15·03 폴더 경로를 본인 구조로 |
| 배포 호스트 | Stage 3 | Vercel → AWS Amplify/Cloudflare/직접 CDN 설정으로 교체 |
| 도구(Context7/gh/vercel) | `## 도구 정확성` | 없으면 degrade — 명령은 생성, 실행은 로컬 |
| 스택 버전 | 변경 포인트 4 | React 19/Next 15/pnpm 정본 — 다르면 vercel.json·job 교체 |
| 트리거 키워드 | frontmatter `description` | 자기 표현으로 |

## 주의

- **시크릿 실제 값은 AI에게 절대 주지 않습니다** — `${{ secrets.* }}`·`gh secret set` 명령까지만.
  실수로 커밋된 시크릿은 즉시 폐기·재발급.
- **프리뷰에 프로덕션 키 주입 금지** — 프리뷰는 외부 접근 가능한 격리 환경(결제=샌드박스, 외부 API=스테이징).
- **CI 작성과 머지 차단은 별개 설정** — 브랜치 보호에 required status check를 안 걸면 빨간불이 떠도 머지됩니다.
- **한 방에 거대한 workflow 생성 금지** — 설계도(Stage 1)→단계별 실행(Stage 5)으로 끊어 각 단계 초록불 확인.
- **액션 버전은 핀하고 갱신** — 오래된 액션은 어느 날 갑자기 워크플로우를 실패시킵니다(Context7로 현행 확정).
- **E2E 전체 PR 실행은 트레이드오프** — 무거우면 라벨·main 한정으로 분리. 정답이 하나가 아닙니다.
- 운영 에러·성능 관측(Sentry·RUM·sourcemap)은 17 단계 — 여기는 "파이프라인이 초록불이 되게 하는" 것까지.

## 원본 가이드

이 스킬은 FE 가이드 **"16. 빌드·배포 (CI·CD)"**를 자동화한 것입니다.

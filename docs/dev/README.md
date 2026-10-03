# 개발 설계 — 스마트스토어 정복 로컬 웹앱

요구사항([docs/prd](../prd/README.md))과 디자인([docs/design](../design/README.md)) 다음 단계다. 오너 결정 D-14(apps/BE NestJS · apps/FE React+Vite · PostgreSQL)와 D-15(FE 개발 전에 ERD → API 명세)를 따른다. 절차는 프로젝트 스킬 `.claude/skills/backend` 02~06과 `.claude/skills/frontend` 03~06이다.

## 읽는 순서

| 순서 | 문서 | 내용 | 상태 |
|---|---|---|---|
| 1 | [02-ADR-001 기술 스택](02_기술스택/02-ADR-001_기술스택.md) | 스택 결정과 근거, 탈락 후보, 재검토 트리거 | 오너 결정분 Accepted · 세부 Proposed |
| 2 | [03-1 옵션 비교](03_아키텍처/03-1_옵션비교.md) · [03-2 C4](03_아키텍처/03-2_C4다이어그램.md) · [03-ADR-003](03_아키텍처/03-ADR-003_아키텍처.md) | 모듈러 모놀리식, 모듈 경계, 트랜잭션 경계, 로컬 보안 | Proposed |
| 3 | [04-1 ERD](04_데이터베이스/04-1_ERD.md) · [04-3 Prisma 스키마](04_데이터베이스/04-3_schema.prisma) · [04-2 DDL](04_데이터베이스/04-2_schema.sql) · [04-5 인덱스·제약](04_데이터베이스/04-5_인덱스제약점검.md) | M1 테이블 55개(ERD v0.4, D-16 `ai_cli_check` 추가). 로컬 PostgreSQL 14에 적용 확인 | Proposed |
| 4 | [05-1 엔드포인트 표](05_API/05-1_엔드포인트표.md) · [05-2 OpenAPI 3.1](05_API/05-2_openapi.yaml) · [05-3 오류 코드·페이징](05_API/05-3_에러코드페이징규약.md) | API 명세 v0.2. 165개(M1 101 · M2 64), 오류 코드 144(06에서 `ROUTE_NOT_FOUND` 추가). Redocly lint 통과(오류 0·경고 0), 05-1 ↔ 05-2 1:1 스크립트 대조 | Proposed |
| 5 | [FE 설계](FE/README.md) — 03 아키텍처 · 04 디자인 토큰·컴포넌트 · 05 라우팅 | 14개 화면 모두 CSR(D-29 SCR-14 사용 안내 포함), feature = OpenAPI 태그(예외 `guide`), tokens.json → CSS 변수, 경로 16행·화면별 operationId. 설계 중 찾은 어긋남 10건(C1~C10) | Proposed |
| 6 | [06 개발 환경](06_개발환경/) — [06-1 저장소·형상관리](06_개발환경/06-1_저장소·형상관리.md) · [06-2 BE 스캐폴딩](06_개발환경/06-2_BE스캐폴딩.md) · [06-3 FE 스캐폴딩](06_개발환경/06-3_FE스캐폴딩.md) · [06-4 환경변수](06_개발환경/06-4_환경변수.md) · [검증 체크리스트](06_개발환경/_검증체크리스트.md) | pnpm 모노레포, Node 24.21, 트렁크 기반·Conventional Commits, husky(secretlint·commitlint). BE·FE 뼈대, V1 마이그레이션 적용, 로컬 보안 규칙 동작 확인 | Proposed |
| 7 | [07 M0 스파이크](07_M0스파이크/README.md) — [S6 격리·비전](07_M0스파이크/S6_AI격리·비전.md) · [S6 약관](07_M0스파이크/S6_AI약관.md) · [S7 엔진 동등성](07_M0스파이크/S7_엔진동등성.md) | AI CLI 실측(2026-10-01): claude 격리 플래그 3개·비전 경계, agy 격리 불가·'실험적'(스키마 86%), 엔진별 약관 위험. 앱·PRD §8.9·§17에 반영. 미실시: S1~S5, S7 codex(미설치) | Proposed |

## 저장소 구조

```
autoStore/
├─ apps/
│  ├─ BE/   NestJS 12 · Prisma 7.10 (API /api/v1, 배포본에서는 화면 정적 파일도 내보냄)
│  └─ FE/   React 19 · Vite 8 · React Router 8
├─ docs/    prd · design · dev
└─ package.json, pnpm-workspace.yaml
```

실행 방법은 저장소 루트의 [README](../../README.md)에 있다.

## 반영한 오너 결정

- **D-16(2026-09-27) 반영**: 사용자가 AI 엔진(Claude Code·Antigravity CLI·Codex)을 설정 아래 별도 페이지(SCR-13)에서 고른다. 세부는 추천안(D-11). ERD v0.4(`ai_cli_check` 신설, `step_run.ai_engine`·`ai_model`·`ai_cli_version`), API v0.2(`GET·PUT /settings/ai-engine`, `/ai-cli-checks` M1 승격, 오류 코드 3개), 아키텍처(`AiEngineAdapter` 포트 + 어댑터 3개)에 반영했다.
- **D-27·D-28(2026-10-03) 반영**: 화면 ID 칩(SCR-xx)을 앱 화면에서 뺐다. 화면 ID는 설계 문서·코드 주석·테스트 이름에만 쓴다(D-27). 앱 표시 이름은 '스마트스토어 정복'이다(D-28). 저장소·패키지(`@autostore/*`)·DB·환경 변수·`X-AutoStore-Client` 같은 내부 이름은 그대로다([원천자료 11](../prd/원천자료/11_화면표시_2026-10-03.md)).
- **D-29(2026-10-03) 반영**: 처음 쓰는 사람을 위한 안내 1~4를 M1에 넣었다 — 대시보드 '시작 준비'·'작업 흐름' 카드, 모든 화면의 '?' 도움말, 빈 상태 다음 행동, 새 화면 SCR-14 사용 안내(`/guide`, 내비 맨 아래). 세부는 추천안(D-11, Proposed). API·DB는 그대로다(이미 있는 M1 GET만 읽는다). FE는 [05-1](FE/05_라우팅/05-1_route맵.md)·[04-3 §24](FE/04_디자인토큰컴포넌트/04-3_컴포넌트계층.md)·[03-2 §3](FE/03_아키텍처/03-2_폴더구조.md)에 적었다. 흐름 테스트 포트를 환경 변수로 바꿀 수 있게 했다([06-3 §3](06_개발환경/06-3_FE스캐폴딩.md)). 첫 실행 마법사·체험 모드(5)는 M2다([원천자료 12](../prd/원천자료/12_사용안내_2026-10-03.md)).

## 결정 표시

- **Accepted**: 오너가 정했다.
- **Proposed**: 오너가 위임한 범위(D-11)에서 Claude가 추천대로 정했다. 오너가 짚으면 고친다.

# be-dev-environment — 개발 환경 구축 자동화 스킬

확정된 스택(02)을 받아 백엔드 프로젝트의 **빈 그릇과 작업 규칙**을 일괄 생성하는 Claude Code 스킬입니다. 스캐폴딩·`build.gradle.kts`·로컬 `docker-compose`·프로파일/환경변수 분리(12-Factor)·브랜치 전략·커밋 규약·pre-commit 훅을 만듭니다. 사람은 **브랜치 전략·커밋 규약 확정 1번**만 개입합니다.

> BE 프로세스 6단계 "06. 개발 환경 구축 (서버·형상관리)"를 자동화합니다.
> 역할 분담: 전략 결정은 사람, 보일러플레이트 생성·검증은 AI.

## 무엇을 만들어 주나

`backend-output/<주제>/06_개발환경/`에 생성:

| 파일 | 내용 |
|---|---|
| `06-1_build.gradle.kts.md` | Gradle Kotlin DSL 빌드 파일(Java 21·SB 3.3 의존성·QueryDSL·testcontainers) + 디렉터리 구조 |
| `06-2_docker-compose.yml` | postgres:16·redis:7(포트·named volume·healthcheck·`${...}` 환경변수 참조) |
| `06-3_브랜치전략커밋규약.md` | 브랜치 전략·main 보호 규칙·Conventional Commits·`.gitignore`·`.pre-commit-config.yaml`(gitleaks 등) |
| `06-4_프로파일환경변수.md` | application.yml(공통)/-local/-dev/-prod 프로파일·환경변수 치환·필수 환경변수 목록·`.env.example` |
| `_검증체크리스트.md` | 사람이 확인할 항목 |

## 준비물 (입력)

1. **(필수) 02 기술스택** — `backend-output/<주제>/02_기술스택/`의 스택·의존성·ADR 확정본. 없으면 정본 스택(Java 21 / Spring Boot 3.3 / PostgreSQL 16 / Redis 7 / Flyway)을 디폴트로 제시하고 확인 후 진행.
2. **(연결) 04 데이터베이스** — DB명·포트·Flyway 사용 여부를 compose·프로파일에 반영.
3. **(연결) 05 API** — springdoc-openapi 의존성 필요 여부.

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| Context7 MCP | 선택 | 내장 지식으로 의존성 좌표 작성 + "SB 3.3 기준 버전 확인 필요 ⚠️" |
| docker / docker compose | 선택 | `06-2`는 생성, "로컬에서 `compose up`으로 healthy 검증 필요" 안내 |
| gradle(`./gradlew`) | 선택 | 생성하되 빌드 검증은 로컬에서 |
| pre-commit | 선택 | `.pre-commit-config.yaml`만 생성, "`pre-commit install` 후 더미 커밋으로 차단 확인 필요" |
| gh CLI | 선택 | 레포 생성·브랜치 보호는 사람이 수동 실행 |

## 설치

```bash
mkdir -p ~/.claude/skills/be-dev-environment
cp SKILL.md ~/.claude/skills/be-dev-environment/SKILL.md
```

## 사용법

02 스택이 확정된 뒤:

```
pomit 백엔드 개발 환경 구축해줘
```

1. 입력 확인·도구 probe → (필요 시 writing-plans로 세팅 계획)
2. **브랜치 전략·커밋 규약 확정** → 당신이 선택 (유일한 개입)
3. 스캐폴딩·build.gradle.kts → docker-compose → 형상관리 → 프로파일 분리 자동 생성
4. 각 단계 검증 명령(`./gradlew build`·`compose up`·더미 커밋) 실행(가능 환경)

발동 키워드: `개발 환경 구축`, `스캐폴딩`, `docker-compose`, `프로파일 분리`, `브랜치 전략`, `형상관리`, `pre-commit`, `dev environment`, `scaffolding`, `git strategy`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `backend-output/`를 본인 볼트 경로(BE/실행산출물/<주제>)로 |
| 계승 출처 | `## 입력` | 02/04/05 상위 산출물 경로를 본인 폴더 구조로 |
| 브랜치 전략 기본값 | `### 🚦 게이트` | trunk-based 디폴트를 팀 리듬에 맞게 |
| 스택 버전 | frontmatter 변경포인트 주석 | 정본(Java 21/SB 3.3)을 팀 정본으로 (임의 상향 주의) |
| 도구(MCP/CLI) | `## 도구 정확성` | Context7·docker·pre-commit 미사용 시 degrade 조정 |

## 주의

- **시크릿을 코드·예시에 넣지 않습니다** — AI가 자리표시자 대신 평문 비밀번호를 채우기도 합니다. `${...}` 치환·`.env`의 `.gitignore` 포함을 직접 확인.
- **스택 버전 임의 변경 금지** — AI 최신 추천보다 시리즈 정본을 따릅니다.
- **브랜치 전략은 팀 합의** — AI 추천을 그대로 확정하지 마세요. 문서화만 AI.
- **검증 없이 "완료" 금지** — `./gradlew build`·`compose up`·더미 커밋을 실제로 돌려본 뒤에만 넘어갑니다.
- **pre-commit은 `install`까지** — `.yaml`만 만들면 훅이 동작하지 않습니다.

## 원본 가이드

이 스킬은 BE 가이드 **"06. 개발 환경 구축 (서버·형상관리)"**를 자동화한 것입니다.

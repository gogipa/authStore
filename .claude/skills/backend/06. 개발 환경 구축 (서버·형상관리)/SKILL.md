---
name: be-dev-environment
description: 확정된 스택(02)을 받아 백엔드 프로젝트 스캐폴딩·로컬 인프라·형상관리 가드레일을 일괄 생성한다. build.gradle.kts·docker-compose·프로파일/환경변수 분리·브랜치 전략·커밋 규약·pre-commit 훅을 만든다. "개발 환경 구축","스캐폴딩","프로젝트 골격","docker-compose","로컬 인프라","프로파일 분리","환경변수 분리","12-Factor","브랜치 전략","형상관리","커밋 규약","pre-commit","gitignore","dev environment","scaffolding","docker compose","profile separation","git strategy","conventional commits" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# 개발 환경 구축 (Dev Environment Setup)

설계(아키텍처·DB·API)가 확정된 뒤 실제 코드를 짤 **빈 그릇과 작업 규칙**을 만든다. 산출물 = ① 서버 환경(스캐폴딩·`build.gradle.kts`·로컬 `docker-compose`·프로파일/환경변수 분리)과 ② 형상관리(브랜치 전략·`.gitignore`·Conventional Commits·pre-commit 훅). **전략 결정은 사람, 보일러플레이트 생성·검증은 AI** — 한 번 잘 깔면 07~19가 그 위에서 돈다.

<!-- ───────────────────────────────────────────────────────────────
변경 포인트 (배포본 → 본인 환경에 맞게 수정)
  1. 출력 경로: 기본 backend-output/<주제-슬러그>/06_개발환경/. 본인 볼트 설치본은 BE/실행산출물/<주제>로 고정 가능.
  2. 계승 출처: 상위 산출물(02_기술스택, 04_데이터베이스, 05_API) 경로를 본인 폴더 구조로 수정.
  3. 도구(MCP/CLI): Context7(의존성 좌표) / docker·gradle·gh·pre-commit(검증) — 없으면 degrade.
  4. 스택 버전: 시리즈 정본(Java 21 / Spring Boot 3.3 / Gradle Kotlin DSL / PostgreSQL 16 / Redis 7 / Flyway). 임의 변경 금지.
──────────────────────────────────────────────────────────────── -->

## 핵심 원칙

- **상위 산출물 계승·재발명 금지**: 스택·의존성·DB 포트는 02(기술스택)·04(데이터베이스) 확정본을 그대로 옮긴다. 확정 상태일 때만 계승하고, 미확정은 ⚠️로 보존.
- **결정은 사람, 생성은 AI**: 브랜치 전략(trunk-based vs Git Flow)·프로파일 수·시크릿 주입 방식은 운영까지 내다본 팀 판단이라 사람이 정한다. AI는 결정된 전략을 일관된 설정으로 펼친다 — 전략까지 AI가 고르면 팀 컨벤션과 따로 노는 환경이 된다.
- **12-Factor — 설정을 코드 밖으로**: 접속 정보·시크릿은 환경변수 치환(`${...}`), 프로파일은 환경별 차이만. 같은 산출물(jar/이미지)이 모든 환경에서 돈다.
- **시크릿을 코드·예시에 넣지 않는다**: 자리표시자만. 그럴듯한 평문 비밀번호를 채우지 않는다.
- **검증 없이 다음으로 넘기지 않는다**: 생성 직후 `./gradlew build`·`docker compose up`·더미 커밋으로 실제 동작을 확인한다(가능한 환경에서). 안 되면 "로컬에서 직접 실행 필요" 안내.
- **스택 버전 임의 변경 금지**: 시리즈 정본(Java 21 / Spring Boot 3.3 / Gradle Kotlin DSL)을 따른다.

## 입력

- **필수**: `<루트>/02_기술스택/`(스택·의존성·ADR 확정본). 없으면 위치를 묻거나, 사용자에게 스택을 직접 받아 진행(정본 디폴트 제시 후 확인).
- **권장**:
  - `<루트>/04_데이터베이스/`(DB명·포트·Flyway 사용 여부 — compose·프로파일에 반영)
  - `<루트>/05_API/`(springdoc-openapi 의존성 필요 여부)
- 상위 산출물이 없으면 정본 스택(Java 21 / Spring Boot 3.3 / PostgreSQL 16 / Redis 7 / Flyway)을 디폴트로 제시하고 사용자 확인 후 진행한다(중단보다 degrade).

## 출력 위치: `backend-output/<주제-슬러그>/06_개발환경/`

<!-- 변경 포인트(출력 경로): 본인 볼트 설치본은 BE/실행산출물/<주제>로 고정 가능. 기본은 backend-output/<주제-슬러그>/ -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `06-1_build.gradle.kts.md` | Gradle Kotlin DSL 빌드 파일(Java 21·SB 3.3 의존성·QueryDSL Q타입·test: junit5/assertj/mockito/testcontainers). 디렉터리 구조(com.pomit·layered) + 변경포인트 주석 | Stage 1 |
| `06-2_docker-compose.yml` | postgres:16(DB·5432·named volume)·redis:7(6379)·healthcheck(pg_isready/redis-cli ping)·`${...}` 환경변수 참조 | Stage 2 |
| `06-3_브랜치전략커밋규약.md` | 브랜치 전략(trunk-based 권장 vs Git Flow 비교·선택근거)·main 보호 규칙 권장값·Conventional Commits(타입+예시)·`.gitignore`·`.pre-commit-config.yaml`(spotless/gitleaks/큰파일) | Stage 3 |
| `06-4_프로파일환경변수.md` | application.yml(공통)/-local/-dev/-prod 프로파일·`${DB_URL}` 등 환경변수 치환·필수 환경변수 목록·`.env.example` | Stage 4 |
| `_검증체크리스트.md` | 사람 확인 항목 | 마지막 |

- 출력 폴더가 없으면 생성한다. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`).

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- `02_기술스택/`(필수)·`04_데이터베이스/`·`05_API/`(권장)를 읽어 스택·의존성·DB 포트·OpenAPI 사용 여부를 확정한다. 없으면 정본 디폴트 제시 후 사용자 확인.
- **도구 probe**: Context7(ToolSearch 존재) / `docker`·`./gradlew`·`gh`·`pre-commit`·`python3`(bash 시도). 부재 시 산출물은 생성하되 "로컬에서 직접 실행/적용 필요" 안내(아래 degrade).
- 변경 범위가 넓고 순서 의존이 있으므로, 필요 시 `writing-plans` 스킬로 세팅 절차(레포→스캐폴딩→compose→프로파일→훅)에 검증을 붙인 계획을 먼저 만든다.

### 🚦 게이트 — 브랜치 전략·커밋 규약 확정 (AskUserQuestion, 필수)
AskUserQuestion으로 **사람이 정해야 하는 팀 컨벤션**을 제시 → 사용자가 선택/수정. 이 게이트 전에는 Stage 3(형상관리 문서 생성)으로 넘어가지 않는다.
- **브랜치 전략**: ① trunk-based(main + 단기 feature 브랜치·PR 병합 / 잦은 통합·짧은 리뷰 / **AI 권장 디폴트**) ② Git Flow(develop·release·hotfix 분리 / 고정 릴리즈 주기) ③ 직접 입력. → 채택은 팀 리듬(릴리즈 주기·리뷰 문화)에 맞춰 **사람이 결정**, 문서화만 AI가 돕는다.
- **커밋 규약**: ① Conventional Commits(feat/fix/docs/refactor/test/chore) ② 기존 팀 규약 유지 ③ 직접 입력.
- **main 보호 규칙**: PR 필수·상태 체크 통과 후 병합을 권장값으로 둘지(16 CI·CD 상태 체크와 연결).

### Stage 1 — 스캐폴딩 + Gradle 빌드 파일 → 06-1
- Spring Initializr 골격(`type=gradle-project-kotlin`·`javaVersion=21`·`bootVersion=3.3.x`)을 기준으로 `build.gradle.kts`를 완성. 의존성: web, data-jpa, postgresql, validation, security, data-redis, flyway, springdoc-openapi(05 입력 시), QueryDSL(Q타입 생성 설정 포함).
- 패키지 루트 `com.pomit`, layered 패키지(controller/service/domain/repository/config). test: junit5·assertj·mockito·testcontainers. **주의: Testcontainers는 `postgresql` 전용 모듈이 있으나 Redis 전용 모듈은 없다 — Redis는 `GenericContainer("redis:7")`로 띄운다(좌표 `org.testcontainers:redis`를 그대로 넣으면 해석 실패).**
- **의존성 좌표·플러그인 버전은 Context7로 Spring Boot 3.3 기준 최신본 확인**(probe 가용 시). 부재면 내장 지식 + "버전 확인 필요 ⚠️" 표기.
- (가능 환경) `./gradlew build` 실행해 통과 확인. 불가 시 "로컬에서 `./gradlew build`로 검증 필요" 안내. → `06-1_build.gradle.kts.md`

### Stage 2 — 로컬 인프라(docker-compose) → 06-2
- `docker-compose.yml`: postgres:16(DB명·포트 5432·named volume로 영속, 04 입력 반영)·redis:7(6379). 둘 다 `healthcheck`(pg_isready / redis-cli ping)와 `depends_on: condition: service_healthy`. **Redis에 `requirepass`(비밀번호)를 걸면 healthcheck도 `redis-cli -a "$REDIS_PASSWORD" ping`로 인증해야 한다 — 맨 `redis-cli ping`은 NOAUTH로 실패해 영원히 unhealthy.**
- 비밀번호 등 비밀값은 `.env`에서 `${POSTGRES_PASSWORD}`로 읽고, `.env.example`은 키 목록만(Stage 4와 정합).
- (가능 환경) `docker compose up -d` 후 두 컨테이너 healthy 확인. 불가 시 안내. → `06-2_docker-compose.yml`

### Stage 3 — 형상관리 (게이트 확정 반영) → 06-3
- `.gitignore`: Java/Gradle/IDE(.idea)/Docker/`.env`/빌드산출물(`build/`) 커버. **`.env`·시크릿 파일이 절대 커밋되지 않게** 명시.
- 브랜치 전략 문서: 게이트에서 확정한 전략 + 미채택안과의 차이·선택 근거(3줄) + main 보호 규칙 권장값.
- Conventional Commits 가이드: 게이트에서 확정한 규약 + 예시 5개.
- `.pre-commit-config.yaml`: 코드 포맷(spotless or google-java-format) + 시크릿 스캔(gitleaks) + 큰 파일 차단 훅. **`pre-commit install` 필요** 명시.
- (가능 환경) 더미 커밋으로 시크릿 스캔 훅이 실제 차단하는지 확인. 불가 시 안내. → `06-3_브랜치전략커밋규약.md`

### Stage 4 — 프로파일·환경변수 분리(12-Factor) → 06-4
- `application.yml`(공통만) / `application-local.yml`(docker-compose의 PG/Redis=localhost·DDL validate·Flyway enabled·상세 로그) / `application-dev.yml`·`application-prod.yml`(접속·시크릿 전부 `${DB_URL}`·`${DB_PASSWORD}`·`${JWT_SECRET}` 환경변수 치환 — **하드코딩·평문 시크릿 금지**).
- 활성 프로파일은 `SPRING_PROFILES_ACTIVE`로 결정. **필수 환경변수 목록**(외부 주입 키)을 표로 정리 + `.env.example`(키만).
- (가능 환경) `--spring.profiles.active=local` 부팅 확인. 불가 시 안내. → `06-4_프로파일환경변수.md`

### Stage 5 — 마무리(_검증체크리스트 + 보고)
- `_검증체크리스트.md` 생성 + 산출물 폴더 경로 보고. 후속(`gh repo create`·main 보호 규칙 설정은 사람이 실행, 16 CI·CD와 연결) 안내.

## 도구 정확성 (probe·degrade)

- **Context7 MCP**(probe) = `build.gradle.kts` 의존성 좌표·플러그인 버전·QueryDSL/Flyway 최신 표기 확인. 부재 시 내장 지식 + "Spring Boot 3.3 기준 버전 확인 필요 ⚠️".
- **docker / docker compose**(bash probe) = compose 기동·헬스체크 검증. 부재 시 `06-2`는 생성하되 "로컬에서 `docker compose up -d`로 healthy 검증 필요".
- **gradle(`./gradlew`)**(probe) = 빌드 검증. 부재 시 생성하되 빌드 검증 안내.
- **gh CLI**(probe) = 레포 생성·브랜치 보호 규칙(사람 실행 대상). 부재 시 수동 안내.
- **pre-commit**(probe) = 훅 설치·동작 검증. 부재 시 `.pre-commit-config.yaml`만 생성 + "`pre-commit install` 후 더미 커밋으로 차단 확인 필요".
- **python3**(probe) = YAML 파싱(compose·yml) 정합 점검. 부재 시 정적 체크리스트 degrade.
- **중단은 필수 입력(상위 산출물) 부재 시에만** — 그 외는 정본 디폴트/안내로 degrade.

## _검증체크리스트 본문 (Stage 5 생성, `<주제>`/`<날짜>` 치환)

```markdown
# 검증 체크리스트 — <주제> 개발 환경 구축 (작성일: <날짜>)

> 전략은 사람이 정하고, 생성은 AI가 한다. 검증 명령을 실제로 돌려본 뒤에만 "완료".

- [ ] `./gradlew build` 실제 실행해 통과 (생성 완료 ≠ 빌드 성공)
- [ ] 스택 버전이 정본(Java 21 / Spring Boot 3.3 / Gradle Kotlin DSL)과 일치 — AI가 임의 상향 안 했는지
- [ ] 의존성 좌표를 Context7로 SB 3.3 기준 확인 (⚠️ 표기 항목 해소)
- [ ] `docker compose up -d` 후 PG/Redis 둘 다 healthy + `depends_on` 조건 동작
- [ ] application-prod.yml에 평문 시크릿 없음 — `${...}` 환경변수 치환만 (JWT_SECRET·DB 비밀번호 직접 확인)
- [ ] `.env`가 `.gitignore`에 포함 / `.env.example`엔 키만 (값 없음)
- [ ] `--spring.profiles.active=local` 부팅 성공
- [ ] 브랜치 전략은 팀 합의로 채택 (AI 추천을 그대로 확정하지 않았는지)
- [ ] `pre-commit install` 실행 + 더미 커밋으로 gitleaks 훅이 실제 차단하는지 확인
- [ ] 필수 환경변수 목록이 dev/prod 주입 키와 일치
```

## 주의

- **시크릿을 절대 코드·예시에 넣지 않는다** — AI가 자리표시자 대신 그럴듯한 평문 비밀번호를 채우는 경우가 있다. 생성 직후 `${...}` 치환·`.env`의 `.gitignore` 포함을 직접 확인.
- **스택 버전 임의 변경 금지** — AI가 더 최신 Spring Boot나 다른 빌드 도구를 권해도 시리즈 정본을 따른다.
- **브랜치 전략은 팀 합의 사항** — AI 추천이 아니라 팀 리듬에 맞춰 사람이 정한다. 문서화는 AI가 돕되 채택은 합의로.
- **compose 헬스체크 반드시 확인** — "컨테이너가 떴다"와 "DB가 연결을 받는다"는 다르다. healthy 상태와 `depends_on` 조건을 검증.
- **흔한 실수 — 검증 없이 다음 단계로**: `./gradlew build`·`compose up`을 실제로 돌려보지 않고 "완료"로 넘기면 누적 오류를 07 이후에 발견한다.
- **흔한 실수 — pre-commit 미설치**: `.pre-commit-config.yaml`만 만들고 `pre-commit install`을 안 하면 훅이 동작하지 않는다. 더미 커밋으로 실제 차단을 확인.

## 원본 가이드
- 이 스킬은 BE 가이드 **"06. 개발 환경 구축 (서버·형상관리)"**를 자동화한 것입니다.

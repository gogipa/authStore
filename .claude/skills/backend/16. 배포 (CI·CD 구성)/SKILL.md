---
name: be-cicd
description: 개발환경(06)·테스트(13)·보안점검(15)을 받아 GitHub Actions CI/CD 파이프라인·멀티스테이지 Dockerfile·blue-green/카나리 배포 전략·롤백 워크플로우·Flyway 마이그레이션 위험 점검을 일괄 생성한다. "CI/CD","CI 워크플로우","배포 파이프라인","GitHub Actions","Dockerfile","멀티스테이지 빌드","blue-green","blue green","카나리","무중단 배포","롤백","Flyway 마이그레이션 점검","expand-contract","ECR","ECS 배포","파이프라인 실패 진단","deploy pipeline","deployment workflow","multi-stage Dockerfile","canary","rollback","migration risk review" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# 배포 (CI·CD 구성) (Deployment / CI·CD)

코드를 사람 손으로 올리던 일을, 푸시하면 자동으로 빌드·테스트·이미지화·배포까지 흐르는 **파이프라인**으로 굳힌다. 산출물 = ① GitHub Actions CI/CD 워크플로우 ② 멀티스테이지 Dockerfile ③ blue-green/카나리 배포 전략 ④ 롤백 워크플로우 + Flyway 마이그레이션 위험 점검. **AI는 파이프라인을 짜고(YAML·Dockerfile·배포 잡은 정형화), 사람은 "이 변경을 지금 이 방식으로 배포해도 되는가"를 판단한다(마이그레이션 적용·롤백·프로덕션 승인).**

<!-- 변경 포인트 (배포본 → 본인 환경)
  1. 출력 경로: 기본 backend-output/<주제-슬러그>/16_배포/. 본인 볼트 설치본은 BE/실행산출물/<주제>로 고정 가능.
  2. 계승 출처: 상위 산출물(06_개발환경·13_테스트·15_보안점검) 경로를 본인 폴더 구조로.
  3. 배포 타깃: 기본 AWS ECS Fargate + ECR + ALB(blue-green) + RDS PG16 + ElastiCache Redis 7. K8s/EC2면 deploy 잡·전략 교체(헬스체크 골격 동일).
  4. 도구(MCP/CLI): Context7(actions 버전) / gh·docker·python3(검증) — 없으면 degrade. writing-plans·executing-plans로 계획→체크포인트.
  5. 스택 버전: 시리즈 정본(Java 21 / Spring Boot 3.3 / Gradle Kotlin DSL / PostgreSQL 16 / Redis 7 / Flyway). 임의 변경 금지. -->

## 핵심 원칙

- **상위 산출물 계승·재발명 금지**: 06(브랜치 전략·`docker-compose`·12-Factor 환경변수)·13(테스트 태스크명·`integrationTest`)·15(의존성/시크릿 스캔 잡)을 확정본 그대로 파이프라인에 회수한다. 미확정은 ⚠️로 보존 — 브랜치 전략·테스트 게이트·스캔을 새로 발명하지 않는다.
- **파이프라인 작성은 AI, 배포 결정은 사람**: YAML·Dockerfile·배포 잡은 보일러플레이트라 AI 초안이 빠르고 정확하다. 하지만 "이 마이그레이션을 적용/롤백/승인해도 되는가"는 데이터·트래픽 맥락을 아는 사람의 판단이다. AI는 뼈대를 만들고, 사람이 방아쇠를 당긴다.
- **계획을 먼저 세우고 단계로 끊는다**: CI/CD는 단계 의존성이 강해(테스트 게이트, 마이그레이션 선적용) 한 방에 짜면 추적이 어렵다. `writing-plans`로 "CI → Dockerfile → 배포 잡 → 시크릿 → 롤백" 순 계획 합의 후 `executing-plans`로 체크포인트를 둔다.
- **마이그레이션을 배포와 분리한다**: Flyway는 새 컨테이너 배포 "전" 독립 잡으로 분리한다(부팅 시 자동 마이그레이션 금지). 실패 지점이 명확해지고, blue-green 신·구 공존을 고려한 안전한 스키마 변경(expand-contract 분할)을 설계할 여지가 생긴다.
- **시크릿은 코드·이미지 밖**: 빌드용은 GitHub Secrets, 런타임용(DB·TOSS 키·JWT)은 Parameter Store/Secrets Manager로 태스크 정의에서 주입한다(이미지에 굽지 않음 — 12-Factor, 15 시크릿 스캔 연결).
- **롤백 경로를 자동화 안에 미리 박는다**: 수동 트리거(`workflow_dispatch`) 롤백 워크플로우를 평소에 만들어두면, 장애 시 사람은 "되돌린다"는 결정만 한다.
- **액션 버전 핀 고정**: `@latest`·메이저만 잡는 `@v4`는 깨지거나 공급망 공격에 노출된다. SHA 핀 고정 검토(15 보안 연결), 버전은 Context7로 확인.

## 입력

- **필수**: `<루트>/06_개발환경/`(브랜치 전략·`docker-compose`·프로파일/환경변수·`build.gradle.kts` — 파이프라인 기반). 없으면 위치를 묻거나 정본 디폴트(trunk-based + `./gradlew bootJar` + 12-Factor)를 제시하고 사용자 확인 후 진행(중단보다 degrade).
- **권장**:
  - `<루트>/13_테스트/`(테스트 태스크명·`integrationTest`·Testcontainers — CI 배포 차단 게이트로 회수). 없으면 `./gradlew build`(단위) + "통합 테스트 잡은 13 확정 후 보강 ⚠️"로 degrade.
  - `<루트>/15_보안점검/`(의존성 스캔·gitleaks 시크릿 스캔 — CI에 편입). 없으면 스캔 잡은 골격만 + "15 확정 후 임계값·정책 보강 ⚠️".
  - `<루트>/04_데이터베이스/`(Flyway `db/migration` 위치·신규 `V__*.sql` — 마이그레이션 위험 점검 대상). 없으면 위험 점검은 일반 규칙 기반 체크리스트로 degrade.
  - `<루트>/05_API/`(스모크 체크 핵심 엔드포인트).
- 06 외 입력 부재는 degrade(중단 안 함).
  <!-- 변경 포인트(입력 경로): 본인 설치본은 <루트>=BE/실행산출물/<주제>. 상위 산출물이 다른 폴더면 수정 -->

## 출력 위치: `backend-output/<주제-슬러그>/16_배포/`

<!-- 변경 포인트(출력 경로): 본인 볼트 설치본은 BE/실행산출물/<주제>로 고정 가능. 기본은 backend-output/<주제-슬러그>/ -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `16-1_github-actions.yml` | CI(`pull_request`+`main`: JDK21·Gradle 캐시·`build`[·06이 `integrationTest` 태스크를 정의한 경우만 별도 단계]·15 스캔·실패 시 차단) + 배포(`main`: 이미지→ECR→**migrate 잡(배포 전 분리)**→ECS green→ALB 헬스체크→타겟그룹 전환→blue 정리→스모크) + 수동 롤백(`workflow_dispatch`). 런타임 시크릿 Parameter Store 참조·액션 핀 고정 | 1·3·4 |
| `16-2_Dockerfile` | 멀티스테이지(build: `gradle:8-jdk21` bootJar / runtime: `eclipse-temurin:21-jre` 슬림·non-root·jar만·JVM옵션 env·`/actuator/health` HEALTHCHECK) + `.dockerignore` + 로컬 빌드·실행 명령 | 2 |
| `16-3_배포전략.md` | blue-green(ALB 타겟그룹 전환) 단계·헬스체크·롤백 트리거 / 카나리 차이·전환 지점 / 스테이징→프로덕션 게이트 / 스모크 항목 | 3 |
| `16-4_롤백마이그레이션.md` | 롤백 경로(이전 안정 태그→ECS 되돌림→blue 복귀) + Flyway 신규 `V__*.sql` 위험 점검표(DROP·타입변경 / 대용량 락 / 공존 깨짐) + expand-contract 권고. **🔴 적용·롤백 최종 판단은 사람** | 4 |
| `_검증체크리스트.md` | 사람 확인 항목 | 마지막 |

- 출력 폴더가 없으면 생성한다. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`). 워크플로우 파일은 실제 배치 위치(`.github/workflows/ci.yml`·`deploy.yml`)를 상단 주석에 명시한다.

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·계획 수립
- `06_개발환경/`(필수)·`13`·`15`·`04`·`05`(권장)를 읽어 브랜치 전략·테스트 태스크명·스캔 잡·Flyway 위치·스모크 엔드포인트 확정. 06 부재 시 정본 디폴트 제시 후 사용자 확인.
- **도구 probe**: Context7(ToolSearch 존재) / `gh`·`docker`·`python3`(bash 시도). 부재 시 산출물은 생성하되 "로컬/CI에서 직접 실행 필요" 안내.
- 단계 의존성이 강하므로 `writing-plans`로 "CI → Dockerfile → 배포 잡 → 시크릿 → 롤백" 순 계획(단계별 검증 체크포인트)을 먼저 합의하고 `executing-plans`로 진행.

### Stage 1 — CI 워크플로우(빌드·테스트·스캔) → 16-1 (ci.yml 파트)
- 트리거 `pull_request`+`main` push. JDK 21(Temurin)·Gradle 캐시. 테스트 게이트는 **06 빌드 설정의 실제 태스크 구성을 따른다**: 06에 별도 `integrationTest` 소스셋·태스크가 정의돼 있으면 `./gradlew build`(단위) → `integrationTest`(13 Testcontainers PG/Redis) 2단으로, **정의돼 있지 않으면**(통합 테스트가 `@SpringBootTest`로 통합 `test`에 포함된 경우 — 흔함) `./gradlew build` 단일 게이트로 회수하고 "통합·단위 일괄 실행 / 분리하려면 06에 `integrationTest` 소스셋 정의 필요 ⚠️"를 표기. **13 자체가 부재면** 단위만 +⚠️. 테스트/커버리지 아티팩트 업로드.
- **15 연결**: 의존성 스캔(`dependencyCheckAnalyze`)·gitleaks를 CI에 편입(15 임계값 계승, 부재면 골격+⚠️). **⚠️ `dependencyCheckAnalyze`는 06 `build.gradle.kts`에 dependency-check Gradle 플러그인이 추가돼 있어야 동작**한다(없으면 'task not found') — 06/15에서 플러그인 미추가면 "플러그인 추가 후 임계값(failBuildOnCVSS) 확정 ⚠️" 표기. **하나라도 실패하면 잡 실패로 머지·배포 차단** — 13·15가 배포 게이트로 회수되는 지점.
- **actions 버전은 Context7로 핀 고정**(부재면 내장 지식 + "SHA 핀 고정 필요 ⚠️"). 파일 상단에 `.github/workflows/ci.yml` 배치 명시.

### Stage 2 — 멀티스테이지 Dockerfile → 16-2
- build: `gradle:8-jdk21`에서 `./gradlew bootJar`(레이어 캐시). runtime: `eclipse-temurin:21-jre` 슬림·**non-root**. jar만 복사, **JVM 옵션은 env 주입**(이미지에 굽지 않음), `/actuator/health` HEALTHCHECK.
- `.dockerignore`(빌드 캐시·`.git`·테스트 리소스 제외), 06 `docker-compose`와 같은 런타임 베이스. (가능 시) 로컬 빌드·부팅·헬스체크 명령 제공, 불가 시 "직접 검증 필요" 안내.

### Stage 3 — 배포 전략 + 배포 워크플로우(이미지·migrate·deploy) → 16-3 + 16-1 (deploy.yml 파트)
- **16-3**(위 출력 표): blue-green 전환 단계·헬스체크·롤백 트리거 / 카나리(소수 트래픽 선반영) 차이·전환 지점 / 스테이징→프로덕션 게이트 / 스모크는 `/actuator/health`+05 핵심 엔드포인트.
- **16-1 deploy.yml**(`main` push): ① 이미지→ECR 푸시(git sha+latest) ② **migrate 잡**: Flyway를 RDS에 적용(Parameter Store DB 자격증명), 배포 "전"에 돌고 **실패 시 중단** ③ deploy 잡(ECS green→헬스체크→타겟그룹 전환→blue 정리) ④ 스모크.
- 런타임 시크릿은 **06 시크릿 목록을 그대로 계승**(DB 자격증명·`JWT_SECRET`·PII 암호화 키 등 — 결제 PG 키 같은 외부 시크릿은 11 외부연동을 쓰는 서비스에 한함)하여 태스크 정의 **Parameter Store 참조**로 주입(이미지에 굽지 않음). **카나리 전환 지점 주석**. 이 단계는 게이트 전 **표·골격으로 먼저** 제시.

### 🚦 게이트 — 🔴 마이그레이션·롤백 + 프로덕션 배포 승인 확정 (AskUserQuestion, 필수)
AskUserQuestion으로 **운영 판단**을 제시 → 사용자 확정/수정. 이 게이트 전에는 Stage 4·완료 보고로 넘어가지 않는다. **AI는 위험을 경고할 뿐, 적용·롤백·승인 최종 판단은 사람(개발 리드·DBA)이 한다.**
- **마이그레이션 적용 방식**: ① 배포 전 분리 migrate 잡(권장) ② expand-contract 분할(파괴적 변경 시) ③ 보류·사람 검토 후 적용. 위험 항목(DROP·타입변경·대용량 락·공존 깨짐)이 있으면 ③/② 권고.
- **배포 전략 채택**: ① blue-green(권장) ② 카나리 ③ 직접 입력 — 팀 트래픽·인프라에 맞춰 사람 결정.
- **프로덕션 배포 절차**: 스테이징에서 전체 흐름(마이그레이션·blue-green·롤백) 1회 통과 후 프로덕션 — 권장값으로 둘지 확인(첫 실행 사고 방지).

### Stage 4 — 롤백 경로 + 마이그레이션 위험 점검 → 16-4
- **롤백 워크플로우**(16-1 `workflow_dispatch`): 이전 안정 이미지 태그를 입력받아 ECS 되돌림·타겟그룹 blue 복귀.
- **마이그레이션 위험 점검표**(04 신규 `V__*.sql`, 입력 존재 시): 비가역 변경(DROP·타입 변경) / 대용량 락(NOT NULL 추가·인덱스 생성) / blue-green 공존에서 깨지는 변경. 위험 항목은 "사람 검토 필요 / expand-contract 분할 권고". 04 부재면 일반 규칙 체크리스트 degrade(⚠️ "실제 SQL 대조 필요").
- **🔴 명시**: 적용·롤백 최종 판단은 사람(개발 리드·DBA)임을 리포트 상단에 강제 표기 — 롤백은 코드만, 데이터는 안 돌아옴.

### Stage 5 — 마무리(_검증체크리스트 + 보고)
- `_검증체크리스트.md` 생성 + 산출물 경로 보고. 후속(`gh secret set`·`gh run watch`·스테이징 통과 후 프로덕션 승인은 사람이 실행, 17 인프라 연결) 안내. 🔴/마이그레이션 잔존 위험 시 ⚠️ 표기, "완료" 보고 금지.

## 도구 정확성 (probe·degrade)

- **Context7 MCP**(probe) = `actions/setup-java`·`docker/build-push-action`·ECS 배포 액션·Flyway 플러그인 등 최신 버전·문법 확인. 부재 시 내장 지식 + "버전 확인·SHA 핀 고정 필요 ⚠️".
- **gh CLI**(bash probe) = 시크릿 등록(`gh secret set`)·실행 관찰(`gh run watch`)은 **사람이 실행**하는 후속(시크릿 실제 값은 AI가 다루지 않음). 부재 시 수동 안내.
- **docker**(probe) = 로컬 멀티스테이지 빌드·헬스체크 검증. 부재 시 `16-2`는 생성하되 "로컬 `docker build`→`run` 검증 필요".
- **python3**(probe) = YAML(`16-1`) `yaml.safe_load` 정합 점검. 부재 시 정적 체크리스트 degrade(들여쓰기·필수 키·핀 고정 점검).
- **writing-plans / executing-plans 스킬** = 다단계·순서 의존 파이프라인을 계획→체크포인트로 진행(Stage 0).
- **중단은 필수 입력(06) 부재 시에만** — 그 외(13·15·04·05·도구)는 정본 디폴트/⚠️로 degrade.

## _검증체크리스트 본문 (Stage 5 생성, `<주제>`/`<날짜>` 치환)

```markdown
# 검증 체크리스트 — <주제> 배포 (CI·CD 구성) (작성일: <날짜>)

> 파이프라인 작성은 AI, 배포 결정은 사람. 마이그레이션·롤백·프로덕션 승인은 사람의 일이다.

- [ ] 🔴 이번 릴리즈 Flyway 마이그레이션을 개발 리드·DBA가 검토(DROP·타입변경·대용량 락·blue-green 공존 깨짐) — AI 점검은 경고일 뿐
- [ ] 🔴 마이그레이션을 배포 "전" 별도 migrate 잡으로 분리 / 부팅 시 자동 마이그레이션 아님
- [ ] 🔴 프로덕션 배포 전 스테이징에서 전체 흐름(마이그레이션·blue-green·롤백) 1회 통과 — 프로덕션 첫 실행 금지
- [ ] 테스트 게이트 동작: `./gradlew build`·`integrationTest` 실패 시 머지·배포가 실제로 차단되는지 (13 회수)
- [ ] 15 스캔(의존성·gitleaks)이 CI에 편입돼 실패 시 후속 차단
- [ ] 런타임 시크릿(06 시크릿 목록 — DB·JWT·PII 암호화 키 등, 결제 PG 키는 해당 서비스만)이 이미지에 없음 — 태스크 정의에서 Parameter Store 참조만
- [ ] AI가 만든 IAM 액션·시크릿 이름이 실제 ECR/ECS 최소 권한·Parameter Store 경로와 일치 (AI는 그럴듯한 이름을 지어냄)
- [ ] 액션 버전 핀 고정 (`@latest`·메이저만 아님 / SHA 핀 검토) — Context7 ⚠️ 항목 해소
- [ ] Dockerfile: non-root 실행 + jar만 복사 + `/actuator/health` HEALTHCHECK / 로컬 빌드·부팅 확인
- [ ] 배포 잡 마지막 스모크 체크(`/actuator/health`+핵심 엔드포인트) — "배포 성공"과 "앱 동작"은 다름
- [ ] 롤백 워크플로우(`workflow_dispatch`)가 이전 안정 태그로 되돌리고 타겟그룹 blue 복귀 — 롤백은 코드만, 데이터는 안 돌아옴
```

## 주의

- **마이그레이션·롤백은 반드시 사람이 검토·결정한다** — Flyway는 데이터에 비가역 변경을 가하고, 롤백이 코드만 되돌린다고 데이터는 안 돌아온다. AI 점검은 경고일 뿐, 최종 판단은 개발 리드·DBA.
- **blue-green에서 신·구 버전이 잠깐 공존한다** — 컬럼 삭제·이름 변경 같은 파괴적 스키마 변경을 한 번에 하면 전환 중 한쪽이 깨진다. expand-contract로 나누고, 이 설계는 사람이 한다.
- **AI가 만든 워크플로우의 권한·시크릿을 검증한다** — AI는 그럴듯한 IAM 액션·시크릿 이름을 지어낸다. ECR 푸시·ECS 배포 최소 권한이 실제 부여됐는지, 시크릿 이름이 Parameter Store 실제 경로와 맞는지 직접 확인(액션 버전도 SHA 핀 고정, 15 보안 연결).
- **흔한 실수 — 프로덕션 첫 실행**: 스테이징 없이 바로 프로덕션에 걸어 첫 실행에서 사고. 스테이징에서 전체 흐름을 한 번 통과시킨 뒤 프로덕션에 건다.
- **흔한 실수 — 스모크 테스트 생략**: 배포는 성공했는데 앱 동작 확인 안 함. 헬스체크+핵심 엔드포인트 스모크를 배포 잡 마지막에 넣어 죽은 배포를 거른다.
- **스택 버전 임의 변경 금지** — 시리즈 정본(Java 21 / Spring Boot 3.3 / Gradle Kotlin DSL).

## 원본 가이드
- 이 스킬은 BE 가이드 **"16. 배포 (CI·CD 구성)"**를 자동화한 것입니다.

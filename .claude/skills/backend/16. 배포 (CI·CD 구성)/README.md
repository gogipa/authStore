# be-cicd — 배포 (CI·CD 구성) 자동화 스킬

개발환경(06)·테스트(13)·보안점검(15)을 받아 푸시하면 자동으로 빌드·테스트·이미지화·배포까지 흐르는 **파이프라인**을 일괄 생성하는 Claude Code 스킬입니다. GitHub Actions CI/CD 워크플로우·멀티스테이지 Dockerfile·blue-green/카나리 배포 전략·롤백 워크플로우·Flyway 마이그레이션 위험 점검을 만듭니다. 사람은 **🔴 마이그레이션·롤백·프로덕션 배포 승인 확정 1번**에 개입합니다.

> BE 프로세스 16단계 "16. 배포 (CI·CD 구성)"을 자동화합니다.
> 역할 분담: 파이프라인 작성은 AI, 배포 결정(마이그레이션 적용·롤백·승인)은 사람.

## 무엇을 만들어 주나

`backend-output/<주제>/16_배포/`에 생성:

| 파일 | 내용 |
|---|---|
| `16-1_github-actions.yml` | CI(`pull_request`+`main`: JDK21·Gradle 캐시·`build`[·06이 `integrationTest` 태스크를 정의한 경우만 별도 단계]·15 스캔·실패 시 차단) + 배포(`main`: 이미지→ECR→**배포 전 분리 migrate 잡**→ECS green→ALB 헬스체크→타겟그룹 전환→blue 정리→스모크) + 수동 롤백(`workflow_dispatch`). 런타임 시크릿 Parameter Store 참조·액션 핀 고정 |
| `16-2_Dockerfile` | 멀티스테이지(build: `gradle:8-jdk21` bootJar / runtime: `eclipse-temurin:21-jre` 슬림·non-root·HEALTHCHECK) + `.dockerignore` + 로컬 빌드·실행 확인 명령 |
| `16-3_배포전략.md` | blue-green(타겟그룹 전환)·헬스체크·롤백 트리거 / 카나리 차이·전환 지점 / 스테이징→프로덕션 게이트 / 스모크 체크 항목 |
| `16-4_롤백마이그레이션.md` | 롤백 경로(이전 안정 태그→ECS 되돌림→blue 복귀) + Flyway 위험 점검표(DROP·타입변경·대용량 락·공존 깨짐) + expand-contract 권고. **🔴 적용·롤백 최종 판단은 사람** |
| `_검증체크리스트.md` | 사람이 확인할 항목 |

## 준비물 (입력)

1. **(필수) 06 개발환경** — `backend-output/<주제>/06_개발환경/`의 브랜치 전략·`docker-compose`·프로파일/환경변수·`build.gradle.kts`. 없으면 정본 디폴트(trunk-based + `bootJar` + 12-Factor)를 제시하고 확인 후 진행.
2. **(연결) 13 테스트** — 테스트 태스크 구성·Testcontainers를 CI 배포 차단 게이트로 회수. 06이 `integrationTest` 소스셋·태스크를 정의했으면 별도 단계, 아니면 통합 `build`로 일괄(통합 테스트가 `@SpringBootTest`에 포함된 경우 — 흔함). 없으면 단위 테스트만 + ⚠️.
3. **(연결) 15 보안점검** — 의존성 스캔·gitleaks를 CI에 편입. `dependencyCheckAnalyze`는 06 빌드에 dependency-check 플러그인이 있어야 동작(없으면 플러그인 추가 후 임계값 확정 ⚠️). 없으면 골격만 + ⚠️.
4. **(연결) 04 데이터베이스 / 05 API** — Flyway `db/migration` 위험 점검 / 스모크 체크 핵심 엔드포인트.

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| Context7 MCP | 선택 | 내장 지식으로 워크플로우 작성 + "actions 버전 확인·SHA 핀 고정 필요 ⚠️" |
| gh CLI | 선택 | 시크릿 등록·실행 관찰은 사람이 수동 실행(실제 시크릿 값은 AI가 안 다룸) |
| docker / docker compose | 선택 | `16-2`는 생성, "로컬에서 `docker build`→`docker run`으로 헬스체크 검증 필요" 안내 |
| python3 | 선택 | YAML 정합 점검을 정적 체크리스트로 degrade |
| writing-plans / executing-plans 스킬 | 권장 | 다단계 파이프라인을 계획→체크포인트로 진행 |

## 설치

```bash
mkdir -p ~/.claude/skills/be-cicd
cp SKILL.md ~/.claude/skills/be-cicd/SKILL.md
```

## 사용법

06 개발환경이 확정된 뒤:

```
pomit 백엔드 CI/CD 파이프라인 구성해줘
```

1. 입력 확인·도구 probe → (writing-plans로 "CI→Dockerfile→배포 잡→시크릿→롤백" 계획)
2. CI 워크플로우(빌드·테스트·스캔) → 멀티스테이지 Dockerfile → 배포 전략·배포 워크플로우(이미지·migrate·deploy) 자동 생성
3. **🔴 마이그레이션·롤백 + 프로덕션 배포 승인 확정** → 당신이 결정 (유일한 개입)
4. 롤백 워크플로우 + 마이그레이션 위험 점검 생성 → 검증 체크리스트

발동 키워드: `CI/CD`, `배포 파이프라인`, `GitHub Actions`, `Dockerfile`, `멀티스테이지`, `blue-green`, `카나리`, `무중단 배포`, `롤백`, `Flyway 마이그레이션 점검`, `deploy pipeline`, `canary`, `migration risk review`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `backend-output/`를 본인 볼트 경로(BE/실행산출물/<주제>)로 |
| 계승 출처 | `## 입력` | 06/13/15/04/05 상위 산출물 경로를 본인 폴더 구조로 |
| 배포 타깃 | frontmatter 변경포인트 주석 + Stage 3 | ECS Fargate를 K8s/EC2로 교체(전략·헬스체크 골격은 동일) |
| 배포 전략 기본값 | `### 🚦 게이트` | blue-green 디폴트를 팀 트래픽·인프라에 맞게 |
| 스택 버전 | frontmatter 변경포인트 주석 | 정본(Java 21/SB 3.3)을 팀 정본으로 (임의 상향 주의) |
| 도구(MCP/CLI) | `## 도구 정확성` | Context7·gh·docker 미사용 시 degrade 조정 |

## 주의

- **마이그레이션·롤백은 반드시 사람이 검토·결정합니다** — AI 위험 점검은 경고일 뿐, 적용·롤백 최종 판단은 개발 리드·DBA. 롤백은 코드만 되돌리고 데이터는 안 돌아옵니다.
- **blue-green 신·구 공존** — 파괴적 스키마 변경(DROP·이름 변경)을 한 번에 하면 전환 중 깨집니다. expand-contract 분할 적용은 사람이 설계.
- **AI가 만든 권한·시크릿을 검증하세요** — 그럴듯한 IAM 액션·시크릿 이름을 지어냅니다. 최소 권한·Parameter Store 실제 경로를 직접 확인.
- **액션 버전 핀 고정** — `@latest`·메이저만은 깨지거나 공급망 공격에 노출. SHA 핀 검토(15 연결).
- **프로덕션 첫 실행·스모크 생략 금지** — 스테이징에서 전체 흐름을 통과시킨 뒤 프로덕션에 걸고, 배포 잡 마지막에 스모크 체크.

## 원본 가이드

이 스킬은 BE 가이드 **"16. 배포 (CI·CD 구성)"**을 자동화한 것입니다.

---
name: be-infra-operations
description: >-
  16 배포 산출물을 받아 포밋 백엔드의 AWS 인프라를 Terraform(IaC)으로 코드화하고
  오토스케일·헬스체크·백업복구·런북·비용점검을 만든다. plan까지만 AI, apply는 사람.
  "인프라 운영", "IaC", "Terraform", "오토스케일링", "헬스체크", "백업 복구", "런북",
  "VPC ECS RDS", "불변 인프라", "비용 점검", "infra operations", "IaC", "Terraform",
  "autoscaling", "runbook", "backup restore", "immutable infrastructure" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# 서버 인프라 운영 (Infra Operations)

포밋 백엔드가 올라갈 AWS 인프라(VPC·ECS Fargate·RDS·ElastiCache·ALB·S3)를 **Terraform 코드(IaC)**로
정의하고, 오토스케일·무중단 배포·백업복구·런북·비용 점검까지의 초안을 만든다. 산출물 = Terraform 모듈
초안 + 운영 정책 + 런북 + 비용 리포트. **AI는 `plan`까지의 HCL·문서 초안, `apply`·비용·보안그룹·IAM
승인은 사람**(불변 인프라 원칙: 서버를 손으로 고치지 않고 코드 diff로 바꾼다).

<!-- ───────────────────────────────────────────────────────────────
변경 포인트 (배포본 → 본인 환경에 맞게 수정)
  1. 출력 경로: 기본 backend-output/<주제-슬러그>/17_인프라/. 본인 볼트 설치본은 BE/실행산출물/<주제>로 고정 가능.
  2. 계승 출처: 16_배포·03_아키텍처 경로를 본인 폴더 구조로 수정.
  3. 도구: Context7(Terraform AWS Provider 스키마)·deep-research(Well-Architected)·Figma generate_diagram(토폴로지)·terraform/aws CLI. 없으면 degrade.
  4. 스택/리전: Java21·SpringBoot3.3 / AWS ap-northeast-2 가정. 다른 리전·계정 체계면 tfvars로 교체.
──────────────────────────────────────────────────────────────── -->

## 핵심 원칙
- **상위 산출물 계승·재발명 금지**(확정 상태일 때만 계승, 미확정은 ⚠️ 보존). 03 아키텍처의 토폴로지·자원
  목록과 16 배포의 이미지 태그 주입 방식을 그대로 잇는다 — 인프라를 새로 상상하지 않는다.
- **`plan`까지는 AI, `apply`는 사람.** AI는 변경 초안·plan 요약·비용 점검까지. apply는 실제 돈·자원
  생성/삭제이며 잘못 연 포트·과다 IAM은 즉시 사고. **AI에게 apply/destroy를 위임하지 않는다.**
- **불변 인프라**: 떠 있는 서버에 SSH로 고치지 않는다. 변경은 코드 diff → 새 이미지·새 태스크 교체.
- **시크릿은 코드·tfvars·state에 넣지 않는다**: DB 비밀번호·JWT 키는 Secrets Manager/SSM 참조. state도
  민감하므로 S3 암호화 + DynamoDB 잠금.
- **보안그룹·IAM은 최소 권한**: AI가 만든 규칙은 넓게 여는 경향(`0.0.0.0/0`). 인바운드·IAM은 사람이 좁힌다.
- **런북은 평시에 쓴다**: 코드가 진실이므로 복구 절차를 코드에서 거꾸로 도출해 평시에 박아둔다.

## 입력
- **필수**: `<루트>/16_배포/`(원천 — 16-1 github-actions.yml·16-2 Dockerfile·16-3 배포전략·16-4 롤백마이그레이션).
  16의 이미지 빌드·배포 방식과 인프라가 충돌하지 않아야 한다. 없으면 **중단**(또는 16 산출물 위치 질의).
  <!-- 변경 포인트(입력 경로): 본인 설치본은 <루트>=BE/실행산출물/<주제-슬러그>. -->
- **권장**: `<루트>/03_아키텍처/`(토폴로지·자원 목록 정본) / `<루트>/02_기술스택/`(DB·인프라 ADR) /
  `<루트>/14_관측성/`(메트릭·헬스체크 경로 정합). 없으면 03 자원 목록을 사용자에게 확인하고 진행.

## 출력 위치: `backend-output/<주제-슬러그>/17_인프라/`
| 파일 | 내용 | 생성 stage |
|---|---|---|
| `17-0_AWS베스트프랙티스조사.md` | VPC 서브넷 분리·Fargate 오토스케일·RDS 백업/PITR·Redis 함정·SG/IAM 최소권한 권장(deep-research 출처·부재 시 ⚠️). 17-1~17-5를 받쳐주는 근거 문서 | Stage 1 |
| `17-1_terraform초안.md` | VPC/ECS/RDS/ElastiCache/ALB/S3 모듈 HCL 초안(environments stage·prod + modules 구조, remote state S3+DynamoDB, Secrets Manager 참조). **보안그룹·IAM은 "🔴 사람 검토 필요" 주석** | Stage 2 |
| `17-2_오토스케일헬스체크.md` | Application Auto Scaling 타깃추적(CPU 타깃·min/max — `{{운영 합의}}`), ECS rolling update(minHealthy/maxPercent), ALB 헬스체크 경로(`/actuator/health`)·deregistration delay, 16과 충돌 안 나게 `lifecycle ignore_changes(image)` 주석 | Stage 3 |
| `17-3_백업복구.md` | RDS 자동백업 보존·PITR·Multi-AZ 설정 + 복구 절차(전제→명령→확인→실패시), 분기 1회 복구 리허설 안내 | Stage 4 |
| `17-4_런북.md` | RDS 복구·ECS 롤백·오토스케일 수동개입·헬스체크 실패 대응 + 에스컬레이션(`{{온콜}}` placeholder). 18 장애대응이 그대로 인용 | Stage 4 |
| `17-5_비용점검.md` | plan 자원 목록 → 월 예상비용(대략치)·비용 큰 순(NAT GW·Multi-AZ·ALB 강조)·과다자원 후보·절감옵션(제안만) | Stage 5 |
| `_검증체크리스트.md` | 사람 확인 항목(apply 전 게이트) | Stage 6 |

> 17-0은 근거 문서(deep-research 결과·출처)다. deep-research/Context7 둘 다 부재 시 내장 지식 + "버전·출처 확인 필요 ⚠️" 표기로 degrade(중단하지 않음).

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- 16_배포 필수 로드(없으면 중단). 03 아키텍처·02 스택 ADR 로드(있으면). 자원 목록·리전·계정 가정 확정.
- **도구 probe**: Context7(ToolSearch 존재) / deep-research 스킬 / Figma generate_diagram(ToolSearch 존재) /
  `terraform -version`·`aws sts get-caller-identity` bash 시도. 없으면 아래 degrade.
- 16 이미지 주입 방식(태스크 정의 등록)을 확인해 Stage 3 `ignore_changes` 설계에 반영.

### Stage 1 — AWS 베스트프랙티스 조사 → 17-0
- deep-research(있으면)로 최신 권장 설정을 **출처와 함께** 조사: VPC 서브넷 분리(public/private/isolated),
  ECS Fargate 오토스케일 정책(타깃추적 vs 단계), RDS PostgreSQL 16 백업 보존·PITR·Multi-AZ, ElastiCache
  Redis 7 함정, 보안그룹·IAM 최소권한 체크리스트.
- **근거 없는 권장 금지** — 출처 링크 필수. deep-research 부재 시 내장 지식 + "버전 확인 필요 ⚠️" 표기.

### 🚦 게이트 ① — 인프라 자원·환경 차등·비용 가정 확정 (AskUserQuestion, 필수)
AskUserQuestion(AI 추천 1안) — **다음 Stage(HCL 작성) 전에 반드시**:
- 대상 자원 목록·AZ 수·환경(stage/prod) 차등(NAT GW·Multi-AZ를 stage에도 켤지)
- 오토스케일 임계값 후보(CPU 타깃·min/max) — 잠정값임을 명시
- 리전·계정·도메인(ACM 인증서) 가정
확정 전에는 Stage 2로 넘어가지 않는다(가이드 "단계별 검토" 원칙).

### Stage 2 — Terraform 모듈 초안 → 17-1
- 03 토폴로지 + 17-0 조사를 입력으로 HCL 작성: `environments/(stage,prod)` + `modules/(network,ecs,rds,redis,alb,s3)`,
  `variables.tf` 분리·환경별 `*.tfvars`, remote state `backend`(S3 + DynamoDB 잠금).
- VPC: public(ALB)·private(ECS)·isolated(RDS/Redis) 2 AZ. ALB + HTTPS 리스너(ACM 참조)·타깃그룹(헬스체크
  `/actuator/health`). ECS Fargate 클러스터·서비스·태스크정의. RDS PostgreSQL 16(Multi-AZ·자동백업·storage 암호화).
  ElastiCache Redis 7. S3(버저닝·암호화).
- **16 배포 방식과 정합**: 16이 CodeDeploy blue-green이면 ECS 서비스 `deployment_controller=CODE_DEPLOY` + **blue/green 타깃그룹 2개** + `aws_codedeploy_app`/`aws_codedeploy_deployment_group`/appspec이 추가로 필요하다. 16-1·16-3을 읽고 단일 타깃그룹·rolling로 잘못 그리지 않게 정합을 잇는다(16이 rolling이면 minHealthy/maxPercent로). 미정합 위험은 🔴/⚠️로 보존.
- **시크릿(DB 비밀번호·JWT 키)은 코드 금지 → Secrets Manager 참조.**
- **보안그룹 규칙·IAM 정책은 별도 주석 "🔴 사람 검토 필요(최소권한)"** 로 표시. `0.0.0.0/0` 자동 사용 금지.
- **Terraform AWS Provider 리소스 인자는 Context7로 최신 스키마 대조**(deprecated 인자 차단). 부재 시 ⚠️.

### Stage 3 — 오토스케일·무중단 배포·헬스체크 → 17-2
- Application Auto Scaling 타깃추적(CPU 타깃·min/max — 게이트 확정값, 미확정이면 `{{운영 합의 필요}}`).
- ECS rolling update(minimumHealthyPercent/maximumPercent), ALB 헬스체크 통과 후에만 구버전 종료(deregistration delay).
- **16 배포가 새 태스크정의를 등록하는 방식과 충돌 안 나게 `lifecycle ignore_changes(image 태그)` 주석 안내.**
- plan 결과를 사람이 읽을 변경 요약으로 함께 정리.

### Stage 4 — 백업·복구 + 런북 → 17-3, 17-4
- 17-3: RDS 자동백업 보존기간·PITR·Multi-AZ 설정 코드 + 복구 절차. 분기 1회 stage 복구 리허설 권장 명시.
- 17-4: 위 코드를 근거로 절차형 런북 — ① RDS PITR 복구(aws rds restore-db-instance-to-point-in-time) ② ECS
  직전 리비전 롤백 ③ 오토스케일 max 임시 상향 ④ 헬스체크 unhealthy 대응(로그→태스크 상태→DB 연결).
  각 절차 **"전제 → 명령 → 확인 방법 → 실패 시"** 형식. 비상연락망은 `{{온콜}}` placeholder.
- **18 장애대응이 명령을 그대로 인용**하므로 명령을 정확히 쓴다(추정 명령 금지·⚠️ 표기).

### Stage 5 — 비용 점검 + 토폴로지 다이어그램 → 17-5
- plan 자원 목록 → 자원별 월 예상비용(온디맨드 대략치)·비용 큰 순 표. NAT GW·Multi-AZ·ALB 고정비 강조.
  "정말 prod에 필요한가" 과다자원 후보 표시. 절감옵션(Savings Plans·Fargate Spot)은 **제안만**.
- **단가 degrade**: deep-research/aws CLI(또는 Pricing API) 부재 시 단가는 내장 지식 **대략치 `≈` + `{{단가 확인}}`** 표기, "AWS Pricing Calculator로 리전·실사양 입력해 사람이 확정" 고지. 근거 없는 확정 비용 금지.
- 토폴로지(VPC·서브넷·자원 배치)를 **Figma generate_diagram**(있으면) FigJam 공유본. 부재 시 **Mermaid 폴백**.

### Stage 6 — 마무리(_검증체크리스트 + 경로 보고)
- `_검증체크리스트.md` 생성(아래 본문) + 산출물 폴더 경로 보고.
- **완료 보고에 "plan/비용/보안그룹/IAM은 사람 검토 후 사람이 apply" 고지를 반드시 포함.** 🔴 미해소 항목
  잔존 시 ⚠️ 표기하고 "apply 가능" 표현 금지.

### 🔴 게이트 ② — apply·비용·보안그룹·IAM 사람 승인 (Stage 6 직후, 필수)
**AI는 plan까지의 초안만 만든다. `apply`는 사람이 누른다.** 스킬이 산출물(17-1~17-5)을 다 만든 뒤,
다음을 사람이 검토·승인하기 전에는 "apply 가능"이라고 보고하지 않는다(🔴 미해소 시 ⚠️ 표기):
- plan diff 한 줄씩 검토(destroy·RDS 교체 등 데이터 손실 변경 식별)
- 비용 리포트(고정비 큰 항목·과다자원) 의사결정
- 보안그룹 인바운드 `0.0.0.0/0` 제거·IAM 최소권한 확인
- 시크릿이 코드·tfvars·state에 없음(Secrets Manager/SSM) + state S3 암호화·DynamoDB 잠금
AskUserQuestion으로 "사람이 plan/비용/보안그룹/IAM을 검토·승인했는가"를 확인하고, 승인 전에는
스킬이 `terraform apply`/`destroy`를 대신 실행하지 않는다.

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe) = Terraform AWS Provider·ECS·RDS 리소스 인자 최신 스키마. 부재 → 내장 지식 +
  "deprecated 인자 가능 ⚠️, 적용 전 provider 문서 대조" 표기.
- **deep-research 스킬**(probe) = AWS Well-Architected·Fargate 운영·RDS 백업 베스트프랙티스 출처 조사. 부재 →
  내장 지식 + 출처 미확보 ⚠️.
- **Figma MCP generate_diagram**(probe) = 토폴로지 FigJam 공유본. 부재 → **Mermaid 폴백**.
- **terraform / aws CLI**(bash probe) = `init`/`plan`·자원 조회. 부재 → HCL·문서는 생성하되 "로컬에서 직접
  `terraform plan` 실행 필요" 안내(스킬은 apply/plan을 대신 실행하지 않는다).
- **중단**: 16_배포(원천) 부재 시에만. 그 외(03 부재·CLI 부재 등)는 degrade로 진행.

## _검증체크리스트 본문 (Stage 6 생성)
```markdown
# 검증 체크리스트 — <주제> 서버 인프라 운영 (작성일: <날짜>)

> 🔴 apply는 사람이 누른다. AI 산출물은 plan까지의 초안이다.

- [ ] plan diff를 사람이 한 줄씩 검토 (destroy·RDS 교체 등 데이터 손실 변경 식별)
- [ ] 보안그룹 인바운드 규칙 최소권한으로 좁힘 (0.0.0.0/0 잔존 없음)
- [ ] IAM 정책 최소권한 확인 (과다 권한 없음)
- [ ] 시크릿이 코드·tfvars·state에 없음 (Secrets Manager/SSM 참조) + state S3 암호화·DynamoDB 잠금
- [ ] 환경별 차등 확인 (stage가 prod처럼 NAT GW·Multi-AZ 켜서 비용 새지 않는지 tfvars 점검)
- [ ] Terraform AWS Provider 리소스 인자 deprecated 여부 Context7/provider 문서 대조
- [ ] 비용 리포트 검토 — 고정비 큰 항목·과다자원 후보 의사결정
- [ ] 런북 복구 명령 정확성 + 분기 1회 stage 복구 리허설 계획
- [ ] 오토스케일 임계값(CPU·min/max) 운영 합의 확정 (`{{운영 합의}}` 해소)
- [ ] 16 배포(이미지 태그 주입)와 ignore_changes 충돌 없음 확인
```

## 주의
- **`terraform apply`는 사람이 누른다** — AI에게 apply/destroy 위임 금지. RDS 교체·destroy는 데이터 손실 직결.
- **보안그룹·IAM은 최소권한, 사람 검토 필수** — AI 생성 규칙은 넓게 여는 경향(`0.0.0.0/0`).
- **시크릿을 코드·tfvars·state에 넣지 마라** — Secrets Manager/SSM 참조. state도 S3 암호화·접근 제한.
- **state 잠금 없이 동시 apply 금지** — S3 + DynamoDB 잠금. 잠금 없이 둘이 apply하면 state가 깨진다.
- **AI 리소스 인자가 옛 버전일 수 있다** — Terraform AWS Provider는 자주 바뀜, Context7로 대조.
- **흔한 실수** — ① stage에 prod처럼 NAT GW·Multi-AZ 켜서 비용 새기(환경별 tfvars 차등). ② 런북만 써두고
  복구 리허설을 안 해서 사고 때 명령이 안 먹히기(분기 1회 stage 스냅샷 복구 실행).

## 원본 가이드
- 이 스킬은 BE 가이드 **"17. 서버 인프라 운영"**을 자동화한 것입니다.

# be-infra-operations — 서버 인프라 운영 자동화 스킬

16 배포 산출물을 받아 포밋 백엔드의 AWS 인프라(VPC·ECS Fargate·RDS·ElastiCache·ALB·S3)를
**Terraform 코드(IaC)**로 정의하고, 오토스케일·무중단 배포·백업복구·런북·비용 점검의 초안을
만드는 Claude Code 스킬입니다. **AI는 `plan`까지의 초안, `apply`·비용·보안그룹·IAM 승인은 사람**입니다.

> BE 프로세스 17단계 "서버 인프라 운영"을 자동화합니다.
> 역할 분담: AI는 HCL 보일러플레이트·문서 초안, 인프라 변경 승인은 사람(불변 인프라 원칙).

## 무엇을 만들어 주나

`backend-output/<주제>/17_인프라/`에 생성:

| 파일 | 내용 |
|---|---|
| `17-1_terraform초안.md` | VPC/ECS/RDS/ElastiCache/ALB/S3 모듈 HCL 초안(stage·prod + modules 구조, remote state S3+DynamoDB, Secrets Manager 참조). 보안그룹·IAM은 "🔴 사람 검토" 주석 |
| `17-2_오토스케일헬스체크.md` | 오토스케일 타깃추적(CPU·min/max), ECS rolling update, ALB 헬스체크(`/actuator/health`), 16과 충돌 안 나게 `ignore_changes(image)` 주석 |
| `17-3_백업복구.md` | RDS 자동백업·PITR·Multi-AZ 설정 + 복구 절차(전제→명령→확인→실패시) |
| `17-4_런북.md` | RDS 복구·ECS 롤백·오토스케일 수동개입·헬스체크 실패 대응 + 에스컬레이션(`{{온콜}}`). 18 장애대응이 인용 |
| `17-5_비용점검.md` | 월 예상비용·비용 큰 순(NAT GW·Multi-AZ·ALB 강조)·과다자원 후보·절감옵션 제안 |
| `_검증체크리스트.md` | apply 전 사람 확인 항목 |

> 부수 산출물: `17-0_AWS베스트프랙티스조사.md`(deep-research 출처 조사 근거 문서).

## 준비물 (입력)

1. **(필수) 16 배포** — `backend-output/<주제>/16_배포/`(github-actions.yml·Dockerfile·배포전략·롤백마이그레이션).
   인프라와 배포 방식(이미지 태그 주입)이 충돌하지 않게 잇습니다. 없으면 중단.
2. **(연결) 03 아키텍처·02 스택** — `03_아키텍처/`(토폴로지·자원 목록 정본), `02_기술스택/`(인프라 ADR).
   없으면 자원 목록을 확인하고 진행.

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| Context7 MCP | 선택 | 내장 지식 + "provider 문서 대조 ⚠️" |
| deep-research 스킬 | 선택 | 내장 지식 + 출처 미확보 ⚠️ |
| Figma MCP | 선택 | 토폴로지 Mermaid 폴백 |
| terraform / aws CLI | 선택 | HCL·문서는 생성, plan은 로컬에서 직접 실행 안내 |

## 설치

```bash
mkdir -p ~/.claude/skills/be-infra-operations
cp SKILL.md ~/.claude/skills/be-infra-operations/SKILL.md
```

## 사용법

16 배포 산출물을 준비한 뒤:

```
16 배포 산출물 보고 포밋 인프라를 Terraform으로 코드화해줘
```

1. AWS 베스트프랙티스 조사(deep-research) → 17-0 근거 문서
2. **🚦 인프라 자원·환경 차등·비용 가정 확정** → 당신이 OK (사람 개입 — HCL 작성 전)
3. Terraform 모듈 → 오토스케일/헬스체크 → 백업복구/런북 → 비용/토폴로지 자동
4. 이후 **plan·비용·보안그룹·IAM을 사람이 검토하고, 사람이 직접 `apply`** (AI는 여기까지 관여 안 함)

발동 키워드: `인프라 운영`, `IaC`, `Terraform`, `오토스케일링`, `런북`, `백업 복구`, `infra operations`, `runbook`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `backend-output/`를 본인 볼트 경로로 |
| 계승 출처 | `## 입력` | 16_배포·03_아키텍처 경로를 본인 폴더 구조로 |
| 도구 | `## 도구 정확성` | Context7/deep-research/Figma/CLI 미사용 시 degrade |
| 리전·계정·스택 | 상단 변경 포인트 주석 | ap-northeast-2·Java21/SpringBoot3.3 가정을 tfvars로 교체 |

## 주의

- **`terraform apply`는 사람이 누릅니다.** AI에게 apply/destroy 위임 금지 — RDS 교체·destroy는 데이터 손실 직결.
- **보안그룹·IAM은 최소권한, 사람 검토 필수** — AI 생성 규칙은 넓게 여는 경향(`0.0.0.0/0`).
- **시크릿을 코드·tfvars·state에 넣지 마라** — Secrets Manager/SSM 참조, state도 S3 암호화·DynamoDB 잠금.
- **AI 리소스 인자가 옛 버전일 수 있다** — Terraform AWS Provider는 자주 바뀜, Context7로 대조.
- **런북은 평시에 검증** — 분기 1회 stage 복구 리허설을 안 하면 사고 때 명령이 안 먹힙니다.

## 원본 가이드

이 스킬은 BE 가이드 **"17. 서버 인프라 운영"**을 자동화한 것입니다.

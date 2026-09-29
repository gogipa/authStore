# be-api-design — API 설계 (명세 정의) 자동화 스킬

기능명세와 04 ERD를 넣으면 **코드보다 명세를 먼저 확정하는 API-first**로
엔드포인트 표 → OpenAPI 3.1 YAML(SSOT) → 에러코드·페이징 규약을 생성하는 Claude Code 스킬입니다.
사람은 **API 계약 확정(리소스 경계·멱등성) 1번**만 개입합니다.

> BE 프로세스 05단계 "API 설계 (명세 정의)"를 자동화합니다.
> 역할 분담: AI는 변환·누락 점검(엔드포인트 도출·OpenAPI 문법화), **리소스 경계·상태 전이 판단은 사람**.

## 무엇을 만들어 주나

`backend-output/<주제>/05_API/`에 생성:

| 파일 | 내용 |
|---|---|
| `05-1_엔드포인트표.md` | 리소스·메서드·경로·인증·권한(OWNER/SITTER)·멱등성·근거 표 + Richardson 성숙도 점검 |
| `05-2_openapi.yaml` | OpenAPI 3.1 명세 (paths 2xx+4xx/5xx 전부, schemas·parameters·responses·securitySchemes) |
| `05-3_에러코드페이징규약.md` | ErrorResponse 포맷·도메인 에러코드표·페이징/정렬 규약·필터 화이트리스트 |
| `_검증체크리스트.md` | 사람이 확인할 항목 |

## 준비물 (입력)

1. **04 데이터베이스 산출물** (필수) — `backend-output/<주제>/04_데이터베이스/`의 `04-1_ERD.md`·`04-3_JPA엔티티초안.md` (DTO 스키마 원천).
2. **기능명세** (필수) — 기획 12 기능명세서 또는 `01_요구사항분석/01-1_도메인분석.md`의 유스케이스 표.
3. **(연결) 기획 14-3 API 초안** — `14_핸드오프/14-3_API명세초안.yaml`가 있으면 1:1 계승(재작명 금지). 없으면 04+기능명세에서 직접 도출.

> 04 또는 기능명세가 없으면 위치를 묻고 중단합니다. 그 외 보조 입력은 없어도 진행(degrade).

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| Context7 MCP | 선택 | springdoc·OpenAPI 3.1 최신 조회 생략, 내장 지식 + "버전 확인 필요 ⚠️" |
| Redocly/swagger-cli | 선택 | python3 `yaml.safe_load` 파싱으로 degrade |
| python3 (pyyaml) | 선택 | 정적 체크리스트로 degrade |

## 설치

```bash
mkdir -p ~/.claude/skills/be-api-design
cp SKILL.md ~/.claude/skills/be-api-design/SKILL.md
```

## 사용법

04 산출물과 기능명세를 준비한 뒤:

```
04 ERD랑 기능명세 읽고 포밋 API 설계해줘
```

1. 엔드포인트 표 도출 → Richardson 성숙도·멱등성 점검 (05-1)
2. **🚦 API 계약 확정** → 당신이 리소스 경계·멱등성 대상 OK (유일한 개입)
3. OpenAPI 3.1 YAML 생성 (05-2) → 에러코드·페이징 규약 (05-3) → 기능명세 역대조 자동 (_검증체크리스트.md)

발동 키워드: `API 설계`, `OpenAPI`, `API 명세`, `엔드포인트 설계`, `API-first`, `에러코드표`, `페이징 규약`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `backend-output/<주제>/`를 본인 볼트 경로로 |
| 계승 출처 | `## 입력` | 04·기능명세·14-3 경로를 본인 폴더 구조로 |
| OpenAPI 버전 | `### Stage 3` | 팀이 3.0이면 `nullable` 등 키워드 교체 |
| 검증 도구 | `## OpenAPI YAML 검증` | Redocly 대신 swagger-cli/spectral 등으로 |
| 트리거 키워드 | frontmatter `description` | 자기 표현으로 |

## 주의

- **AI는 없는 엔드포인트·필드를 그럴듯하게 지어냅니다.** `x-proposal`로 분리된 항목과 최종본은 04 ERD·기능명세에 직접 대조하세요.
- **리소스 경계는 비즈니스 판단** — Payment를 Booking 하위/독립으로 둘지 등은 사람이 결정. AI 초안을 그대로 확정 금지.
- **멱등성·동시성은 명세 단계에서 못 박습니다** — 결제 승인은 멱등성 키, 예약 충돌은 409.
- **권한 표기는 07(인증·인가) RBAC과 일치** — 명세에서 임의로 풀면 보안 구멍.
- **한 방 생성 금지** — 엔드포인트 표를 사람이 확정한 뒤 YAML로 넘어갑니다. **code-first 미루기 금지** — 명세를 먼저 확정.

## 원본 가이드

이 스킬은 BE 가이드 **"05. API 설계 (명세 정의)"**를 자동화한 것입니다.

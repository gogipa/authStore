---
name: be-api-design
description: >-
  기능명세·04 ERD를 받아 API-first로 OpenAPI 3.1 명세를 SSOT로 확정한다. 엔드포인트
  표(리소스·메서드·권한·멱등성) → Richardson 성숙도 점검 → openapi.yaml(기획 14-3
  계승·transform, 1:1 매핑) → 에러코드·페이징 규약 → 기능명세 역대조. "API 설계",
  "OpenAPI", "API 명세", "엔드포인트 설계", "API-first", "REST 설계", "에러코드표",
  "페이징 규약", "API design", "OpenAPI spec", "endpoint design", "REST" 같은
  요청에서 사용.
metadata:
  version: 1.0.0
---

# API 설계 (명세 정의) (API Design)

기능명세와 04 ERD를 입력으로 **코드보다 명세를 먼저 확정하는 API-first** 작업을 자동화한다.
산출물 = 엔드포인트 표 → OpenAPI 3.1 YAML(SSOT) → 에러코드·페이징 규약. **AI는 변환·회수율
(엔드포인트 도출·OpenAPI 문법화·누락 점검), 리소스 경계·멱등성·상태 전이 같은 설계 판단은 사람.**

<!-- 변경 포인트 (배포본 → 본인 환경에 맞게 수정):
  1. 출력 경로: 기본 backend-output/<주제-슬러그>/05_API/. 본인 볼트 설치본은 BE/실행산출물/<주제>로 고정 가능.
  2. 계승 출처: 04 ERD(04_데이터베이스/), 01 도메인분석(01_요구사항분석/), 기획 14-3 API초안 경로를 본인 폴더 구조로 수정.
  3. 도구(MCP/CLI): Context7(springdoc·OpenAPI 3.1 최신) / Redocly·swagger-cli·python3(yaml 검증) — 없으면 degrade.
  4. 스택 버전: Java 21 / Spring Boot 3.3 / springdoc-openapi. 팀이 OpenAPI 3.0이면 nullable 등 키워드 교체.
-->

## 핵심 원칙
- **상위 산출물 계승, 재발명 금지 — 단 확정 상태일 때만.**
  - **04 엔티티 정본 → DTO 스키마**: 필드명·타입은 04 엔티티(Member·SitterProfile·Pet·CareService·Booking·Payment·Review)에서 파생. **04에 없는 필드를 새로 만들지 말고**, 추가가 필요하면 `x-proposal` 또는 "스키마 추가 제안" 주석으로 분리.
  - **기획 14-3 API 초안 → 05-2로 구조 변환(transform)**: API명/경로/요청·응답 필드/기능ID는 **1:1 매핑(재작명 금지)**. OpenAPI 구조화에 새로 필요한 타입·응답 본문만 추정 표기(출처: "14-3 계승" vs "신규 구조화"). 14-3이 없으면 04+기능명세에서 직접 도출.
    - **타입 충돌 시 04 정본 우선**: 14-3 초안의 필드 타입(예: path id `type: string`)이 04 엔티티 타입(예: PK `bigint`)과 어긋나면 **04를 따르고**(`integer/int64`) 변경 사유를 한 줄로 기록. 이름·경로·기능ID는 14-3 1:1 유지(타입만 04로 교정).
  - 04/기획에 잔존한 `⚠️`/`[확인 필요]`는 명세에 보존(임의 확정 금지).
- **API-first**: 명세가 SSOT다. 코드에서 명세를 역으로 뽑지 않는다(code-first 금지).
- **에러부터 설계한다**: 해피패스(2xx)만 채우지 말고 4xx/5xx와 에러코드표를 1급 산출물로 먼저 정의.
- **횡단 규약은 공통 컴포넌트로 한 번만**: 페이징·에러·인증은 `components`에 두고 `$ref` 참조.
- **권한 표기는 07과 일치**: 엔드포인트별 OWNER/SITTER 권한은 07(인증·인가)의 RBAC과 동일. 명세에서 임의로 풀면 보안 구멍.
- **단계별 파일로 끊는다**: 표(05-1) → YAML(05-2) → 규약(05-3). 한 방 생성 금지(중간 판단 검토 불가).

## 입력
- **필수**: `<루트>/04_데이터베이스/`(04-1 ERD·04-3 JPA엔티티초안 — DTO 스키마 원천) + **기능명세**(기획 12 기능명세서 또는 `<루트>/01_요구사항분석/01-1_도메인분석.md`의 유스케이스 표).
  <!-- 변경 포인트(입력 경로): 본인 설치본은 <루트>=BE/실행산출물/<주제>. 상위 산출물이 다른 폴더면 수정 -->
- **권장**: 기획 `14_핸드오프/14-3_API명세초안.yaml`(있으면 1:1 계승) / `01_요구사항분석/01-2_비기능요구.md`(멱등성·동시성 NFR).
- 04 또는 기능명세가 없으면 **중단**(또는 사용자에게 명세 위치 질의). 그 외 보조 입력은 degrade.

## 출력 위치: `backend-output/<주제-슬러그>/05_API/`

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `05-1_엔드포인트표.md` | 리소스 \| 메서드 \| 경로 \| 설명 \| 인증 \| 권한(도메인 역할 — 포밋 예 OWNER/SITTER, 단일 actor 도메인이면 OWNER 단일) \| 멱등성 \| 근거. Richardson 성숙도 점검·"확인 필요" 포함 | Stage 1~2 |
| `05-2_openapi.yaml` | OpenAPI 3.1: info/servers/tags/paths(2xx+4xx/5xx 전부)/components(schemas·parameters·responses·securitySchemes). 14-3 1:1 계승, x-proposal 분리 | Stage 3 |
| `05-3_에러코드페이징규약.md` | ErrorResponse 포맷·도메인 에러코드표·페이징(page/size/sort) 규약·정렬/필터 화이트리스트 | Stage 4 |
| `_검증체크리스트.md` | 사람 확인 항목 | Stage 5 |

- 출력 폴더가 없으면 생성. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`). 모든 BE 스킬은 같은 `<루트>=backend-output/<주제-슬러그>`를 공유.

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- `<루트>/04_데이터베이스/`(엔티티·ERD)와 기능명세를 읽는다. **둘 중 하나라도 없으면 중단**(위치 질의).
- 기획 `14-3_API명세초안.yaml` 로드 시도(있으면 계승 모드, 없으면 직접 도출 모드 + ⚠️).
- **도구 probe**: Context7(ToolSearch 존재) / python3·Redocly·swagger-cli(bash 시도). 없으면 degrade(아래 "도구 정확성").

### Stage 1 — 리소스·엔드포인트 도출 → 05-1
- 기능명세의 동사형 요구("예약을 취소한다")를 **REST 리소스·엔드포인트**로 번역.
- 규칙:
  - 리소스는 **명사·복수형**(`/members`, `/care-services`, `/bookings`, `/payments`, `/reviews`).
  - 상태 변경은 가능한 한 리소스로 표현하되, 도메인 액션(예약 수락/취소)은 `POST /bookings/{id}/accept`처럼 명시적 액션 엔드포인트도 허용 — **어느 쪽을 택했는지 근거를 한 줄로** 적는다.
  - 검색(지역·날짜로 CareService 조회)은 쿼리 파라미터: `GET /care-services?region=&date=&page=`.
  - 권한(OWNER/SITTER)·인증 필요 여부·멱등성 컬럼 채움.
- **기능명세에 있는데 엔드포인트로 안 떨어지는 항목은 "확인 필요"로 표시**(억지 매핑 금지).
- 표 형식: `리소스 | 메서드 | 경로 | 설명 | 인증 | 권한 | 멱등성 | 근거`.

### Stage 2 — Richardson 성숙도·규약 점검 → 05-1에 추가
- 현재 Level 평가(0~3) 후 **Level 2 목표**(HATEOAS는 과설계로 보류)로 정렬.
- 잘못된 동사형 URL(`/getBooking`, `/createPayment`) 지적·교정.
- 메서드·상태코드 매핑 점검(생성 201, 비동기 수락 202, 삭제 204, 충돌 409)을 표로.
- POST 액션 중 멱등성 필요한 것(결제 승인 등)에 **멱등성 키 헤더(`Idempotency-Key`)** 필요 여부 표시.

### 🚦 게이트 — API 계약 확정 (사람 개입, 필수)
AskUserQuestion으로 05-1(엔드포인트 표 + 성숙도/멱등성 점검 결과)을 제시 → 사용자가 OK/수정.
- 핵심 결정 항목(사람이 쥐는 비즈니스 판단):
  - **리소스 경계** — 예: Payment를 Booking 하위로 둘지 독립 리소스로 둘지(정산·환불 흐름까지 보고 결정).
  - **상태 전이 노출 방식** — PATCH vs 액션 엔드포인트.
  - **멱등성 적용 대상** — 결제 승인 등 재시도 위험 액션.
  - **"확인 필요" 항목 처리** — 엔드포인트 누락/추가.
- **표(05-1)를 사람이 확정하기 전에는 Stage 3(YAML)로 넘어가지 않는다**("한 방 생성" 방지 — 중간 판단을 검토해야 한다).

### Stage 3 — OpenAPI 3.1 명세 → 05-2 YAML
- 확정된 05-1 표 + 04 엔티티 스키마를 근거로 생성:
  - `info` / `servers`(local, dev) / `tags`(회원·검색·예약·결제·리뷰).
  - `paths`: 05-1 전 엔드포인트. 각 operation에 `operationId`·`summary`·파라미터·`requestBody`·`responses`(**2xx + 4xx/5xx 전부**).
  - `components/schemas`: 04 엔티티에서 DTO 파생. **요청/응답 DTO 분리**(예: `BookingCreateRequest`, `BookingResponse`). Bean Validation 제약을 OpenAPI 제약으로 표현(`required`, `minLength`, `format: email` 등).
  - `components/parameters`: 페이징(`page`,`size`,`sort`) 공통 정의 후 `$ref`.
  - `components/responses`: 공통 에러 응답(`ErrorResponse`)을 정의해 4xx에서 `$ref`.
  - `securitySchemes`: `bearerAuth`(JWT) 정의, 인증 필요 operation에 적용(권한은 07 RBAC과 일치).
- **계승 규칙**: 14-3이 있으면 API명/경로/필드/기능ID **1:1 매핑(재작명 금지)**, 새 구조만 추정 표기.
- ⚠️ **04에 없는 필드를 새로 만들지 말 것** — 추가 필요 시 `x-proposal` 키 또는 "스키마 추가 제안" 주석으로 분리.
- Context7로 OpenAPI 3.1 + springdoc 최신 표기를 확인한 뒤 작성(부재 시 내장 지식 + "버전 확인 필요 ⚠️").
- **생성 후 검증**: python3 `yaml.safe_load` 파싱. 가능하면 Redocly/swagger-cli lint(아래 "OpenAPI YAML 검증").

### Stage 4 — 에러코드표 + 페이징/정렬 규약 → 05-3
- **표준 에러 응답 바디**: `{ code, message, status, timestamp, path, fieldErrors[] }`.
- **에러코드표**: 도메인별 코드(예: `BOOKING_NOT_FOUND`, `BOOKING_ALREADY_CANCELED`, `PAYMENT_DECLINED`, `INSUFFICIENT_PERMISSION`) | HTTP status | 사용자 메시지 | 발생 조건. → 05-2의 `ErrorResponse`가 참조하는 포맷과 일치.
- **페이징 규약**: `page`(0-base) / `size`(기본 20, 최대 100) / `sort`(필드,asc|desc 다중). 응답은 `content[]` + pageable(`totalElements`,`totalPages`,`number`) 래퍼.
- **정렬·필터 허용 필드 화이트리스트**(검색 API에서 임의 필드 정렬 차단).
- 에러코드표·페이징 규약은 09(전역 예외 핸들러)와 같은 표를 공유하게 됨을 명시.

### Stage 5 — 기능명세 역대조 + 검증 체크리스트
- AI에게 **기능명세 ↔ OpenAPI 역대조**: ① 기능명세 유스케이스 중 대응 엔드포인트 없는 것 ② 정의된 에러 상황 중 `responses`에 빠진 것 ③ 권한 표기가 07 설계와 어긋나는 것을 목록화(사람이 메움).
- `_검증체크리스트.md` 생성(`<주제>`/`<날짜>` 치환):

```markdown
# 검증 체크리스트 — <주제> API 설계 (작성일: <날짜>)

> AI는 변환·회수율까지. 리소스 경계·멱등성·상태 전이는 사람의 판단이다.

- [ ] 05-1 엔드포인트 표를 사람이 확정한 뒤 YAML로 넘어갔는가 (한 방 생성 금지)
- [ ] 05-2의 path·schema가 04 엔티티·기능명세에 근거 (AI가 지어낸 path/field 차단 — x-proposal 분리 확인)
- [ ] 14-3 계승 시 API명/경로/필드/기능ID 1:1 (재작명 0건)
- [ ] responses에 4xx/5xx 전부 정의 (해피패스만 채우지 않았는가)
- [ ] 에러코드표(05-3) ↔ openapi ErrorResponse 포맷 일치
- [ ] 멱등성 필요 액션(결제 승인 등)에 Idempotency-Key, 예약 충돌에 409 명세
- [ ] 엔드포인트별 권한(도메인 역할 — 포밋 OWNER/SITTER, 단일 actor 도메인은 OWNER 단일)이 07(인증·인가) RBAC과 일치
- [ ] 페이징 규약·정렬 화이트리스트 전 API 일관 적용
- [ ] Redocly/swagger-cli lint 통과 (또는 python3 yaml.safe_load 파싱 OK)
- [ ] 기능명세 역대조 목록의 누락 엔드포인트·미정의 에러를 사람이 메웠는가
```

- 마지막으로 산출물 폴더 경로와 "OpenAPI YAML이 SSOT — 09 구현·springdoc 산출물 대조 기준" 고지를 보고한다.

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe) = springdoc-openapi 좌표·OpenAPI 3.1 변경점 최신 조회(외부 SDK 필드 보강 한정 2-step). 없으면 **내장 지식 + "버전 확인 필요 ⚠️"** 표기. OpenAPI 형식 자체는 내장 지식/정적 템플릿.
- **Redocly CLI / swagger-cli**(bash probe) = YAML lint/validate. 없으면 **python3 `yaml.safe_load`** 파싱으로 degrade. 둘 다 없으면 정적 체크리스트 degrade("로컬에서 `npx @redocly/cli lint` 직접 실행 필요" 안내).
  - ⚠️ **경로 주의**: `npx`/Redocly는 **한글·공백이 포함된 경로(볼트 리서치 폴더 등)에서 `package.json` 탐색 실패로 깨질 수 있음** — 산출물 yaml을 ASCII 임시 폴더(예: scratchpad)로 복사해 lint하거나, `python3 yaml.safe_load`를 1차 검증으로 쓴다(`pyyaml`은 `pip install pyyaml`로 대개 즉시 가용).
- **springdoc-openapi** = 09에서 런타임 명세를 내보내는 구현 단계 연계 도구(이 단계의 설계 명세와 09 산출물을 **둘 다** 두고 대조). 좌표는 Context7로 최신 확인.
- **중단**은 필수 입력(04·기능명세) 부재 시에만. 그 외는 degrade.

## OpenAPI YAML 검증 (05-2)
- python3 `yaml.safe_load` 파싱 시도. pyyaml 미설치 시 정적 체크리스트 degrade:
  `openapi: 3.1.x` 핀, 3.0 키워드(`nullable`) 금지(3.1은 `type: [string, "null"]`), 들여쓰기, **루트 필수 키(`openapi`·`info`) + `paths`/`components`/`webhooks` 중 최소 1개** 점검.

## 주의
- **AI는 없는 엔드포인트·필드를 그럴듯하게 지어낸다.** 04 엔티티 정본·기능명세에 근거 없는 path/schema를 차단 — Stage 3의 "x-proposal 분리" 규칙 유지, 최종본은 ERD·기능명세와 직접 대조.
- **리소스 경계는 비즈니스 판단** — Payment를 Booking 하위로 둘지 등은 정산·환불 흐름까지 보고 사람이. AI 초안을 그대로 확정하지 않는다.
- **멱등성·동시성은 명세 단계에서 못 박는다** — 결제 승인은 멱등성 키 헤더, 예약 충돌은 409. 11(외부 연동)에서 실제 구현으로 이어짐.
- **권한 표기는 07과 일치** — 명세에서 임의로 권한을 풀면 보안 구멍.
- **흔한 실수 — 한 방 생성**: 기능명세에서 YAML을 한 번에 뽑으면 중간 판단 검토 불가. 반드시 엔드포인트 표(게이트)를 사람이 확정한 뒤 YAML로.
- **흔한 실수 — code-first로 미루기**: "코드부터 짜고 springdoc으로 뽑자"는 프론트 병렬 작업 이점을 버린다. 설계 명세를 먼저 확정한다.

## 원본 가이드
- 이 스킬은 BE 가이드 **"05. API 설계 (명세 정의)"**를 자동화한 것입니다.

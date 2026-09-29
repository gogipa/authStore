---
name: be-api-development
description: >-
  05 OpenAPI 명세와 08 도메인 서비스를 받아 컨트롤러·DTO·Bean Validation·전역 예외 핸들러를 스캐폴딩하고,
  명세↔구현 대조표·슬라이스 테스트 초안까지 만든다. "API 개발", "컨트롤러 구현", "DTO", "Bean Validation",
  "예외 처리", "전역 예외 핸들러", "스펙 구현", "명세 대조", "@RestControllerAdvice", "API development",
  "controller", "request response DTO", "exception handler", "spec compliance" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# API 개발 (API Development)

08에서 TDD로 굳힌 도메인 서비스를 HTTP 바깥 세계와 잇는다. 05 OpenAPI 명세를 입력으로 컨트롤러(`@RestController`)·요청/응답 DTO(Java 21 record)·Bean Validation·전역 예외 핸들러(`@RestControllerAdvice`)를 스캐폴딩하고, 산출물 = **명세 대조표가 0건 불일치인 API 구현 초안**이다. **AI는 명세→코드 변환·보일러플레이트, 사람은 "정말 명세대로인가" 대조와 정책 검증**을 `code-review`·`verification-before-completion`으로 마감한다.

<!-- 변경 포인트 (배포본 → 본인 환경에 맞게 수정)
  1. 출력 경로: 기본 backend-output/<주제-슬러그>/09_API개발/. 본인 볼트 설치본은 BE/실행산출물/<주제>로 고정 가능.
  2. 계승 출처: 05 openapi·05-3 에러코드규약(05_API/)·08 도메인(08_비즈니스로직/) 경로를 본인 폴더 구조로 수정.
  3. 도구(MCP/CLI): Context7(probe)·gradle/python3(bash probe). 없으면 degrade(아래 도구 정확성).
  4. 스택 버전: Java 21 / Spring Boot 3.3 / Jakarta Bean Validation. 팀 버전이 다르면 애너테이션 네임스페이스 교체.
-->

## 핵심 원칙
- **상위 산출물 계승·재발명 금지(확정일 때만 계승)**: 05 openapi.yaml의 엔드포인트·스키마·에러코드를 코드의 출처로 삼는다. 명세에 없는 필드·엔드포인트를 지어내지 말고 "명세 대비 누락/여분"으로 보고한다. 08 도메인 서비스 시그니처(`BookingService.request`/`accept` 등)는 그대로 위임 대상으로 계승.
- **스펙이 진실, 코드가 따라온다.** 09에서 코드를 창작하면 05 명세=프론트와의 계약을 어긴다. 불일치가 나오면 코드를 고친다. 단 명세 자체가 틀린 것 같으면 코드를 바꾸기 전에 05로 회귀해 명세부터 고치라고 보고한다.
- **컨트롤러는 얇게, 로직은 08에.** 컨트롤러는 "받고·검증하고·위임하고·변환한다"만. 비즈니스 규칙을 컨트롤러에 넣지 않는다.
- **엔티티 직접 노출 금지.** JPA 엔티티(Booking 등)를 응답으로 내보내지 않고 반드시 응답 DTO로 변환한다(LazyInitialization·순환참조·민감필드 노출 차단).
- **검증·예외는 한곳에.** Bean Validation은 진입점(`@Valid`)에서, 도메인 예외→HTTP 매핑은 `@RestControllerAdvice` 한곳에서. 컨트롤러에 try-catch·수기 if 검증을 흩뿌리지 않는다.
- **AI는 변환·보일러플레이트, 사람은 대조·정책 판단.** "이 필드가 정말 필수인가, 이 범위가 정책과 맞는가"는 06 정책을 아는 사람의 몫.

## 입력
- **필수**: `backend-output/<주제-슬러그>/05_API/05-2_openapi.yaml`(엔드포인트·요청/응답 스키마·`ErrorResponse` 포맷 — 구현의 정답지) **+ `05_API/05-3_에러코드페이징규약.md`(도메인 에러코드표·페이징 규약 — 예외 핸들러 매핑의 출처. openapi.yaml의 ErrorResponse는 포맷만, 코드↔status 매핑표는 05-3에 있음)**. 없으면 **중단**하고 05 먼저 권장.
- **필수**: `backend-output/<주제-슬러그>/08_비즈니스로직/`(08-3 도메인서비스초안·08-1 도메인규칙명세·08-4 상태전이 — 컨트롤러가 위임할 대상과 던질 도메인 예외). 없으면 중단(또는 위치 질의).
- **권장**: 기획 06 정책 정의(예약/취소 정책 등 — Bean Validation 규칙의 근거). 없으면 명세 제약만 반영하고 "정책 미대조 ⚠️" 표기.

## 출력 위치: `backend-output/<주제-슬러그>/09_API개발/`

<!-- 변경 포인트(출력 경로): 기본은 현재 작업 폴더의 backend-output/<주제-슬러그>/. 본인 설치본은 볼트 경로 고정 가능. -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `09-1_컨트롤러DTO초안.md` | 컨트롤러(얇게·위임만)·요청/응답 record DTO·Bean Validation(근거 주석)·명세↔코드 매핑표. 변경포인트 주석 포함 | Stage 1~2 |
| `09-2_전역예외핸들러.md` | `@RestControllerAdvice` GlobalExceptionHandler. 도메인 예외→에러코드표 매핑, **05-2 `ErrorResponse` 스키마와 동일 포맷**(05-2가 RFC 7807 ProblemDetail이면 그걸로, 커스텀 스키마면 그 필드대로 — 스펙이 진실), 미커버 에러코드 목록 | Stage 3 |
| `09-3_명세대조표.md` | 05 openapi ↔ 구현 대조(엔드포인트·필드·상태코드·에러코드). "명세 기준/구현 기준/원인 추정" 3열, 불일치 0건 목표. (선택) `@WebMvcTest`+`@MockBean` 슬라이스 테스트 초안 부록 | Stage 4~5 |
| `_검증체크리스트.md` | 사람 확인 항목(빌드·테스트·대조 0건 확인) | Stage 5 |

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- 05 openapi.yaml + 05-3 에러코드페이징규약 로드(없으면 **중단**, 05 권장). 08 도메인 산출물 로드(없으면 중단·위치 질의). 06 정책 로드(있으면 검증 근거, 없으면 "정책 미대조 ⚠️").
- **도구 probe**: Context7(ToolSearch 존재 여부) / `gradle`·`python3`(bash 시도). 부재 시 아래 degrade.
- python3 가용 시 `yaml.safe_load`로 05 openapi.yaml 파싱(읽기 전 형식 깨짐 확인). 미설치면 정적 확인 degrade.

### 🚦 게이트 — 구현 범위 + 명세 모호점 확정 (AskUserQuestion, 필수)
AskUserQuestion으로 **이번에 구현할 엔드포인트 범위**(예: Booking 전체 vs `POST /bookings`+`PATCH /accept`만)와 **05 명세에서 발견한 모호/누락 항목**(예: 응답 스키마 미정, 에러코드 누락)을 제시 → 사용자가 OK/수정. **명세가 틀린 듯한 항목은 여기서 "05로 회귀해 고칠지" 결정**(스펙이 진실 — 09에서 임의 보정 금지).
- 범위·모호점 확정 전에는 Stage 1로 넘어가지 않는다.

### Stage 1 — 컨트롤러·DTO 스캐폴딩 → 09-1
- 05 openapi.yaml에서 확정 범위의 엔드포인트만 추려 Spring Web MVC로 스캐폴딩.
- 요청/응답 DTO는 **Java 21 record**. 명세 스키마의 필드명·타입·nullable을 **그대로** 따른다.
- 컨트롤러는 기능당 하나(예: `BookingController`)로 묶고, 메서드는 **08 도메인 서비스에 위임만**. 명세의 HTTP 상태코드(201/200/409 등)를 `ResponseEntity`로 정확히 반영.
- **엔티티 직접 노출 금지** — 반드시 응답 DTO로 변환.
- **명세에 없는 엔드포인트·필드를 임의 생성 금지**. 명세에 있는데 빠진 게 있으면 코드 대신 "명세 대비 누락" 목록으로 보고. 끝에 명세 항목 ↔ 코드 매핑표.

### Stage 2 — Bean Validation 부착 → 09-1
- 05 스키마 제약(required/format/min/max/pattern) + **06 정책**(있으면)을 함께 읽어 검증 규칙을 채운다.
- 표준 애너테이션(`@NotNull`/`@Future`/`@Size` 등)으로 표현 가능한 건 그걸로. `endAt > startAt`처럼 **필드 간 관계 검증은 클래스 레벨 커스텀 validator(`ConstraintValidator`)로 분리**.
- 각 규칙 옆에 **근거 주석**(명세 항목 또는 정책 조항). 실패 메시지는 **메시지 코드로 분리**(하드코딩 금지).
- 정책 문서가 없으면 명세 제약만 반영하고 "정책 미대조 ⚠️"를 규칙 옆에 표기(취소 마감 등 정책 규칙이 누락될 수 있음).

### Stage 3 — 전역 예외 핸들러 → 09-2
- `@RestControllerAdvice` 기반 `GlobalExceptionHandler`. 매핑 기준은 **05-3 에러코드페이징규약의 도메인 에러코드표**(코드↔HTTP status↔발생 조건). 응답 포맷은 05-2 openapi.yaml의 `ErrorResponse` 스키마와 일치시킨다.
- `MethodArgumentNotValidException`(Bean Validation 실패) → **05-3 에러코드표의 검증 실패 status**(400 또는 422 — 05가 정하는 대로, 임의로 400 가정 금지) + 필드별 에러 목록. 08 도메인 예외를 에러코드표대로 매핑: 상태 전이 위반(예 `BookingStateException`/`InvalidStateTransitionException`) → 409 / 일정 충돌·중복(예 `SitterNotAvailableException`/`DuplicateCancelException`) → 409 / `EntityNotFoundException` → 404 / 권한 없음(`AccessDeniedException`) → 403.
- 응답 본문은 **05-2 `ErrorResponse` 스키마와 동일 포맷**으로 통일한다(05-2가 RFC 7807 ProblemDetail이면 type/title/status/detail/errors, 커스텀 스키마(예 code/message/status/timestamp/path/fieldErrors)면 그 필드대로 — **05가 진실, 09에서 포맷을 바꾸지 않는다**). 500은 스택트레이스 미노출, **traceId만** 내려준다.
- 명세 에러코드 중 핸들러가 커버 못 한 게 있으면 "**미커버 에러코드**" 목록으로 보고.

### Stage 4 — 명세 ↔ 구현 대조 → 09-3
- 구현 코드와 05 openapi.yaml을 다시 읽혀 불일치를 잡는다(스펙이 진실을 강제하는 지점).
- 표 체크: ① 명세 모든 엔드포인트가 컨트롤러에 구현됐는가(경로·메서드·path/query 파라미터) ② 요청/응답 DTO 필드가 명세 스키마와 1:1 일치하는가(이름·타입·nullable·**누락·여분**) ③ 각 응답 HTTP 상태코드가 명세와 일치하는가 ④ 05-3 에러코드표의 도메인 에러코드가 전부 핸들러에 매핑되는가(코드↔status).
- 불일치는 **"명세 기준 / 구현 기준 / 원인 추정"** 3열로. 명세가 맞다고 가정하고(스펙이 진실) 코드 수정안 제안. 단 **명세 자체가 틀린 것 같으면 코드를 바꾸기 전에 그 점부터 보고**(→ 05 회귀).

### Stage 5 — 슬라이스 테스트 초안 + 검증 마감 → 09-3 부록, _검증체크리스트
- (선택) 핵심 컨트롤러(예 `BookingController`) 대상 `@WebMvcTest` 슬라이스 테스트를 **09-3 명세대조표 말미에 부록으로** 첨부. 위임 서비스는 `@MockBean`. 케이스(상태코드는 **05-3 에러코드표 기준** — 아래는 포밋 예시): 정상 요청 → 200/201+바디 / 필수값 누락 → 검증 실패 status(400 또는 422·05대로)+에러필드 / 도메인 제약 위반(예 과거 시각·기간 규칙) → 검증/도메인 status / 이미 처리된 자원 재요청 → 409 / 타인 자원 접근 → 403 / 정산·외부 실패 → 500.
- **마감은 스킬로**: `code-review`로 컨트롤러·DTO·예외 핸들러 정확성·단순화 여지 점검 → `verification-before-completion`으로 **`./gradlew test` 통과 + 09-3 대조표 불일치 0건을 출력으로 확인한 뒤에만** "API 개발 완료" 선언. gradle 부재 시 "로컬에서 `./gradlew test` 직접 실행 필요" 안내(빌드 미실행 완료는 완료 아님).
- `_검증체크리스트.md` 생성 후 산출물 폴더 경로와 "빌드·대조 미확인은 미완료" 고지를 보고.

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe) = Spring Web MVC / Jakarta Bean Validation(`ConstraintValidator`) / `@RestControllerAdvice` ProblemDetail / springdoc-openapi의 Spring Boot 3.3 기준 최신 애너테이션·설정 확인(2-step: resolve-library-id → query-docs ≤3). 부재 → 내장 지식 + "버전 확인 필요 ⚠️"(특히 javax→jakarta 네임스페이스, springdoc 3.3 설정).
- **gradle**(bash probe) = 빌드·테스트 실행. 부재 → 산출물(코드·테스트 초안)은 생성하되 "로컬에서 `./gradlew test` 직접 실행 필요" 안내.
- **python3**(bash probe) = 05 openapi.yaml `yaml.safe_load` 파싱·구조 확인. 부재 → 정적 확인 degrade.
- **code-review / verification-before-completion 스킬** = 마감의 핵심(생성 코드 점검 + 빌드·대조 결과 증명).
- **중단**: 필수 입력(05 openapi·08 도메인) 부재 시에만. 그 외는 degrade.

## _검증체크리스트 본문 (Stage 5 생성)
```markdown
# 검증 체크리스트 — <주제> API 개발 (작성일: <날짜>)

> AI는 명세→코드 변환·대조 초안까지. "정말 명세대로인가"·정책 적정성은 사람이 마감한다.

- [ ] `./gradlew test` 실제 통과 확인 (빌드·테스트 미실행 "완료"는 완료 아님)
- [ ] 09-3 명세 대조표 불일치 0건 — 엔드포인트·필드·상태코드·에러코드 전수
- [ ] DTO 필드 "여분"(명세에 없는데 AI가 추가한 친절한 필드) 0건 확인
- [ ] Bean Validation이 06 정책 제약(취소 마감·예약 가능 시간 등)까지 반영 — 명세만 충족 ❌
- [ ] 엔티티 직접 노출 0건 — 모든 응답이 DTO 변환(LazyInitialization·순환참조·민감필드 차단)
- [ ] 상태코드·에러코드를 "더 적절해 보여서" 임의 변경 0건(바꾸려면 05 명세부터)
- [ ] 미커버 에러코드 목록 비어 있음(05-3 에러코드표의 도메인 코드 전부 핸들러 매핑)
- [ ] 컨트롤러에 비즈니스 로직·수기 if 검증 없음(얇게·위임만)
```

## 주의
- **AI는 명세에 없는 필드·엔드포인트를 그럴듯하게 지어낸다.** 프롬프트에 "없으면 누락 보고"를 명시하고, Stage 4 대조에서 **여분 필드를 반드시 확인**. 친절한 추가 필드가 계약 위반 사고가 된다.
- **검증을 정책과 대조하지 않으면 명세만 충족하고 정책을 어긴다.** 명세에 `required`만 적혀 있어도 06 정책의 "취소 마감 24시간 전" 같은 규칙까지 반영. Stage 2에서 정책을 함께 읽힌 이유다.
- **엔티티 직접 노출은 컴파일은 되지만 운영에서 터진다** — `LazyInitializationException`·순환참조·민감필드 노출. DTO 변환을 규약으로 박는다.
- **상태코드·에러 본문은 클라이언트와의 계약이다.** 200↔201, 409↔400의 사소한 차이가 프론트 분기를 깬다. 임의 변경 금지 — 바꾸려면 05부터.
- **흔한 실수 — 검증을 컨트롤러에서 수기 if로**: `@Valid` 없이 본문에 `if (req.startAt == null)`을 흩뿌리면 검증이 분산되고 에러 형식이 깨진다. 진입점 Bean Validation + 전역 핸들러로 모은다.
- **흔한 실수 — 빌드 없이 "완료" 선언**: 코드를 읽어보기만 하고 완료로 보고. `verification-before-completion`대로 `./gradlew test` 통과 + 대조표 0건을 출력으로 확인한 뒤에만 완료다.

## 원본 가이드
- 이 스킬은 BE 가이드 **"09. API 개발"**을 자동화한 것입니다.

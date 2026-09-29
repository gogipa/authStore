---
name: be-auth
description: >-
  Spring Security 6 기반 인증·인가(JWT access/refresh·카카오 OAuth2·RBAC) 구현 초안과 위협
  점검을 생성한다. 03 아키텍처·05 API 명세를 계승해 SecurityConfig·JWT/OAuth 플로우·RBAC
  권한 매트릭스·OWASP 위협 점검을 만들고, 인증 설계는 사람이 검수·확정한다. "인증 인가",
  "JWT", "OAuth", "카카오 로그인", "Spring Security", "RBAC", "권한 매트릭스", "로그인 구현",
  "토큰 발급", "authentication", "authorization", "auth", "OAuth2" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# 인증·인가 구현 (Authentication & Authorization)

개발 환경 위에 "누구인지 증명하고(인증) 무엇을 할 수 있는지 통제하는(인가)" 보안 기반을 올린다.
Spring Security 6 / JWT(access·refresh) / 카카오 OAuth2 / RBAC(OWNER·SITTER) 초안과 OWASP
위협 점검을 산출한다. **AI는 표준 패턴 초안과 위협 회수율에 강하고, 보안 정책 결정과 최종 검수는
전적으로 사람의 몫**이다. 이 단계는 자동화 효율과 위험이 동시에 높아, 생성된 인증 코드는 예외 없이
사람이 검수한 뒤에만 머지한다.

<!-- 변경 포인트 (배포본 → 본인 환경에 맞게 수정)
  1. 출력 경로: 기본 backend-output/<주제-슬러그>/07_인증인가/ (본인 설치본은 BE/실행산출물/<주제>/).
  2. 계승 출처: 03 아키텍처·05 API 명세 경로를 본인 폴더 구조로(기본 <루트>/03_아키텍처, /05_API).
  3. 도구(MCP/CLI): Context7(Spring Security 6 최신)·Figma generate_diagram(시퀀스)·python3.
  4. 스택 버전: Java 21 / Spring Boot 3.3 / Spring Security 6 / jjwt 0.12.x / Redis 7. 다르면
     이 4곳 교체(버전은 Context7로 재확인). -->

## 핵심 원칙

- **상위 산출물 계승·재발명 금지(확정 상태일 때만 계승)**: 인증 엔드포인트는 05 OpenAPI에서,
  `Member(role: OWNER|SITTER)` 엔티티는 04에서 정의됐다고 가정해 그대로 참조한다. 미확정(⚠️)
  항목은 ⚠️ 보존하고 임의로 채우지 않는다.
- **AI 생성 인증 코드는 반드시 사람이 검수한다(이 단계 제1원칙).** "동작하는 것처럼 보이는" 잘못된
  보안 코드의 무검증 머지가 최악의 시나리오다. security-review·code-review를 거치고 결과를 사람이
  직접 읽은 뒤에만 머지한다.
- **버전 확인을 코드 생성보다 먼저 한다(Context7 선행).** Spring Security는 버전마다 설정 API가
  갈아엎힌다(`WebSecurityConfigurerAdapter` 폐지·`SecurityFilterChain` 빈·람다 DSL). 코드 전에
  최신 관례를 컨텍스트에 넣어 폐지 API·낡은 보안 설정을 줄인다.
- **정책 값을 프롬프트에 못 박는다.** 만료·rotation·키 관리·계정 충돌은 보안 정책 결정이지 코드
  취향이 아니다. 사람이 정한 값을 명시하고, 검토는 "정책대로 짜였나"만 본다.
- **인가를 두 층으로 분리한다(역할 + 소유권).** 경로/역할 RBAC는 "시터냐 보호자냐"는 막지만 "이게 그
  사람의 예약인가"는 못 막는다(IDOR). 두 검사를 분리하면 누락 지점이 드러난다.
  - **역할 모델은 도메인을 따른다(OWNER/SITTER 강제 금지).** OWNER·SITTER는 시터매칭 예시(포밋)
    전용이다. 05/04에서 `Member.role`이 없거나 단일 actor(예: 펫사료구독 = 보호자=구매자 단일)면
    **경로 RBAC를 "공개 vs 인증" 2분류로 단순화하고, 자원 차등은 전적으로 소유권 검사로** 처리한다.
    없는 역할(SITTER 등)·없는 `hasRole`을 발명하지 않는다.
- **무효화 경로를 처음부터 설계한다(Redis).** 무상태 JWT는 발급 토큰을 만료 전 못 죽인다. 탈취·로그아웃
  대응이 필요하면 refresh 저장·블랙리스트용 Redis를 설계 초기에 넣는다.

## 입력

- **필수**: `<루트>/05_API/05-2_openapi.yaml`(인증 엔드포인트 — `/api/auth/**`·`/oauth2/**`) 또는
  `05-1_엔드포인트표.md`. 인증 대상 엔드포인트·역할 정보가 없으면 위치를 묻고 degrade(아래).
  <!-- 변경 포인트(입력 경로): 본인 설치본은 <루트>=BE/실행산출물/<주제>. 상위 산출물이 다른 폴더면 수정 -->
- **권장**:
  - `<루트>/03_아키텍처/`(03-1 옵션비교·03-ADR) — stateless·세션 정책·필터 배치의 전제.
  - `<루트>/04_데이터베이스/04-3_JPA엔티티초안.md` — `Member.role` 열거형·식별자 타입 확인(있으면).
  - `<루트>/06_개발환경/06-4_프로파일환경변수.md` — JWT 키·카카오 secret을 환경변수로 주입(12-Factor).
- **스택 정본**: Java 21 / Spring Boot 3.3 / Spring Security 6 / jjwt 0.12.x / Redis 7 /
  엔티티 `Member`. **역할 모델은 04/05를 따른다** — 포밋 예시는 `role: OWNER|SITTER`이나, `role`
  필드가 없거나 단일 actor 도메인이면 역할 매트릭스 없이 소유권 검사 중심으로 간다(위 원칙). 가이드에
  없는 역할·라이브러리를 발명하지 않는다.

## 출력 위치: `backend-output/<주제-슬러그>/07_인증인가/`

<!-- 변경 포인트(출력 경로): 기본은 현재 작업 폴더의 backend-output/<주제-슬러그>/07_인증인가/.
     본인 설치본은 볼트 BE/실행산출물/<주제> 경로로 고정 가능. <주제-슬러그>는 짧은 kebab-case(예: pomit). -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `07-1_SecurityConfig초안.md` | SecurityFilterChain(람다 DSL)·인가 경로 매트릭스 표·STATELESS·CSRF 비활성 근거 주석·401/403 JSON 핸들러·JWT 필터/Provider/TokenService(Redis rotation·블랙리스트) 초안 (코드블록) | Stage 1·2 |
| `07-2_JWT_OAuth플로우.md` | 자체 로그인·토큰 재발급·로그아웃(Mermaid 시퀀스, Figma 옵트인). 카카오 OAuth2는 05에 소셜 명세 있을 때만 본문, 없으면 "차기 옵션" 스케치. 계정 충돌은 "확인 필요" 분기만 | Stage 2·3 |
| `07-3_RBAC권한매트릭스.md` | 경로×역할 인가 매트릭스(역할 단일/부재면 "공개 vs 인증" 2분류) + `@PreAuthorize`/SpEL·소유권 가드(역할+소유권 2층)·각 규칙이 막는 위협(권한상승/IDOR) 표 | Stage 4 |
| `07-4_위협점검.md` | security-review 기반 OWASP(A01·A07·A02·A05) 위협 목록(심각도)·수정 제안과 "사람이 결정할 정책 질문" 분리 | Stage 5 |
| `_검증체크리스트.md` | 사람 확인 항목 | 마지막 |

- 출력 폴더가 없으면 생성한다. 코드 초안은 컴파일 보증이 아닌 검수 대상임을 각 파일 상단에 고지한다.

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- `05_API`에서 인증 엔드포인트·역할을 읽는다. 없으면 위치 질의 후, 그래도 없으면 가이드 정본 경로
  (`/api/auth/**`·`/api/sitters/**`·`/api/care-services`·`/api/bookings`·`/api/admin/**`)로 degrade
  진행하고 "05 미계승 ⚠️" 표기.
- `03`·`04-3`·`06-4`는 있으면 로드(없으면 ⚠️ 보존, 중단하지 않음).
- **도구 probe**: Context7(ToolSearch 존재)·Figma generate_diagram(존재)·python3(bash 시도).
  부재 시 degrade(아래 "도구 정확성").
- **민감정보 경고**: 산출물에 실제 키·secret·토큰 원문을 절대 넣지 않는다(예시는 환경변수
  플레이스홀더·더미). 로그·에러 응답에 비밀번호·토큰 원문이 새지 않게 한다.

### Stage 1 — 최신 설정 관례 확인 (Context7 선행)
- 코드 생성 **전에** Context7로 Spring Boot 3.3 / Spring Security 6 최신을 확인한다:
  SecurityFilterChain 빈 방식, `authorizeHttpRequests` 람다 DSL, 커스텀 JWT 필터를
  `UsernamePasswordAuthenticationFilter` 앞에 등록, stateless 세션·CSRF 비활성의 적절성·근거.
  폐지/변경 API(`WebSecurityConfigurerAdapter`·`authorizeRequests()` 등)를 명시한다.
- Context7 부재 → 내장 지식으로 진행하되 "버전 확인 필요 ⚠️"를 07-1 상단에 표기.

### Stage 2 — Security 설정 + 인가 경로 매트릭스 + JWT 발급/검증 (초안)
- **경로별 인가는 표로 먼저** 정리한 뒤 그 표에 맞춰 `SecurityFilterChain`을 작성(매트릭스가 진실,
  코드가 따라온다). 정본 매트릭스: `/api/auth/**`·`/oauth2/**` permitAll / `/api/sitters/**` 인증
  사용자 / `/api/care-services` 등록·수정·삭제 SITTER / `/api/bookings` 생성 OWNER·상태 변경 당사자
  / `/api/admin/**` 전부 deny(추후 ADMIN).
- 조건: 세션 STATELESS, formLogin/httpBasic 비활성, JWT 필터를 `UsernamePasswordAuthenticationFilter`
  앞에 등록, 401(EntryPoint)/403(AccessDeniedHandler)을 일관 JSON으로, CSRF 비활성 + 안전한 이유
  (stateless·JWT 헤더·쿠키 미사용)를 **주석으로 명시**.
- **JWT 정책은 아직 미확정 — 기본 제안값으로 초안만** 작성하고 값마다 `// 게이트 확정 전 기본값 ⚠️`
  주석을 단다(확정은 바로 뒤 게이트에서, 결정은 사람). 기본 제안: access 30분 / refresh 14일 / HS256 /
  키는 환경변수 주입 / claim sub=memberId·role·만료(민감정보 금지) / refresh는 Redis에 memberId 기준
  저장·재발급 시 rotation / 로그아웃 = refresh 삭제 + access jti 블랙리스트. 구성:
  JwtTokenProvider·JwtAuthenticationFilter·TokenService(Redis). jjwt 0.12.x 최신 API는 Context7로
  확인. 검증 실패(만료/위조/형식오류) 구분 로깅하되 토큰 원문 미기록.
- → `07-1_SecurityConfig초안.md`. 토큰 재발급 시퀀스는 `07-2`에 Mermaid로.
- 게이트에서 기본값이 바뀌면 07-1의 해당 값·주석을 확정값으로 갱신한 뒤 Stage 3로 진행한다.

### 🚦 게이트 — 인증 설계 사람 검수·확정 🔴 (AskUserQuestion, 필수)
보안 단계이므로 **사람 확정 게이트 필수**. AskUserQuestion으로 다음 정책 값을 확정받는다(AI는 1안
추천만, 결정은 사람). 확정 전에는 Stage 3로 넘어가지 않는다.
- access/refresh 만료 시간(기본 제안 30분 / 14일).
- refresh 저장·rotation 방식, 로그아웃 시 무효화 정책(Redis 블랙리스트/화이트리스트 채택 여부).
- 카카오 등 소셜 계정과 기존 로컬 계정 **이메일 충돌 처리**(자동 병합 금지 — "확인 필요" 분기만 둘지).
- 토큰 전달 방식(헤더 vs 쿠키) — 쿠키면 CSRF 비활성 전제가 깨짐을 고지.

### Stage 3 — 카카오 OAuth2 소셜 로그인 (초안 · 05 명세에 있을 때만)
- **선행 점검(degrade)**: 05(엔드포인트표·openapi)에 **소셜 로그인 엔드포인트(`/oauth2/**`)·스키마가
  없고** 04에 `provider`/`provider_id` 컬럼도 없으면, OAuth2는 **현 범위 밖**이다. 임의 엔드포인트·
  스키마·컬럼을 발명하지 말고, 07-2에 **"차기 옵션" 설계 스케치(계정 충돌 "확인 필요" 분기 포함)와
  도입 전 선결 항목**만 남기고 본문 구현은 건너뛴다(05에 명세 추가·04 컬럼 추가가 선결).
- (05에 소셜 명세가 있을 때) spring-boot-starter-oauth2-client로 연동(Context7로 최신 확인). 흐름:
  카카오 인가 → 콜백 →
  사용자정보 조회 → 우리 `Member` 매핑 → 우리 JWT 발급.
- `application.yml` 카카오 client(client-id/secret은 환경변수 플레이스홀더), OAuth2UserService에서
  email/nickname 추출, SuccessHandler에서 우리 access/refresh 발급.
- **계정 매핑 정책: 같은 email 로컬 계정이 있으면 자동 병합하지 말고 "확인 필요" 분기 지점만**
  만들고 TODO 주석. 신규면 role 미정 상태로 가입 처리. **email이 없을 수 있는 케이스(동의 항목)의
  예외 처리 필수**(동의 항목 확인은 카카오 개발자 콘솔 — 사람 몫).
- → 플로우는 `07-2_JWT_OAuth플로우.md`(Mermaid 시퀀스).

### Stage 4 — RBAC 메서드 보안 + 소유권 검사 → 07-3
- `@EnableMethodSecurity` 활성화. **역할 검사(hasRole)와 소유권 검사(누구의 리소스인가)를 분리**해,
  어느 한쪽만으로 막지 않는다.
- **역할이 단일/부재면 역할 검사는 비활성**(없는 `hasRole('SITTER')` 발명 금지). 그땐 경로×역할
  매트릭스 대신 **"공개 vs 인증" 경로 매트릭스 + 소유권 가드가 1급**이 된다(`@PreAuthorize`로 path
  자원 ID 전수 가드). 매트릭스에 ADMIN/시스템 행은 04/05에 있을 때만.
- CareService 수정/삭제: `@PreAuthorize("hasRole('SITTER')")` + 본인 소유 여부를 서비스 레이어에서
  검사. Booking 상태 변경: 커스텀 권한 빈
  `@PreAuthorize("@bookingGuard.isParticipant(#bookingId, authentication)")`로 당사자 검사.
- 각 권한 규칙이 어떤 위협(수직 권한 상승·수평 권한 상승/IDOR)을 막는지 **표**로 정리.
- → `07-3_RBAC권한매트릭스.md`(경로×역할 매트릭스 + 규칙↔위협 표).

### Stage 5 — 보안 위협 점검 (security-review) → 07-4
- 머지 전 위협 점검을 강제한다. **security-review 스킬**로 SecurityConfig·JWT 필터/Provider·OAuth2
  핸들러·권한 가드를 OWASP 관점 점검:
  - 토큰 탈취 시 영향·무효화 가능 여부, 만료·rotation 실동작(A07 식별·인증 실패).
  - CSRF 비활성 전제(쿠키 미사용)가 코드에서 지켜지는지(A05 보안 설정 오류).
  - 인가 우회·수평/수직 권한 상승·IDOR 가능 지점(A01 접근통제 실패).
  - 에러·로그 정보 누출(계정 존재 노출, 토큰/비밀번호 로깅), 비밀키·OAuth secret 하드코딩(A02/A05).
- 발견 항목을 **심각도별**로 정리하고, 각 항목에 **수정 제안**과 **"사람이 결정할 정책 질문"을
  구분**한다. 이후 **code-review 스킬**로 일반 코드 품질(필터 예외 처리·민감정보 로깅)도 점검.
- → `07-4_위협점검.md`. (두 리뷰 스킬이 환경에 없으면 OWASP A01·A07·A02·A05 체크리스트를 정적
  생성하고 "수동 점검 필요 ⚠️" 표기.)
- **코드 diff 부재 degrade**: 두 리뷰 스킬은 변경된 코드 diff(PR/working tree)를 대상으로 동작한다.
  07은 `.md` 설계 초안만 만들고 실제 코드는 09(API개발)에서 작성되므로, 이 단계에선 **OWASP 정적
  점검으로 1차 차단**하고 07-4에 **"실코드 작성 후 두 리뷰 스킬로 재점검 필요 ⚠️"** 를 명시한다(검수
  강제는 코드가 생긴 뒤로 이월하되 생략하지 않는다).

### Stage 6 — 마무리(_검증체크리스트 + 산출물 경로 보고)
- `_검증체크리스트.md` 생성(아래 본문, `<주제>`/`<날짜>` 치환).
- 산출물 폴더 경로와 **"검수 전 초안 — 두 리뷰를 사람이 읽고 정책 질문에 답한 뒤에만 머지"** 고지를
  보고한다. 🔴/정책 질문이 잔존하면 ⚠️ 표기하고 "완료" 단정
  금지. (전수 보안 점검은 15 be-security-audit에서 다시 수행됨을 안내.)

## 도구 정확성 (probe·degrade)

- **Context7 MCP**(probe = ToolSearch 존재) = **이 단계 필수 도구**. Spring Security 6 / jjwt /
  OAuth2 Client 최신 설정. 부재 → 내장 지식 진행 + "버전 확인 필요 ⚠️"(폐지 API 혼입 위험 경고).
- **Figma MCP generate_diagram**(probe) = 07-2 인증·OAuth 시퀀스 FigJam. 부재 → Mermaid 시퀀스 폴백.
- **security-review / code-review 스킬** = 위협·품질 2중 검토(Stage 5). 환경에 없으면 OWASP 정적
  체크리스트로 degrade + "수동 점검 필요" 표기(단계 제1원칙상 사람 검수는 생략 불가).
- **python3** = 산출 YAML/설정 스니펫 파싱 점검. 부재 → 정적 체크리스트 degrade.
- **중단**: 필수 입력(05 인증 엔드포인트·역할)이 전혀 없고 사용자도 위치를 못 줄 때만(그 외 degrade).

## _검증체크리스트 본문 (Stage 6 생성)

```markdown
# 검증 체크리스트 — <주제> 인증·인가 구현 (작성일: <날짜>)

> AI 생성 인증 코드는 반드시 사람이 검수한 뒤에만 머지한다(이 단계 제1원칙).

- [ ] SecurityConfig가 폐지 API(WebSecurityConfigurerAdapter·authorizeRequests) 없이 람다 DSL로 작성됐는지(Context7 대조)
- [ ] 인가 경로 매트릭스 ↔ SecurityFilterChain 일치 (permitAll/인증/SITTER/OWNER/deny 누락 없음)
- [ ] JWT 필터가 서명뿐 아니라 만료(exp)를 검증하는지 — "만료된 토큰은 401" 테스트 존재
- [ ] 토큰 정책이 게이트 확정값과 일치(만료·rotation·무효화) / refresh·블랙리스트 Redis 실동작
- [ ] PasswordEncoder(BCrypt 등 단방향 해시) 실제 적용 — 평문·가역 암호화 아님
- [ ] 비밀번호·토큰 원문이 로그·에러 응답에 남지 않음 / 계정 존재 여부 미노출
- [ ] JWT 서명 키·카카오 client-secret 하드코딩 0 (환경변수/시크릿 매니저 주입)
- [ ] RBAC가 역할(hasRole) + 소유권 2층으로 분리 — IDOR(남의 예약 조작) 차단 지점 존재
- [ ] 카카오 email 충돌 자동 병합 안 함("확인 필요" 분기) / email 없는 케이스 예외 처리
- [ ] CSRF 비활성 전제(쿠키 미사용·헤더 JWT)가 토큰 전달 방식과 일치
- [ ] security-review + code-review 결과를 사람이 직접 읽고 정책 질문에 답함
- [ ] 거부 케이스(권한 없는 사용자 차단) 테스트가 성공 케이스만큼 꼼꼼함
```

## 주의

- **무검증 머지가 최악의 시나리오.** 인증/인가 결함은 곧 계정 탈취·데이터 유출. 두 리뷰
  (security-review·code-review)는 검수 강제 장치이고, 검토는 줄이지 않는다(이득은 초안 시간이지 검토 시간이 아님).
- **OWASP 인증 항목 기준**: A01(접근통제 실패·IDOR·권한 상승)·A07(식별·인증 실패·무효화 부재)·
  A02(키·시크릿 노출)·A05(CSRF·CORS·기본 설정). 15(보안 점검)에서 전수 재점검되지만 여기서 1차 차단.
- **흔한 실수 — 만료 검증 누락 JWT 필터**: 서명만 보고 exp를 안 보면 만료 토큰이 통과한다.
- **흔한 실수 — 인가 테스트 없이 통과**: 정상 흐름만 보고 거부 케이스를 안 보면 인가 결함이 숨는다.
  성공 케이스보다 **거부 케이스**를 더 꼼꼼히 테스트한다.

## 원본 가이드

- 이 스킬은 BE 가이드 **"07. 인증·인가 구현"**을 자동화한 것입니다.

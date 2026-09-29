# be-auth — 인증·인가 구현 자동화 스킬

05 API 명세·03 아키텍처를 받아 Spring Security 6 인증·인가 초안(SecurityConfig·JWT access/refresh·
카카오 OAuth2·RBAC 권한 매트릭스)과 OWASP 위협 점검을 생성하는 Claude Code 스킬입니다.
**AI는 표준 패턴 초안과 위협 회수율을, 보안 정책 결정과 최종 검수는 사람**이 맡습니다.

> BE 프로세스 7단계 "07. 인증·인가 구현"을 자동화합니다.
> 역할 분담: AI는 초안·위협 목록, **정책 결정과 인증 코드 검수는 사람**(이 단계 제1원칙).

## 무엇을 만들어 주나

`backend-output/<주제>/07_인증인가/`에 생성:

| 파일 | 내용 |
|---|---|
| `07-1_SecurityConfig초안.md` | SecurityFilterChain(람다 DSL)·인가 경로 매트릭스·STATELESS·CSRF 비활성 근거·401/403 JSON 핸들러·JWT 필터/Provider/TokenService(Redis) 초안 |
| `07-2_JWT_OAuth플로우.md` | 자체 로그인·토큰 재발급·로그아웃(Mermaid 시퀀스). 카카오 OAuth2는 05에 소셜 명세 있을 때만 본문(없으면 "차기 옵션"), 계정 충돌 "확인 필요" 분기 |
| `07-3_RBAC권한매트릭스.md` | 경로×역할 매트릭스(역할 단일/부재면 "공개 vs 인증" 2분류) + `@PreAuthorize`·소유권 가드(역할+소유권 2층)·규칙↔위협 표 |
| `07-4_위협점검.md` | OWASP(A01·A07·A02·A05) 위협 목록(심각도)·수정 제안과 "사람이 결정할 정책 질문" 분리 |
| `_검증체크리스트.md` | 사람이 확인할 항목 |

## 준비물 (입력)

1. **(필수) 05 API 명세** — `<루트>/05_API/05-2_openapi.yaml` 또는 `05-1_엔드포인트표.md`의 인증
   엔드포인트(`/api/auth/**`·`/oauth2/**`)와 역할. 없으면 위치를 묻고, 그래도 없으면 가이드 정본
   경로로 degrade(⚠️ 표기).
2. **(연결) 03 아키텍처 / 04-3 JPA엔티티 / 06-4 환경변수** — 있으면 stateless 전제·`Member.role`·
   키 주입(12-Factor)에 반영. 없으면 ⚠️ 보존(중단하지 않음).

스택 정본: Java 21 / Spring Boot 3.3 / Spring Security 6 / jjwt 0.12.x / Redis 7 / `Member`. 역할
모델은 04/05를 따른다(포밋 예시는 OWNER·SITTER이나, role 부재·단일 actor면 소유권 검사 중심으로 degrade).

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| Context7 MCP | 권장(이 단계 핵심) | 내장 지식 진행 + "버전 확인 필요 ⚠️"(폐지 API 혼입 위험) |
| security-review / code-review 스킬 | 권장 | OWASP 정적 체크리스트로 degrade + "수동 점검 필요" |
| Figma MCP (generate_diagram) | 선택 | 07-2 플로우를 Mermaid 시퀀스로 폴백 |
| python3 | 선택 | 설정 스니펫 정적 체크리스트로 degrade |

## 설치

```bash
mkdir -p ~/.claude/skills/be-auth
cp SKILL.md ~/.claude/skills/be-auth/SKILL.md
```

## 사용법

05 API 명세(또는 인증 엔드포인트)를 준비한 뒤:

```
포밋 인증·인가 구현해줘 (JWT + 카카오 OAuth2 + RBAC)
```

1. Context7로 Spring Security 6 최신 설정 확인(코드보다 먼저) → SecurityConfig·인가 매트릭스·JWT 초안
2. **🚦 인증 설계 사람 검수·확정(🔴 필수 게이트)** → 만료 시간·rotation·무효화·계정 충돌·토큰 전달 방식 확정
3. 카카오 OAuth2 플로우 → RBAC(역할+소유권) 매트릭스 → security-review/code-review 위협 점검 → 검증 체크리스트

발동 키워드: `인증 인가`, `JWT`, `OAuth`, `카카오 로그인`, `Spring Security`, `RBAC`, `로그인 구현`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `backend-output/<주제>/`를 본인 볼트 경로로 |
| 계승 출처(03·05) | `## 입력` | 상위 산출물 폴더를 본인 구조로 |
| 토큰 정책 기본값 | `### 🚦 게이트` / `### Stage 2` | access 30분·refresh 14일·rotation 기본 제안을 팀 정책으로 |
| 스택 버전 | 변경 포인트 주석 4번 | Spring Security·jjwt·Redis 버전 교체 후 Context7 재확인 |
| 트리거 키워드 | frontmatter `description` | 자기 표현으로 |

## 주의

- **AI 생성 인증 코드는 반드시 사람이 검수한 뒤 머지합니다.** "동작하는 것처럼 보이는" 잘못된 보안
  코드의 무검증 머지가 최악의 시나리오입니다.
- **정책 값은 사람이 정합니다.** 만료·rotation·키 관리·계정 충돌·CSRF/CORS 비활성은 보안 판단이지
  코드 취향이 아닙니다. AI에게 "알아서" 맡기지 마세요.
- **인가는 역할 + 소유권 2층**으로. 역할만 막으면 IDOR(남의 예약 조작)가 통과합니다.
- **시크릿·키는 코드/깃에 절대 넣지 않습니다.** 환경변수·시크릿 매니저로 주입(12-Factor).
- **거부 케이스를 더 꼼꼼히 테스트합니다.** 만료 토큰 401·권한 없는 사용자 차단을 반드시 확인.
- 검토 시간은 줄지 않습니다(의도된 것) — 자동화 이득은 초안 시간이지 검토 시간이 아닙니다.

## 원본 가이드

이 스킬은 BE 가이드 **"07. 인증·인가 구현"**을 자동화한 것입니다.

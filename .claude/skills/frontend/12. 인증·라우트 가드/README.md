# fe-auth-guard — 인증·라우트 가드 자동화 스킬

BE 07 인증 계약(토큰·카카오 OAuth·역할 클레임)을 받아 프론트의 **토큰 저장 전략(ADR) →
Next middleware 라우트 가드 → 권한별 UI·2차 인가 → 위협 점검(XSS/CSRF)**을 만드는 Claude Code
스킬입니다. **AI는 middleware matcher·refresh 큐·`<Can>` 같은 보일러플레이트를 짜고, "이 저장
전략·리다이렉트가 안전한가"는 사람 + security-review가 의심합니다.**

> FE 프로세스 12단계 "인증·라우트 가드"를 자동화합니다.
> 역할 분담: AI는 회수율(가드 누락 방지)·초안, **보안 판단은 사람**(인증은 한 번 뚫리면 전체가 무너짐).

## 무엇을 만들어 주나

`frontend-output/<주제-슬러그>/12_인증가드/`에 생성:

| 파일 | 내용 |
|---|---|
| `12-1_토큰저장전략.md` | ADR(0012): 쿠키전부 / access메모리+refresh쿠키 / localStorage 비교표(XSS/CSRF/SSR/복잡도) + 권장안·근거 |
| `12-2_middleware가드.md` | `src/middleware.ts` 초안 — 보호/공개 matcher, 쿠키 1차 차단, open redirect 방지 |
| `12-3_권한별UI.md` | `useAuth()` 훅·`<Can role>`·`/sitter/*` 서버 컴포넌트 2차 인가 |
| `12-4_위협점검.md` | 카카오 OAuth(state CSRF)·refresh single-flight 인터셉터·security-review 결함 표 |
| `_검증체크리스트.md` | 사람 확인 항목(🔴 보안 전수) |

## 준비물 (입력)

1. **(필수) BE 07 인증 규약** — 토큰 발급·카카오 콜백·역할 클레임. `<BE루트>/07_인증인가/` 또는
   BE 05 `openapi.yaml`의 `/auth` 경로. 없으면 중단합니다(역할 값·콜백 경로는 BE 정본 계승).
2. **(권장) FE 05 라우팅** — 보호/공개 라우트 목록 출처. 없으면 포밋 예시 목록을 가정 + ⚠️.
3. **(권장) FE 09 상태관리 / 10 API 연동** — 서버/클라 상태 분리 기준, refresh 인터셉터가 붙는
   fetch 클라이언트. 없으면 골격만 만들고 "연결 필요" 표기.
4. **(권장) FE 06 env 분리** — 카카오 키 `NEXT_PUBLIC_`/서버전용 구분 규약.

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| BE 07 인증 규약 | 필수 | 중단(또는 계약 가정 명시) |
| Context7 MCP | 선택 | 내장 지식 + "⚠️ Next 15 시그니처 확인 필요" |
| security-review 스킬 | 선택 | Stage 5 점검 항목을 수기 체크리스트로 |
| gh / git | 선택 | 변경 파일 수기 지정해 점검 |

## 설치

```bash
mkdir -p ~/.claude/skills/fe-auth-guard
cp SKILL.md ~/.claude/skills/fe-auth-guard/SKILL.md
```

## 사용법

BE 07 인증 규약(또는 openapi.yaml `/auth`)을 준비한 뒤:

```
BE 07 인증 계약 읽고 포밋 프론트 인증·라우트 가드 만들어줘
```

1. 토큰 저장 전략 비교표(ADR) 자동 생성
2. **🔴 토큰 저장 전략 + 보안 결정 확정** → 당신이 확정/수정 (필수 게이트, 가드 구현 전제)
3. middleware 가드 → useAuth·`<Can>`·2차 인가 → 카카오 OAuth·refresh 인터셉터 자동
4. **security-review로 변경분 스캔** → 발견 결함을 사람이 해소

발동 키워드: `프론트 인증`, `라우트 가드`, `토큰 저장`, `middleware`, `권한별 UI`,
`카카오 OAuth 연동`, `open redirect`, `auth guard`, `route guard`, `XSS CSRF`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `frontend-output/`를 볼트 경로 등으로 |
| 계승 출처 | `## 입력` | BE 07·05 openapi·FE 05/09/10 경로를 본인 폴더로 |
| 역할 모델 | 핵심 원칙·Stage 3 | `GUARDIAN/SITTER`를 BE 07 클레임 값으로 1:1 교체 |
| 저장 전략 결론 | Stage 1 | (b) 권장안을 팀 위협 모델에 맞게 |
| 스택 버전 | frontmatter·전반 | Next 15/TanStack Query v5/Zustand가 다르면 교체 |
| 트리거 키워드 | frontmatter `description` | 자기 표현으로 |

## 주의

- **AI는 안전하지 않은 코드도 그럴듯하게 짭니다.** localStorage 토큰 저장 같은 흔한 패턴을 무비판
  생성하기도 합니다. 저장 전략·쿠키 옵션·리다이렉트 대상은 사람이 검토 + security-review 교차 점검.
- **UI 숨김은 보안이 아닙니다.** `<Can>`으로 버튼을 숨겨도 API는 직접 호출 가능 — 최종 인가는 항상 BE.
- **토큰을 프론트가 디코드해 신뢰하지 않습니다.** JWT 페이로드는 검증 없이 읽는 정보입니다.
- **middleware는 Edge 런타임** — 무거운 검증·Node API 금지, 1차 차단(쿠키 유무)만.
- **open redirect / env 키 노출**이 가장 흔한 실수 — `next`는 내부 경로만, 시크릿은 `NEXT_PUBLIC_` 금지.

## 원본 가이드

이 스킬은 FE 가이드 **"12. 인증·라우트 가드"**를 자동화한 것입니다.

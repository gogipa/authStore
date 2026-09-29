# fe-routing-structure — 라우팅·화면 구조 설계 자동화 스킬

01 화면 목록·03 렌더링 전략·BE 05 OpenAPI를 넣으면 Next.js 15 App Router의 **화면→라우트 매핑표(route map) → route group·layout 경계 → `app/` 파일 트리 골격 → 코드 스플리팅 경계**를 생성하는 Claude Code 스킬입니다. AI는 화면을 빠짐없이 라우트로 매핑하고 특수 파일을 갖춘 트리를 찍어내는 회수 작업, **레이아웃 경계·UX 흐름 결정은 사람**이 합니다.

> FE 프로세스 5단계 "라우팅·화면 구조 설계"를 자동화합니다.
> 역할 분담: AI는 매핑·트리 골격, **route group 경계·결제 화면 탭 숨김 같은 구조 판단은 사람**.

## 무엇을 만들어 주나

`frontend-output/<주제-슬러그>/05_라우팅/`에 생성:

| 파일 | 내용 |
|---|---|
| `05-1_route맵.md` | 화면명·URL 경로·세그먼트·렌더링(03 계승)·인증·연동 API(operationId) 표 + 미매핑/고아 섹션 |
| `05-2_layout구조.md` | route group `(group)` 후보·근거, layout 공유 요소, 중첩 트리, 경계 애매 화면 옵션 2개 |
| `05-3_app트리.md` | `src/app/` 파일 트리 골격(layout/page/loading/error/not-found) + 주석(렌더링/인증/operationId) |
| `05-4_코드스플리팅경계.md` | 무거운 세그먼트 분할 후보(next/dynamic·ssr 옵션·근거) — 13단계 입력 |
| `_검증체크리스트.md` | 사람이 확인할 항목 |

## 준비물 (입력)

1. **(필수) 01 화면 목록** — `01_핸드오프분석/01-1_화면목록·컴포넌트인벤토리.md`.
2. **(필수) 03 렌더링 전략** — `03_아키텍처/03-1_렌더링전략맵.md`(페이지별 CSR/SSR/SSG/ISR).
3. **(권장) BE 05 OpenAPI** — `openapi.yaml`. 있으면 경로·operationId를 **1:1 계승**(재작명 금지), 없으면 화면 목록만으로 도출 + ⚠️ "API 미대조".
4. **(권장) 01-3 상태화면 커버리지** — 빈/로딩/에러 목록(특수 파일 배치 근거).

01 화면 목록 또는 03 렌더링 전략이 없으면 스킬이 위치를 묻고 중단합니다.

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| Context7 MCP | 권장(이 단계 핵심) | 내장 지식 + "Next 15 규칙 확인 필요 ⚠️" (error.tsx·route group 함정 명시) |
| Figma MCP (read) | 선택 | 01 화면 목록만으로 누락 점검 |
| BE 05 openapi.yaml | 권장 | operationId 열 공란, 10단계에서 채움 + ⚠️ |

## 설치

```bash
mkdir -p ~/.claude/skills/fe-routing-structure
cp SKILL.md ~/.claude/skills/fe-routing-structure/SKILL.md
```

## 사용법

01·03 산출물(가능하면 BE 05 openapi.yaml)을 준비한 뒤:

```
01 화면 목록과 03 렌더링 전략, openapi.yaml 읽고 route map 설계해줘
```

1. route map 생성(05-1) → route group·layout 경계 후보 생성(05-2)
2. **🚦 라우트 구조 확정** → 당신이 OK/수정 (route group 경계·경계 애매 화면 옵션·미매핑/고아 처리 결정 — 유일한 필수 개입)
3. `app/` 트리 골격(05-3) → 코드 스플리팅 경계(05-4) → 교차 검증 자동

발동 키워드: `라우팅 설계`, `App Router`, `route map`, `라우트 구조`, `route group`, `layout 경계`, `코드 스플리팅`, `routing`, `route structure`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `frontend-output/`를 원하는 경로로 (볼트 설치본은 FE/실행산출물/<주제>) |
| 계승 출처 | `## 입력` · 변경포인트 주석 | 01·03·openapi.yaml 경로를 본인 폴더 구조로 |
| Context7 / Figma | `## 도구 정확성` | 안 쓰면 degrade로 동작, 단락 조정 가능 |
| 라우터 종류 | 전반 | App Router 전제 — Pages Router 팀이면 부적합 |
| 트리거 키워드 | frontmatter `description` | 자기 표현으로 |

## 주의

- **App Router 규칙은 버전마다 바뀝니다.** AI 기억이 아니라 Context7로 Next 15 기준 확인 — `error.tsx`는 클라이언트 컴포넌트여야 하는 등 함정이 있습니다.
- **route group `(auth)`·`(app)`는 URL에 나타나지 않습니다.** 그룹명을 경로에 끼운 트리는 잘못 — 트리 생성 후 실제 URL을 확인하세요.
- **전체 페이지를 `'use client'`로 만들지 않습니다.** 상호작용은 잎 컴포넌트에만 경계를 둡니다(RSC 이점 유지).
- **동적 `[id]` 라우트의 not-found·loading 누락 주의.** AI가 page.tsx만 찍는 경우가 잦으니 트리에서 확인하세요. 상태 화면 실제 UI는 08단계에서 채웁니다.
- **API 경로를 프론트 편의로 재작명하지 마세요.** 10단계에서 매핑 비용이 발생합니다 — OpenAPI 경로를 그대로 따오고, 다르게 가려면 BE와 합의하세요.
- **한 방 스캐폴딩 금지.** route map·경계(05-1·05-2)를 사람이 확정한 뒤 트리를 찍습니다.

## 원본 가이드

이 스킬은 FE 가이드 **"05. 라우팅·화면 구조 설계"**를 자동화한 것입니다.

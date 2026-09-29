# fe-state-management — 상태 관리 자동화 스킬

08 화면 구현 코드와 01 화면↔API 의존맵을 넣으면 상태를 **서버상태(TanStack Query)와 클라상태로
분류**하고, 클라상태 위치(local/global/URL)를 정해 **Zustand store 골격**까지 만드는 Claude Code
스킬입니다. 사람은 **상태 위치(서버/클라 경계 + global 승격) 확정 1번**에 개입합니다.

> FE 프로세스 9단계 "상태 관리"를 자동화합니다.
> 역할 분담: AI는 상태 회수·분류 초안·store 보일러플레이트, **무엇을 전역에 올릴지의 경계 판단은 사람**.

## 무엇을 만들어 주나

`frontend-output/<주제-슬러그>/09_상태관리/`에 생성:

| 파일 | 내용 |
|---|---|
| `09-1_상태분류표.md` | 상태 인벤토리 + 서버/클라 분류(근거·복사 경고·경계 사례) + 위치 결정(local/global/URL) |
| `09-2_query키설계.md` | 서버 상태의 query key 규약·계층·무효화 키 (훅 구현은 10 위임) |
| `09-3_zustand스토어설계.md` | global 확정 항목만 TS strict slice store 초안 + prop drilling 탐지 리포트 |
| `_검증체크리스트.md` | 사람이 확인할 항목 |

## 준비물 (입력)

1. **(필수) 08 화면 구현** — `08_화면구현/`의 화면 컴포넌트 코드. 상태 조각 추출 원천. 없으면 중단.
2. **(권장) 01 화면↔API 의존맵** — `01_핸드오프분석/01-2_화면API의존맵.md`. "출처=서버" 판별 근거.
   없으면 코드의 fetch/query 호출로 추정 + ⚠️ 표기.

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| Context7 MCP | 선택 | 내장 지식 + ⚠️ 버전 주의 (v5 시그니처 직접 확인 필요) |
| pnpm / npx | 선택 | 설치 명령은 생성, "로컬 실행 필요" 안내 |
| vercel-react-best-practices 스킬 | 선택 | 리렌더 패턴 검토 생략 |

## 설치

```bash
mkdir -p ~/.claude/skills/fe-state-management
cp SKILL.md ~/.claude/skills/fe-state-management/SKILL.md
```

## 사용법

08 화면 구현을 마친 뒤:

```
08 화면 코드 읽고 상태 관리 설계해줘
```

1. 상태 인벤토리 추출 → 서버/클라 분류(규칙 먼저) 자동
2. **상태 위치 확정** → 당신이 경계 사례 귀속·global 승격을 재검증 (유일한 개입)
3. 위치 결정(기본 local) → query key 설계 → Zustand store 골격 → prop drilling 탐지 자동

발동 키워드: `상태 관리`, `서버상태 클라상태`, `상태 분류`, `Zustand 스토어`, `prop drilling`, `state management`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` / 상단 주석 | `frontend-output/`를 원하는 경로로 (볼트 설치본은 FE/실행산출물) |
| 계승 출처 | `## 입력` / 상단 주석 | 08·01 산출물 폴더 경로를 본인 구조로 |
| 분류·위치 규칙 | `### Stage 2` / `### Stage 3` | 서버/클라·local/global/URL 기준을 팀에 맞게 |
| 스택 버전 | 상단 주석 | TanStack Query v5·Zustand가 다르면 교체 |
| 트리거 키워드 | frontmatter `description` | 자기 표현으로 |

## 주의

- **서버 상태를 Zustand에 넣지 마세요** — 가장 비싼 실수. 서버 데이터는 TanStack Query가 단일 출처(분류에서 경고로 잡습니다).
- **전역의 기본값은 local.** AI는 의심스러우면 전역으로 올립니다 — global 승격은 사람이 재검증.
- **검색 필터·정렬·페이지네이션은 URL(searchParams) 우선** — Zustand에 넣으면 새로고침·공유에서 날아갑니다.
- **이 단계는 클라 전역 store까지** — 서버 상태 훅·낙관적 업데이트는 10 API 연동이 BE 05 OpenAPI 계약을 받아 구현합니다.
- **한 방 프롬프트 금지** — 단계별 산출물을 파일로 남깁니다.

## 원본 가이드

- 이 스킬은 FE 가이드 **"09. 상태 관리"**를 자동화한 것입니다.

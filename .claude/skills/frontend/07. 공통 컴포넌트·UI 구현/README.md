# fe-ui-components — 공통 컴포넌트·UI 구현 자동화 스킬

04 디자인토큰·컴포넌트 계층(과 디자인 핸드오프 스펙)을 넣으면 변형 매트릭스(CVA) →
Button 기준 구현·Radix 위임 → Storybook 8 카탈로그 → jsx-a11y·RTL 접근성 안전망을 만드는
Claude Code 스킬입니다. 사람은 **컴포넌트 API(변형 매트릭스) 확정 1번**만 개입합니다.

> FE 프로세스 07단계 "공통 컴포넌트·UI 구현"을 자동화합니다.
> 역할 분담: AI는 골격·CVA 변형·스토리·a11y 속성 초안(반복·정형), **변형 축 설계와 접근성 판단은 사람**.

## 무엇을 만들어 주나

`frontend-output/<주제>/07_공통컴포넌트/`에 생성:

| 파일 | 내용 |
|---|---|
| `07-1_컴포넌트변형매트릭스.md` | 컴포넌트 인벤토리 + 변형 매트릭스 (컴포넌트·variant·size·state·직접구현/Radix위임·사유·출처) |
| `07-2_컴포넌트초안.md` | 구현 컴포넌트 목록·파일 위치(src/components/ui/*.tsx)·props(API)·CVA variants 요약. Button 기준 + Radix 위임 패턴, 04 토큰만·매직값 0 |
| `07-3_storybook.md` | 컴포넌트별 스토리(CSF3·autodocs)·Button Matrix·상태 스토리(error/disabled/loading)·addon-a11y·argTypes |
| `07-4_접근성점검.md` | jsx-a11y 위반 표 + RTL 테스트 목록 + 키보드/스크린리더 "접근성 확인 필요" 수동 점검 목록 |
| `_검증체크리스트.md` | 사람이 확인할 항목 |

> 실제 컴포넌트 `.tsx`는 코드베이스 `src/components/ui/`에 작성하고, 위 `.md`는 매트릭스·위치·점검을 기록하는 산출물 문서입니다.

## 준비물 (입력)

1. **04 디자인토큰·컴포넌트 산출물** (필수) — `frontend-output/<주제>/04_디자인토큰컴포넌트/`의 토큰·Tailwind 클래스·컴포넌트 계층·Code Connect 매핑 (토큰·명명 원천).
2. **(권장) 디자인 시리즈 13 핸드오프 스펙** — 컴포넌트별 간격·상태별 스타일·변형. Figma MCP `get_design_context`/`get_metadata`로 직접 조회 가능하면 그쪽 우선.
3. **(권장) 디자인 시리즈 09 모션 사양** — Modal 진입/이탈 트랜지션. 없으면 토큰 duration/easing 기본값.

> 04 토큰·컴포넌트 계층이 없으면 위치를 묻고 중단합니다. 그 외 보조 입력은 없어도 진행(degrade — 핸드오프 스펙 부재 시 시안 스크린샷·수기 스펙 입력 안내).

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code + frontend-design 스킬 | 필수 | — |
| Context7 MCP | 선택 | CVA·Radix·Storybook8·React19 최신 조회 생략, 내장 지식 + "버전 확인 필요 ⚠️" |
| Figma MCP (read) | 선택 | 핸드오프 스펙은 시안 스크린샷·수기 스펙으로 degrade |
| pnpm / Storybook / Vitest / eslint(jsx-a11y) | 선택 | 설정·스토리·테스트는 생성하되 "로컬 실행 필요" 안내 |

## 설치

```bash
mkdir -p ~/.claude/skills/fe-ui-components
cp SKILL.md ~/.claude/skills/fe-ui-components/SKILL.md
```

## 사용법

04 산출물(과 핸드오프 스펙)을 준비한 뒤:

```
04 토큰·컴포넌트 계층 읽고 포밋 공통 UI 컴포넌트 구현해줘
```

1. 컴포넌트 인벤토리·변형 매트릭스 도출 (07-1)
2. **🚦 컴포넌트 API(변형 매트릭스) 확정** → 당신이 변형 축·Radix 위임 경계 OK (유일한 개입)
3. Button 기준 구현 → Radix 위임(Modal 등) (07-2) → Storybook 카탈로그 (07-3) → jsx-a11y·RTL 접근성 (07-4) → 검증 체크리스트 자동

발동 키워드: `공통 컴포넌트 구현`, `UI 컴포넌트`, `CVA 변형`, `변형 매트릭스`, `Storybook`, `헤드리스 Radix 래퍼`, `컴포넌트 라이브러리`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `frontend-output/<주제>/`를 본인 볼트 경로로 |
| 계승 출처 | `## 입력` | 04·13 핸드오프·09 모션 경로를 본인 폴더 구조로 |
| 도구(MCP/CLI) | `## 도구 정확성` | Context7/Figma/pnpm·eslint·vitest 가용에 맞게 |
| 스택 버전 | frontmatter 아래 변경 포인트 | React19/Radix/Storybook8 → 팀 스택으로 |
| 트리거 키워드 | frontmatter `description` | 자기 표현으로 |

## 주의

- **AI는 시안에 없는 변형도 만들어냅니다.** intent를 7개로·size를 4단계로 쪼개는 과설계가 잦습니다 — 07-1 매트릭스의 축만 구현, 매트릭스 밖 변형은 제거.
- **토큰 우회 매직값을 경계하세요.** `bg-[#5B8DEF]`·`p-[13px]` 하드코딩은 디자인 검수 최다 적발 항목 — 04 토큰 클래스만 사용.
- **jsx-a11y 통과 ≠ 접근성 통과.** 정적 린트는 1차 그물일 뿐 — 키보드·스크린리더 수동 확인을 대체하지 않습니다. 자동 점검 통과를 접근성 완료로 보고 금지.
- **헤드리스 위임 vs 직접 구현 경계를 지키세요.** Modal/Select/Tabs는 Radix 상속, Badge/Spinner는 직접구현 (07-1 기준).
- **공통 컴포넌트는 순수 UI** — 도메인 로직(Booking 상태 분기·API 호출)은 넣지 않습니다. 도메인 결합은 8단계.
- **시안 제작·토큰 정의는 디자인 몫** — FE 07은 확정 토큰·시안의 코드 구현입니다.
- **한 방 생성 금지** — 변형 매트릭스를 사람이 확정한 뒤 코드로 넘어갑니다. **Storybook 방치 금지** — 컴포넌트를 고치면 스토리도 갱신.

## 원본 가이드

이 스킬은 FE 가이드 **"07. 공통 컴포넌트·UI 구현"**을 자동화한 것입니다.

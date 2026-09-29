---
name: fe-ui-components
description: >-
  04 디자인토큰·컴포넌트 계층(과 디자인 핸드오프 스펙)을 받아 공통 UI 컴포넌트를
  구현한다. 변형 매트릭스(CVA) 확정 → Button 기준 구현·Radix 위임 → Storybook 8
  카탈로그 → jsx-a11y·RTL 접근성 안전망. 토큰 재정의 없이 04 토큰만 사용,
  도메인 로직 없는 순수 UI. "공통 컴포넌트 구현", "UI 컴포넌트", "CVA 변형",
  "변형 매트릭스", "Storybook", "헤드리스 Radix 래퍼", "컴포넌트 라이브러리",
  "ui components", "component library", "CVA variants", "headless primitive",
  "storybook stories" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# 공통 컴포넌트·UI 구현 (Common UI Components)

04에서 코드화한 디자인 토큰·컴포넌트 계층을 입력으로, 화면 어디에나 등장하는 공통 UI 컴포넌트(Button·Input·Modal 등)를 **실제 코드 + Storybook 문서**로 구현한다. 8단계 화면 구현이 "조립"이 되도록 재사용 라이브러리를 갖춘다. **AI는 골격·CVA 변형·스토리·a11y 속성 초안(반복·정형), 변형 축 설계와 접근성 판단은 사람.**

<!-- 변경 포인트 (배포본 → 본인 환경에 맞게 수정):
  1. 출력 경로: 기본 frontend-output/<주제-슬러그>/07_공통컴포넌트/. 볼트 설치본은 FE/실행산출물/<주제> 고정 가능.
  2. 계승 출처: 04 디자인토큰컴포넌트(<루트>/04_디자인토큰컴포넌트/), 디자인 시리즈 13 핸드오프 스펙 경로를 본인 폴더 구조로 수정.
  3. 도구(MCP/CLI): Context7(CVA·Radix·Storybook8·React19 최신) / Figma read(get_design_context·get_code_connect_map) / pnpm·eslint(jsx-a11y)·vitest — 없으면 degrade.
  4. 스택 버전: React 19 / Next.js 15 / TS strict / Tailwind / CVA / Radix UI / Storybook 8. 팀이 다르면 교체.
  5. 컴포넌트 코드는 frontend-output 코드베이스에 직접 작성 가능(아래 파일들은 위치·계약을 기록하는 산출물 문서). 실제 .tsx 경로는 src/components/ui/ 기준.
-->

## 핵심 원칙

- **04 산출물 계승, 재발명 금지 — 단 확정 상태일 때만.** 토큰·Tailwind 클래스·컴포넌트 계층은 **04에서 코드화한 것만 사용**. 색·간격 리터럴(`bg-[#5B8DEF]`·`p-[13px]`)을 끼우지 않고 매직값은 토큰 클래스로 치환. 04에 `⚠️`/[확인 필요]가 남은 토큰·변형은 보존(임의 확정 금지).
- **시안 제작·토큰 정의는 이 단계 밖**(디자인 시리즈 몫). FE 07은 **확정된 시안·토큰을 코드 컴포넌트로 구현**한다. `frontend-design` 스킬도 "새 디자인"이 아니라 "토큰 적용 구현" 용도로만 쓴다.
- **변형 매트릭스를 코드보다 먼저 확정한다.** 컴포넌트 API는 한 번 굳으면 화면 전체가 의존해 되돌리기 비싸다 — 07-1에서 변형 축(variant×size×state)을 표로 못 박고 사람이 확정한 뒤 코드 생성(한 방 생성 금지).
- **시안에 있는 변형만 만든다(과설계 금지).** AI는 intent를 7개로 늘리거나 size를 4단계로 쪼갠다. 핸드오프에 없는 축은 "확인 필요" 태그 — 코드에 임의 변형이 들어오면 제거.
- **접근성은 기본값으로 박는다.** focus-visible 링(토큰 색)·키보드 조작·aria 속성·색상에만 의존하지 않는 상태 표현을 처음부터 넣는다. 단 **jsx-a11y 통과 ≠ 접근성 통과** — 정적 린트는 1차 그물, 키보드·스크린리더 수동 확인을 대체하지 않는다.
- **까다로운 접근성은 헤드리스 프리미티브에 위임한다.** Modal(포커스 트랩·ESC·스크롤 잠금)·Select(타입어헤드)·Tabs(화살표 내비)·Checkbox/Radio는 직접 만들면 버그가 끝없다 — Radix 위에 우리 토큰만 입혀 접근성을 상속. 단 Badge·Spinner처럼 단순한 것까지 Radix로 감싸면 번들만 는다(07-1 기준).
- **공통 컴포넌트는 도메인을 모르는 순수 UI다.** 포밋 도메인 로직(Booking 상태 분기·특정 API 호출)을 넣으면 재사용이 깨진다. 도메인 결합은 8단계 화면에서.

## 입력

- **필수**: `<루트>/04_디자인토큰컴포넌트/`(04-1 tailwind토큰·04-2 css변수·04-3 컴포넌트계층·04-4 CodeConnect매핑 — 토큰·컴포넌트 명명 원천).
  <!-- 변경 포인트(입력 경로): 본인 설치본은 <루트>=FE/실행산출물/<주제>. 상위 산출물이 다른 폴더면 수정 -->
- **권장**:
  - 디자인 시리즈 **13 핸드오프 스펙**(컴포넌트별 간격·상태별 스타일·변형) — Figma MCP `get_design_context`/`get_metadata`로 직접 조회 가능하면 그쪽 우선.
  - 디자인 시리즈 **09 모션 사양**(Modal 진입/이탈 트랜지션) — 없으면 토큰 duration/easing 기본값.
- 04(토큰·컴포넌트 계층)가 없으면 **중단**(위치 질의 또는 디자인 04 먼저 권장). 그 외 보조 입력은 degrade(핸드오프 스펙 부재→시안 스크린샷·수기 스펙 입력 안내).

## 출력 위치: `frontend-output/<주제-슬러그>/07_공통컴포넌트/`

<!-- 변경 포인트(출력 경로): 기본은 현재 작업 폴더의 frontend-output/<주제-슬러그>/07_공통컴포넌트/.
     실제 컴포넌트 .tsx는 코드베이스 src/components/ui/에 작성. 아래 .md는 매트릭스·위치·점검을 기록하는 산출물 문서. -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `07-1_컴포넌트변형매트릭스.md` | 컴포넌트 인벤토리. 표: 컴포넌트 \| variant 축 \| size 축 \| 상태(state) \| 직접구현/Radix위임 \| 위임 사유 \| 출처(04/13 핸드오프). 시안 없는 변형 제외·핸드오프에 없는 축은 "확인 필요" | Stage 1 |
| `07-2_컴포넌트초안.md` | 구현 컴포넌트 목록·파일 위치(src/components/ui/*.tsx)·각 컴포넌트 props(API)·CVA variants 요약·cn 유틸 위치. Button(기준)·Radix 위임(Modal 등) 패턴. 04 토큰 클래스만, 매직값 0 | Stage 2~3 |
| `07-3_storybook.md` | 컴포넌트별 스토리 목록(CSF3·autodocs)·Matrix 스토리(Button intent×size)·상태 스토리(error/disabled/loading)·addon-a11y preview 설정·argTypes 컨트롤 | Stage 4 |
| `07-4_접근성점검.md` | jsx-a11y 위반 표(규칙·파일·조치) + RTL 테스트 목록(컴포넌트당 *.test.tsx) + 키보드/스크린리더 "접근성 확인 필요" 수동 점검 목록 | Stage 5 |
| `_검증체크리스트.md` | 사람 확인 항목 | Stage 5 |

- 출력 폴더가 없으면 생성. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`). 모든 FE 스킬은 같은 `<루트>=frontend-output/<주제-슬러그>`를 공유.

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- `<루트>/04_디자인토큰컴포넌트/`를 읽는다(토큰·컴포넌트 계층·CodeConnect 명명). **없으면 중단**(위치 질의 / 디자인 04 먼저 권장).
- 디자인 13 핸드오프 스펙 로드 시도(또는 Figma read). 없으면 ⚠️ + 시안 스크린샷·수기 스펙 입력 안내.
- **도구 probe**: Context7·Figma read(ToolSearch 존재) / pnpm·eslint·vitest·storybook(bash 시도). 없으면 degrade(아래 "도구 정확성").

### Stage 1 — 컴포넌트 인벤토리·변형 매트릭스 → 07-1
- 04 컴포넌트 계층 + 13 핸드오프 스펙을 기준으로 만들 컴포넌트와 각 변형 축을 표로 못 박는다(코드보다 설계 먼저).
- 아래 "대상 예"는 **범용 예시일 뿐 체크리스트가 아니다** — **04 인벤토리·13 핸드오프에 실재하는 컴포넌트만** 표에 넣는다(없는 컴포넌트 생성 = 컴포넌트 자체 과설계, 금지).
  - 대상 예(있는 것만 채택): Button, IconButton, Input, Textarea, Select, Checkbox, Radio, Badge, Avatar, Modal(Dialog), Toast, Spinner, Skeleton, Tabs.
- 표: `컴포넌트 | variant 축 | size 축 | 상태(state) | 직접구현/Radix위임 | 위임 사유 | 출처`.
  - Button 예(**축 형태 예시 — 이 변형들을 만들라는 뜻 아님**): intent(primary/…) × size(sm/md/lg) × state(…). 실제 축은 시안 실재만(size 시안 0건 → size 축 미정의, intent도 시안에 있는 것만).
- **Modal·Select·Tabs·Checkbox·Radio처럼 포커스 트랩·키보드 내비가 필요한 것은 Radix 위임 후보**로 표시하고 사유를 한 줄로. Badge·Spinner 등 단순한 것은 직접구현.
- **시안에 등장하지 않는 변형은 만들지 않는다**(과설계 금지). 핸드오프에 없는 축·상태(빈/에러 등)는 "확인 필요" 태그 + 디자인 역질의 대상으로 기재.
- **대상 없음 degrade**: Radix 위임 후보(Modal/Select 등)·Spinner·Input 등 예시 컴포넌트가 도메인에 0건이면 Stage 3·해당 스토리·테스트를 "대상 없음"으로 비운다(억지 생성 금지). Stage 2 "loading 시 Spinner"도 도메인에 Spinner가 없으면 a11y 동작(`aria-busy`/disabled)만 박고 시각 인디케이터는 시안 확정 후 보류.

### 🚦 게이트 — 컴포넌트 API(변형 매트릭스) 확정 (사람 개입, 필수)
AskUserQuestion으로 07-1(변형 매트릭스 + Radix 위임 경계 + "확인 필요" 항목)을 제시 → 사용자가 OK/수정.
- 핵심 결정 항목(사람이 쥐는 판단):
  - **변형 축의 적정성** — intent/size가 과설계 아닌가, 줄일 축은 없는가.
  - **직접구현 vs Radix 위임 경계** — 어디까지 헤드리스에 맡길지.
  - **"확인 필요" 항목 처리** — 핸드오프에 빠진 상태(빈/에러)는 디자인에 역질의할지, 이번 범위에서 뺄지.
- **07-1을 사람이 확정하기 전에는 Stage 2(코드 생성)로 넘어가지 않는다**(한 방 생성 방지 — 컴포넌트 API는 화면 전체가 의존하므로 중간 판단을 검토해야 한다). 이후 모든 컴포넌트는 이 매트릭스의 축만 구현한다.

### Stage 2 — Button 기준 컴포넌트 구현 → 07-2
- 가장 많이 쓰는 Button을 먼저 만들어 팀의 컴포넌트 작성 규약(템플릿)을 정한다. `frontend-design` 스킬 사용(새 디자인 금지 — **04 코드화 토큰/Tailwind 클래스만**).
- 요구사항(예): 위치 `src/components/ui/button.tsx`, CVA로 변형 정의(intent×size×fullWidth, 07-1 매트릭스 그대로). **React 19 기준 ref를 prop으로** 받고 asChild(Slot) 지원, className은 tailwind-merge(`cn` 유틸)로 머지. 접근성: loading 시 `aria-busy`+disabled+Spinner, focus-visible 링은 토큰 색. 타입은 `ButtonHTMLAttributes` 확장 + `VariantProps<typeof buttonVariants>`.
- **Context7로 CVA·React 19 ref 처리 최신 패턴을 먼저 확인**(폐기된 불필요한 forwardRef 답습 금지). `cn` 유틸(src/lib/utils.ts) 없으면 clsx+tailwind-merge로 함께 생성. 07-2에 파일 위치·props(API)·CVA variants 요약 기록.

### Stage 3 — Radix 위임 컴포넌트(Modal 등) 구현 → 07-2에 추가
- 07-1에서 Radix 위임으로 가른 컴포넌트(Modal/Select/Tabs 등) 구현. **Context7로 해당 Radix 패키지 최신 API 먼저 확인**.
- Modal 예: `src/components/ui/modal.tsx`. Radix의 **포커스 트랩·ESC 닫기·스크롤 잠금·aria 속성은 그대로 상속**(재구현 금지). Overlay/Content는 토큰 클래스, 진입/이탈 트랜지션은 디자인 09 모션 계승(없으면 토큰 duration/easing 기본).
- 합성 컴포넌트로 노출(Modal.Root/Trigger/Content/Title/Description/Close), size 변형만 CVA·나머지 동작은 Radix 위임, 사용 예시 한 개 주석 포함. ⚠️ **단순 컴포넌트(Badge·Spinner)는 Radix로 감싸지 않는다**(07-1 기준).

### Stage 4 — Storybook 스토리·문서 → 07-3
- `src/components/ui/` 구현 컴포넌트에 Storybook 8 스토리 생성(컴포넌트당 `*.stories.tsx`, **CSF3·autodocs 태그**).
- Button: intent×size 전 조합 **Matrix 스토리** + Loading/Disabled/FullWidth 개별. Modal: 기본 열림·긴 본문(스크롤)·size별. Input/Select: default/error(메시지 노출)/disabled.
- `@storybook/addon-a11y`가 각 스토리에서 활성화되도록 preview 설정 확인, argTypes로 variant prop을 컨트롤로 노출. Storybook을 **디자인 검수 접점**으로 쓴다(이탈 조기 검출) — 변형 추가 시 스토리도 함께 갱신(카탈로그가 진실).

### Stage 5 — 접근성·컴포넌트 테스트 + 검증 체크리스트 → 07-4
- **jsx-a11y 정적 점검**: `eslint-plugin-jsx-a11y`로 `ui/` 전체 점검, 위반을 표로(규칙·파일·조치).
- **Vitest + RTL 테스트**(컴포넌트당 `*.test.tsx`): Button(disabled/loading 시 클릭 핸들러 미호출·`aria-busy`), Modal(Trigger 클릭 열림·ESC 닫힘·열림 시 포커스가 Content로 이동), Input error(`aria-invalid=true`·`aria-describedby`가 에러 메시지 지칭). 실패 시 컴포넌트를 고쳐 통과(TDD).
- **키보드만으로** Modal 열고 닫기·Tabs 좌우 이동 등 수동 시나리오 점검. 안 되는 케이스는 **"접근성 확인 필요"** 목록으로 분리(jsx-a11y 통과 ≠ 접근성 통과 — 자동 점검을 끝으로 보고 금지).
- `_검증체크리스트.md` 생성(`<주제>`/`<날짜>` 치환, 아래 본문). 마지막으로 산출물 폴더 경로와 "AI가 줄이는 건 작성 시간이지 판단 시간이 아니다 — 매트릭스 검토·접근성 수동 확인 시간은 줄지 않는다" 고지를 보고.

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe) = CVA·Radix UI·Storybook 8·React 19 최신 API 조회(ref 처리 변화·Radix 최신 버전). 골격 잡기 전에 조회. 없으면 **내장 지식 + "버전 확인 필요 ⚠️"**(폐기 패턴 답습 주의).
- **Figma read**(probe) = `get_design_context`/`get_metadata`로 핸드오프 스펙(간격·상태별 스타일), `get_code_connect_map`으로 Figma↔코드 컴포넌트 매핑 확인(04에서 매핑했으면 같은 이름 사용). 없으면 시안 스크린샷·수기 스펙으로 degrade.
- **pnpm / Storybook / Vitest / eslint(jsx-a11y)**(bash probe) = 설치·실행. 없으면 **설정·스토리·테스트는 생성하되 "로컬 실행 필요"** 안내(degrade, 중단 아님).
- **중단**은 필수 입력(04 토큰·컴포넌트 계층) 부재 시에만. 그 외는 degrade.

## _검증체크리스트 본문 (Stage 5 생성)
```markdown
# 검증 체크리스트 — <주제> 공통 컴포넌트·UI 구현 (작성일: <날짜>)

> AI는 골격·변형·스토리·a11y 속성 초안까지. 변형 축 설계와 접근성은 사람의 판단이다.
> AI가 줄이는 건 작성 시간이지 판단 시간이 아니다 — 매트릭스 검토·접근성 수동 확인 시간은 줄지 않는다.

- [ ] 07-1 변형 매트릭스를 사람이 확정한 뒤 코드 생성으로 넘어갔는가 (한 방 생성 금지)
- [ ] 시안에 없는 변형이 코드에 들어오지 않았는가 (과설계 — intent/size 임의 증식 제거)
- [ ] 토큰 우회 매직값 0건 — bg-[#...]·p-[..px] 등 리터럴 없이 04 토큰 클래스만 사용 (디자인 검수 최다 적발 항목)
- [ ] Radix 위임 경계 준수 — Modal/Select/Tabs는 Radix 상속, Badge/Spinner는 직접구현 (07-1 기준)
- [ ] React 19 ref 처리·Radix/Storybook 최신 API를 Context7로 확인 (폐기된 forwardRef 등 답습 안 함)
- [ ] 공통 컴포넌트에 도메인 로직(Booking 상태 분기·특정 API) 미포함 — 순수 UI
- [ ] Storybook: 변형·상태가 카탈로그에 반영 (변형 추가했는데 스토리 누락 없음, addon-a11y 활성)
- [ ] jsx-a11y 위반 0 또는 조치 — 단 jsx-a11y 통과 ≠ 접근성 통과
- [ ] 키보드·스크린리더 수동 점검 — "접근성 확인 필요" 목록을 사람이 실제로 확인 (자동 점검을 끝으로 보고 금지)
- [ ] RTL 테스트 통과 — Button(disabled/loading 클릭 차단·aria-busy)·Modal(열림/ESC/포커스 이동)·Input(aria-invalid/describedby)
```

## 주의
- **AI는 시안에 없는 변형도 만들어낸다.** intent를 7개로·size를 4단계로 쪼개는 과설계가 잦다 — 07-1 매트릭스 축만 구현, 매트릭스 밖 변형은 제거.
- **토큰 우회 매직값을 경계한다.** `bg-[#5B8DEF]`·`p-[13px]` 하드코딩은 디자인 검수 최다 적발 항목 — 04 토큰 클래스만, 리터럴은 토큰으로 치환.
- **jsx-a11y 통과 ≠ 접근성 통과.** 정적 린트는 "alt 누락" 수준만 잡는다. 포커스 순서·스크린리더 낭독·키보드만으로 전 동작 가능 여부는 실제로 확인 — 자동 점검 통과를 접근성 완료로 보고 금지.
- **헤드리스 위임 vs 직접 구현 경계 준수** — Badge·Spinner까지 Radix로 감싸면 번들만 늘고, Modal을 직접 만들면 접근성 버그가 난다(07-1 기준).
- **React 19 / 최신 API는 Context7로 확인** — ref 처리·Radix·Storybook 최신 API는 학습 시점과 어긋날 수 있다. 골격 전 조회로 폐기 패턴(불필요한 forwardRef 등) 답습 방지.
- **흔한 실수 — 컴포넌트에 화면 로직 섞기**: 도메인 로직(Booking 상태 분기·API 호출)을 넣으면 재사용이 깨진다. 순수 UI로, 도메인 결합은 8단계.
- **흔한 실수 — Storybook 방치**: 컴포넌트를 고치면 스토리도 갱신해야 카탈로그가 진실로 남는다. 변형 추가했는데 스토리에 빠지면 검수가 그 변형을 못 본다.

## 원본 가이드
- 이 스킬은 FE 가이드 **"07. 공통 컴포넌트·UI 구현"**을 자동화한 것입니다.

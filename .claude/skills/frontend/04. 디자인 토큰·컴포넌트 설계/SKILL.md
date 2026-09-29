---
name: fe-design-tokens-components
description: >-
  디자인 시리즈가 확정한 디자인 토큰·컴포넌트 사전을 프론트 코드(SSOT)로 옮긴다. 토큰을
  한 글자도 새로 만들지 않고 Tailwind config·CSS 변수(3계층 primitive→semantic→component)로
  코드화 → 아토믹 컴포넌트 인벤토리 → CVA 변형 스키마 → Figma Code Connect 매핑 →
  토큰 드리프트 점검. "디자인 토큰 코드화", "Tailwind 토큰", "tokens.css", "CSS 변수
  토큰", "컴포넌트 계층", "아토믹 디자인", "CVA 변형", "Code Connect", "토큰 드리프트",
  "design tokens to code", "atomic components", "cva variants", "code connect",
  "token drift" 같은 요청에서 사용. (토큰 "정의"·시안 제작은 디자인 04/08 몫.)
metadata:
  version: 1.0.0
---

# 디자인 토큰·컴포넌트 설계 (Design Tokens & Components)

디자인 시리즈가 **정의**한 디자인 토큰(컬러 스케일·타이포·스페이싱·radius·breakpoint)과 컴포넌트
사전(배리언트 매트릭스)을 프론트 코드의 단일 진실 공급원(SSOT)으로 옮기는 단계다. 토큰을 한 글자도
새로 만들지 않고 `tailwind.config`·CSS custom properties(3계층)·CVA 변형 스키마로 **코드화**하고,
Figma 컴포넌트와 코드 컴포넌트를 Code Connect로 묶는다. 여기서 정한 토큰 이름·컴포넌트 계층이
07(공통 컴포넌트)·08(화면 구현)의 모든 className이 참조하는 기준선이 된다.
**AI는 변환·회수율(토큰→코드 전개·CVA화·드리프트 스캔), "어디까지 atom인가"·토큰 매핑 확정 같은
계층 경계 판단은 사람.**

<!-- 변경 포인트 (배포본 → 본인 환경에 맞게 수정):
  1. 출력 경로: 기본 frontend-output/<주제-슬러그>/04_디자인토큰컴포넌트/. 볼트 설치본은 FE/실행산출물/<주제> 고정 가능.
  2. 계승 출처: 디자인 08 토큰 가이드/Figma Variables, 디자인 04 토큰, 03 폴더구조(03_아키텍처/) 경로를 본인 폴더 구조로 수정.
  3. 도구(MCP/CLI): Context7(Tailwind @theme·CVA 최신 문법) / Figma MCP(get_variable_defs·get_metadata·Code Connect) / pnpm — 없으면 degrade.
  4. 스택 버전: React 19 / Next 15 / TS strict / Tailwind CSS / CVA. 팀이 Tailwind v3면 theme.extend, v4면 @theme — Context7로 버전 문법 확인.
-->

## 핵심 원칙
- **상위 산출물 계승, 재발명 금지 — 토큰의 출처는 항상 디자인(Figma 라이브러리).**
  - **디자인 08 토큰 가이드/Figma Variables → 04-1·04-2로 1:1 코드화**: 토큰 **이름·값을 한 글자도
    새로 만들지 말 것.** 가이드/Variables에 있는 것만 코드화한다. 가이드에 없어 임의로 채운 값은
    **`/* 디자인 확인 필요 */` 주석**으로 분리(임의 확정 금지).
  - **디자인 08 배리언트 매트릭스 → 04-3·04-4**: 컴포넌트명·배리언트 속성(variant/size/state)을
    1:1 계승. BE 도메인 용어(Member/SitterProfile/Booking/Review/Chat) 임의 재작명 금지.
  - 디자인 가이드에 잔존한 `⚠️`/`[확인 필요]`는 코드 주석으로 보존(임의 메우기 금지).
- **3계층을 코드 변수 계층으로 그대로 옮긴다**: primitive(`--blue-600` 원시 값) → semantic
  (`--color-primary`, primitive를 `var()`로 참조) → component(필요한 것만). 라이트/다크 등 모드는
  **semantic 레이어에서만 분기**(`:root` / `[data-theme="dark"]`) — 컴포넌트 코드는 모드를 모른다.
- **새 토큰 금지를 프롬프트로 강제**: FE가 편의상 토큰을 추가하면 디자인 시스템이 둘로 갈라진다.
  "한 글자도 새로 만들지 말 것 / 없으면 디자인 확인 필요"를 매 스텝 못 박는다. 개선 제안은 디자인에
  역제안, 코드는 정본을 따른다.
- **CVA로 변형을 선언적으로**: 배리언트 매트릭스를 `cva()`로 1:1 옮겨 디자인 정의와 대조 가능하게.
  모든 클래스는 semantic 토큰만 참조(하드코딩 색/px 금지). 누락 조합(예 ghost+loading) 점검은 AI.
- **Code Connect 오연결 금지**: 불확실한 매핑은 **등록하지 말고 목록으로** 남겨 사람이 확인. 잘못된
  매핑은 없느니만 못하다.
- **단계별 파일로 끊는다**: 토큰(04-1·04-2) → 인벤토리(04-3) → CVA(04-3 변형) → Code Connect(04-4)
  → 드리프트. 한 방 생성 금지(중간 판단 검토 불가).
- **시안 제작이 아니다**: 컬러를 고르거나 새 토큰을 정의하는 건 디자인 04/08의 몫. FE는 확정 토큰을
  코드 표현으로만 옮긴다.

## 입력
- **필수**: 디자인 시리즈 **08 토큰 가이드**(`tokens.css` 후보·토큰 표) **또는 Figma Variables**
  (Figma MCP `get_variable_defs`) — 토큰 코드화의 원천. 둘 다 없으면 **중단**(토큰 출처 위치 질의).
  <!-- 변경 포인트(입력 경로): 본인 설치본은 디자인 산출물 폴더/Figma 파일 키. 다른 폴더면 수정 -->
- **권장**:
  - 디자인 08 **컴포넌트 배리언트 매트릭스**(없으면 Figma `get_metadata`로 컴포넌트 메타데이터 직접 읽기, 둘 다 없으면 인벤토리 ⚠️ 초안)
  - 디자인 **04** 디자인 시스템(토큰 출처 보강) / **03 아키텍처**(`03_아키텍처/03-2_폴더구조.md` — 컴포넌트 코드 경로 기준)
- 그 외 보조 입력은 degrade.

> 토큰·컴포넌트의 "정의"는 스킬 범위 밖(디자인 04/08). 이 스킬은 확정본을 코드로 옮긴다.

## 출력 위치: `frontend-output/<주제-슬러그>/04_디자인토큰컴포넌트/`

<!-- 변경 포인트(출력 경로): 기본은 현재 작업 폴더의 frontend-output/<주제-슬러그>/.
     볼트 설치본은 FE/실행산출물/<주제> 고정 가능. 모든 FE 스킬이 같은 <루트>를 공유. -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `04-1_tailwind토큰.md` | `tailwind.config.ts`(v3 `theme.extend` CSS변수 참조) 또는 v4 `@theme` 블록 초안. 디자인 가이드 1:1, 신규값 0건(있으면 "디자인 확인 필요") | Stage 1 |
| `04-2_css변수.md` | `src/styles/tokens.css` 초안 — primitive + semantic CSS 변수, 참조 체인(`--color-primary: var(--blue-600)`), 모드 분기(`:root`/`[data-theme]`) | Stage 1 |
| `04-3_컴포넌트계층.md` | 아토믹 인벤토리(계층\|컴포넌트\|Figma명\|코드경로\|상태) + 컴포넌트별 CVA 변형 스키마(`*.variants.ts` 초안, semantic 토큰만 참조, 누락 조합 점검) | Stage 2~3 |
| `04-4_CodeConnect매핑.md` | Figma 컴포넌트↔코드 컴포넌트 매핑 표(Figma 속성명 ↔ code prop) + `*.figma.tsx` Code Connect 정의 초안. 확정만 등록·불확실은 목록 | Stage 4 |
| `04-5_토큰이탈리포트.md` | 토큰 외 하드코딩(hex/rgb/임의 px·임의값 클래스) 발견 위치 + semantic 토큰 후보. 자동 치환 금지 | Stage 5 |
| `_검증체크리스트.md` | 사람 확인 항목 | Stage 6 |

- 출력 폴더가 없으면 생성. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`).

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- 디자인 08 토큰 가이드 또는 Figma Variables를 확보한다. **둘 다 없으면 중단**(토큰 출처 위치 질의 — 토큰을 지어내선 안 된다).
- 디자인 08 배리언트 매트릭스 / 03 폴더구조를 로드(있으면). 없으면 Stage 2에서 Figma `get_metadata` 또는 ⚠️ 초안 처리.
- **도구 probe**: Context7(ToolSearch 존재)·Figma MCP(ToolSearch 존재)·pnpm(bash 시도). 없으면 degrade(아래 "도구 정확성").
- Tailwind 버전(v3/v4) 확인 — 산출물 문법이 갈린다.

### Stage 1 — 디자인 토큰을 코드로 코드화 → 04-1·04-2
- 디자인 08 토큰 가이드(또는 `get_variable_defs` 결과)를 **3계층 그대로** 코드로 옮긴다.
  - **primitive**: 원시 값(`--blue-600: #...`). 가이드 값 1:1.
  - **semantic**: 의미 토큰(`--color-primary`, `--color-danger` 등), primitive를 `var()`로 참조.
  - **component**: 가이드에 있는 것만(억지 생성 금지).
- 라이트/다크 모드는 **semantic 레이어에서 분기**(`:root` / `[data-theme="dark"]`).
- **토큰 이름·값을 한 글자도 새로 만들지 말 것.** 가이드에 없어 임의로 채운 값은 `/* 디자인 확인 필요 */`.
- Tailwind 문법은 **Context7로 버전(v3 `theme.extend` vs v4 `@theme`) 확인 후** 작성. Context7 부재·quota 초과로 **버전을 끝내 확정 못 하면**: greenfield(신규 React19/Next15)면 **v4 `@theme` 기본 채택** + v3 폴백 병기, "버전 확인 필요 ⚠️" 표기(둘 다 같은 `tokens.css` 변수를 가리키므로 후속 확정 시 한쪽만 채택). 버전 선택은 게이트 자동진행 항목으로 기록.
- → `04-1_tailwind토큰.md`(config/`@theme`) + `04-2_css변수.md`(tokens.css).

### Stage 2 — 컴포넌트 계층(아토믹) 인벤토리 도출 → 04-3
- Figma `get_metadata`(또는 디자인 08 배리언트 정의)를 읽어 atom/molecule/organism 분류 **초안**.
  - **atom**: Button, Input, Badge, Avatar, Icon 등 더 못 쪼개는 단위.
  - **molecule**: SitterCard, BookingStatusChip, RatingStars 등 atom 조합.
  - **organism**: SitterList, BookingForm, ReviewSection 등 molecule+도메인 조합.
- 각 컴포넌트에 (Figma 컴포넌트명 ↔ 예정 코드 경로 `src/components/...`) 매핑 컬럼. 코드 경로는 03 폴더구조 기준.
- BE 도메인 용어(Member/SitterProfile/Booking/Review/Chat) **임의 재작명 금지.**
- 이번 스코프 밖이라 만들지 않을 것은 **"보류"** 표시(억지로 만들지 말 것).
- 표: `계층 | 컴포넌트 | Figma명 | 코드경로 | 상태(작업/보류)`.

### 🚦 게이트 — 토큰 매핑·컴포넌트 계층 확정 (사람 개입, 필수)
AskUserQuestion으로 04-1·04-2 토큰 매핑 + 04-3 계층 초안을 제시 → 사용자가 OK/수정.
- 핵심 결정 항목(사람이 쥐는 판단):
  - **"디자인 확인 필요"로 표시된 임의값 처리** — 디자인에 회부할지, 잠정 사용할지.
  - **아토믹 계층 경계** — 도메인 결합도 높은 컴포넌트(SitterCard 등)가 atom인가 molecule인가(팀 합의 문제).
  - **이번 스코프 컴포넌트 확정** — "보류" 유지/해제(미리 다 만들지 않는다).
  - **semantic 토큰 충분성** — 모드 전환·필요 의미 토큰 누락 여부.
- **토큰 매핑·계층을 사람이 확정하기 전에는 Stage 3(CVA)로 넘어가지 않는다**(한 방 생성 방지 — 중간 판단을 검토해야 한다).

### Stage 3 — CVA 변형 스키마 작성 → 04-3에 추가
- 확정된 배리언트 매트릭스를 `cva()` 정의로 변환(예: Button = variant:primary/secondary/ghost/danger × size:sm/md/lg × state:default/disabled/loading).
- **모든 클래스는 Stage 1 semantic 토큰만 참조**(`bg-primary`, `text-on-primary` 등). 하드코딩 색/px 금지.
- CVA API 문법(`compoundVariants` 포함)은 **Context7로 확인**(부재 시 내장 지식 + ⚠️).
- 정의되지 않은 조합(예 ghost+loading)이 매트릭스에 있는지 **누락 점검·보고**.
- `defaultVariants` 지정, `tailwind-merge`(`cn` 유틸)로 외부 className 병합 가능하게.
- → `src/components/atoms/<X>/<x>.variants.ts` 초안(**cva 정의만**, 컴포넌트 구현은 07단계).

### Stage 4 — Figma Code Connect 매핑 → 04-4
- Figma read로 대상 컴포넌트의 **`get_code_connect_suggestions`로 매핑 후보를 먼저 제안**받는다.
- 코드 컴포넌트 props(variant/size/disabled)와 Figma 배리언트 속성을 1:1 연결. prop 이름이 Figma
  속성명과 다르면 **매핑 표**로 정리(예: Figma "Type" → code "variant").
- **확정된 매핑만 `add_code_connect_map`으로 등록**. 불확실한 건 등록하지 말고 목록으로 남긴다(오연결 금지).
- → `<X>.figma.tsx`(Code Connect 정의) + 매핑 표(`04-4_CodeConnect매핑.md`).
- **전제 점검 먼저**: Code Connect는 ①published Figma 컴포넌트+node-id URL ②코드 컴포넌트 실체(`.tsx`) ③(Org/Enterprise) 가 필요. **Figma MCP가 있어도 이 전제가 미충족**(상위 디자인이 Figma WRITE 미호출·dry-run, 또는 07 구현 전이라 `.tsx` 부재)이면 **도구 호출 없이 degrade** — 매핑 명세표만 1급, `.figma.tsx`·`add_code_connect_map` 미수행, "publish+레포 확인 후 등록" 안내.
- Figma MCP 부재 시: 매핑 표만 수기 작성하고 "Figma에서 Code Connect 등록 필요" 안내(degrade).

### Stage 5 — 토큰 드리프트 점검 → 04-5
- `src/` 아래 `.tsx`/`.css`에서 디자인 토큰을 벗어난 하드코딩을 스캔(읽기 전용):
  - 토큰 외 hex(`#xxxxxx`)·`rgb()`·4의 배수 스페이싱 스케일을 벗어난 임의 px.
  - Tailwind 임의값 클래스(`bg-[#...]`, `p-[13px]` 등).
- 각 발견 위치에 대응 semantic 토큰 후보 제안(없으면 "토큰 없음 — 디자인 확인 필요").
- **자동 치환 금지** — 사람이 검토 후 일괄 적용(의도적 예외: 외부 SDK 위젯 등 보존).
- → `04-5_토큰이탈리포트.md`. (스캔 대상 코드가 아직 없으면 "대상 없음 — 07/08 이후 재실행" 처리.)

### Stage 6 — 마무리 + 검증 체크리스트
- `_검증체크리스트.md` 생성(`<주제>`/`<날짜>` 치환):

```markdown
# 검증 체크리스트 — <주제> 디자인 토큰·컴포넌트 설계 (작성일: <날짜>)

> AI는 변환·회수율까지. 계층 경계·토큰 매핑 확정은 사람의 판단이다.

- [ ] 04-1·04-2 토큰이 디자인 08 가이드/Figma Variables와 1:1 (신규 토큰 0건 — AI가 지어낸 값 차단)
- [ ] "디자인 확인 필요" 주석 항목을 디자인에 회부했는가 (임의 채움값 검수, WCAG 대비 재확인)
- [ ] 3계층 참조 체인 정합 (semantic이 primitive를 var()로 참조, 모드는 semantic에서만 분기)
- [ ] Tailwind 버전 문법 일치 (v3 theme.extend / v4 @theme — Context7 확인)
- [ ] 04-3 아토믹 계층 경계를 사람이 확정 (도메인 결합 컴포넌트·"보류" 처리)
- [ ] CVA 클래스가 semantic 토큰만 참조 (하드코딩 색/px 0건) / 누락 조합 점검 완료
- [ ] Code Connect: 확정 매핑만 등록, 불확실은 목록 (오연결 0건) / prop↔Figma 속성 1:1
- [ ] 토큰 드리프트 리포트 검토 후 사람이 적용 (자동 치환 안 함, 의도적 예외 보존)
- [ ] FE가 토큰을 "개선"하지 않았는가 (이름 변경 0건 — 정본은 디자인)
```

- 마지막으로 산출물 폴더 경로와 "토큰이 SSOT — 07·08 className 기준선이며, 디자인 시리즈 14(퍼블리싱 검수)를 그대로 거친다" 고지를 보고한다.

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe) = Tailwind `@theme`/`theme.extend` 버전 문법·CVA API(`compoundVariants`) 최신 조회. 없으면 **내장 지식 + "버전 확인 필요 ⚠️"** 표기.
- **Figma MCP**(probe) = `get_variable_defs`(토큰), `get_metadata`/`get_design_context`(컴포넌트 구조), `get_code_connect_suggestions`/`add_code_connect_map`(매핑). 없으면 **토큰·컴포넌트 메타데이터 수기 입력 안내** + 매핑 표만 작성(등록은 "Figma에서 직접" 안내). 토큰 가이드 .md가 있으면 그것으로 코드화.
- **pnpm**(bash probe) = `pnpm add class-variance-authority tailwind-merge clsx` 안내. 없으면 설정·스크립트는 생성하되 "로컬 설치·실행 필요" 표기.
- **중단**은 필수 입력(토큰 가이드/Figma Variables) 부재 시에만. 그 외는 degrade.

## 주의
- **AI는 없는 토큰을 그럴듯하게 채운다.** 가이드에 빠진 값을 임의로 메우는 경우가 잦다 — "디자인 확인 필요" 주석 강제, 토큰 값은 디자인 08 가이드/Figma Variables와 직접 대조. 임의 채움값은 WCAG 대비 재확인.
- **Tailwind 버전 문법 혼동** — v3 `theme.extend`와 v4 `@theme`는 다르다. Context7로 프로젝트 버전 확인 후 변환.
- **Code Connect 오연결은 추적성을 망친다** — prop 이름이 Figma 속성명과 미묘하게 달라도 AI가 매칭해버린다. 불확실한 매핑은 등록 금지·목록만.
- **아토믹 계층은 정답이 없다** — atom/molecule 경계는 팀 합의. AI 분류는 초안, 도메인 결합도 높은 컴포넌트(SitterCard 등) 계층은 사람이. 스코프 밖은 "보류" 유지.
- **드리프트 자동 치환 금지** — 의도적으로 토큰을 벗어난 예외(외부 SDK 위젯)까지 망가뜨린다. 점검은 자동, 치환은 사람 검토 후.
- **흔한 실수 — FE가 토큰을 "개선"한다** — "이 이름이 더 낫다"는 유혹은 Figma·다른 시리즈와 어긋나게 만든다. 개선은 디자인에 역제안, 코드는 정본을 따른다.
- **흔한 실수 — 한 방 생성** — 토큰→CVA→Code Connect를 한 번에 뽑으면 계층 경계·매핑 판단을 검토할 수 없다. 게이트(토큰 매핑·계층 확정)를 사람이 거친 뒤 진행.

## 원본 가이드
- 이 스킬은 FE 가이드 **"04. 디자인 토큰·컴포넌트 설계"**를 자동화한 것입니다.

---
name: design-system
description: >-
  디자인 컨셉(컬러 무드·톤앤매너)을 재현 가능한 디자인 토큰으로 굳히는 스킬. 컬러 스케일
  (50~900)과 WCAG 대비비, 모듈러 타이포 스케일, 4px 스페이싱·그리드·radius를 Python으로
  산출(계산이 진실)하고, 마크다운 토큰 가이드(SSOT)에서 CSS 변수와 Figma Variables·스타일을
  파생한다. 무드보드(03)와 컴포넌트화(08) 사이 단계. "디자인 시스템", "디자인 토큰", "컬러
  팔레트", "컬러 스케일", "타이포 스케일", "스페이싱 토큰", "WCAG 대비", "Figma Variables",
  "tokens.css", "design system", "design tokens", "color scale", "type scale",
  "contrast check" 같은 요청에서 사용. (무드보드·컨셉은 03 / 컴포넌트화는 08.)
metadata:
  version: 1.0.0
---

<!-- 경로 정의(배포본): 아래 두 줄을 본인 환경 경로로 바꿔 설치한다. 입력은 디자인03 산출물에서 읽고, 출력은 디자인 04 폴더에 쓴다(이전 단계에 쓰지 않음) -->
<!-- 변경 포인트: <디자인입력> = design-moodboard-output/<주제>/03_무드보드 -->
<!-- 변경 포인트: <출력루트> = design-system-output/<주제>/04_디자인시스템 -->

# 디자인 시스템·컬러·타이포 가이드 정의 (Design System / Tokens)

무드보드와 컨셉(design-moodboard)에서 "어떤 느낌인가"를 정했다면, 이 스킬은 그 느낌을
**재현 가능한 규칙**으로 굳힌다. 컬러 팔레트·타이포 스케일·스페이싱·그리드·radius 토큰과
그 사용 규칙을 정의한다. 여기서 Claude는 "디자인 도구"가 아니라 **계산기 겸 규칙 엔진**이다 —
대비비·모듈러 스케일·4px 정렬 같은 **결정론적 계산**을 Python으로 돌리고, 브랜드 정합·최종 톤
보정은 사람이 한다.

## 핵심 원칙 (어기면 토큰이 그럴듯하게 틀린다)

- **대비비·스케일은 "취향"이 아니라 "계산"이다 → Python 스크립트의 stdout이 진실.** WCAG 대비비
  (상대휘도)·모듈러 스케일(base×ratio)·4px 정렬·OKLab 명도 보간은 답이 하나인 계산이다. **LLM
  암산 금지.** 스크립트가 `scripts/out/*.json`으로 결과를 내고, 마크다운·CSS·preview는 그 JSON을
  **인용/주입**한다(재계산·재반올림 금지).
- **3자 정합은 "수치 동등성"으로 검증한다(글자 일치 아님).** `json.dump`는 `8.10`을 `8.1`로
  저장하지만 stdout/md는 `8.10`으로 쓸 수 있다 — 순진한 문자열 비교는 값이 옳아도 오차단한다.
  **비교는 반올림 자릿수를 고정한 수치 동등성으로** 하고, **표시 포맷을 못박는다**: 대비비는 소수
  2자리(`:.2f`)로 stdout·json·md·preview가 동일 포맷. (이 포맷 통일이 게이트 블로킹의 전제.)
- **OKLab 상수는 지어내지 않는다 — 단 fetch 실패 ≠ 정확성 실패.** OKLab 3×3 행렬·sRGB 선형화
  상수는 Context7(CSS Color 4 명세)에서 fetch해 **주석에 출처**를 박는 것이 1순위다. **Context7이
  unreachable(쿼터 초과·장애)이면 W3C CSS Color 4 §12 표준 상수를 하드코딩 + 출처 주석으로 degrade**
  한다(이 상수는 공개 불변값이라 fetch 실패가 곧 오류가 아니다). 어느 경로든 **알려진 sRGB→OKLCH
  변환쌍 1~2개를 스크립트가 stdout에 assert**한다. **중단은 "assert 자체가 실패"할 때만**(상수가
  실제로 틀림). WCAG 2.1 상수도 명시: 오프셋 0.05, 선형화 임계 0.04045·gamma 2.4, 가중치
  0.2126/0.7152/0.0722, **반올림 전 원값으로 비교**. (sanity: black/white=21.00, #767676/white≈4.54.)
- **SSOT는 마크다운, 파생은 마크다운→CSS→Figma 단방향.** 값이 갈리면 항상 마크다운 기준.
- **semantic은 primitive를 alias로 참조.** 화면은 `action/primary`를 쓰고 `color/primary-600`을
  직접 쓰지 않게 — 테마 교체·리브랜딩이 한 군데 수정으로 끝난다.
- **네이밍은 값 생성 전에 못박는다.** `primary` vs `brand`, `gray` vs `neutral`, `danger` vs
  `error` — Figma·CSS·코드가 공유하므로 나중에 바꾸면 세 군데를 동시에 고쳐야 한다.
- **publish는 사람이 한다.** 생성 ≠ 게시. 게시는 다른 파일에 즉시 영향 → 검증 후 디자이너가 직접.
- **이 산출물은 초판이지 완성이 아니다.** 08에서 토큰이 더 드러난다 — 스케일 규칙을 깨지 않는 선에서 SSOT부터 갱신·재파생.
- **경계값은 사람이 재확인.** 4.3:1 vs 4.6:1 경계 대비비는 실제 도구로 한 번 더.

## 입력

- **`<디자인입력>`**(읽기 전용) · **`<출력루트>`**(쓰기). 이전 단계에 **쓰지 않는다.**
  ⚠️ 원본 가이드의 평면경로 `디자인/산출물/`(입력·출력 양쪽)은 **스킬 배포 폴더와 충돌**하므로
  쓰지 않는다 — 입력은 `03_무드보드`, 출력은 `04_디자인시스템`.

| 등급 | 파일 | 용도 |
|---|---|---|
| **필수** | `<디자인입력>/03-4_디자인컨셉정의서.md` | 확정 컨셉·톤앤매너·컬러 무드 방향 — 토큰 의도 1급 기준 |
| **필수(seed)** | `<디자인입력>/03-3_컨셉비주얼·컬러무드.md`의 확정 컨셉 hex 후보 | brand seed 추천 출처(`확정 아님` 라벨) |
| 선택 | 사용자 제공 기존 Figma 파일 URL | 라이브러리 감사(Stage 5) 대상 |

### brand seed 회수 (ID 우선 매칭)
03-4가 확정한 컨셉 **ID/이름**(예: `확정: D1`)으로 03-3에서 **같은 방향의 컬러 무드 hex 후보**를
회수한다(03-3엔 여러 후보가 있으므로 확정 컨셉으로 골라야 함 — ID 우선, 이름 보조). 후보는
`확정 아님` 라벨이므로 **04는 "추천 seed"로 제시할 뿐 자동 확정하지 않는다**. 매칭 실패 시 회수
중단 + `[확인 필요]` → 게이트에서 사용자 입력.

### 부재 분기
- **중단**: 슬러그 0개 / 03-4 부재 / **OKLab 변환쌍 assert 실패**(상수가 실제로 틀림 — 암산 우회 금지).
- **degrade**: 03-3 부재·후보 hex 0개 → seed를 게이트에서 사용자 입력 / **Context7 unreachable →
  W3C 표준 OKLab 상수 하드코딩+assert** / 기존 Figma URL 없음 → Stage 5 감사 생략·신규 직행 /
  **입력에 dry-run·가상예시 고지가 있으면 4종 파생(stdout·md·css·html) 전체에 배너 전파**.
- 슬러그 해소: `디자인/리서치/` 하위 1개 자동채택 / 복수 게이트 / 0개 위치질문 후 중단. **한글
  경로는 Glob/Read만**(Bash ls/find 금지·rtk 패닉). **dry-run 시 Figma probe·write 생략.**

## 출력 위치: `<출력루트>/`

| 파일 | 내용 | stage |
|---|---|---|
| `04-1_디자인토큰_컬러.md` | 컬러 스케일(HEX·OKLCH) + WCAG 표(라이트+다크) — **scripts/out/color.json 인용**(SSOT) | Stage 2 |
| `04-2_디자인토큰_타이포_스페이싱.md` | 모듈러 타이포·스페이싱·radius·그리드 — typespace.json 인용 | Stage 3 |
| `04-3_라이브러리감사.md` | (조건부) 기존 Figma Variable 대조표·충돌/중복 목록 | Stage 5 |
| `scripts/color_tokens.py` | 컬러 스케일·대비비 계산(런타임 생성물·재실행 가능) | Stage 2 |
| `scripts/type_space_tokens.py` | 타이포·스페이싱·radius·그리드 계산 | Stage 3 |
| `scripts/out/*.json` | 계산 결과 머신리더블 캡처(md·css·preview가 인용) | Stage 2·3 |
| `tokens.css` | CSS custom properties(라이트/다크) — 가이드 파생 | Stage 4 |
| `tokens-preview.html` | 스와치·타이포·스페이싱·WCAG 검수 페이지 | Stage 4 |
| `_검증체크리스트.md` | 사람 확인 항목 | Stage 7 |
| (옵트인) Figma Variables·스타일 | 가이드 파생 미러(생성≠publish) | Stage 6 |

## 파이프라인

### Stage 0 — 슬러그·입력 로드·probe·degrade
- 슬러그 해소(위). 03-4 로드(없으면 중단). **03-4 확정 컨셉 ID가 정확히 1개인지 assert**(0개·복수
  → `[확인 필요]`·seed 회수 보류). 03-3 seed 후보 회수(ID 우선 매칭), dry-run 플래그 계승.
- **도구 probe(하드코딩 금지)**: MCP tool만 probe — `whoami`·`get_libraries`·`get_variable_defs`·
  `search_design_system`·`use_figma`. **figma-generate-library는 SKILL이라 probe가 아니라 invoke
  절차**(Stage 6). frontend-design = 내장 스킬(probe 불요). **dry-run 시 Figma probe·write 생략.**

### Stage 1 — 의존성 프리플라이트
- `python3 -c "import math"` 가용만 확인(**stdlib만 — install 사다리 불요**). OKLab 상수는 Stage 2
  스크립트에서 Context7 fetch(또는 unreachable 시 W3C 표준 상수) + 변환쌍 assert. 스크립트 위치 =
  `<출력루트>/scripts/`(재실행 가능하게 남김).

### 🚦 게이트1 — seed·네이밍·semantic·타이포 상수 확정 (사람, 필수·1블로킹)
AskUserQuestion **멀티문항**: (a) brand seed(03-3 추천 후보 또는 사용자 hex), (b) 네이밍 규칙
(primary|brand / gray|neutral / danger|error), (c) **semantic 색(success/warning/danger/info)
seed hex** — SKILL 기본 팔레트를 추천으로 제시, 사람 확정(계산 아닌 입력값이므로 비결정 방지),
(d) **타이포 보조 상수**(weight·line-height 비율·letter-spacing) — SKILL 기본값 명시 후 조정 받음.
**값 생성 전에 못박는다.** 확정 전 Stage 2 미진입.

### Stage 2 — 컬러 스케일 + WCAG (Python) → `04-1`
`scripts/color_tokens.py` 작성·실행:
- OKLab 행렬·sRGB 선형화 상수를 **Context7 fetch(또는 unreachable 시 W3C CSS Color 4 §12 표준
  상수)로 확보 + 주석 출처** + 알려진 sRGB→OKLCH 변환쌍 1~2개 **stdout assert**(상수 오류 차단).
- seed에서 **50~900 10단계(50,100,…,900)**, neutral 10단계(**색조는 03-4 컬러무드 방향에서 파생** —
  완전 무채색 vs 웜/쿨 틴트), semantic(게이트1 확정 색 + 텍스트용 어두운 변형). 각 HEX + OKLCH.
- **WCAG 2.1 대비비**(상수 위 명시·반올림 전 원값·표시 `:.2f`): **라이트+다크 양면** 조합
  (neutral-900 on white, primary-600 on white, white on primary-600, danger on white,
  neutral-500 on white, + 다크 표면 위 텍스트) → AA본문(4.5)/AA큰텍스트(3)/AAA(7) ✅/❌. 탈락은
  "텍스트로 쓰지 말 것". sanity assert: black/white=21.00.
- **stdout + `scripts/out/color.json`** 출력. `04-1`은 JSON을 그대로 인용(재계산 금지).

### Stage 3 — 타이포·스페이싱·radius·그리드 (Python) → `04-2`
`scripts/type_space_tokens.py` 작성·실행:
- 모듈러 타이포: base 16px × ratio 1.25(Major Third) → **caption/body-sm/body/body-lg/title/
  heading/display 7단계 고정 이름**, 각 font-size(px·rem)·line-height(비율·px)·weight·
  letter-spacing(게이트1 보조 상수). 모바일 우선 + display/heading 데스크톱 확대값.
- 스페이싱: 0,2,4,8,12,16,20,24,32,40,48,64. **2는 half-step 허용**, 검출 로직 = "half-step(2)
  외 4 미배수 위반"(스크립트가 자기 입력 2를 위반으로 잡지 않게).
- radius: 4px 배수(none/sm 4/md 8/lg 12/full).
- 그리드: 모바일(4컬럼/16px gutter/16px margin)·태블릿(8컬럼)·데스크톱(12컬럼/24px gutter) +
  container max-width + breakpoint(360/768/1280).
- 게이트1 네이밍 일관. **stdout + `scripts/out/typespace.json`** → `04-2` 인용.

### Stage 4 — CSS 변수 + 검수 preview (frontend-design) → `tokens.css`·`tokens-preview.html`
frontend-design 스킬로:
- `:root` CSS custom properties(`--color-*`,`--font-size-*`,`--line-height-*`,`--space-*`,
  `--radius-*`, breakpoint) + 라이트/다크 2테마(`prefers-color-scheme`/`[data-theme="dark"]`).
  변수명 = 네이밍 규칙과 **1:1 매핑표 정합**(Figma slash·CSS kebab은 표기체계가 달라 글자일치가
  아니라 매핑표로 검증).
- `tokens-preview.html`: 스와치(50~900)·타이포 견본(실제 한글/영문)·스페이싱 막대 + WCAG 표.
  **WCAG 숫자는 `scripts/out/color.json`에서 정적 주입(재계산 금지·표시 `:.2f`)**, 대비 ❌ 텍스트는 빨간 배지.
- 사람 검수 → 톤 조정 시 **Stage 2/3 마크다운(SSOT)부터 고치고 재실행**(가이드→코드 단방향).

### 🚦 게이트2 = figma-generate-library Phase 0 승인 (사람, 필수 / Figma 쓰기)
AskUserQuestion: "기존 Figma 파일 감사 후 얹기(URL 필요) / 신규 생성 / Figma 생략(md+CSS만)".
**미동의·미인증·view-only·dry-run → Figma 단계(5·6) degrade**(마크다운+CSS가 1급). 이 게이트가
figma-generate-library의 Phase 0(스코프 락+gap 분석+승인)을 겸한다(이중 게이트 제거).

### Stage 5 — 기존 라이브러리 감사 (조건부 선행) → `04-3`
게이트2에서 "기존 파일에 얹기" 선택 시만: `get_libraries` + `get_variable_defs` +
`search_design_system` → 대조표(토큰|가이드값|Figma기존값|상태=신규/일치/충돌/중복). 충돌·중복·
미사용은 **목록화·추천만, 삭제·통합 단정 금지**(사용처는 사람 확인). 신규 생성 시 생략.

### Stage 6 — Figma Variables·스타일 (figma-generate-library Phase 0~2) → (옵트인)
`/figma-use` + `resource:figma-generate-library`(SKILL) 동시 로드. **입력 = tokens.css**(코드 중심
스킬이라 코드가 정상 입력). primitive 컬렉션 + semantic 컬렉션(text/default·bg/surface·
action/primary가 primitive **alias 참조**, 라이트/다크 Variable mode). 컬러/텍스트 스타일,
이름=가이드 네이밍. **scope[]·alias·var() 래퍼는 게이트 블로킹**.
- 되읽기 대조 = **전체 인벤토리 덤프(inspectFileStructure 류)** — `get_variable_defs`는 selection의
  *사용된* 변수만 반환해 정의만 한 변수가 누락되므로 검증 고리가 끊긴다. 전체 인벤토리로 대조표.
- **publish는 사람.** **Phase 3(컴포넌트)은 08 영역 → 토큰·foundations만(Phase 0~2)** 스코프 컷.

### Stage 7 — 검증 체크리스트 + 마무리 → `_검증체크리스트.md`
"대비비·스케일은 스크립트가 진실 — 경계값 사람 재확인" / "publish는 사람" / "네이밍 바꾸면 3곳
동시" 고지. 미해소 `[확인 필요]` 있으면 완료보고 차단.

## degrade / 중단 / 게이트 블로킹

- **중단**: 슬러그 0개 / 03-4 부재 / **OKLab 변환쌍 assert 실패**(상수가 틀림).
- **degrade**: 03-3 부재(seed 사용자 입력) / **Context7 unreachable(쿼터·장애) → W3C 표준 상수+
  assert** / 기존 Figma URL 없음(감사 생략) / Figma 미동의·미인증·dry-run(md+CSS 1급).
- **게이트 블로킹**: **3자(stdout/json·md·css·preview) 수치 동등성 불일치 시 차단**(글자 아닌
  수치 비교·표시 포맷 `:.2f` 통일 전제) / Figma scope[]·alias·var() 미충족 / `[확인 필요]` 미해소 /
  **publish는 항상 사람**.

## 도구 정확성

- **Python(stdlib math)** = 컬러·대비비·스케일 계산 엔진. **stdout/JSON이 진실**, LLM 암산 금지.
  OKLab 상수는 Context7 fetch(또는 W3C 표준 상수 degrade) + assert. 외부 패키지 안 씀.
- **Context7 MCP** = OKLab 행렬·OKLCH 표기·CSS 문법 확인(**값 결정엔 안 씀**, 상수/문법만).
  unreachable이면 W3C 표준 상수로 degrade(중단 아님).
- **Figma MCP** = `get_libraries`/`get_variable_defs`/`search_design_system`(감사), `use_figma`
  계열(`/figma-use` 선행). `figma-generate-library`(SKILL·Phase 0~2·publish 사람). 되읽기는 전체
  인벤토리(get_variable_defs selection 한계 회피). **claude mcp add 본문 금지**(README만).
- **frontend-design 스킬** = tokens.css + preview HTML. WCAG 숫자는 color.json 정적 주입(`:.2f`).

## 주의

- **AI가 낸 대비비·HEX는 검산 대상** — 계산식·assert로, 경계값은 사람이 도구로.
- **OKLCH·다크 색은 화면에서 봐야 안다** — preview·Figma 스와치 사람 검수, 톤은 디자이너 보정.
- **네이밍·semantic 색은 한 번 정하면 비싸다** — 게이트1에서 확정(3곳 공유).
- **semantic/primitive 분리** — 화면은 의미 토큰만.
- **기존 토큰 함부로 안 지움** — 추천만(사용처 사람 확인).
- **publish는 사람** — 생성≠게시.
- **토큰은 초판** — 08에서 갱신, version 박기(스킬 version ≠ 토큰 가이드 문서 버전).
- **편집 범위** — 이전 단계는 읽기만, 쓰기는 `<출력루트>` 안에서만(자동화/ 하위·볼트 루트 금지). 한글 경로 Glob/Read만.

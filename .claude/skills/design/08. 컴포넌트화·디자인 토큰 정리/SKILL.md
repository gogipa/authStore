---
name: design-componentize
description: >-
  06~07 UI 시안의 반복 요소를 컴포넌트·배리언트로 굳히고, 04 토큰 사전을 3계층
  (Primitive 재사용→Semantic 확충→Component 신설)으로 정비해 재사용 라이브러리로
  만든다. 반복 요소 스캔→배리언트 매트릭스→토큰 후보 추출·계층화→토큰↔코드 동기화
  →Figma 라이브러리 정비(figma-generate-library Phase3 위임)→Code Connect 매핑.
  "컴포넌트화", "배리언트 정리", "디자인 토큰 정비", "토큰 계층화", "컴포넌트 라이브러리
  구축", "Code Connect 매핑", "componentize", "variant matrix", "token tiering"
  같은 요청에서 사용. (04 토큰 사전 생성은 design-system / 시안 생성은 design-mockup /
  일관성 검증은 design-consistency-review.)
metadata:
  version: 1.0.0
---

<!-- 변경 포인트: 설치 시 아래 3줄을 환경 경로로 교체 -->
<!-- <기획루트> = <기획 산출물 루트>/<주제-슬러그> -->
<!-- <디자인입력> = <디자인 산출물 루트>/<주제-슬러그> -->
<!-- <출력루트> = <디자인 산출물 루트>/<주제-슬러그>/08_컴포넌트토큰 -->

# 컴포넌트화·디자인 토큰 정리 (Componentize & Token Tiering)

06~07 시안을 "그린 그림"에서 "재사용 부품"으로 바꾼다. 반복 요소를 **컴포넌트·배리언트**로 굳히고, 04가
만든 토큰 "사전"을 **3계층(Primitive 재사용→Semantic 확충→Component 신설)**으로 정비해 라이브러리로 만든다.
**04=토큰 원칙(사전·Phase 0~2) / 08=라이브러리화(Phase 3+).** 이 단계가 새로 만드는 것은 토큰 *값*이 아니라
**구조**(Component alias 참조·배리언트 매트릭스·Code Connect 매핑)다. design-moodboard·design-system·
design-mockup에 이은 Figma WRITE 스킬.

## 핵심 원칙 (어기면 라이브러리가 비대해지거나 거짓 일관성이 굳는다)

- **토큰 값의 진실은 04 산출물이다(BMD 계승).** 색·간격·radius 값은 `04/scripts/out/*.json`·`tokens.css`·
  `get_variable_defs`가 진실이고 **LLM이 HEX/px를 지어내지 않는다.** SKILL 본문·산출물에 구체 값(예 특정 HEX)을
  재기재하지 않고 04·07-3을 **인용**한다. ⚠️ **04가 dry-run 배너(`Figma 생략` 등)를 달고 있으면 그 토큰값은
  가상**이므로 Figma 교차검증을 강제 스킵하고 08 산출물 전체에 dry-run 배너를 전파한다.
- **3계층은 값이 아니라 참조다.** Primitive=04 재사용(신설 안 함). Semantic=04의 것 유지 + 공백만 신설(**기존
  primitive를 alias로 참조할 뿐 새 값 생성 금지**). Component=08 신설 계층(**반드시 Semantic alias 참조**).
  Component 다크값을 따로 정의하지 않는다 — Semantic 레벨에서 다크 짝이 보장된다.
- **신규 alias의 다크 짝을 LLM이 만들지 않는다.** 04 primitive는 light/dark 공용이고, 04의 기존 alias는 다크
  테마 블록에서 **다른 step으로 재매핑**된다(예 text-default가 다크 시 neutral-900→neutral-50). 따라서 신규
  Semantic alias의 "다크 짝"이란 primitive 부재가 아니라 **다크 테마 블록의 재매핑 step이 미정**이라는 뜻 →
  그 step을 지어내지 말고 **`[04 환류 대기]`로 라우팅**(04 재실행·디자이너 결정). 다크 step 미정 블로킹은 **04가
  이미 다크 재매핑을 정의한 토큰에만** 적용한다.
- **통합 제안·컴포넌트 후보는 "후보"이지 결정이 아니다.** 거의 같은 두 회색(#F5/#F4류)도 의도적으로 다를 수
  있다 → 통합은 의미 확인 후 사람 결정. **07-3이 이미 '역할 분리·이탈 아님'으로 판정한 차이**(예 카드 vs 결제옵션)는
  '통합 후보'로 재포장하지 말고 그 판정을 **인용 승계**한다.
- **과잉 추상화 경계.** "2곳 이상 반복"만 컴포넌트화(인스턴스 반복 + 06-3 역할 등장 기준). 단일 사용은 거른다.
- **네이밍은 사람이 정한다.** 컴포넌트/토큰 식별자는 06 클래스명 + figma-generate-library 컨벤션(Button/Card)에서
  **권장안**을 뽑고 게이트A에서 사람이 확정(Figma·CSS·코드 3곳 공유). **07-4 용어집은 UI 카피·도메인 용어 SSOT**이지
  컴포넌트명 SSOT가 아니다(컴포넌트명 미수록).
- **생성 ≠ publish/게시.** 컴포넌트·토큰 생성과 라이브러리 publish·Code Connect 게시는 다르다 — publish·게시는
  영향 범위가 크니 검증 후 사람이 한다.
- **이미지·외부 컴포넌트 내부 값은 안 잡힌다.** 비트맵·외부 인스턴스 내부 색/간격은 raw 값 미검출 → 토큰 커버리지
  100%를 자동 검출만으로 단정 말고 핵심 화면은 get_screenshot+원본 사람 확인.

## 04와의 경계 / 위임 도구

- **04(design-system)=토큰 사전 생성(figma-generate-library Phase 0~2 foundations)**, 08=컴포넌트화+토큰 정비
  (Phase 3+). 08은 Primitive를 **신설하지 않고 재사용**, Component 계층만 신설한다.
- **figma-generate-library**(Figma MCP 서빙 스킬)는 08이 **Phase 3(COMPONENTS) 절차로 위임 호출**하는 하위 도구다.
  ⚠️ fig-gen-lib는 **Primitive+Semantic 2계층 표준**이라 Component 토큰 계층을 모른다 → **Component 계층은 08
  자체 절차**(08-2·tokens.css 코드/문서 1급), fig-gen-lib엔 '이미 정의된 토큰 바인딩'만 위임.
- **Code Connect**는 **figma-code-connect**(Figma MCP 서빙 스킬·`get_code_connect_suggestions`→
  `get_context_for_code_connect`→`.figma.ts` 작성)에 위임한다. ⚠️ Code Connect는 **published 컴포넌트·코드 레포·
  Org/Enterprise 플랜·node-id URL이 모두 필요**한데 '생성≠publish'와 충돌하므로 → **08 기본 경로는 매핑 명세표
  (08-3) 1급**, `.figma.ts` 작성은 publish 완료+레포 확인 시 옵트인.
- **frontend-design**=내장 스킬 invoke(토큰→코드 변수 변환·대조).

## 입력

- **`<기획루트>`·`<디자인입력>`**(읽기 전용) · **`<출력루트>`**(쓰기). 이전 단계에 **쓰지 않는다.**
  ⚠️ 원본 가이드의 평면경로(입력측 `디자인/산출물/디자인시스템-토큰원칙.md`·출력측 `토큰정의서-petsub.md`·
  `컴포넌트-토큰-정비리포트.md`)는 **양쪽 모두 정규화 폐기**(`산출물/`은 스킬 배포 폴더 전용) — 출력은 `08_컴포넌트토큰/`.

| 등급 | 입력 | 용도 | 부재 시 |
|---|---|---|---|
| **필수(핵심)** | `<디자인입력>/06_UI시안/06-2_시안초안/*.html` | 컴포넌트화 대상·반복요소 raw값 원천 | **중단**(부품화할 시안 없음) |
| **필수(핵심)** | `<디자인입력>/04_디자인시스템/`(`tokens.css`·`04-1`·`04-2`·`scripts/out/*.json`) | 토큰 값 진실(BMD)·Primitive 원천·기존 semantic | **중단**(토큰 사전 없음) |
| **강(컴포넌트 역할 1급)** | `<디자인입력>/06_UI시안/06-3_토큰컴포넌트적용.md` | 화면×토큰×컴포넌트 역할(배리언트 근거·예 secondary) | degrade: 06-2 raw값만으로 역할 추정+⚠️ |
| 강(토큰 정비) | `<디자인입력>/07_시안리뷰/07-3_디자인일관성.md`(FB-1~5) | semantic alias 공백·border-width·wcag 미수록 정비 입력 | degrade: 시안 raw값에서 alias 후보 직접 추출 |
| 강(검증·인용) | `<디자인입력>/07_시안리뷰/07-3` 통합후보 판정 / `06_UI시안/06-4_자가점검` | 통합후보 07 판정 인용·06 기계검출 경계 | degrade: 08 재검출(중복 감수) |
| 보조(커버리지) | `<기획루트>/12_기능명세/`(`12-2_상태정의`·`12-1`) | ⚠️ 도메인 엔티티 상태(UI state 아님)·커버리지 별도 항목 | degrade: 시안 실재 state만·명세 대조 생략 |
| 선택 | 코드 레포(React+Tailwind)·Figma 파일 URL | Code Connect·frontend-design 대조·라이브러리 감사 | degrade: Code Connect 명세표만·HTML 1급 |

### 슬러그 해소 (Stage 0, 1급)
`스터디/AI 스터디/자동화/디자인/리서치/` 하위 → 1개 자동 / 복수 게이트 / 0개 위치 질문 후 중단. 같은 슬러그로
`기획/리서치/`도 확인. **한글 경로 Glob/Read만**(Bash ls/find 금지).

### ID·네이밍 (리터럴/파일명 단정 금지)
- **화면ID** = `S\d+`(무하이픈·09-1 권위·원본 `SC-` 비계승).
- **컴포넌트 식별자 네이밍** = **06 클래스명**(`.btn-primary`→Button) + figma-generate-library 컨벤션 권장안 →
  **게이트A 사람 확정**(07-4는 카피만·파일명 sanitize와 무관). **프레임명은 Stage 5(Figma) 전용** — 06-3 sanitize
  모순(공백→`_` vs 예시 삭제·하이픈 잔존)은 프레임명에만 걸리는 문제이므로 **컴포넌트 네이밍과 분리**하고 Stage 5에서
  `[확인 필요]`로 다룬다(dry-run·degrade 경로에선 미발동).

## 출력 위치: `<출력루트>/`

| 파일 | 내용 | stage |
|---|---|---|
| `08-1_컴포넌트후보.md` | 컴포넌트 후보(2곳+반복)·배리언트 매트릭스(실재 조합·불필요 추정 분리)·통합후보(07 판정 인용) | 1·2 |
| `08-2_토큰정의서.md` | 3계층 토큰(토큰명·계층·값[04 인용]·참조·사용처)·신규 alias·**04 v0.1→08 버전 표기**·다크 짝 | 3 |
| `08-3_CodeConnect매핑.md` | **매핑 명세표(1급)**: Figma 컴포넌트·코드 경로·신뢰도·prop 매칭. `.figma.ts`는 옵트인 | 게이트C |
| `08-4_정비리포트.md` | 컴포넌트/토큰/Code Connect 변경 요약 + **하류 계약표(→09·13·14)** + 토큰 계층도(mermaid degrade) | 7 |
| `tokens.css`(확장)·`tailwind.config.js` | (조건부) 04 tokens.css 확장·코드 동기화(frontend-design) | 4 |
| `_검증체크리스트.md` | 사람 확인 항목 | 8 |

## 파이프라인 (Stage 0~8, 원본 Step1~6 매핑)

### Stage 0 — 슬러그·입력 로드·probe·degrade
- 슬러그 해소(위). 06·04 로드(없으면 중단). 06-3/07-3/12 로드(없으면 degrade 플래그). dry-run 플래그 계승.
- **probe(하드코딩 금지·03 교훈: whoami도 실호출→dry-run 분기 필수)**: dry-run 아니면 `whoami`·`get_libraries`·
  `get_variable_defs`·`search_design_system`·코드 레포 존재 확인. **figma-generate-library·figma-use·figma-code-connect는
  SKILL이라 probe 아니라 invoke 절차**(Stage 5·게이트C). **04 dry-run 배너 검출 시 Figma 교차검증 강제 스킵 + 08
  산출물 전체 배너 전파.** **dry-run 시 Figma probe·write·Code Connect 게시 전부 생략.**

### Stage 1 — 컴포넌트화 대상 스캔 → `08-1`
- Figma 모드: `get_metadata`(전체 훑기)→`get_design_context`(주요 프레임 raw값)→`search_design_system`(기존 확인·
  신설/재사용). **degrade(dry-run/Figma 미동의): 06-2 HTML DOM 파싱 1급 + 06-3 매핑표(4화면 역할) 병합.**
- 후보표: `잠정 컴포넌트명 | 등장 화면 | 추정 변형수 | 통합필요 | 신설/재사용 | 비고`. **"2곳 이상" 카운트 = (HTML
  인스턴스 반복) + (06-3에서 *다른 화면*의 역할 등장)을 합산**(같은 화면 단일 역할은 1곳). **2곳 미달(단일 화면·단일
  인스턴스) 컴포넌트는 '신설 보류·표본 확충 후 재평가'**(과소 컴포넌트화 방지 — 폐기 아닌 보류). 컴포넌트명=06 클래스+컨벤션 권장.
- ⚠️ **표본 빈약 가시화 배너**(06-2가 2장뿐·S9·S11은 06-3 역할 명세에만 의존·raw값 미검증). 확신 없는 묶음=`[확인 필요]`.

### Stage 2 — 배리언트 구조 설계 → `08-1` 병합
- 시안 실사용 조합만 매트릭스, **미사용=`불필요 추정` 분리**(matrix>30이면 분할). 컴포넌트 1개씩.
- **state 축 이원화**: (a) 12-2 도메인 엔티티 상태(active/cancelling…)는 **UI state가 아니므로 매트릭스에 직접 안
  넣고 별도 커버리지 항목**으로(도메인 상태→UI 미반영은 `추가 필요` 후보·단정 금지). (b) 06-3 Stage5 상태커버리지
  (loading/error/empty)→UI state 후보. ⚠️ **시안에 UI state 실재가 0건이면 매트릭스 발명 금지→`[배리언트 근거부족→사람정의]`.**
  S11 secondary 버튼은 06-3 역할(계속해지=보조)에서 도출.

### 🚦 게이트A — 컴포넌트 목록·네이밍·배리언트 확정 (사람, 필수)
AskUserQuestion(AI 추천 1안, **응답 전 Stage 3 미진입**). 신설/통합/폐기 목록 + **네이밍(06 클래스+컨벤션 권장 1안)**
+ 배리언트 축. **네이밍은 사람**(3곳 공유). 통합 후보는 **의미 확인 질문**(07-3 판정 있으면 인용). 검수 대상=08-1.

### Stage 3 — 토큰 후보 추출·3계층화 → `08-2`
- Figma 모드: `get_variable_defs`(**전체 인벤토리** — selection 한계 회피·04 계승) + raw값 대조. degrade: 04 tokens.css
  (값 진실) + 06 HTML var() 사용처 대조.
- **3계층**:
  - **Primitive**: 04 재사용(신설 안 함·값 안 지음). success/warning/info/accent는 primitive 실재 → alias 신설 안전.
  - **Semantic**: 04의 6개 유지 + **07-3 FB-1~4 환류 + 06-1 disabled 공백 신설**(에러배경·border·surface 단계·disabled
    등). **값은 04 primitive alias만**(새 HEX 금지). **신규 alias 다크 짝이 04에 없으면 `[04 환류 대기]`**(LLM 생성 금지).
  - **Component**: 08 신설 계층(`button/primary/bg`→`action/primary` 등). **반드시 Semantic alias 참조**·다크값 중복정의 금지.
- **중복 검출**: 06 raw값 #F5/#F4류 근사 중복 + primitive 직접 사용처 + **다른 패밀리인데 동일 HEX 스케일**(예
  accent≡warning 같은 04 산출 결함)도 검출. **통합=후보·의미 확인 후 사람**(07-3 판정 인용·04 결함은 04 환류 후보).
- **FB-5(wcag 미수록 조합)·다크 재계산**: 04 영역 → `[04 재실행 필요]` 미결 라우팅(재계산 금지·BMD).
- orphan primitive(미사용 accent/success 등)=**폐기 후보 추천만**. 표: `토큰명|계층|값(light·04 인용)|값(dark)|참조|사용처`.

### Stage 4 — 토큰→코드 동기화 (frontend-design 내장) → `tokens.css` 확장·`tailwind.config.js`
- frontend-design invoke. 08-2 토큰셋→CSS custom properties + tailwind theme.extend. **04 tokens.css 확장(덮어쓰기 금지).**
  신규 Semantic은 **`:root` + `@media (prefers-color-scheme: dark)` + `[data-theme="dark"]` 3블록 동시**(04 패턴 계승).
- 대조표(코드 레포 존재 시만): **누락**(정의서O·코드X)·**orphan**(코드O·정의서X)·**불일치**(값 다름·양쪽 인용)·**다크 짝
  누락**. **값 덮어쓰기 금지**, 불일치표 먼저·반영은 사람. 레포 부재 시 변환 산출만(대조 생략·degrade).

### 🚦 게이트B — figma-generate-library Phase 3 착수 (사람, 필수 / Figma WRITE)
AskUserQuestion. **/figma-use MANDATORY 선행.** **`get_variable_defs` probe로 04 Variables 실재 분기**: 미존재
(04 dry-run 기본값)면 fig-gen-lib가 Phase 1(FOUNDATIONS)부터 토큰을 Figma에 생성해야 함 → **04 영역 침범·이중 SSOT
경고**·사람 회부(기본 추천=Figma 생략·md+코드 1급). 존재면 Phase 3 직행. 미동의·미인증·view-only·**편집 권한 없음**·
dry-run → Stage 5~6 degrade. 게시 영향 범위·편집 권한 고지.

### Stage 5 — Figma 컴포넌트·배리언트 정비 (figma-generate-library Phase 3 위임)
- `/figma-use` + `resource:figma-generate-library` 동시 로드. **(Figma WRITE 동의 경로 한정) Phase 0~2는 건너뛸 수
  없음**(fig-gen-lib §2 강제) — 게이트B가 Phase 0 스코프 락을 겸하고, 04 Variables 존재 시 Phase 1~2는 재확인만(중복
  생성 회피). **Figma 생략 degrade 경로에선 Stage 5 자체가 미실행**이라 이 강제는 비적용. Phase 3=게이트A
  매트릭스대로 컴포넌트 1개씩(never batch)·combineAsVariants. Semantic/Component 변수 바인딩. get_metadata+get_screenshot 검증.
  **생성≠publish**(사람).

### Stage 6 — 라이브러리 정합성 점검
- `get_libraries`로 중복/유사 라이브러리·미게시 신규 컴포넌트 식별 — **목록화·추천만**(삭제·게시 단정 금지).

### 🚦 게이트C — Code Connect 매핑 검수 (사람, 필수)
**figma-code-connect 스킬 위임**: `get_code_connect_suggestions`→`get_context_for_code_connect`→`.figma.ts` 템플릿.
매핑 명세표(`Figma 컴포넌트 | 코드 경로 | 신뢰도 | prop 매칭 | 비고`) → **`08-3` 1급**. ⚠️ Code Connect 하드 전제
(published 컴포넌트·코드 레포·Org/Enterprise 플랜·node-id URL) 충족 시에만 `.figma.ts` 작성 옵트인 — **미충족(미게시·
플랜 부족·레포 부재) 전부 degrade(명세표만)**. 신뢰도 낮은 후보=`[확인 필요]`(게시·작성 안 함).

### Stage 7 — 정비 리포트 → `08-4` (+토큰 계층도)
- 컴포넌트(신설/통합/폐기)·토큰(신규/통합/네이밍)·Code Connect(연결/미연결/확인필요) 변경 요약 + **하류 계약표**
  (→09 인터랙션 state 축·→13 핸드오프 매핑·라이브러리·→14 검수 기준선). 핸드오프로 넘길 미결 항목.
- **08-2 토큰정의서 머리에 04 v0.1→08 정비분 버전 표기**(04 SKILL "08에서 version 박기" 계약 이행). 04-1 직접 편집
  금지·환류 후보로만(볼트 제약+07-3 선례).
- 토큰 계층도(Primitive→Semantic→Component): `generate_diagram`(FigJam·write·게이트B 동의 하위) / **dry-run·미동의 시
  mermaid degrade**(08-4 안에).

### Stage 8 — 검증 체크리스트 → `_검증체크리스트.md`
"통합=후보·의미 확인" / "네이밍은 사람" / "Code Connect 게시 전 검수·published 전제" / "다크 짝 04 환류" / "이미지
내부값 사람 확인" / "publish·게시는 사람". `[확인 필요]`·`[04 환류 대기]` 잔존 시 ⚠️ + 무단 '완료' 보고 금지.

## degrade / 중단 / 게이트 블로킹

- **중단**: 슬러그 0개 / **06 시안 부재** / **04 디자인시스템 부재**.
- **degrade**: 06-3 부재→06-2 raw값만+⚠️ / 07-3 부재→시안 raw값에서 alias 직접 추출 / 12 부재→시안 실재 state만 /
  Figma 미동의·미인증·view-only·편집권한 없음·dry-run→**Stage 5~6 생략·마크다운+코드 1급** / 04 Variables 미존재→fig-gen-lib
  Phase1부터(이중 SSOT 경고·사람 회부) / 코드 레포 부재→Code Connect·frontend-design 대조 생략(명세표·변환만) / Code
  Connect 전제 미충족→매핑 명세표만(.figma.ts 옵트인).
- **게이트 블로킹**: 게이트A 미응답→Stage 3 미진입 / 게이트B 미동의→Figma write 차단 / 게이트C→Code Connect 게시·.figma.ts
  차단 / `[확인 필요]`·`[04 환류 대기]` 미해소→완료 보고 차단 / 다크 짝 누락(04 정의 토큰)→블로킹.

## 도구 정확성

- **Claude Code(파일 읽기/쓰기)** — 입력 `<기획루트>`·`<디자인입력>` 읽기 전용, 출력 `<출력루트>` 쓰기.
- **Figma MCP** — READ(get_metadata/get_design_context/get_variable_defs[전체 인벤토리]/get_libraries/search_design_system/
  get_screenshot) 직접 호출. WRITE(use_figma·/figma-use 선행·figma-generate-library Phase 3 위임·generate_diagram). nodeId
  필수(`^\d+[:-]\d+$`). **claude mcp add 본문 금지**(README만).
- **figma-code-connect 스킬** — `.figma.ts` 작성(published 전제·옵트인). add/send 게시는 사람.
- **frontend-design 스킬** — 토큰→코드 변수 변환·대조(내장 invoke).

## 주의

- **토큰 값은 04 진실** — 본문·산출물에 HEX/px 재기재 금지(04·07-3 인용). 04 dry-run이면 가상값·배너 전파.
- **3계층은 참조** — Primitive 04 재사용·Semantic 공백만 신설(primitive alias)·Component는 Semantic alias 참조.
- **다크 짝 LLM 생성 금지** — 신규 alias 다크값은 `[04 환류 대기]`.
- **통합·컴포넌트 후보=후보** — 의미 확인 후 사람. 07-3 판정은 인용.
- **과잉 추상화 경계** — 2곳 이상 반복만. 단일 사용 거름.
- **네이밍은 사람** — 06 클래스+컨벤션 권장→게이트A. 07-4는 카피 SSOT.
- **생성≠publish/게시** — publish·Code Connect 게시는 검증 후 사람. 영향 범위·편집 권한 확인.
- **Code Connect 전제** — published·레포·플랜·node-id. 미충족 시 명세표만.
- **편집 범위** — 기획·이전 디자인은 읽기만, 04 직접 편집 금지(환류 후보로), 쓰기는 `<출력루트>` 안에서만(`자동화/` 하위·볼트 루트 금지).

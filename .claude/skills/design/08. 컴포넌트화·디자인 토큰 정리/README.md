# design-componentize

06~07 UI 시안의 반복 요소를 **컴포넌트·배리언트**로 굳히고, 04 토큰 사전을 **3계층(Primitive 재사용→
Semantic 확충→Component 신설)**으로 정비해 재사용 라이브러리로 만드는 디자인 시리즈 8단계 Figma WRITE
스킬. 04=토큰 원칙(Phase 0~2) / 08=라이브러리화(Phase 3+). 시안 리뷰(07)와 인터랙션·모션(09) 사이.

## 설치
`SKILL.md`를 `~/.claude/skills/design-componentize/SKILL.md`로 복사.

## 일반경로 치환 포인트 (`<!-- 변경 포인트 -->`)
- `<기획루트>` = `<기획 산출물 루트>/<주제>` (12 기능명세 — 상태 정의)
- `<디자인입력>` = `<디자인 산출물 루트>/<주제>` (06 시안·06-3·04 토큰·07-3·07-4)
- `<출력루트>` = `<디자인 산출물 루트>/<주제>/08_컴포넌트토큰`

⚠️ 원본 가이드의 평면경로(입력측 `디자인/산출물/디자인시스템-토큰원칙.md`·출력측 `토큰정의서-petsub.md`·
`컴포넌트-토큰-정비리포트.md`)는 양쪽 모두 정규화 폐기(`산출물/`은 스킬 배포 폴더 전용) → `08_컴포넌트토큰/`.

## 04와의 경계
04(design-system)는 토큰 **사전(원칙·Primitive+Semantic foundations·figma-generate-library Phase 0~2)**을
만든다. 08은 그 위에서 **컴포넌트화 + Component 토큰 계층 신설 + 라이브러리화(Phase 3+)**를 한다. 08은
Primitive를 **신설하지 않고 재사용**하며, 토큰 *값*이 아니라 **구조**(Component alias 참조·배리언트·Code
Connect)를 만든다.

## 토큰 진실은 04 (BMD 계승)
토큰 값은 `04/scripts/out/*.json`·`tokens.css`·`get_variable_defs`가 진실이다. SKILL 본문·산출물에 구체 HEX/px를
재기재하지 않고 04·07-3을 인용한다. 04가 dry-run 배너를 달고 있으면 그 값은 가상이므로 Figma 교차검증을 강제
스킵하고 08 산출물 전체에 배너를 전파한다. 신규 Semantic alias의 다크 짝이 04에 없으면 `[04 환류 대기]`로
라우팅(LLM 생성 금지). **04 파일은 직접 편집하지 않고 환류 후보로만 기재**한다.

## Figma WRITE (figma-generate-library Phase 3 위임 · /figma-use mandatory)
컴포넌트·배리언트 정비는 `figma-generate-library`(Figma MCP 서빙 스킬) Phase 3에 위임한다. use_figma WRITE
전에 **`/figma-use`를 먼저 읽는다**(mandatory). 미연결 시: `claude mcp add --transport http figma
https://mcp.figma.com/mcp` 후 `/mcp` 인증(**편집 권한 계정** — 라이브러리를 손대므로 13 리뷰의 열람 권한과
다름). ⚠️ fig-gen-lib는 **Primitive+Semantic 2계층 표준**이라 Component 토큰 계층을 모른다 → Component 계층은
08 자체 절차(코드/문서 1급), Figma에는 Semantic까지만 둔다. 미동의·미인증·편집권한 없음·dry-run이면 마크다운
토큰정의서+frontend-design 코드가 1급. (SKILL 본문은 mcp add를 하드코딩하지 않는다 — README 전용.)

## Code Connect (figma-code-connect 위임 · 조건부)
Code Connect는 `figma-code-connect`(`.figma.ts` 작성)에 위임한다. ⚠️ **published 컴포넌트·코드 레포(React+
Tailwind)·Org/Enterprise 플랜·node-id URL이 모두 필요**한데 08의 '생성≠publish' 규율과 충돌하므로, **08 기본
경로는 매핑 명세표(08-3) 1급**이고 `.figma.ts` 작성은 publish 완료+레포 확인 시 옵트인이다. 게시
(send_code_connect_mappings)는 Dev Mode에 즉시 반영되므로 검수 후 사람이 한다.

## 입력 전제
- **필수(핵심)**: `06_UI시안/06-2_시안초안/*.html`(컴포넌트화 대상) + `04_디자인시스템/`(토큰 진실). 부재면 중단.
- **강**: `06-3_토큰컴포넌트적용`(화면×토큰×컴포넌트 역할 1급·배리언트 근거) · `07-3_디자인일관성`(FB-1~5 토큰 정비 입력).
- 보조: `12_기능명세/12-2_상태정의`(⚠️ 도메인 엔티티 상태 — UI state 아님). 선택: 코드 레포·Figma URL.

## 출력물
`08-1_컴포넌트후보`(후보·배리언트 매트릭스) · `08-2_토큰정의서`(3계층·04 인용·버전) · `08-3_CodeConnect매핑`
(명세표 1급) · `08-4_정비리포트`(하류 계약표·토큰 계층도) · `tokens.css` 확장·`tailwind.config.js`(조건부) ·
`_검증체크리스트`.

## 다음 소비자 계약
정비된 토큰·컴포넌트·Code Connect 매핑이 **09(인터랙션·모션 state 축)·13(개발자 핸드오프 패키지 기준)·14
(퍼블리싱 검수 기준선)**의 입력이 된다. 07-4 용어집은 컴포넌트 카피 SSOT(컴포넌트명은 06 클래스+컨벤션).

## 트리거 경계
"컴포넌트화", "배리언트 정리", "디자인 토큰 정비", "토큰 계층화", "Code Connect 매핑" 등에서 발동. 04 토큰 **사전
생성**은 `design-system`, 시안 **생성**은 `design-mockup`, 일관성 **검증**은 `design-consistency-review`. (08은
시안→부품 변환+토큰 구조 정비. figma-generate-library는 08이 Phase 3로 위임하는 하위 도구.)

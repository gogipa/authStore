# design-handoff

12 디자인 QA를 통과한 시안을 **개발자가 추측 없이 그대로 구현하도록 에셋·스펙·디자인 토큰·컴포넌트
매핑을 픽셀·토큰 단위로 넘기는** 디자인 시리즈 13단계 핸드오프 패키지 스킬. 4묶음(에셋·스펙·토큰
코드변수 매핑·Code Connect 매핑) + 화면 관점 엣지케이스 Q&A·티켓·인덱스. **07~12 산출물을 모두
수렴하는 최대 통합 종착 스킬.** QA(12)와 (미빌드) 퍼블리싱 검수(14) 사이.

## 설치
`SKILL.md`를 `~/.claude/skills/design-handoff/SKILL.md`로 복사.

## 일반경로 치환 포인트 (`<!-- 변경 포인트 -->`)
- `<디자인입력>` = `<디자인 산출물 루트>/<주제>` (04/08 토큰·06 시안·07-4·08-3·09-4·10·11·12 — 읽기)
- `<기획루트>` = `<기획 산출물 루트>/<주제>` (10 화면설계서·12 기능명세·06 정책·14 핸드오프 짝 — 읽기 전용)
- `<출력루트>` = `<디자인 산출물 루트>/<주제>/13_핸드오프`

⚠️ 원본 평면경로 `산출물/핸드오프/`·`assets/`·`INDEX_·스펙_·토큰_·컴포넌트매핑_`은 정규화 폐기
(`산출물/`은 스킬 배포 폴더 전용) → `13_핸드오프/`. 원본 평면 '용어집.md'는 **디자인07-4**·'디자인토큰.md'는
**04/08 tokens.css**로 정정.

## 동명이역 주의 (dev-handoff · 기획14)
`dev-handoff`는 **기획 시리즈 핸드오프**(기능·정책·명세·API·티켓·입력 기획12·출력 기획14_핸드오프).
디자인13은 **에셋·스펙·토큰·컴포넌트 매핑**(픽셀·토큰). **짝**이다(같은 Notion 트리·14=시스템 동작 관점·
13=화면/스펙 관점·충돌 아닌 협력). dev-handoff는 **호출하지 않고 규율만 내장**(출력 기획 폴더 고정·이중
게이트·인계 제어점 부재 + **Figma/Code Connect write 전면 금지가 13 핵심과 정면충돌**). 기획 14-1/14-2/14-4가
있으면 입력 수령해 dedup.

## Code Connect write = 결정적 차별점
dev-handoff(기획14)는 Code Connect read-only(FE/디자인시스템 몫)지만, **디자인13은 디자인시스템 주체라
매핑 실제 등록(write)이 정당**하고 핵심이다. **08(design-componentize)이 만든 08-3 명세표를 수령**(재생성
금지)해 **실제 등록(send)까지 격상**하는 것이 13 고유 책무. 등록 경로는 08과 일관되게 **figma-code-connect
스킬 위임 1순위**(raw add/send 폴백). **4대 하드전제**(published 컴포넌트·코드 레포 실존·Org/Enterprise
플랜·node-id URL)를 게이트로 강제 — 미충족이면 명세표/신규 구현 목록만 degrade(빈 껍데기 등록 방지).
함수 순서: `get_code_connect_suggestions`(read)→사람 확정 게이트→`send_code_connect_mappings`(bulk).
`use_figma`/`create_new_file`은 13도 금지.

## download_assets 도구 사실
**단일 노드 전용**(nodeId 단수) → 각 아이콘/이미지 노드마다 노드별 루프 1회 호출. `defaultScale` 단일값
(@2x·@3x 별도 호출). `defaultFormat` enum=`png|jpg|svg|pdf`. **Figma Make 미동작.** **Lottie/Rive
(.json/.riv)는 download_assets 반환 타입에 없음** → 추출 대상 아님·09-4가 가리키는 디자이너 제작 실파일을
매니페스트에 motion 타입으로 '참조 편입'만(AI 생성·추출 금지). 추출 결과는 **사람 눈 검수 필수**
(매니페스트↔실파일·SVG 렌더링·래스터/벡터 오추출·마스크 잔존). write/권한 필요·옵트인·dry-run 생략.

## BMD · 다크모드 강제
토큰 값 진실 = **04/08 tokens.css·scripts/out/*.json SSOT** → 13은 코드 토큰(CSS var/Tailwind)으로 **포맷
변환만**(새 값 생성 금지). 본문·산출물에 임의 HEX/px 리터럴 재기재 금지(이름으로 연결). `get_variable_defs`는
보조(selection 한계·하드코딩 거짓통과). **다크모드 강제**: `:root` + `prefers-color-scheme: dark` +
`[data-theme=dark]` 3블록·LLM 다크 발명 금지·토큰 차이 목록은 사람 결정·네이밍 04 규약 우선.

## 상태 누락 = 12 환류
13은 상태 변형(화면 빈/에러/로딩/권한·컴포넌트 hover/disabled/loading) 누락을 **처음 발견하는 자리가
아니다**. 12에서 잡혔어야 함 — 13 신규 발견은 **12로 회귀(시안 보강 후 재핸드오프)**·절대 `[확인 필요]`로
개발에 떠넘기지 않는다. 컴포넌트 state와 화면 5종 상태 구분(엔티티 상태머신 ≠ 화면 상태).

## Figma MCP · Notion MCP
Figma read(get_design_context·get_metadata·get_screenshot·get_variable_defs)·Code Connect·download_assets.
미연결 시: `claude mcp add --transport http figma https://mcp.figma.com/mcp` 후 `/mcp` 인증(에셋 추출·Code
Connect는 편집 권한 필요). Notion은 패키지 공유·구현 상태 추적(옵트인·민감정보 더미). 미연결 시:
`claude mcp add --transport http notion https://mcp.notion.com/mcp`. 미사용→마크다운 SSOT. (SKILL 본문은
mcp add 하드코딩하지 않음 — README 전용.)

## HITL 경계 (사람 몫)
에셋 추출 결과 눈 검수 / 토큰 네이밍 개발 합의 / Code Connect 등록 전 검수·4대 하드전제 / 상태 누락=12
환류 / 하드코딩=후보·의도적 값 재분류 / **법적·결제·정기결제 고지 화면 `[🔴 사람 직접 검수]`**(이미지 내부
텍스트·외부 컴포넌트 미포착) / 티켓 우선순위·스프린트·동의어 판별 / Notion 발행 전 민감정보 더미.

## 입력 전제
- **필수**: `06_UI시안`(Figma 링크 OR `06-2_시안초안/*.html`) · `04`/`08 tokens.css` · `12_디자인QA/12-1`
  (QA 통과 확인·미통과 시 12 환류·중단).
- **강권장**: `07-4_용어집` · `08-3_CodeConnect매핑`·`08-4` · `09-4_에셋통합가이드` · `10`·`11` · `12-2` ·
  기획 `10`·`12`·`06`·(있으면) `14`(짝 dedup).

## 출력물 (13_핸드오프/)
`13-1_스펙.md` · `13-2_토큰매핑.md` · `13-3_에셋매니페스트.md` · `13-4_컴포넌트매핑.md` ·
`13-5_엣지케이스QA·티켓.md` · `13_핸드오프패키지.md`(인덱스·확인 필요 항목 맨 위 집약) · `_검증체크리스트.md` ·
`assets/<S-ID>/`.

## 다음 소비자 계약
핸드오프 패키지 → **14(퍼블리싱·구현물 검수)**. ⚠️ 디자인14·15 스킬은 미빌드(설치 `dev-handoff`는 기획
시리즈)이므로 자동 인계 금지 — 후보 라벨만·**13이 디자인 시리즈 자기완결 종착**. 진짜 토큰 미연결·발견
공백은 04/08 토큰화 환류(기재만).

## 트리거 경계
"디자인 핸드오프", "에셋 전달", "스펙 전달", "디자인 토큰 코드 변수", "Code Connect 등록" 등에서 발동.
**기능·정책·API 핸드오프**는 `dev-handoff`(기획14), **Code Connect 매핑 명세표 작성**은
`design-componentize`(08), **시안 내부 QA**는 `design-qa`(12). 일반 트리거("핸드오프")는 디자인 한정어
결합형으로만.

# design-mockup

와이어프레임(05)과 디자인 시스템(04 토큰)을 결합해 **화면 단위 고충실도 UI 시안**을 Figma 프레임으로
생성하는 디자인 시리즈 6단계 스킬. 단일 핵심원칙은 **"04 토큰을 단 하나도 새로 만들지 않고 시안 완성"**.
design-moodboard·design-system에 이은 세 번째 Figma WRITE 스킬. 디자인 시스템(04)과 시안 리뷰(07) 사이.

## 설치
`SKILL.md`를 `~/.claude/skills/design-mockup/SKILL.md`로 복사.

## 일반경로 치환 포인트 (`<!-- 변경 포인트 -->`)
- `<디자인입력>` = `<디자인 산출물 루트>/<주제>` (04 토큰·05 검토·01-2 상태추출표)
- `<기획루트>` = `<기획 산출물 루트>/<주제>` (09 와이어프레임·10 화면설계서·12 기능명세·06 정책)
- `<출력루트>` = `<디자인 산출물 루트>/<주제>/06_UI시안`

⚠️ 원본 가이드의 `디자인/작업/`·`디자인/와이어프레임/`·`디자인/기획참조/` 평면경로는 정규화 폐기
(`산출물/`은 스킬 배포 폴더 전용) → 출력은 `06_UI시안/`.

## 입력 전제
- **필수(핵심)**: `04_디자인시스템/`(04-1·04-2·tokens.css·scripts/out/{color,typespace}.json). **부재면
  중단** — 핵심원칙("04 토큰만 쓴다")의 전제가 사라져 degrade 불가.
- **필수(골격)**: `09_와이어프레임/`(09-1_화면목록·wireframes/*.html). 09-1 부재면 중단(화면 분모 소멸).
- **강권장**: `05_와이어프레임검토/`(05-1·05-2·05-5) + `01_디자인요구사항/01-2_상태추출표`(상태 권위 분모) ·
  `10_화면설계서/`(화면 의도, 화면별 per-screen md) · `12_기능명세`·`06_정책정의`(상태·카피 근거).

## 토큰 진실 우선순위 (BMD 계승)
토큰 값의 진실은 **04 산출물(`scripts/out/*.json`·`tokens.css`)**이다. SKILL 본문·산출물에 구체 HEX/px를
재기재하지 않고 인용만 한다(04 재실행 시 드리프트 방지). Figma `get_variable_defs`는 **교차검증·드리프트
탐지 보조**이지 진실 1순위가 아니다(SSOT→Variables 파생 방향). 04가 Figma Variables를 publish하지 않은
주제(tokens.css에 `Figma 생략` 배너)는 04 산출물을 진실로 자동 채택한다.

## Figma (WRITE · /figma-use mandatory)
use_figma(WRITE)는 **`/figma-use` 스킬을 먼저 읽지 않고 호출 금지**(MCP 서버 mandatory 규칙). 미연결 시:
`claude mcp add --transport http figma https://mcp.figma.com/mcp` 후 `/mcp` 인증(디자인 시스템 라이브러리·
작업 파일 편집 권한 계정). 화면 코드→Figma는 `/figma-generate-design`(Figma MCP 서빙 스킬·폴백
`skill://figma/figma-generate-design/SKILL.md` — 설치본 아님)에 위임하고, use_figma WRITE 동의를 그 스킬의
컴포넌트 수집 전 스코프락 입력으로 전달한다. **생성≠publish — publish·핸드오프 확정은 사람(07/08).**
미동의·미인증·view-only·dry-run이면 frontend-design HTML 시안이 1급으로 degrade. (SKILL 본문은 mcp add를
하드코딩하지 않는다 — README 전용.)

## degrade 사다리
use_figma 미동의/미인증/dry-run → frontend-design HTML 1급 / get_variable_defs 미가용·라이브러리 URL 부재
→ 04 산출물 진실 / 10·12 부분 커버리지(일부 화면만) → 덮인 화면만 의도 반영·미덮은 09 골격+추정·요소 발명
금지 / 05-2 부재 → 12+06 재도출+⚠️.

## frontend-design (내장) · 외부 도구 (HITL)
Stage 2 코드 시안 초안은 frontend-design 스킬을 내장 invoke(probe 불요). 외부 도구(Figma Make/v0.dev/Google
Stitch)는 우리 토큰을 모르므로 **방향 탐색 전용**(프롬프트만 제공·캡처는 사람·직접 채택 금지), 확정 방향만
use_figma로 우리 컴포넌트 위에 다시 짓는다.

## 출력물
`06-1_토큰팔레트`(허용 토큰 폐쇄목록·04 인용) · `06-2_시안초안/*.html`(frontend-design·degrade 시 1급) ·
`06-3_토큰컴포넌트적용`(화면×토큰·컴포넌트 + 의도근거 등급열) · `06-4_자가점검`(토큰 하드코딩·요소 누락·
컴포넌트 불일치) · `06-5_외부탐색프롬프트`(선택) · `_검증체크리스트`.

## 다음 소비자 계약
이 시안이 07(시안 리뷰·미감/위계 판정)·08(컴포넌트화·인스턴스 기반 시안이 정리 입력)·13(개발자 핸드오프)의
입력이 된다. **06은 생성+기계검출(토큰 하드코딩·요소 누락·컴포넌트 불일치)까지만** — 미감·위계 판정은 07,
publish·핸드오프 확정은 사람.

## 트리거 경계
"UI 시안", "고충실도 시안", "hi-fi mockup", "Figma 시안", "시안 작업" 등에서 발동. 04 토큰 **생성**은
`design-system`, 시안 **검증·리뷰**(미감·위계)는 `design-review`, **클릭 가능한** 인터랙션은
`prototype-design`, 범용 UI 코드는 `frontend-design`(06이 내장 invoke). 정적 시안(mockup) vs 인터랙티브
(prototype) 동사축 분리.

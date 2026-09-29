# design-system

디자인 컨셉(컬러 무드·톤앤매너)을 **재현 가능한 디자인 토큰**으로 굳히는 디자인 시리즈 4단계 스킬. 컬러 스케일+WCAG 대비비·모듈러 타이포·4px 스페이싱·radius·그리드를 **Python으로 산출(계산이 진실)**하고, 마크다운 토큰 가이드(SSOT)에서 CSS 변수·Figma Variables를 파생한다. 무드보드(03)와 컴포넌트화(08) 사이.

## 설치
`SKILL.md`를 `~/.claude/skills/design-system/SKILL.md`로 복사.

## 일반경로 치환 포인트 (`<!-- 변경 포인트 -->`)
- `<디자인입력>` = `design-moodboard-output/<주제>/03_무드보드` (3단계 산출물)
- `<출력루트>` = `design-system-output/<주제>/04_디자인시스템`

⚠️ 원본 가이드는 `디자인/산출물/`을 입출력에 쓰는데, 이 스킬 시리즈에서 `산출물/`은 **스킬 배포 폴더 전용**이라 충돌한다 → 입출력 모두 위 경로로.

## 입력 전제
- **필수**: 03-4 디자인컨셉정의서(확정 컨셉·톤앤매너·컬러 무드 방향). 없으면 중단.
- **brand seed hex**: 03 정의서엔 hex가 없으므로(온도·채도 방향만), 03-3 컨셉비주얼의 확정 컨셉 hex 후보(`확정 아님` 라벨)를 **추천 seed**로 제시하고 게이트에서 사람이 확정한다. 03-3이 없으면 seed를 직접 입력.

## 계산 (Python · stdlib only)
WCAG 대비비·모듈러 스케일·OKLab 명도 보간은 **Python 스크립트로 산출하고 stdout/JSON이 진실**(LLM 암산 금지). 외부 패키지 없이 `math`만 쓴다. OKLab 행렬 상수는 **Context7(CSS Color 4)에서 fetch**해 출처를 박고, 알려진 변환쌍을 스크립트가 assert한다. WCAG 2.1 상수(오프셋 0.05·gamma 2.4·가중치 0.2126/0.7152/0.0722)는 명시. 마크다운·CSS·preview가 같은 JSON을 인용해 3자 정합을 보장한다. 경계 대비비는 사람이 도구로 재확인.

## Figma (옵트인 · publish는 사람)
Figma Variables·스타일 생성은 옵트인이다. 미연결 시: `claude mcp add --transport http figma https://mcp.figma.com/mcp` 후 `/mcp` 인증. 생성은 `figma-generate-library` 스킬(Phase 0~2 — foundations 토큰만, 컴포넌트는 08)에 위임하고 `/figma-use` 절차를 선행한다. **생성 ≠ 게시 — publish는 검증 후 디자이너가 직접** 한다. 미동의·미인증·dry-run이면 마크다운+CSS만 1급으로 degrade. (SKILL 본문은 mcp add를 하드코딩하지 않는다 — README 전용.)

## 출력물
`04-1_디자인토큰_컬러`(스케일+WCAG, color.json 인용) · `04-2_디자인토큰_타이포_스페이싱`(radius 포함) · `04-3_라이브러리감사`(조건부) · `scripts/{color_tokens.py, type_space_tokens.py}` + `scripts/out/*.json` · `tokens.css` · `tokens-preview.html` · `_검증체크리스트`.

## 다음 소비자 계약
이 토큰(마크다운 SSOT·tokens.css·Figma Variables)이 06(UI 시안)·08(컴포넌트화)·11(반응형)·13(디자인 리뷰)의 어휘가 된다. 08이 컴포넌트 속성에 토큰을 연결한다.

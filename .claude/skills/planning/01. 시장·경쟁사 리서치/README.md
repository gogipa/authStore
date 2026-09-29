# market-research — 시장·경쟁사 리서치 자동화 스킬

주제 한 줄을 던지면 시장·경쟁사 리서치 산출물 5개를 자동 생성하는 Claude Code 스킬입니다.
경쟁사 확정 게이트 1개만 사람이 확인하고, 나머지는 자동으로 흐릅니다.

> 기획 프로세스 1단계 "시장·경쟁사 리서치"를 자동화합니다.

## 무엇을 만들어 주나

실행하면 `market-research-output/<주제-슬러그>/` 폴더에 5개 파일이 생깁니다:

| 파일 | 내용 |
|---|---|
| `00-시장리포트.md` | 시장 규모·성장률·경쟁사 BM·투자 동향 (출처 링크 포함) |
| `01-가격정책.md` | 경쟁사별 요금·배송·해지 정책 표 |
| `02-notebooklm-질의.md` | NotebookLM 출처 기반 Q&A |
| `03-경쟁사-비교.md` | 기능 비교표(O/△/X/?) + mermaid 포지셔닝 맵 |
| `_검증체크리스트.md` | 사람이 확인해야 할 항목 |

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| `deep-research` 스킬 | 필수 | Stage 1(시장 리포트)의 핵심. 없으면 WebSearch로 대체 가능하나 품질이 떨어짐 |
| NotebookLM MCP | 선택 | Stage 3가 자동 스킵됨. 나머지 4개 산출물은 정상 생성 |

NotebookLM MCP 설치(선택):
```bash
uv tool install notebooklm-mcp-cli   # uv 필요: https://docs.astral.sh/uv/
nlm login                            # 브라우저로 Google 로그인 (1회)
claude mcp add --scope user notebooklm-mcp notebooklm-mcp
```

## 설치

```bash
mkdir -p ~/.claude/skills/market-research
cp SKILL.md ~/.claude/skills/market-research/SKILL.md
```

새 Claude Code 세션을 시작하면 스킬이 인식됩니다.

## 사용법

대화창에 주제를 말하면 자동 발동합니다:

```
반려동물 사료 정기구독 시장 경쟁사 분석해줘
```

1. 스킬이 경쟁사 후보를 찾아 **"이 경쟁사들 맞나요?"** 하고 한 번 물어봅니다 (← 유일한 사람 개입 지점)
2. 확정하면 시장 리포트·가격표·NotebookLM 질의·비교표를 자동 생성합니다
3. `market-research-output/<주제-슬러그>/`에 5개 파일로 저장됩니다

발동 키워드: `시장 리서치`, `경쟁사 분석`, `market research`, `competitor research` 등

## 🔧 변경해서 쓰는 법

`SKILL.md`를 열어 아래를 자기 상황에 맞게 바꾸세요:

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` 섹션 | `market-research-output/`를 원하는 경로로 (예: Obsidian 볼트 폴더) |
| NotebookLM 제거 | `### Stage 3` 섹션 | MCP를 안 쓰면 Stage 3 단락 전체를 삭제 |
| 비교표 기능 축 | `### Stage 0`의 예시 축 | 업종이 고정이면 기능 행을 직접 박아두기 |
| 트리거 키워드 | frontmatter `description` | 자기 표현으로 키워드 추가/교체 |

## 주의

- AI 산출물은 **검증된 사실이 아니라 잘 정리된 초안**입니다.
- 시장 수치는 반드시 원출처를 클릭해 확인하세요. (그럴듯한 숫자를 지어내는 것이 LLM의 대표적 실패 모드)
- 비교표 O/△/X는 핵심 경쟁사 2~3곳을 직접 가입해 검증하세요.
- 가격·정책은 유통기한이 짧으니 의사결정 직전에 핵심 항목을 재확인하세요.
- 국내 시장은 영어권 검색에 잘 안 잡힙니다 — 네이버/DART 등 국내 소스 보강을 권장합니다.

## 원본 기획

이 스킬은 기획 가이드 **"01. 시장·경쟁사 리서치"**를 자동화한 것입니다.

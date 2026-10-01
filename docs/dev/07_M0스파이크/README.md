# 07 M0 스파이크 — 실측 기록

PRD §17 M0 스파이크의 결과 보고서다. 오너 PC(macOS)에서 실제 CLI·공식 문서로 쟀다. 결과는 앱 코드와 설계 문서에 반영했다(2026-10-01, 아래 '반영').

## 보고서

| 스파이크 | 문서 | 한 줄 결과 | 상태 |
|---|---|---|---|
| S6 격리·비전 | [S6_AI격리·비전.md](S6_AI격리·비전.md) | claude는 `--safe-mode --setting-sources "" --strict-mcp-config`로 사용자 설정이 모두 막힌다(호출당 토큰 약 87% 감소). 비전은 claude 성공·agy 앱 템플릿 실패(도구 권한 거부). `--allowedTools Read`는 경계를 없애고 `images_seen`만으로는 '봤는지' 알 수 없다 | Proposed(반영함) |
| S6 약관 | [S6_AI약관.md](S6_AI약관.md) | 세 회사 모두 산출물 상업 이용은 된다. agy는 'Google이 제공하지 않은 제품과 함께 쓰기'를 남용으로 들어 위험 **상**. 엔진별 고지 문구·E-10 확인 9개 | Proposed(법률 판단 아님) |
| S7 엔진 동등성 | [S7_엔진동등성.md](S7_엔진동등성.md) | claude **통과**(스키마 50/50, 최대 44.5초, 고시 정확도 글 100%·비전 98%). agy **실험적**(43/50 = 86%, 비전 3/10). claude 카피 4/10이 스키마는 통과했지만 모양이 깨졌다 | Proposed(반영함) |

- 실행기·샘플·요약: [`apps/BE/scripts/spikes/s7/`](../../../apps/BE/scripts/spikes/s7/) — 앱 빌드·jest·typecheck에 들지 않는다(ESLint만 본다).
- 원본 기록(CLI stdout·stderr·디버그 로그)은 저장소에 넣지 않았다(사용자 경로·agy 로그 잡음, 비밀값이 섞일 수 있음).

## 하지 않은 것

| 항목 | 이유 | 다음 |
|---|---|---|
| S7 codex(호출 템플릿·`~/.codex` 격리·기본 모델·지원 버전) | 이 PC에 `codex`가 설치돼 있지 않다 | 오너가 설치·로그인한 뒤 `run-s7 run --engines codex --codex-text <모델> --codex-vision <모델>` |
| S1 썸네일 생성 | 이번 범위 밖 | 생성 경로 결정 때 S6 약관 §6 #8(배포본은 Gemini API 유료 키 권장)을 함께 본다 |
| S2 라쿠텐 · S3 커머스API · S4 데이터랩 · S5 셀러라이프 | 앱 키·앱 등록이 필요하거나 이번 범위 밖 | [M1 리허설](../../action/M1_리허설.md) §2.1 |

## 반영(2026-10-01)

| 무엇 | 어디 |
|---|---|
| claude 격리 플래그 3개, 격리 검사기를 그 한 조합으로(빈 `--setting-sources` 값까지 검사) | `integrations/ai-engine/ai-engine.constants.ts` `CLAUDE_ISOLATION_ARGS`, `cli-isolation.ts` `CLAUDE_GLOBAL_SETTINGS_BLOCKERS` |
| claude 자식 환경에 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`(세션 제목용 haiku 호출 끄기), 금지 환경변수에 `CODEX_API_KEY`·`GEMINI_API_KEY` | `process/env-allowlist.ts`, `cli-isolation.ts` |
| claude 비전에서 `--allowedTools Read` 삭제, `permission_denials`가 있으면 실패 | `adapters/claude-code.adapter.ts` |
| agy `--disable-slash-commands`, 비전 프롬프트(파일 절대 경로 + 파일 보기 도구만), `print timeout`·`denied_actions`·`no output produced`를 실패로 | `adapters/agy.adapter.ts`, `adapters/cli-adapter-support.ts` |
| 결과 모양 검사(필드 속 결과 JSON·`placeholder` → AI_OUTPUT_INVALID) | `schema/ai-output-validator.ts` |
| AGY '실험적', 엔진별 약관 고지(SCR-13), AGY 모델 목록은 `gemini-*`만 | `settings/ai-engine/ai-engine-options.ts`, FE fixture |
| ⑥-2 원산지: 힌트에 '나라 이름만, 괄호·지역 설명·번역 없이', 괄호 설명·`U.S.A.` 마침표 정리 | `content/facts/extractors/ai-fact.extractor.ts`, `fact-text.ts`, `fact-values.ts` |
| 녹화본 fixture 5개 | `apps/BE/test/fixtures/ai-engine/README.md` |
| PRD §8.9 호출 템플릿·비용 추정·§17 결과, 리허설 §2.1, 열린 질문, 06-2 §9 | 각 문서 |
| PRD 약관 보강(S6 약관 §6 #1·#2·#12·#13): §3 #15·①-9 리스크 칸(Anthropic 법무 페이지 새 문장 3개, agy 'Google이 제공하지 않은 제품' 문구, 첫 실행 고지 항목), K16 '중(agy 상)', K25 배포본 AGY 기본 끔, OP-08 감시 대상, E-10 E10-a~i | `docs/prd/03-PRD초안.md` |

## 반영하지 않은 추천(오너 결정·추가 측정)

| 추천 | 이유 |
|---|---|
| claude 비전을 stream-json base64로(토큰 47%, 6.5초) | 실행기가 stdin을 열어야 해 PRD 규약('stdin을 닫는다')이 바뀐다. M2 후보(S6 §9) |
| ⑥-1 모양 깨짐 때 1회 바로 다시 부르기 | AI-05 재시도를 M2에서 앞당기는 일이라 오너 결정(S7 Q3). 지금은 `AI_OUTPUT_INVALID` + '다시 실행해 보세요' |
| agy 자동 업데이트 끄기(`AGY_CLI_DISABLE_AUTO_UPDATE`) | 바이너리에서 이름만 찾았고 효과를 시험하지 못했다 |
| 지원 버전 범위 최소값(P-13) | 오너 결정. 검증 버전만 `AI_VERIFIED_CLI_VERSIONS`에 적었다 |
| SCR-13 연결 테스트의 엔진별 기대 시간(agy p50 17초·최대 45초, claude 최대 4.4초) | 보드 캡션 문구가 정해져 있어 화면 문구 결정이 필요하다. 연결 테스트 시간 제한은 120초라 agy도 넘지 않는다 |
| 배포본(GEN-09) AGY 기본 끔·별도 동의, 첫 실행 고지 항목 | GEN-09는 M2 범위. PRD ①-9·K25에 적었다 |
| 기능 문장 속 소재 이름('메쉬 어퍼')을 카피에 써도 되는지 | 오너 결정(S7 Q1) |
| `test/fixtures/content/ai` 비전 합성본을 녹화본으로 | S7 원본 기록이 저장소 밖(세션 스크래치)에 있다. 요약만 `scripts/spikes/s7/results`에 있다 |

남은 일(오너 결정·추가 측정)은 각 보고서의 추천 표와 [M1 리허설](../../action/M1_리허설.md) §2.1에 있다.

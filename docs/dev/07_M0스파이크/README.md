# 07 M0 스파이크 — 실측 기록

PRD §17 M0 스파이크의 결과 보고서다. 오너 PC(macOS)에서 실제 CLI·공식 문서로 쟀다. 결과는 앱 코드와 설계 문서에 반영했다(2026-10-01 S6·S7, 2026-10-02 S1, 아래 '반영'). 보고 뒤 오너가 정한 것(D-17~D-20 2026-10-02, D-21~D-26 2026-10-03)은 아래 '오너 결정'에 있다.

## 보고서

| 스파이크 | 문서 | 한 줄 결과 | 상태 |
|---|---|---|---|
| S1 썸네일 생성(agy) | [S1_썸네일생성.md](S1_썸네일생성.md) | agy 1.2.14 `generate_image`로 레퍼런스 → 썸네일 12/12, 거부 0. 권한 플래그 필요 없음. 결과는 늘 JPEG 1024×1024(2048 요청 무시), `~/.gemini/antigravity-cli/brain/<id>/`에 생긴다. p50 27.9초·최대 92.2초. 실패도 SUCCESS·exit 0. 호출 단위 학습·텔레메트리 끄기 없음. 입력이 합성 사진이라 사람 채점 기준(70%·디테일)은 **미측정** | Proposed(경로 사용 가능, 실제 어댑터 반영함). 오너 결정 Q1~Q6은 D-21~D-26으로 모두 정함. 오너 채점 남음 |
| S6 격리·비전 | [S6_AI격리·비전.md](S6_AI격리·비전.md) | claude는 `--safe-mode --setting-sources "" --strict-mcp-config`로 사용자 설정이 모두 막힌다(호출당 토큰 약 87% 감소). 비전은 claude 성공·agy 앱 템플릿 실패(도구 권한 거부). `--allowedTools Read`는 경계를 없애고 `images_seen`만으로는 '봤는지' 알 수 없다 | Proposed(반영함) |
| S6 약관 | [S6_AI약관.md](S6_AI약관.md) | 세 회사 모두 산출물 상업 이용은 된다. agy는 처음 위험 '상'으로 봤으나 D-18로 오너 본인 사용은 **중**이다('제3자 소프트웨어로 접근' 금지는 OAuth를 빌려 쓰는 경우라 해당 없음, 넓은 'Google이 제공하지 않은 제품' 문장만 남음). 동료 배포는 E-10 확인 전. 엔진별 고지 문구·E-10 확인 9개 | Proposed(법률 판단 아님), D-18~D-20 반영 |
| S7 엔진 동등성 | [S7_엔진동등성.md](S7_엔진동등성.md) | claude **통과**(스키마 50/50, 최대 44.5초, 고시 정확도 글 100%·비전 98%). agy **실험적**(43/50 = 86%, 비전 3/10). claude 카피 4/10이 스키마는 통과했지만 모양이 깨졌다 | Proposed(반영함) |

- 실행기·샘플·요약: [`apps/BE/scripts/spikes/s7/`](../../../apps/BE/scripts/spikes/s7/) — 앱 빌드·jest·typecheck에 들지 않는다(ESLint만 본다).
- 원본 기록(CLI stdout·stderr·디버그 로그)은 저장소에 넣지 않았다(사용자 경로·agy 로그 잡음, 비밀값이 섞일 수 있음).

## 하지 않은 것

| 항목 | 이유 | 다음 |
|---|---|---|
| S7 codex(호출 템플릿·`~/.codex` 격리·기본 모델·지원 버전) | 이 PC에 `codex`가 설치돼 있지 않다 | 오너가 설치·로그인한 뒤 `run-s7 run --engines codex --codex-text <모델> --codex-vision <모델>` |
| S1 사람 채점(70%·디테일, 상품 10개 × 2장) | 실측은 했다(2026-10-02). 입력이 합성 판매 사진이라 채점하지 않았다 | 오너가 실제 라쿠텐 상품으로 ⑤에서 만들고 G3에서 센다(M1 리허설). '70%'는 신발 길이로 잰다(D-22). 미달이면 대안(Gemini API 유료 키 또는 대표이미지 대안)을 오너가 고른다(D-19). Gemini API 비교는 키가 없어 하지 않았다 |
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
| PRD 약관 보강(S6 약관 §6 #1·#2·#12·#13): §3 #15·①-9 리스크 칸(Anthropic 법무 페이지 새 문장 3개, agy 'Google이 제공하지 않은 제품' 문구, 첫 실행 고지 항목), K16 '중(agy 상)', K25 배포본 AGY 기본 끔, OP-08 감시 대상, E-10 E10-a~i. 2026-10-02 D-18로 K16 '중', K25 'M2에서 E-10 뒤 정함'으로 다시 고쳤다 | `docs/prd/03-PRD초안.md` |

### S1 반영(2026-10-02)

| 무엇 | 어디 |
|---|---|
| 실제 이미지 생성 어댑터 `AgyImageGenProvider`(최소 권한 호출, 레퍼런스 복사본만, brain 폴더 realpath 확인, 실패 매핑, `--print-timeout` = 하드 - 20초, call_log AI_AGY_CLI) | `integrations/image-gen/agy-image-gen.provider.ts` |
| 설정 `thumbnail.imageProvider`(기본 AGY)로 고르는 `RoutingImageGenProvider`. NODE_ENV=test는 가짜 공급자 그대로, e2e·흐름 테스트는 토큰을 가짜로 바꿔 끼운다 | `integrations/image-gen/routing-image-gen.provider.ts`, `integrations.module.ts` |
| 실행기 중단 신호(`signal`) — 하드 타임아웃 때 자식을 끝낸다. 생성 작업은 끊긴 agy가 끝날 때까지(최대 10초) 다음 생성을 미룬다 | `process/isolated-cli-runner.ts`, `thumbnails/generation/generation.worker.ts` |
| agy 자식 환경에 `AGY_CLI_DISABLE_AUTO_UPDATE=true`('1'은 효과 없음) | `process/env-allowlist.ts`, `cli-isolation.ts` |
| 녹화본 fixture(정리함)와 합성본 2개, 단위 테스트, 실제 호출 테스트(기본 꺼짐) | `apps/BE/test/fixtures/image-gen/README.md` |
| PRD §8.4 공급자 표·§8.9 R16·K15·§17 S1 결과, M1 리허설 사전 점검 12·§2.1, 검증 체크리스트 | 각 문서 |

## 오너 결정(2026-10-02~)

D-17~D-20은 S6·S7 보고 뒤 '정해 주실 것' 4개에 대한 답이다. 원문과 근거: [원천자료 09](../../prd/원천자료/09_M0결정_2026-10-02.md). D-21~D-26은 S1 보고 §8의 Q1~Q6에 대한 답이다. 원문과 근거: [원천자료 10](../../prd/원천자료/10_S1결정_2026-10-03.md)(Q26~Q32).

| 결정 | 내용 | 반영 |
|---|---|---|
| D-17 | ⑥-1 카피의 AI 결과가 앱 검증에서 떨어지면(`AI_OUTPUT_INVALID`) 같은 엔진·모델로 1회 바로 다시 부른다. 시간 초과·CLI 실패·엔진 사용 불가·한도·취소는 다시 부르지 않는다. ⑥-1만 | 설계 문서(PRD §8.5, 03-1 AI-04, 03-3, 04 `F-CT-41`). **코드 반영**(2026-10-02): ⑥-1 `CopyStepRunner.generate`, 카피 지시문 끝 '[결과 모양]' 줄(S7 §4.7) — [구현기록](../../action/_구현기록.md) 'D-17' |
| D-18 | AGY를 계속 고를 수 있다. 오너 본인 사용 약관 위험 상 → **중**. 배포본 기본값은 M2에서 E-10 뒤. '실험적'은 품질 이유만 | [S6 약관](S6_AI약관.md) 상자·§0·§6 #2·§7·§8·§10, PRD §3 #15·§8.9 R14·K16·K25·①-9, SCR-13 AGY 고지(`ai-engine-options.ts`, FE fixture) |
| D-19 | S1 썸네일 생성 경로 = agy `generate_image`(오너 Google 플랜). Gemini API 키 없음. S1 미달이면 대안을 오너가 고름 | S6 약관 §6 #8·§10 #5, PRD §8.4·§17 S1·K15, 04 `F-TH-07`, M1 리허설. **S1 실측·코드 반영**(2026-10-02): [S1_썸네일생성.md](S1_썸네일생성.md), `AgyImageGenProvider` |
| D-20 | 학습 허용 안 함. 계정 설정 3개는 오너가 끈다. 앱은 학습을 켜지 않고 허용 옵션도 없다 | PRD §8.9 R16·§13 P-09, S6 약관 §8·§10 #8, M1 리허설 사전 점검. S1: agy를 호출 단위로 끄는 스위치는 **찾지 못했다**(`--help`·`/config`·환경변수 이름) — 오너가 'Enable Telemetry'를 끈다 |
| D-21 | (S1 Q1, 2026-10-03) 썸네일 생성 해상도 기본값 `thumbnail.resolutionPx` = **1024**(전에는 2048). agy는 늘 1024×1024를 낸다. 업로드 때 1000×1000 JPEG로 맞추는 처리는 그대로. 엔진별 크기 문구 없음(썸네일은 엔진 선택과 관계없이 agy가 만든다). 이미 있는 설정 파일 값은 앱이 바꾸지 않는다 | 기본 템플릿·fixture, ⑤ 요약 줄 '1K', PRD §8.4·§16 ③·K15·§17, 03-1 IM-03, 04 `F-TH-07`·`F-ST-21`, ERD `requested_size_px`, 05-1·05-2, 06-4·06-2 §9-244, M1 리허설 사전 점검 12 — [구현기록](../../action/_구현기록.md) 'S1 Q1' |
| D-22 | (S1 Q2, 2026-10-03) 지금 생성 결과가 목표다. 프롬프트는 그대로 둔다. '70%'는 **신발 길이**로 잰다: 신발 박스 긴 변 ÷ 같은 방향 이미지 변 ≥ 0.70(S1 샘플 약 0.84~0.88). 박스 면적비는 기본이 아니다(옆모습 신발은 약 0.43이 상한). G3 문구 '신발 길이가 화면 폭의 70% 이상'. 키 `shoeRatioOver70`은 그대로 | FE G3 문구·BE DTO·05-2 설명, 체크리스트 버전 `M1-2`, PRD §5.1·§8.4·§16 ③, 03-1 IM-04·06, 04 `F-TH-14`·`F-TH-24`, ERD, 화면시안_명세 SCR-05, M1 리허설 — [구현기록](../../action/_구현기록.md) 'S1 Q2~Q6' |
| D-23 | (S1 Q3) 생성 하드 타임아웃 기본값 `thumbnail.generationTimeoutSeconds` = **300초**(전에는 900초). 범위 1~900초 그대로. `--print-timeout`은 하드 - 20초(기본 280초). 이미 있는 설정 파일 값은 앱이 바꾸지 않는다 | 기본 템플릿·fixture·테스트, 설정이 없을 때 쓰는 상수, PRD §8.9, 03-1 AI-03, 04 `F-BS-59`, 05-1, 06-4·06-2 §9-246, P3-02, M1 리허설 사전 점검 12 |
| D-24 | (S1 Q4) 얼굴 노출은 품질 기준이 아니다. 기준은 신발이 돋보이는가 하나다. `FACE_OPTION_PHRASES`는 그대로. G3 '실존 인물 연상 없음'(초상권)은 그대로 | PRD §8.4, S1 §4.7·§8 #8. 코드 변경 없음 |
| D-25 | (S1 Q5) 앱은 `~/.gemini/antigravity-cli/` 아래 agy 기록을 지우지 않는다. AI 엔진 설정 화면(SCR-13)에 용량 세 가지를 보인다: agy 기록 폴더 크기, 앱이 저장한 이미지 폴더(라쿠텐 원본·생성 후보) 크기, PC 디스크 남은 공간. 앱은 크기를 재기만 한다(M1) | PRD §8.9 R17, S1 §8 #10. 반영함(2026-10-03): SCR-13 '저장 공간' 패널(`F-ST-33`, `GET /storage-usage`) |
| D-26 | (S1 Q6) StitchMCP는 그대로 둔다(앱 프롬프트가 다른 도구를 금지하고 S1에서 부르지 않았다. IDE도 같은 방식) | PRD §8.9, S1 §8 #11. 코드 변경 없음 |

## 반영하지 않은 추천(오너 결정·추가 측정)

| 추천 | 이유 |
|---|---|
| claude 비전을 stream-json base64로(토큰 47%, 6.5초) | 실행기가 stdin을 열어야 해 PRD 규약('stdin을 닫는다')이 바뀐다. M2 후보(S6 §9) |
| ~~⑥-1 모양 깨짐 때 1회 바로 다시 부르기~~ | **정함(D-17, 2026-10-02)**: ⑥-1만 같은 엔진·모델로 1회 바로 다시 부른다. 재시도 요구사항은 AI-04(`F-BS-60`)다(전에 적은 'AI-05'는 오기). M1 기능 `F-CT-41`. 코드 반영함(2026-10-02, `copy-step.runner.ts`). 두 번째도 떨어지면 지금처럼 `AI_OUTPUT_INVALID` + '다시 실행해 보세요' |
| ~~agy 자동 업데이트 끄기(`AGY_CLI_DISABLE_AUTO_UPDATE`)~~ | **반영함(S1, 2026-10-02)**: 값이 `true`여야 꺼진다(`1`은 효과 없음). 앱이 agy 자식에만 넣는다 |
| ~~S1 오너 결정 5개('70%' 지표, 하드 타임아웃 300초, 얼굴 노출 문장, agy 대화 기록 정리, StitchMCP 끄기)~~ | **정함(D-22~D-26, 2026-10-03)**: '70%'는 신발 길이, 타임아웃 기본 300초, 얼굴 노출 문장 그대로, agy 기록은 지우지 않고 용량 표시, StitchMCP 그대로. 해상도 1024는 D-21. [S1](S1_썸네일생성.md) §8 |
| 지원 버전 범위 최소값(P-13) | 오너 결정. 검증 버전만 `AI_VERIFIED_CLI_VERSIONS`에 적었다 |
| SCR-13 연결 테스트의 엔진별 기대 시간(agy p50 17초·최대 45초, claude 최대 4.4초) | 보드 캡션 문구가 정해져 있어 화면 문구 결정이 필요하다. 연결 테스트 시간 제한은 120초라 agy도 넘지 않는다 |
| ~~배포본(GEN-09) AGY 기본 끔·별도 동의~~, 첫 실행 고지 항목 | **M2로 미룸(D-18, 2026-10-02)**: 배포본 AGY 기본값은 M2에서 E-10(E10-d·e) 확인 뒤 정한다(PRD K25). 첫 실행 고지 항목은 GEN-09(M2)이고 PRD ①-9에 있다 |
| 기능 문장 속 소재 이름('메쉬 어퍼')을 카피에 써도 되는지 | 오너 결정(S7 Q1) |
| `test/fixtures/content/ai` 비전 합성본을 녹화본으로 | S7 원본 기록이 저장소 밖(세션 스크래치)에 있다. 요약만 `scripts/spikes/s7/results`에 있다 |

남은 일(오너 결정·추가 측정)은 각 보고서의 추천 표와 [M1 리허설](../../action/M1_리허설.md) §2.1에 있다.

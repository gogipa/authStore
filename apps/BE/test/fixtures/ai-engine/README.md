# AI 엔진 fixture (P1-10)

실제 AI CLI(`claude`·`agy`·`codex`)를 부르지 않고 AI 실행기·어댑터 3개를 검증하는 파일이다.
M0 S6(claude·agy 격리·비전)과 S7(codex 설치·엔진 동등성)이 끝나기 전이라 **모두 합성본**이다. 녹화본이 오면
같은 이름으로 바꾸고 아래 표의 '종류'를 '녹화본(날짜·버전)'으로 고친다. 파서는 `src/modules/integrations/ai-engine/adapters/*.adapter.ts`에만 있다.

## 가짜 CLI

| 파일                               | 종류        | 내용                                                                                                                                                                                                                               |
| ---------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/fake-ai-cli.mjs`              | 테스트 도구 | 실행한 파일 이름(claude·agy·codex)으로 엔진을 정하고, 옆 `scenario.json`이 고른 출력을 내보낸다. 호출마다 옆 `records/calls.jsonl`에 argv·cwd·시작 때 cwd 안 파일·환경변수 **이름**·stdin 상태·`--add-dir`·`--image` 내용을 적는다 |
| `bin/claude`·`bin/agy`·`bin/codex` | 테스트 도구 | `fake-ai-cli.mjs`와 이름만 다른 실행 파일(손으로 돌려 볼 때)                                                                                                                                                                       |

- 앱은 자식 환경변수를 허용 목록으로 거르므로 시나리오를 환경변수로 넘기지 않는다. 테스트는 `test/support/fake-ai-cli.ts`의
  `createFakeCliWorld()`로 임시 폴더에 같은 이름의 실행 파일(노드 절대 경로 shebang)과 `scenario.json`을 만들고 그 폴더만 `PATH`에 둔다.
  사용자 PC의 진짜 CLI가 잡히지 않는다.
- `scenario.json` 모양: `{ "<엔진>": { "version": "<fixture 경로>" | null, "auth": { "stdout", "exit" }, "run": { "stdout", "stderr", "lastMessage"(codex), "exit", "sleepMs" } } }`.
  경로는 이 폴더 기준이고, `{ "text": "…" }`로 글을 바로 줄 수 있다. `version: null`이면 `--version`이 실패한다.

## 출력

| 파일                                                             | 종류   | 근거                                                                       |
| ---------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| `claude/version.txt`                                             | 합성본 | `claude --version`(2.1.269, PRD §8.9)                                      |
| `claude/auth-status-ok.txt` · `auth-status-logged-out.txt`       | 합성본 | `claude auth status` 출력 모양은 S6에서 확인                               |
| `claude/text-success.json`                                       | 합성본 | `--output-format json` 봉투의 `structured_output`(PRD §8.9 템플릿)         |
| `claude/vision-success.json`                                     | 합성본 | 비전 결과 + `images_seen`(읽은 파일 이름 목록, P1-10 Proposed)             |
| `claude/success-empty-structured-output.json`                    | 합성본 | SUCCESS인데 `structured_output`이 null                                     |
| `claude/smoke-ok.json`                                           | 합성본 | 연결 테스트 `{answer:'OK'}`                                                |
| `claude/error-logged-out.json`                                   | 합성본 | 로그인 풀림 오류 봉투(`is_error`)                                          |
| `claude/extra-field.json`                                        | 합성본 | 스키마 밖 필드(`price`)가 섞인 결과                                        |
| `agy/version.txt`                                                | 합성본 | `agy --version`(1.2.9)                                                     |
| `agy/success.json` · `smoke-ok.json`                             | 합성본 | `status: SUCCESS` 봉투(PRD §8.9 agy)                                       |
| `agy/success-empty-structured-output.json`                       | 합성본 | SUCCESS인데 빈 `structured_output`                                         |
| `agy/partial-output-warning.json`                                | 합성본 | 부분 출력 경고(`warnings`의 PARTIAL_OUTPUT) — 실제 경고 모양은 S6에서 확인 |
| `agy/agy-error.stderr.txt`                                       | 합성본 | stderr의 `AGY_ERROR`                                                       |
| `codex/version.txt`                                              | 합성본 | `codex --version`                                                          |
| `codex/last-message-success.json` · `last-message-smoke-ok.json` | 합성본 | `--output-last-message` 파일(결과는 이것만 믿는다)                         |
| `codex/events.jsonl`                                             | 합성본 | `--json` 이벤트(진행 표시용, 결과로 쓰지 않는다)                           |
| `codex/login-status-ok.txt` · `login-status-logged-out.txt`      | 합성본 | `codex login status`                                                       |

## 스키마

| 파일                                        | 규칙 7                                                          |
| ------------------------------------------- | --------------------------------------------------------------- |
| `schemas/valid.schema.json`                 | 지킨다(모든 필드 required, 추가 필드 막음, 선택 값은 null 허용) |
| `schemas/additional-properties.schema.json` | 어김: `additionalProperties: true`                              |
| `schemas/missing-required.schema.json`      | 어김: `note`가 required에 없음                                  |
| `schemas/format.schema.json`                | 어김: `format` 사용                                             |

## 실제 CLI 테스트

기본으로 돌지 않는다. `AI_CLI_LIVE=1`일 때만 `src/modules/integrations/ai-engine/live-cli.spec.ts`가 이 PC의 진짜 CLI로
감지·연결 테스트('OK' 한 번)를 한다(구독 쿼터를 쓴다, 06-2 §9).

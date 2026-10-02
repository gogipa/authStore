# AI 엔진 fixture (P1-10)

실제 AI CLI(`claude`·`agy`·`codex`)를 부르지 않고 AI 실행기·어댑터 3개를 검증하는 파일이다.
M0 S6·S7(2026-10-01, [docs/dev/07_M0스파이크](../../../../../docs/dev/07_M0스파이크/README.md)) 실측 출력 중 일부를 **녹화본**으로 넣었다
(아이디는 0으로 바꾸고 로컬 경로는 `/tmp/autostore-ai-img-XXXXXX`로 바꿨다). 나머지는 합성본이고, codex는 미설치라 모두 합성본이다.
파서는 `src/modules/integrations/ai-engine/adapters/*.adapter.ts`에만 있다.

## 가짜 CLI

| 파일                               | 종류        | 내용                                                                                                                                                                                                                               |
| ---------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/fake-ai-cli.mjs`              | 테스트 도구 | 실행한 파일 이름(claude·agy·codex)으로 엔진을 정하고, 옆 `scenario.json`이 고른 출력을 내보낸다. 호출마다 옆 `records/calls.jsonl`에 argv·cwd·시작 때 cwd 안 파일·환경변수 **이름**·stdin 상태·`--add-dir`·`--image` 내용을 적는다 |
| `bin/claude`·`bin/agy`·`bin/codex` | 테스트 도구 | `fake-ai-cli.mjs`와 이름만 다른 실행 파일(손으로 돌려 볼 때)                                                                                                                                                                       |

- 앱은 자식 환경변수를 허용 목록으로 거르므로 시나리오를 환경변수로 넘기지 않는다. 테스트는 `test/support/fake-ai-cli.ts`의
  `createFakeCliWorld()`로 임시 폴더에 같은 이름의 실행 파일(노드 절대 경로 shebang)과 `scenario.json`을 만들고 그 폴더만 `PATH`에 둔다.
  사용자 PC의 진짜 CLI가 잡히지 않는다.
- `scenario.json` 모양: `{ "<엔진>": { "version": "<fixture 경로>" | null, "auth": { "stdout", "exit" }, "models": { "stdout", "exit" }(agy, P1-11), "run": { "stdout", "stderr", "lastMessage"(codex), "brain"(agy 이미지, M0 S1), "exit", "sleepMs" } } }`.
  경로는 이 폴더 기준(절대 경로도 된다)이고, `{ "text": "…" }`로 글을 바로 줄 수 있다. `version: null`이면 `--version`이 실패한다.
- M0 S1(이미지 생성): 출력 글의 `<HOME>`·`<RUN_DIR>`(녹화본 자리표시자)은 그 호출의 `HOME`·`--add-dir` 상위 폴더로 바뀐다.
  `run.brain = { conversationId, files: [{ name, from }] }`이면 `$HOME/.gemini/antigravity-cli/brain/<conversationId>/`에 결과 파일을 복사한다.
  `createFakeCliWorld()`의 기본 `HOME`은 세계 폴더 안 `home/`(임시)이다. 가짜 CLI는 `HOME`이 임시 폴더(`os.tmpdir()` 아래, 사용자 홈 아님)가
  아니면 brain 파일을 쓰지 않고 exit 97로 끝난다(사용자 홈의 `~/.gemini` 보호).
  호출 기록에 `AGY_CLI_DISABLE_AUTO_UPDATE` 값(`agyDisableAutoUpdate`)도 남긴다. 이미지 녹화본은 [`../image-gen/`](../image-gen/README.md)에 있다.

## 출력

| 파일                                                             | 종류                                   | 근거                                                                                                                                  |
| ---------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `claude/version.txt`                                             | 합성본                                 | `claude --version`(2.1.269, PRD §8.9)                                                                                                 |
| `claude/auth-status-ok.txt` · `auth-status-logged-out.txt`       | 합성본                                 | `claude auth status` 출력 모양은 S6에서 확인                                                                                          |
| `claude/text-success.json`                                       | 합성본                                 | `--output-format json` 봉투의 `structured_output`(PRD §8.9 템플릿)                                                                    |
| `claude/vision-success.json`                                     | 합성본                                 | 비전 결과 + `images_seen`(읽은 파일 이름 목록, P1-10 Proposed)                                                                        |
| `claude/success-empty-structured-output.json`                    | 합성본                                 | SUCCESS인데 `structured_output`이 null                                                                                                |
| `claude/smoke-ok.json`                                           | 녹화본(2026-10-01, claude 2.1.269)     | 연결 테스트 `{answer:'OK'}`, 격리 3개 플래그. 실제 봉투 키(`permission_denials`·`modelUsage` 등) 그대로                               |
| `claude/vision-permission-denied.json`                           | 녹화본 모양(2026-10-01)                | 읽기가 거부됐는데 `images_seen`에 이름을 적은 실측(S6 §5 발견 2). 결과는 `valid.schema.json` 모양으로 바꿨다 → AI_IMAGES_NOT_SEEN     |
| `claude/error-logged-out.json`                                   | 합성본                                 | 로그인 풀림 오류 봉투(`is_error`)                                                                                                     |
| `claude/extra-field.json`                                        | 합성본                                 | 스키마 밖 필드(`price`)가 섞인 결과                                                                                                   |
| `agy/version.txt`                                                | 합성본                                 | `agy --version`(1.2.9)                                                                                                                |
| `agy/models.txt`                                                 | 합성본                                 | `agy models`(P1-11 — 모델 5개, 머리 줄·'(default)' 설명 포함. 파서 `parseAgyModels`)                                                  |
| `agy/success.json`                                               | 합성본                                 | `status: SUCCESS` 봉투(PRD §8.9 agy)                                                                                                  |
| `agy/smoke-ok.json`                                              | 녹화본(2026-10-01, agy 1.2.14)         | 연결 테스트. `response`에 잡음(`OK\n{…toolAction…}`)이 섞이고 `structured_output`만 깨끗하다                                          |
| `agy/print-timeout.json` · `print-timeout.stderr.txt`            | 녹화본(agy 1.2.14)                     | `--print-timeout 1s`: exit 0·`SUCCESS`·`num_turns 0`, stderr `print timeout after` → AI_TIMEOUT                                       |
| `agy/denied-command.json` · `no-output-produced.stderr.txt`      | 녹화본(agy 1.2.14, 스키마 에코만 줄임) | 비전에서 `RunCommand` 자동 거부(`denied_actions`), stderr `jetski: no output produced` → 비전 AI_IMAGES_NOT_SEEN·텍스트 AI_CLI_FAILED |
| `agy/success-empty-structured-output.json`                       | 합성본                                 | SUCCESS인데 빈 `structured_output`                                                                                                    |
| `agy/partial-output-warning.json`                                | 합성본                                 | 부분 출력 경고(`warnings`의 PARTIAL_OUTPUT). S6 실측 봉투(1.2.14)에는 `partial`·`warnings` 필드가 없었다 — 시간 초과는 stderr로 본다  |
| `agy/agy-error.stderr.txt`                                       | 합성본                                 | stderr의 `AGY_ERROR`                                                                                                                  |
| `codex/version.txt`                                              | 합성본                                 | `codex --version`                                                                                                                     |
| `codex/last-message-success.json` · `last-message-smoke-ok.json` | 합성본                                 | `--output-last-message` 파일(결과는 이것만 믿는다)                                                                                    |
| `codex/events.jsonl`                                             | 합성본                                 | `--json` 이벤트(진행 표시용, 결과로 쓰지 않는다)                                                                                      |
| `codex/login-status-ok.txt` · `login-status-logged-out.txt`      | 합성본                                 | `codex login status`                                                                                                                  |

## 스키마

| 파일                                        | 규칙 7                                                          |
| ------------------------------------------- | --------------------------------------------------------------- |
| `schemas/valid.schema.json`                 | 지킨다(모든 필드 required, 추가 필드 막음, 선택 값은 null 허용) |
| `schemas/additional-properties.schema.json` | 어김: `additionalProperties: true`                              |
| `schemas/missing-required.schema.json`      | 어김: `note`가 required에 없음                                  |
| `schemas/format.schema.json`                | 어김: `format` 사용                                             |

## 실제 CLI 테스트

기본으로 돌지 않는다. `AI_CLI_LIVE=1`일 때만 `src/modules/integrations/ai-engine/live-cli.spec.ts`가 이 PC의 진짜 CLI로
감지·연결 테스트('OK' 한 번)를 한다(구독 쿼터를 쓴다, 06-2 §9). 이미지 생성(M0 S1)은 `AI_CLI_LIVE_ENGINES`에 `agy-image`를 넣을 때만
`src/modules/integrations/image-gen/live-image-gen.spec.ts`가 진짜 agy로 1장 만든다.

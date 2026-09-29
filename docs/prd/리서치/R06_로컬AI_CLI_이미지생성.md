# R06 — 로컬 AI CLI 연동 및 썸네일 이미지 생성·검증

- 작성일: 2026-09-24
- 대상: 신발 해외구매대행 자동 상품등록 로컬 웹앱 PRD
- 조사 범위: 로컬 웹앱 백엔드가 `claude`(Claude Code) / `agy`(Antigravity CLI) / `codex`(Codex CLI) / `gemini`(Gemini CLI)를 서브프로세스로 호출해 번역·카피라이팅·정보추출·상품매칭·태그선별·썸네일 이미지 생성을 수행하는 방법
- 근거 원천: `../원천자료/01_사용자요청_2026-09-24.md`, 로컬 실측(2026-09-24), 공식 문서 및 2차 자료(출처 표기)
- 표기 규칙: **[실측]** = 이 머신에서 직접 실행해 확인, **[공식]** = 공식 문서, **[2차]** = 커뮤니티·언론, **미확인** = 확인하지 못함

---

## 1. 요약

1. 텍스트·비전 작업(번역·카피·정보추출·매칭·태그선별)은 **`claude -p` + `--json-schema`**(Max 구독, 실측 성공)를 주 경로로, **`agy -p` + `--json-schema`**(실측 성공)를 보조·대체 경로로 쓰는 것이 현실적이다. 두 CLI 모두 JSON 결과의 `structured_output` 필드를 돌려준다.
2. **Gemini CLI는 개인 Google 로그인으로 쓸 수 없다**(2026-06-18부터 개인·AI Pro·Ultra 요청 중단, 로컬 실측 `IneligibleTierError`). **Codex는 설치돼 있지 않다.** Claude는 이미지를 **생성하지 못한다.**
3. 썸네일을 만들 수 있는 경로는 네 가지다. (a) `agy`에 내장된 `generate_image` 도구(구독 쿼터 사용, 헤드리스 동작은 공식 문서가 없어 커뮤니티 자료로만 확인), (b) Gemini API 직접 호출(Nano Banana 2·Pro, 레퍼런스 이미지 최대 10장·6장, 장당 $0.067~$0.24), (c) Codex의 내장 이미지 생성(`gpt-image-2`, ChatGPT Plus 이상), (d) OpenAI Images API. 재현성·크기 제어 측면에서는 (b)가 가장 안정적이다.
4. "신발 70%"는 **정의부터 정해야 한다**(마스크 면적인지, 바운딩박스 면적인지). 측정은 VLM 바운딩박스·세그멘테이션(Gemini `box_2d` 0~1000 정규화)이나 로컬 텍스트 프롬프트 세그멘테이션(SAM 3)으로 할 수 있다. 디테일 보존은 임베딩 유사도, 색상 비교, VLM 체크리스트를 조합한 뒤 **최종 판단은 사람이 한다.**
5. 정책 리스크가 크다. 네이버쇼핑의 AI 생성물 기준(2026-07-10)과 공정위 추천·보증 심사지침의 AI 가상인물 표시(2026-06-01), 실존 아이돌과 닮았을 때의 부정경쟁방지법 문제, 구독을 자동화에 쓸 때의 약관 문제(Anthropic·Google)가 있다. 썸네일 라벨링과 휴먼 승인 단계를 필수 요구사항으로 반영해야 한다.

---

## 2. 상세 발견사항

### 2.1 로컬 환경 실측 (2026-09-24)

| 항목 | 결과 | 비고 |
|---|---|---|
| 머신 | Apple M4 Pro, arm64, RAM 24GB | 로컬 세그멘테이션 모델 구동 여지 있음(성능 미확인) |
| `claude` | 2.1.269, `/Users/pyo/.local/bin/claude` | `claude auth status` → `authMethod: claude.ai`, `subscriptionType: max` |
| `agy` | **1.1.23** 설치(changelog 최신은 **1.2.9**) ⚠️정정됨(검증 결과 참조) | `agy update`로 업데이트 필요. 1.2.x에 헤드리스 관련 수정이 다수 포함됨 ⚠️정정됨(검증 결과 참조) |
| `gemini` | 0.42.0 | 개인 OAuth(`oauth-personal`) 인증 실패. 아래 2.2.3 참고 |
| `codex` | **미설치** (`codex not found`) | |
| API 키 환경변수 | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY` 모두 **미설정** | 현재는 모두 구독 로그인 기반 |
| Python | 시스템 `python3` 3.9.6 | `rembg`는 Python 3.11~3.13이 필요해 별도 가상환경(uv 등)이 있어야 함 |
| 이미지 도구 | `ffmpeg` 있음, ImageMagick 없음, `ollama` 없음 | |
| agy MCP 설정 | `~/.gemini/config/mcp_config.json`에 `StitchMCP`(npx mcp-remote) 등록 | 헤드리스 행(hang) 이슈 #1087과 관련 있음. 2.2.2 참고 |
| agy 저장된 기본 모델 | `"Gemini 3.5 Flash (High)"` | 현재 `agy models` 목록에 없음. **`--model`을 항상 명시해야 함** ⚠️정정됨(검증 결과 참조) |

#### 헤드리스 스모크 테스트 (CLI당 1회, "OK" 수준)

| CLI | 명령 요지 | 결과 |
|---|---|---|
| claude | `claude -p "Reply with exactly: OK" --model sonnet --output-format json --tools "" --no-session-persistence --json-schema '{...answer...}'` | **성공**, exit 0, wall 12.7s, `structured_output: {"answer":"OK"}`, `num_turns: 2`, `is_error: false`. 단 `cache_creation_input_tokens: 44,834`, `total_cost_usd: 0.187`(정가 기준 추정치). `sonnet` 별칭이 `claude-sonnet-5`로 해석됨 |
| agy | `agy -p "..." --model gemini-3.8-flash-low --output-format json --print-timeout 90s --json-schema '{...}' </dev/null` | **성공**, wall 16.1s, `status: "SUCCESS"`, `structured_output: {"answer":"OK"}`, `usage.input_tokens: 30,572`. **`response` 필드에 잡음이 섞임** (`"OK\n{\"answer\":\"OK\",\"toolAction\":...}"`) |
| gemini | `gemini -p "Reply with exactly: OK" -o json </dev/null` | **실패**: `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products` (`reasonCode: 'UNSUPPORTED_CLIENT'`, `tierId: 'free-tier'`). 추가로 `Gemini CLI is not running in a trusted directory. To proceed, either use --skip-trust, set the GEMINI_CLI_TRUST_WORKSPACE=true ...` 경고 |
| codex | `which codex` | 미설치 |

> 의미: 아주 짧은 호출에도 claude는 약 4.5만 토큰, agy는 약 3만 토큰의 컨텍스트를 매번 적재한다. `claude -p`는 CLAUDE.md, 스킬, MCP 같은 로컬 설정을 인터랙티브 세션과 똑같이 불러오기 때문이다[공식: headless]. 구독 쿼터를 설계할 때 호출 1회당 고정 오버헤드로 계산해야 한다.

### 2.2 CLI별 헤드리스 옵션

#### 2.2.1 Claude Code (`claude`) — 텍스트·비전 주 경로

| 기능 | 옵션 / 동작 | 출처 |
|---|---|---|
| 헤드리스 | `-p/--print`. 성공 시 exit 0, 실패 시 non-zero. 실행 중 발생한 실패(예: 인증)는 stdout의 result로 출력 | [공식] headless |
| 출력 형식 | `--output-format text\|json\|stream-json`. json에는 `result`, `session_id`, `total_cost_usd`, 모델별 비용이 들어 있음(클라이언트 측 추정치) | [공식] headless, [실측] |
| 스키마 강제 | `--json-schema '<JSON Schema>'` → 결과는 `structured_output` 필드. 스키마가 잘못되면 `Error: --json-schema is not a valid JSON Schema`로 즉시 종료(v2.1.205+). `format` 키워드는 주석으로만 취급하고 강제하지 않음 | [공식] headless |
| 모델 | `--model <alias\|full name>`, `--fallback-model` (쉼표로 여러 개) | [실측] `claude --help` |
| 도구·권한 | `--tools ""`(도구 전부 비활성), `--allowedTools`, `--permission-mode dontAsk\|acceptEdits\|auto...`, `--permission-prompts none`(v2.1.259+), `--dangerously-skip-permissions` | [실측] help, [공식] headless |
| 컨텍스트 최소화 | `--bare`: 훅·스킬·MCP·CLAUDE.md를 건너뛰지만 **`ANTHROPIC_API_KEY` 또는 `apiKeyHelper`만 인정하고 OAuth·키체인은 읽지 않는다.** 문서는 "`--bare` is the recommended mode for scripted and SDK calls, and **will become the default for `-p` in a future release**"라고 명시 | [공식] headless |
| 컨텍스트 최소화(구독 유지) | `--safe-mode`: CLAUDE.md·스킬·플러그인·훅·MCP를 끄면서 "Auth, model selection, built-in tools, and permissions work normally". 그 밖에 `--system-prompt`, `--strict-mcp-config`, `--no-session-persistence` | [실측] help (토큰 절감 효과는 **미측정**) |
| 타임아웃 | 전용 플래그 **없음**. 외부에서 프로세스를 종료해야 함. SIGTERM이면 exit 143이고 진행 중이던 턴은 결과 없이 끝남. SIGINT를 보내면 턴을 정리하고 끝냄. 백그라운드 서브에이전트 대기 상한은 기본 10분(`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) | [공식] headless |
| 재시도 이벤트 | stream-json에서 `system/api_retry` 이벤트(`error`: `rate_limit`, `overloaded`, `authentication_failed`, `billing_error` 등) | [공식] headless |
| 입력 | stdin 파이프 지원(최대 10MB). 큰 입력은 파일로 저장한 뒤 경로를 전달 | [공식] headless |
| 이미지 입력 | (1) CLI: 프롬프트에 이미지 경로를 넣으면 Read 도구가 "PNG, JPG ... returned as visual content"로 읽음. 큰 이미지는 리사이즈되고, 500KB를 넘으면 JPEG로 재인코딩됨. `--add-dir`과 `--allowedTools Read`가 필요. (2) Agent SDK: streaming input 모드에서 `{type:"image", source:{type:"base64", media_type, data}}` 블록 사용. **single message 모드에서는 이미지 첨부 불가** | [공식] tools-reference, streaming-vs-single-mode |
| 이미지 생성 | **불가**: "Claude is an image understanding model only ... it cannot generate, produce, edit, manipulate, or create images." | [공식] vision |
| 비전 한계 | 좌표·위치 출력은 근사치. 사람 신원 식별 거부. Claude 4.7 이상은 긴 변 2576px까지 고해상도 처리 | [공식] vision |
| Agent SDK | TS `@anthropic-ai/claude-agent-sdk`의 `query({options:{outputFormat:{type:"json_schema", schema}}})`, Python `output_format`. 실패 시 `subtype: "error_max_structured_output_retries"`. `subtype: success`인데 `structured_output`이 없는 경우도 실패로 처리해야 함. 스키마는 draft-07 기준 | [공식] agent-sdk/structured-outputs |

**약관·과금 (load-bearing)**
- Help Center(2026-06-16 갱신): "We're pausing the changes to Claude Agent SDK usage ... **Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits.**" 즉 현재 `claude -p` 사용량은 구독 한도에서 차감된다.
- Agent SDK 개요: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods ..."
- Legal & compliance: OAuth는 "designed to support ordinary use of Claude Code and other native Anthropic applications"이고, "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK." 동시에 "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription"이라고도 되어 있다.
- **해석(중간 신뢰도)**: 오너 본인이 자기 머신에서 **수정하지 않은 `claude` 바이너리**를 자기 구독으로 호출하는 방식은 문서가 막는 "제3자 제품에 claude.ai 로그인 제공"에 해당하지 않는 것으로 보인다. 다만 대량·상시 자동화는 "ordinary, individual usage" 범위를 넘을 수 있고, **Agent SDK 패키지를 쓰려면 API 키가 권장 경로다.** 법률 판단은 아니다.

#### 2.2.2 Antigravity CLI (`agy`) — 보조 텍스트 경로이자 구독 기반 이미지 생성 후보

| 기능 | 옵션 / 동작 | 출처 |
|---|---|---|
| 헤드리스 | `-p/--print/--prompt` | [실측] help, [공식] headless |
| 출력 형식 | `--output-format text\|json\|stream-json`. json 봉투에는 `status`(SUCCESS/ERROR/CANCELED...), `response`, `structured_output`, `usage`, `conversation_id`, `duration_seconds`, `num_turns`가 있음. 권한 거부는 `denied_actions`(1.1.27+) | [공식] headless, [실측], changelog |
| 스키마 강제 | `--json-schema` (JSON 문자열, 파일 경로, `string`·`number` 같은 원시 타입명). stream-json이면 최종 결과에만 적용 | [실측] help, [공식] headless |
| 모델 | `--model <id>`, `--effort low\|medium\|high`. 로컬 `agy models`: `gemini-3.8-flash-{high,medium,low}`, `gemini-3.7-flash-*`, `gemini-3.6-flash-*`, `gemini-3.1-pro-{high,low}`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium` | [실측] |
| 권한 | 헤드리스에서는 승인이 필요한 도구 호출을 "soft-denied" 처리함. `--dangerously-skip-permissions`, `--mode accept-edits\|plan`, `--sandbox`, `settings.json`의 `permissions.allow`(예: `"command(git)"`) | [공식] headless |
| 타임아웃 | `--print-timeout` (로컬 help 기준 기본값 `5m0s`, 공식 문서도 5m) ⚠️정정됨(검증 결과 참조). changelog 1.2.6에서 헤드리스 기본값이 "unlimited"로 바뀜. 1.1.28부터는 타임아웃이 나면 **부분 출력을 돌려주고 exit 0 + stderr 경고**로 끝남. **값을 항상 명시하고, 부분 출력인지 판별해야 함** | [실측] help, changelog, [공식] headless |
| 오류 보고 | 1.2.6+: stderr에 `AGY_ERROR: {...}` JSON(상태, HTTP·gRPC 코드, retryability, error ID)을 한 줄로 찍고 **exit 3**으로 종료. 1.2.1+: 502·503·504·429는 프로세스 안에서 자동 재시도 | changelog [실측 출력] |
| 파일·이미지 입력 | 전용 첨부 플래그는 **없음**. `--add-dir <dir>`로 워크스페이스에 추가한 뒤 프롬프트에 경로를 쓰면 에이전트가 도구로 읽음(커뮤니티 스킬이 이 방식으로 레퍼런스 이미지를 전달) | [실측] help, [2차] agy-image |
| 이미지 생성 | 바이너리에 `generate_image` 도구, `GenerateImageToolConfig`, `image_generation_model_ids`와 모델명 `gemini-3.1-flash-image(-preview)`, `gemini-3-pro-image`가 들어 있음. **공식 문서에서 CLI 헤드리스 이미지 생성 설명은 찾지 못함** | [실측] `strings` 분석, 공식 문서 **미확인** |
| 이미지 생성 실사용 특성 | 커뮤니티 스킬(Openclaw-Metis/agy-image) 기준: `agy --print` + `--add-dir`(출력·레퍼런스 폴더), 기본 캔버스 1024×1024, 프롬프트의 비율 지시는 "inconsistently" 반영, "1024 x 1536 pixels, do not output a square"처럼 픽셀을 명시하면 대체로 지켜짐, **`.png` 이름으로 JPEG 바이트를 쓰는 경우 있음**, 수 분 걸림(권장 타임아웃 12m), 생성 리포트는 `~/.gemini/antigravity-cli/brain/<id>/generation_report.md` | [2차] 신뢰도 중~하 |
| 인증 | (1) Google 계정 로그인 → 플랜 쿼터. (2) `settings.json`에 `"modelProvider": "gemini"` + `GEMINI_API_KEY` → Gemini API 과금, 로그인 불필요, "headless and CI runs"에 적합 | [공식] cli/install |
| 플랜 쿼터 | Free: "Meaningful quota, refreshed weekly". AI Pro: "refreshed every five hours until weekly limit reached". Ultra: 가장 높음. 수치는 비공개. **이미지 생성 쿼터 별도 여부는 미확인** | [공식] plans |
| 약관 | FAQ: "Using third party software, tools, or services to access Antigravity is a violation of our Terms of Service ... may be grounds for suspension or termination." 2026년 서드파티 래퍼 사용자 계정 정지 사례 보도 | [공식] faq, [2차] The Register |
| 알려진 이슈 | #318: 비TTY 환경에서 `-p`가 무한 대기(1.0.6, Windows 중심). #1087(2026-09-23, **Open**, 1.2.9): MCP 서버 초기화가 끝나지 않으면 `--print-timeout`까지 막혀 있다가 **빈 SUCCESS**를 반환. 로컬에 StitchMCP가 등록돼 있으므로 해당됨 | [2차] GitHub issues |
| SDK | Python `pip install google-antigravity` (`from google.antigravity import Agent, LocalAgentConfig`). 로컬 번들 문서 기준이며 structured output 지원 여부는 **미확인** | [실측] `~/.gemini/antigravity-cli/builtin/.../sdk.md` |

#### 2.2.3 Gemini CLI (`gemini`) — MVP 제외 권고

| 항목 | 내용 | 출처 |
|---|---|---|
| 헤드리스 옵션 | `-p/--prompt`, `-o/--output-format text\|json\|stream-json`, `-m/--model`, `-y/--yolo`, `--approval-mode`, `--skip-trust`. JSON 스키마 강제 플래그는 help에 **없음** | [실측] help |
| 개인 계정 | "On June 18, 2026, Gemini CLI and Gemini Code Assist IDE extensions will stop serving requests for Google AI Pro and Ultra, as well as those using it free of charge" | [공식] Google Developers Blog (2026-05-19) |
| 유지 경로 | "Gemini CLI will remain accessible via paid Gemini and Gemini Enterprise Agent Platform API keys" | [공식] 동일 |
| 로컬 상태 | 개인 OAuth로 `IneligibleTierError` 발생 | [실측] |
| nanobanana 확장 | `gemini extensions install https://github.com/gemini-cli-extensions/nanobanana`. `NANOBANANA_API_KEY`(Gemini API 키) **필수**, 기본 모델 `gemini-3.1-flash-image-preview`(`NANOBANANA_MODEL`로 `gemini-3-pro-image-preview` 등 변경), `/generate`, `/edit <file> "<instr>"`, 출력은 `./nanobanana-output/` | [공식] 확장 README |
| 결론 | 어차피 API 키가 있어야 하므로 **Gemini CLI를 거치지 말고 Gemini API를 직접 호출하는 편이 단순하고 안정적** | 분석 |

#### 2.2.4 Codex CLI (`codex`) — 선택 어댑터(미설치)

| 항목 | 내용 | 출처 |
|---|---|---|
| 설치 | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh`, `npm i -g @openai/codex`, `brew install --cask codex` | [공식] learn.chatgpt.com/docs/codex/cli, [2차] |
| 헤드리스 | `codex exec`: 진행 상황은 stderr, **최종 메시지만 stdout**. `--json`이면 stdout이 JSONL 이벤트 스트림. `-o/--output-last-message <file>`. `--output-schema <file>`로 최종 응답을 JSON Schema에 맞춤. `--ephemeral`, `--skip-git-repo-check`, `--sandbox workspace-write\|danger-full-access`, `--ignore-user-config`, `codex exec resume --last` | [공식] non-interactive-mode |
| 스키마 제약 | strict 모드: `additionalProperties: false`와 모든 속성의 `required` 지정 필요. 도구·MCP가 활성화된 상태에서 스키마가 무시되던 버그 #15451(0.116.0, 현재 closed) | [2차] GitHub issues·문서 미러 |
| 이미지 입력 | `-i/--image <path>` (쉼표로 구분하거나 반복 지정해 여러 장). 프롬프트 인자 뒤에 둬야 함 | [공식] cli, [2차] |
| 이미지 생성 | "Built-in image generation uses `gpt-image-2`". 사용량을 텍스트보다 "3–5x faster" 소모. **Free 플랜 불가**. `OPENAI_API_KEY`를 설정하면 API 과금으로 전환됨. 레퍼런스 이미지 첨부 가능. 저장 위치는 `~/.codex/generated_images/`([2차]). `codex exec`에서의 동작은 커뮤니티 플러그인에서 확인됨(`codex exec --sandbox workspace-write` + `--image`, 레퍼런스 최대 5장, `SAVED: <path>` 출력) | [공식] image-generation, pricing, [2차] |
| 인증 | ChatGPT 로그인을 기본으로 재사용하거나 `CODEX_API_KEY`/API Key("Great for automation in shared environments like CI") | [공식] non-interactive, pricing |
| 신모델 | GPT Image 2.5(`gpt-image-2.5-flare`/`-sunburst`) 2026-09-08 출시, ChatGPT·Codex 전 티어 적용이라고 보도. Codex 내장 도구에 실제로 반영됐는지는 **미확인** | [2차] |

### 2.3 CLI 역량 매트릭스

| CLI | 로컬 설치 | 헤드리스 | 구조화 출력(스키마 강제) | 이미지 입력 | 이미지 생성 | 인증(현재 머신) | 이 프로젝트 권장 역할 |
|---|---|---|---|---|---|---|---|
| `claude` 2.1.269 | O | O `-p` [실측] | O `--json-schema` → `structured_output` [실측] | O (파일 경로 + Read / SDK base64 블록) | **X** | claude.ai **Max** OAuth [실측] / API 키(`--bare`, SDK) | **텍스트·비전 주 엔진**, 생성물 검증(VLM 판정) |
| `agy` 1.1.23 ⚠️정정됨(검증 결과 참조) | O (업데이트 필요) ⚠️정정됨(검증 결과 참조) | O `-p` [실측] | O `--json-schema` → `structured_output` [실측] | O (`--add-dir` + 경로, 에이전트 도구) | **O(내장 `generate_image`)** — 공식 헤드리스 문서 미확인, 커뮤니티 검증 | Google 계정(플랜 미확인) / `GEMINI_API_KEY` | 텍스트 보조·대체, **구독 기반 썸네일 생성 후보**, Gemini 비전(바운딩박스) |
| `gemini` 0.42.0 | O | O `-p` | X (플래그 없음, JSON 봉투만) | O | nanobanana 확장(API 키 필수) | **개인 로그인 불가** [실측] | **제외** (API 키가 있으면 API 직접 호출) |
| `codex` | **X** | O `codex exec` | O `--output-schema`(strict) | O `-i` | **O(내장, gpt-image-2)** — Plus 이상 | ChatGPT 로그인 / API 키 | 선택 어댑터(설치·요금제 확인 후) |
| (참고) Gemini API 직접 | - | - | O (`response_json_schema`) | O | **O** Nano Banana 2·Pro | API 키(유료, 이미지 모델 무료 티어 없음) | **썸네일 생성 안정 경로(권장 폴백 또는 주 경로)** |
| (참고) OpenAI Images API | - | - | - | O (`/v1/images/edits`) | **O** gpt-image-2 / 2.5 | API 키 | 대체 폴백 |

### 2.4 썸네일용 이미지 생성 모델 비교

요구: 라쿠텐 신발 사진(레퍼런스)을 입력으로 "가상의 한국 남자 아이돌 스타일 모델이 신발을 들고 있는 사진, 신발이 화면의 70% 이상, 로고·스티칭·색상 등 디테일 보존"

| 모델 | 레퍼런스 편집 | 출력 해상도 | 접근 경로 | 비용(API 정가) | 출처 |
|---|---|---|---|---|---|
| **Nano Banana 2** `gemini-3.1-flash-image` | 객체 레퍼런스 **최대 10장**(고충실도), 인물 일관성 최대 4장 | 512 / 1K / 2K / 4K, 비율 1:1·4:5·3:4 등 | Gemini API 키 / agy 내장 도구(구독) / nanobanana 확장(기본 모델) | 0.5K $0.045, **1K $0.067**, 2K $0.101, 4K $0.151, 입력 $0.50/1M. Batch는 약 절반 | [공식] image-generation, pricing |
| **Nano Banana Pro** `gemini-3-pro-image` | 객체 **최대 6장**, 인물 5장 | 1K / 2K / 4K | 동일 | **1K·2K $0.134**, 4K $0.24, 입력 $2.00/1M | [공식] 동일 |
| Nano Banana 2 Lite `gemini-3.1-flash-lite-image` | 객체 최대 14장 | 동일 ⚠️정정됨(검증 결과 참조) | API | 미확인 ⚠️정정됨(검증 결과 참조) | [공식] image-generation |
| Nano Banana(legacy) `gemini-2.5-flash-image` | 가능 | 1K | API | $0.039/장 | [공식] pricing |
| **gpt-image-2** (`gpt-image-2-2026-04-21`) | `/v1/images/edits`로 레퍼런스 여러 장 편집(최대 장수 미확인, 커뮤니티 플러그인 기준 5장) | 1024², 1536×1024, 1024×1536, 사용자 지정(16의 배수, 비율 1:3~3:1, 긴 변 ≤3840) | Codex 내장(ChatGPT Plus 이상) / OpenAI API | 토큰: 이미지 입력 $8·출력 $30/1M. 1024² 장당 약 low $0.006 / medium $0.053 / **high $0.211**([2차] 계산기). Tier1은 5 IPM | [공식] models/gpt-image-2, pricing, [2차] |
| gpt-image-2.5 `-flare` / `-sunburst` | sunburst는 "editing precision" 특화 | 최대 3840px | OpenAI API / ChatGPT·Codex | 토큰 단가는 gpt-image-2와 동일 | [공식] pricing, [2차] |
| Claude(모든 모델) | - | - | - | **생성 불가** | [공식] vision |

- **워터마크**: Gemini 생성 이미지에는 모두 SynthID가 들어간다("All generated images include a SynthID watermark") [공식]. OpenAI C2PA는 **미확인**.
- **상품당 이미지 비용 예시**(시도 3회 가정): NB2 1K 0.067×3 = **$0.20**, NB Pro 2K 0.134×3 = **$0.40**, gpt-image-2 high 1024² 0.211×3 = **$0.63**. 구독 경로(agy·Codex)는 현금 비용 대신 쿼터를 소모한다(Codex는 3–5배 빠르게 소모).
- **디테일 보존 관점 권고**: 로고·스티칭 보존은 "객체 레퍼런스 고충실도"를 명시한 Gemini 이미지 모델(NB2·Pro)이나 gpt-image-2.5-sunburst가 후보다. 실제 신발 디테일이 얼마나 보존되는지는 **벤치마크 자료를 찾지 못했다(미확인)**. MVP 전에 오너 상품 5~10개로 A/B 스파이크 테스트가 필요하다.
- **프롬프트 설계 요소**(권고): 레퍼런스 이미지는 배경을 제거하고 크롭한 뒤 1~3장만 전달(정면·측면·로고 클로즈업). "reference owns the product" 원칙으로 신발의 색상·로고·재질 묘사는 레퍼런스에 맡기고, 프롬프트에는 구도·인물·조명만 적는다. 출력은 픽셀 크기를 명시하고 정사각 1:1로 지정한 뒤 실제 크기를 검증한다(agy는 크기 지시를 어기는 경우가 있다).

### 2.5 생성물 자동 검증

#### (A) "신발 비중 70%" 측정

| 방법 | 원리 | 장점 | 한계 | 출처 |
|---|---|---|---|---|
| Gemini 비전 탐지 | `box_2d` = `[ymin, xmin, ymax, xmax]`를 0~1000으로 정규화해 반환. 스키마 강제 가능 | 구현이 쉬움. agy·Gemini API로 호출 가능 | 박스 면적이라 실제 면적보다 과대 추정됨 | [공식] image-understanding |
| Gemini 세그멘테이션 | 박스 + 라벨 + **폴리곤**(0~1000 정규화). thinking은 "minimal" 권장 | 마스크 면적 계산 가능 | 폴리곤 정밀도 미확인 | [공식] 동일 |
| Claude 비전 | 좌표 반환 가능 | 이미 사용 가능 | 문서에 "coordinate and localization outputs are approximate"로 명시 | [공식] vision |
| 로컬 SAM 3 | 텍스트 프롬프트("shoe")로 개념 분할(2025-11-19 공개) | 오프라인, 과금 없음, 인물과 신발 분리 가능 | Apple Silicon 성능·라이선스 **미확인**, 설치 부담 | [2차] Meta·Roboflow |
| 로컬 rembg | 배경 제거(u2net, isnet, BiRefNet, sam 등) | 레퍼런스 전처리(신발 컷아웃)에 적합 | 생성 이미지에서는 "인물+신발"을 함께 전경으로 잡아 **신발만 분리하기 어려움**. 기본 모델 `bria-rmbg`는 **상업 이용 시 유료 계약 필요** → BiRefNet 등 다른 모델 선택. Python 3.11+ | [공식] rembg README |
| 하이브리드(권장) | VLM 박스 → SAM 계열로 박스 프롬프트 정밀 분할 → 마스크 면적비 | 정확도와 구현 난이도의 균형 | 파이프라인 복잡도 | 분석 |

- **지표 정의가 필요하다**: (1) 마스크 픽셀 면적/전체 면적, (2) 바운딩박스 면적/전체 면적, (3) 박스 긴 변/이미지 변. 마스크 면적 70%는 인물이 거의 보이지 않는 수준이라 요구("아이돌이 들고 있는 사진")와 충돌할 수 있다. **오너 확인 필요.**

#### (B) 원본 대비 디테일 보존 검사 (아이디어, 조합 권장)

1. **영역 정렬**: 생성 이미지에서 신발 마스크를 크롭하고, 원본은 rembg로 컷아웃해 크기를 정규화한다.
2. **전역 유사도**: DINOv2나 DreamSim 임베딩의 코사인 유사도로 임계치를 판정한다. 연구 자료에 따르면 CLIP·LPIPS는 "identity sensitivity"가 약하다[2차 arXiv ID-Sim]. 임계치는 스파이크 테스트로 정한다.
3. **색상 일치**: 주요 색 k-means → Lab ΔE 비교(갑피·밑창·로고 색).
4. **국소 특징**: 로고·스티칭 영역의 특징점 매칭 인라이어 수(예: ORB/SuperPoint+LightGlue — 도구 적합성 **미확인**).
5. **VLM 체크리스트 판정**: 원본과 생성본을 함께 보여주고 스키마를 강제한다(`logo_match`, `color_match`, `sole_pattern_match`, `lace_eyelet_count_match`, `text_legible`, `extra_artifacts`, `overall_pass`). `claude -p`나 `agy -p`로 실행 가능.
6. **인물 검사**: 손가락 기형, 신발 개수(한 짝·두 짝), 실존 인물 닮음 여부는 사람이 체크리스트로 확인한다(Claude는 인물 신원 식별을 거부하므로 자동화가 불가).
7. **최종 게이트**: 자동 점수는 "재생성 여부" 판단에만 쓰고, 등록은 오너 승인(원천 요구 "스마트 스토어에 내 승인하에 등록")을 거친다.

### 2.6 백엔드 서브프로세스 호출 설계 고려사항

| 주제 | 권고 설계 | 근거 |
|---|---|---|
| 어댑터 구조 | `AiProvider` 인터페이스 `{ id, capabilities: {text, vision, imageGen, schema}, healthCheck(), runStructured(task, schema, inputs, opts), generateImage(refImages, prompt, size, opts) }`. 작업 유형(`translate`, `copywrite`, `extract_spec`, `match_product`, `select_tags`, `gen_thumbnail`, `verify_thumbnail`)별로 **provider 우선순위 목록**을 설정 파일/UI로 바꿀 수 있게 한다 | CLI마다 기능과 신뢰도가 다름(2.3) |
| 프로세스 실행 | `spawn(bin, argsArray)`(셸 미사용), **stdin은 즉시 닫거나 프롬프트 전달용으로만 사용**, 전용 작업 디렉터리(CLAUDE.md·.mcp.json 없음), 환경변수 화이트리스트, `--model` 항상 명시 | agy #318 비TTY 행, `-p`가 로컬 설정을 적재함[공식], agy 기본 모델 불일치[실측] |
| 컨텍스트 최소화 | claude: `--tools ""`(순수 텍스트 작업), `--safe-mode` 또는 `--system-prompt`, `--no-session-persistence`, `--strict-mcp-config`. agy: 전용 settings와 MCP 비활성(설정 제거 필요 — `disabled:true`가 print 모드에서 무시되는 이슈 #1088 보도) | 실측 오버헤드 4.5만/3만 토큰 |
| 동시성 | provider별 세마포어(초기값 제안: claude 2, agy 2, 이미지 생성 1). 작업 큐는 로컬 SQLite에 영속화하고, 단계별 체크포인트(입력 해시 → 산출물 캐시)로 재개 가능하게 한다 | 호출당 10~16초[실측], 이미지는 수 분[2차] |
| 타임아웃 | 작업별 하드 타임아웃(예: 텍스트 120s, 비전 180s, 이미지 15m). 넘으면 SIGINT → 유예 → SIGTERM(claude exit 143). agy는 `--print-timeout`을 명시하되, 부분 출력 + exit 0 경고(stderr)를 감지하면 실패로 처리 | [공식] headless, agy changelog |
| 재시도 | 일시적 오류(429·503·네트워크·타임아웃)는 지수 백오프로 최대 3회. 영구 오류(인증, 스키마, 콘텐츠 필터, `IneligibleTierError`)는 즉시 실패하고 UI에 알린다. 스키마 검증 실패는 오류 메시지를 넣어 재프롬프트(최대 2회) | claude `api_retry`의 `error` 분류, agy `AGY_ERROR` retryability |
| 출력 파싱 | **`structured_output` 필드만 사용**하고 `result`/`response` 텍스트는 로그용으로만 둔다. 앱 쪽에서 Ajv/Zod로 **재검증**한다. claude는 `is_error`, `subtype`, `api_error_status`를, agy는 `status`, exit code, `denied_actions`를 확인하고, `status=SUCCESS`인데 `structured_output`이 비어 있으면 실패로 처리(#1087) | [실측] agy response 잡음, [공식] SDK "success without structured_output" |
| 스키마 호환 | 공통 부분집합만 사용: draft-07, `additionalProperties:false`, 모든 필드 `required`(선택 필드는 `null` 허용 타입), `format` 키워드에 의존하지 않음 | Claude: draft-07·format 미강제, Codex: strict 규칙 |
| 비용·쿼터 | 호출마다 `usage`, `total_cost_usd`(추정), `duration`, provider, model을 DB에 기록. 일일 호출·이미지 상한을 설정하고 넘으면 큐를 일시정지. 구독 한도 소진 시 대체 provider로 폴백 | [공식] headless(`total_cost_usd`는 클라이언트 추정) |
| 버전 고정 | 시작 시 `claude --version`, `agy --version`, `codex --version`을 확인하고 **계약 스모크 테스트**("OK" 스키마 호출) 결과를 UI 헬스 패널에 표시. CLI를 자동 업데이트하면 플래그나 출력이 바뀔 수 있음(예: `--bare` 기본화 예고) | [공식] headless |
| 보안(프롬프트 인젝션) | 라쿠텐 페이지 텍스트와 타 판매자 태그는 신뢰하지 않는 데이터다. 구분자 블록으로 감싸고, 텍스트 작업 CLI는 도구를 끄며(`--tools ""`), `--dangerously-skip-permissions`는 이미지 생성 전용 샌드박스 디렉터리에서만 제한적으로 사용 | 일반 원칙 |
| 약관 | Claude: 공식 바이너리를 수정 없이 본인 구독으로 사용하고, 토큰 추출이나 서드파티 래퍼는 금지. Google: 공식 `agy`만 사용하고, 대량 자동화 시 API 키 경로 권장. OpenAI: 자동화에는 API Key 경로가 공식 권장 | 2.2 각 절 |

### 2.7 정책·법규 관련 발견 (썸네일 생성에 직접 영향)

| 항목 | 내용 | 신뢰도 | 출처 |
|---|---|---|---|
| 네이버쇼핑 AI 생성물 기준 (2026-07-10 시행) | AI 생성·편집 이미지는 소비자를 오인시키는 과장 금지. 썸네일은 이미지 안에 문구·아이콘으로, 상세페이지는 이미지 안이나 인접 위치에 AI 사용을 표시. 금지 행위(2차 보도): AI 생성 표시 누락, **유명인·실존 인물 모방 AI 이미지**, 실제와 다른 색상·크기·구성 표현, **저작권 이미지를 AI로 무단 변형·모방**. 위반 시 상품 미노출, 클린프로그램 조치. 일반 상품에서 표시가 "의무"인지 "권장"인지는 보도마다 다름 | 중 (공식 공지 원문 미확인) | [2차] 세하컴퍼니, MTN |
| 공정위 「추천·보증 등에 관한 표시·광고 심사지침」 개정 (2026-06-01 시행) | 추천·보증 주체에 **AI 가상인물**을 추가. 가상인물이 등장하는 광고는 인접 위치에 '가상 인물' 등을 표시해야 함. 표시했더라도 직접 사용 경험처럼 표현하면 부당광고가 될 수 있음. **가상 모델이 상품을 들고 있는 정지 썸네일에 적용되는지는 미확인** | 중~상 | [2차] MBC, 다음(연합), FTC 게시판 |
| AI 기본법 (2026-01-22 시행, 1년 이상 계도) | 생성형 AI "제품·서비스 제공 사업자"에 표시 의무. AI를 도구로 쓰는 "이용자"는 원칙적으로 대상이 아니라는 해석 | 중 | [2차] 국민일보, 법률사무소 칼럼 |
| 부정경쟁방지법 (타)목 (인적 식별표지) | 실존 연예인을 연상시키는 AI 인물을 광고에 쓰면 손해배상 위험 | 중 | [2차] 법무법인 블로그, 학술자료 |

---

## 3. PRD에 반영할 도출 요구사항

| ID | 구분 | 요구사항 | 근거 |
|---|---|---|---|
| AI-01 | 기능 | AI 공급자 어댑터 계층: `claude`, `agy`, `codex`(선택), `gemini-api`(선택), `openai-api`(선택)를 같은 인터페이스로 추상화하고, 작업 유형별 provider 우선순위를 설정 UI에서 바꿀 수 있어야 한다 | 2.3, 2.6 |
| AI-02 | 기능 | 앱 시작 시(그리고 수동으로) CLI 헬스체크: 설치 여부, 버전, 인증 상태(`claude auth status`, `agy models` 등), "OK" 스키마 스모크 테스트 결과를 대시보드에 표시 | 2.1 실측(gemini 인증 불가, codex 미설치) |
| AI-03 | 제약 | 모든 텍스트·비전 AI 호출은 JSON Schema로 출력을 강제하고, 앱은 **`structured_output`만** 사용하며 Ajv/Zod로 재검증한다. `result`/`response` 자유 텍스트 파싱 금지 | agy `response` 잡음[실측] |
| AI-04 | 비기능 | 작업별 하드 타임아웃(설정 가능, 기본: 텍스트 120s, 비전 180s, 이미지 15m)과 단계적 종료(SIGINT → SIGTERM). agy는 `--print-timeout`을 명시하고 부분 출력 경고를 감지 | 2.2.1, 2.2.2 |
| AI-05 | 비기능 | 오류 분류 기반 재시도: 일시적 오류는 지수 백오프로 최대 3회, 스키마 불일치는 피드백을 넣어 최대 2회, 영구 오류는 즉시 실패하고 UI 알림 | claude `api_retry`, agy `AGY_ERROR` |
| AI-06 | 비기능 | provider별 동시성 상한(기본 claude 2, agy 2, 이미지 1)과 SQLite 영속 작업 큐. 단계별 산출물 캐시(입력 해시 키)로 중단 후 재개 | 호출 지연 10~16s, 이미지 수 분 |
| AI-07 | 기능 | 호출 계측: provider, model, 토큰 사용량, 추정 비용, 소요시간, 성공 여부를 저장하고 일일 상한(호출 수, 이미지 수, API 비용 USD)을 넘으면 큐를 자동 정지 | 호출당 고정 오버헤드 3~4.5만 토큰[실측] |
| AI-08 | 제약 | 서브프로세스 실행 규칙: 셸 미사용 인자 배열, stdin 닫기, 전용 작업 디렉터리, 환경변수 화이트리스트, `--model` 명시, 텍스트 작업은 도구 비활성(`claude --tools ""`) | agy #318, `-p`의 로컬 설정 적재 |
| AI-09 | 제약 | 인증 정책: 공식 CLI 바이너리를 수정 없이 오너 본인 계정으로 호출하고, OAuth 토큰 추출이나 서드파티 래퍼는 금지. Agent SDK 패키지를 쓸 경우 API 키 사용 | Anthropic legal, Antigravity FAQ |
| AI-10 | 제약 | Gemini CLI는 MVP 범위에서 제외한다(개인 로그인 불가). Gemini 이미지·비전은 `agy` 또는 Gemini API 직접 호출로 제공 | 2.2.3 |
| IMG-01 | 기능 | 레퍼런스 전처리: 라쿠텐 이미지 중 신발 단독 컷 1~3장을 고르고 배경 제거·크롭(상업 이용 가능 모델 사용)을 한 뒤 생성 모델에 전달 | 2.4, 2.5 |
| IMG-02 | 기능 | 썸네일 생성 요청은 픽셀 크기(기본 1:1, 예: 2048×2048 생성 후 다운스케일)를 명시하고, 생성 후 실제 크기와 포맷(JPEG-under-png)을 검증·정규화(ffmpeg/sharp) | agy 크기 불안정[2차] |
| IMG-03 | 기능 | 썸네일 후보를 N장(설정, 기본 2~3) 생성하고 자동 검증 점수와 함께 승인 화면에 나란히 표시 | 원천 요구 "내 승인하에" |
| IMG-04 | 기능 | 신발 비중 측정: 합의된 지표(마스크 면적비 또는 박스 면적비) ≥ 임계치(기본 0.70, 설정 가능)를 자동 판정하고 미달 시 재생성(최대 N회) | 원천 요구 "70% 이상" |
| IMG-05 | 기능 | 디테일 보존 검증: 임베딩 유사도 + 주요 색 ΔE + VLM 체크리스트(로고, 색상, 밑창, 끈·아일렛, 글자)를 스키마 기반 판정으로 수행. 점수와 불합격 사유를 승인 화면에 표시 | 2.5(B) |
| IMG-06 | 기능 | AI 생성·가상인물 표시 라벨(예: "AI 생성 이미지", "가상 인물")을 썸네일과 상세페이지 이미지에 오버레이하는 옵션을 제공하고, 기본값은 정책 확인 결과에 따라 결정 | 네이버 AI 기준, 공정위 지침 |
| IMG-07 | 제약 | 프롬프트에 실존 인물·그룹명 사용을 금지하고(입력 검증), 승인 체크리스트에 "특정 실존 인물 연상 여부" 항목을 둔다 | 부경법 (타)목, 네이버 금지 행위 |
| IMG-08 | 비기능 | 이미지 생성 이력 보관: 레퍼런스 해시, 프롬프트, provider·모델·버전, 해상도, 검증 점수, 승인자·시각 | 재현성·분쟁 대응 |
| IMG-09 | 기능 | 이미지 생성 provider 폴백 체인(예: agy 구독 → Gemini API → OpenAI API) 설정과 경로별 비용·쿼터 표시 | 2.4 |
| SEC-01 | 비기능 | 외부 수집 텍스트(라쿠텐 설명, 타 판매자 태그)는 프롬프트 안에서 데이터 블록으로 격리하고, 모델 출력은 허용 필드와 길이 제한으로 후검증 | 프롬프트 인젝션 |

---

## 4. 리스크

| 리스크 | 심각도 | 완화책 |
|---|---|---|
| agy 헤드리스 이미지 생성은 공식 문서가 없고 결과가 불안정하다(크기 무시, JPEG 확장자 불일치, 수 분 지연, 레퍼런스 무시 가능) | 상 | MVP 전 스파이크(상품 5~10개). 크기·포맷 후처리를 강제하고, Gemini API 폴백 어댑터를 준비 |
| 구독 계정 자동화로 인한 계정 제재(Google FAQ "third party software ... suspension", Anthropic "ordinary, individual usage") | 상 | 공식 바이너리만 사용, 낮은 동시성과 일일 상한, 대량 처리 시 API 키 경로로 전환하는 옵션 |
| 네이버 AI 생성물 기준과 공정위 가상인물 표시 위반 시 상품 미노출·제재 | 상 | 라벨 오버레이 기능(IMG-06), 공식 공지 원문 확인(별도 리서치나 오너 확인), 승인 체크리스트 |
| 라쿠텐 판매자 이미지의 저작권, 그리고 "저작권 이미지를 AI로 무단 변형" 금지 조항 | 상 | 오너의 사용 방침 결정 필요(레퍼런스로만 쓰고 원본 미게시 등). 법률 확인 권고 |
| 생성 인물이 실존 아이돌과 닮아 부정경쟁방지법(타)목이나 네이버 금지 조항에 걸림 | 상 | 실존 인물명 금지, 얼굴 부분 노출 옵션(크롭, 뒷모습 등), 휴먼 리뷰 |
| `--bare`가 `-p` 기본값이 되면 구독 OAuth 기반 `claude -p`가 끊길 수 있음 | 중 | CLI 버전 고정, 스모크 테스트로 조기 감지, `ANTHROPIC_API_KEY` 경로 준비 |
| 호출당 고정 컨텍스트 오버헤드(3~4.5만 토큰)로 구독 한도가 빨리 소진됨 | 중 | `--safe-mode`나 전용 cwd로 오버헤드를 측정·축소, 작업 배치화(상품 여러 개를 한 호출로), 계측 |
| 구조화 출력 실패 또는 빈 SUCCESS(agy #1087) | 중 | `structured_output` 존재 여부 확인, 앱 측 재검증, 재시도, MCP 비활성 전용 설정 |
| CLI 업데이트로 플래그·출력 스키마가 바뀜(agy 1.1.23 → 1.2.9 사이 변경 다수) | 중 | 버전 고정, 업데이트 전 계약 테스트, 어댑터 계층에서 흡수 |
| "70%" 지표가 모호하고 디테일 자동 판정이 틀릴 수 있음(오탐·미탐) | 중 | 지표 정의 합의, 임계치 튜닝용 스파이크, 최종 사람 승인 |
| 이미지 API 경로의 비용 누적(상품당 $0.2~0.6) | 하 | 해상도·시도 횟수 상한, 일일 예산, Batch 가격 활용 검토 |
| Gemini CLI 사용 불가 | 하 | MVP 제외(AI-10) |

---

## 5. 오너에게 물어야 할 질문

1. **썸네일 생성 경로**: (a) agy(Google 구독 쿼터) (b) Gemini API 키(장당 약 $0.07~$0.24, 가장 안정적) (c) Codex + ChatGPT Plus 이상 (d) OpenAI API 중 어느 것을 쓸까요? 폴백 순서는 어떻게 할까요? 현재 **Google 플랜(Free / AI Pro / Ultra)**과 **ChatGPT 플랜**은 무엇인가요?
2. **"신발 비중 70%"의 정의**: 신발 실루엣(마스크) 면적인가요, 신발을 감싸는 사각형(바운딩박스) 면적인가요, 신발 길이가 화면 한 변의 70%라는 뜻인가요? 마스크 면적 70%라면 인물은 거의 손과 얼굴 일부만 보이게 됩니다.
3. **AI 생성 / 가상 인물 표시**: 썸네일에 "AI 생성" 또는 "가상 인물" 문구를 넣을까요? (네이버 2026-07-10 기준, 공정위 2026-06-01 지침 관련)
4. **모델 얼굴 노출 수준**: 얼굴 전체, 부분(턱 아래 크롭), 노출 없음(손·상반신) 중 어느 쪽인가요? 실존 아이돌과 닮을 위험을 줄이는 선택지가 있습니다.
5. **API 키 사용 의향**: 안정성을 위해 Anthropic, Gemini, OpenAI API 키를 쓸 수 있나요? 월 예산 상한은 얼마인가요?
6. **Codex 설치 의향**: 요청에는 Codex가 언급됐지만 현재 미설치입니다. 설치해서 선택 어댑터로 쓸까요?
7. **처리량 목표**: 하루(또는 1회 실행) 등록 후보 상품 수는 몇 개인가요? 동시성과 쿼터 설계의 기준이 됩니다.
8. **썸네일 사양**: 해상도·비율(예: 1:1, 1000px 이상)과 상품당 후보 이미지 수(1장 자동 vs 3장 중 선택)는 어떻게 할까요?
9. **라쿠텐 원본 이미지 사용 범위**: AI 생성의 레퍼런스로만 쓸까요, 상세페이지에도 원본을 게시할까요? (저작권, 네이버 "무단 변형" 금지 관련)
10. **자동 재생성 한도**: 검증에 실패하면 몇 번까지 자동으로 재생성할까요? 한도를 넘으면 수동 처리로 넘길까요?

---

## 6. 출처 목록

### 로컬 실측 (2026-09-24)
- `claude --help`, `claude --version`(2.1.269), `claude auth status`, `claude -p ... --json-schema` 스모크 테스트
- `agy --help`, `agy models`, `agy changelog`(1.1.23~1.2.9 항목), `agy -p ... --json-schema` 스모크 테스트, `strings /Users/pyo/.local/bin/agy`(generate_image 관련 식별자)
- `~/.gemini/antigravity-cli/builtin/skills/antigravity_guide/references/{cli,sdk}.md`
- `gemini --help`, `gemini extensions list`, `gemini -p ... -o json`(IneligibleTierError)
- `which codex`(미설치), `uname -m`, `sysctl`, `python3 --version`, `which ffmpeg`

### Anthropic / Claude
- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/agent-sdk/structured-outputs
- https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- https://code.claude.com/docs/en/tools-reference
- https://code.claude.com/docs/en/legal-and-compliance
- https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- https://platform.claude.com/docs/en/build-with-claude/vision
- https://codersera.com/blog/anthropic-june-2026-billing-change-claude-code/ (2차, 과금 변경 타임라인)

### Google Antigravity / Gemini
- https://antigravity.google/docs/cli/headless/
- https://antigravity.google/docs/cli/reference
- https://antigravity.google/docs/cli/install/
- https://antigravity.google/docs/plans/
- https://antigravity.google/docs/faq/
- https://antigravity.google/pricing
- https://ai.google.dev/gemini-api/docs/antigravity-agent
- https://ai.google.dev/gemini-api/docs/image-generation
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/image-understanding
- https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/
- https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals
- https://github.com/gemini-cli-extensions/nanobanana (README)
- https://github.com/Openclaw-Metis/agy-image (SKILL.md, references/agy-cli.md, references/troubleshooting.md — 2차)
- https://github.com/google-antigravity/antigravity-cli/issues/318 (2차)
- https://github.com/google-antigravity/antigravity-cli/issues/1087 (2차)
- https://www.theregister.com/2026/02/23/google_antigravity_compute_burden/ (2차)
- https://blog.google/products/gemini/where-to-use-nano-banana-pro/

### OpenAI / Codex
- https://learn.chatgpt.com/docs/non-interactive-mode (구 developers.openai.com/codex/noninteractive)
- https://learn.chatgpt.com/docs/codex/cli
- https://learn.chatgpt.com/docs/image-generation (구 developers.openai.com/codex/image-generation)
- https://learn.chatgpt.com/docs/pricing
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/models/gpt-image-2
- https://github.com/openai/codex/issues/15451 (2차)
- https://github.com/KingGyuSuh/codex-image-in-cc (2차)
- https://codex.danielvaughan.com/2026/04/27/codex-cli-image-generation-gpt-image-2-visual-development-workflows/ (2차)
- https://wavespeed.ai/blog/ai-news/gpt-image-2-5-what-we-know/ (2차)
- https://costgoat.com/pricing/openai-images (2차, 장당 비용 계산기)

### 검증 도구
- https://github.com/danielgatis/rembg
- https://ai.meta.com/blog/segment-anything-model-3/ , https://blog.roboflow.com/what-is-sam3/
- https://github.com/ssundaram21/dreamsim
- https://arxiv.org/html/2604.05039 (ID-Sim, 2차)

### 정책·법규 (2차, 공식 원문 추가 확인 필요)
- https://sehacompany.onch3.co.kr/bbs_view.php?num=13&vnum=16026 (네이버 AI 생성물 기준)
- https://news.mtn.co.kr/news-detail/2026072417015682342 (네이버 AI 표기 기준)
- https://imnews.imbc.com/news/2026/econo/article/6826539_36932.html (공정위 가상인물 표시)
- https://v.daum.net/v/20260630100311911 (하반기 달라지는 것: AI 가상인물 광고표시)
- https://www.ftc.go.kr/www/selectBbsNttView.do?pageUnit=10&pageIndex=1&searchCnd=all&key=12&bordCd=3&searchCtgry=01%2C02&nttSn=47547 (공정위 보도자료 게시판, 원문 미열람)
- https://www.kmib.co.kr/article/view.asp?arcid=1768984300 (AI 기본법 시행)
- https://bh-law.kr/ko/news/column/ai-content-labeling-obligation-guide (AI 생성물 표시 의무 칼럼)
- https://blog.sugar.legal/ai-image-legal-checklist (AI 이미지 사업화 법률 체크리스트)

---

## 검증 결과 (적대적 재검증)

- 검증일: 2026-09-24
- 방법: 1차 출처(공식 문서, GitHub 이슈 원문, 설치본 `agy changelog`)를 직접 열람했다. 로컬에서는 `claude --help`, `agy --help`, `agy models`, agy 로그(`~/.gemini/antigravity-cli/log/`), 바이너리 `strings`로 다시 확인했다. 쿼터나 과금이 발생하는 호출(`claude -p`, `agy -p`, 이미지 생성)은 재실행하지 않았다. `gemini -p`는 인증 단계에서 거부돼 과금이 없으므로 재실행했다.
- 결과: 검증 대상 12건 중 **CONFIRMED 10건, CORRECTED 2건(F06, F11)**, REFUTED 0건, UNVERIFIABLE 0건. 검증 과정에서 본문 오류 2건(S1, S2)을 추가로 찾았다.
- F11의 부정확한 표현("유료 API 키로만")은 조사자의 요약 주장에만 있다. 본문 2.2.3은 원문을 정확히 인용하므로 본문에는 정정 표시를 붙이지 않았다.

| 항목 | 주장 | 판정 | 정정 내용 | 근거 URL |
|---|---|---|---|---|
| F01 | Claude Code 2.1.269의 `-p`, `--output-format json\|stream-json`, `--json-schema` → `structured_output`. 스키마가 잘못되면 v2.1.205+에서 즉시 오류, `format` 미강제, 타임아웃 플래그 없음(SIGTERM이면 exit 143), `system/api_retry` 이벤트 | CONFIRMED | 문서 문구가 모두 일치한다. 로컬 `claude --version`은 2.1.269이고 help에 타임아웃 플래그가 없다. 보충: help에 `--max-budget-usd`(`--print` 전용 API 비용 상한)가 있다. 실측 수치(12.7s, `num_turns` 2)는 쿼터를 쓰므로 재현하지 않았다 | https://code.claude.com/docs/en/headless |
| F02 | `--bare`는 OAuth·키체인을 읽지 않고 `ANTHROPIC_API_KEY`/`apiKeyHelper`만 쓴다. 향후 `-p`의 기본값이 된다 | CONFIRMED | 문서 Note 원문과 로컬 help("OAuth and keychain are never read")가 일치한다. 보충: `--bare`는 `CLAUDE_CODE_OAUTH_TOKEN`(`claude setup-token` 장기 토큰)도 읽지 않는다 | https://code.claude.com/docs/en/headless , https://code.claude.com/docs/en/authentication |
| F03 | 기본 `-p`가 CLAUDE.md·스킬·MCP를 적재한다(cache_creation 44,834, $0.187). `--safe-mode`가 있다. agy input 30,572 | CONFIRMED (메커니즘) | 문서 원문: "Without it, `claude -p` loads the same context an interactive session would". `total_cost_usd`가 클라이언트 추정치라는 점과 `--safe-mode` help 문구도 일치한다. 토큰 수치는 재현하지 않았다. agy 로그에는 본 턴 planner step `input_tokens:25429`가 찍혀 있다. JSON 봉투 30,572와 차이가 나는 이유는 스키마 단계 합산으로 추정하며 확인하지 않았다 | https://code.claude.com/docs/en/headless |
| F04 | Claude는 이미지 생성·편집 불가. CLI는 Read, SDK는 streaming base64 블록으로 입력하며 single message 모드는 첨부 불가. 500KB 초과 시 JPEG 재인코딩. 좌표는 근사치이고 인물 식별은 거부 | CONFIRMED | 문구가 모두 일치한다. 보충: JPEG 재인코딩은 v2.1.196+에서 "리사이즈 후에도 500KB를 넘을 때" 적용되고 픽셀 크기는 유지된다. 긴 변 2576px 처리는 Claude 4.7 이상 고해상도 티어 기준이다 | https://platform.claude.com/docs/en/build-with-claude/vision , https://code.claude.com/docs/en/tools-reference , https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode |
| F05 | 2026-06-16 갱신 기준으로 SDK·`claude -p` 사용량은 구독 한도에서 차감. 제3자 claude.ai 로그인 금지, SDK는 API 키 권장, "ordinary, individual usage" 전제, 크레딧 계획은 06-15 보류 | CONFIRMED | 페이지 날짜 "June 16, 2026"과 "Update June 15: We're pausing ..." 원문을 확인했다. 보충: Agent SDK 사용에는 Commercial Terms가 적용되고(overview), Anthropic은 "without prior notice"로 제한을 집행할 수 있다(legal) | https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan , https://code.claude.com/docs/en/agent-sdk/overview , https://code.claude.com/docs/en/legal-and-compliance |
| F06 | agy는 로컬 1.1.23, 최신 1.2.9. 플래그 지원, 실측 성공, `response` 잡음. 저장된 기본 모델이 목록에 없어 `--model` 명시 필수 | **CORRECTED** | (1) 현재 로컬 `agy --version`은 **1.2.9**다. agy 로그를 보면 07:48:36에 1.1.23으로 기동한 직후 `auto_updater.go: Spawned background update process`가 실행됐고, 07:48:39에 바이너리가 1.2.9로 교체됐다. 07:49:32의 스모크 테스트(`Print mode: starting ... model="gemini-3.8-flash-low"`)는 **1.2.9에서 실행**됐다. 따라서 "업데이트 필요"는 사실이 아니다. (2) 저장된 기본 모델 "Gemini 3.5 Flash (High)"는 로그상 `resolved to "Gemini 3.8 Flash (High)"`로 자동 대체되므로 `--model`이 없어도 동작한다. 재현성을 위해 명시하라는 권고는 유지한다. (3) 공식 봉투 필드는 `status`, `response`, `conversation_id`, `duration_seconds`, `num_turns`, `usage`이고, `structured_output`, `error`, `json_schema`는 조건부다. `--json-schema`가 원시 타입(`string`, `number`, `integer`, `boolean`)을 받는다는 점도 확인했다. `--add-dir`는 headless 문서에는 없고 help에만 있다 | https://antigravity.google/docs/cli/headless/ (로컬 `agy --version`, `agy models`, `~/.gemini/antigravity-cli/log/cli-20260924_0748*.log`, `cli-20260924_074932.log`) |
| F08 | agy 바이너리에 `generate_image`와 이미지 모델 ID가 있고 공식 문서는 없다. 커뮤니티 스킬 특성(1024², 비율 불안정, JPEG-under-png, 12m) | CONFIRMED (2차 근거 수준) | 1.2.9 바이너리 strings에서 `generate_image`, `GenerateImageToolConfig`, `image_generation_model_ids`, `gemini-3.1-flash-image(-preview)`, `gemini-3-pro-image`를 확인했다. 공식 headless·reference 문서에는 이미지 생성 언급이 없다. 커뮤니티 SKILL.md와 agy-cli.md의 문구도 일치한다. **주의**: 이 래퍼는 `--dangerously-skip-permissions`를 자동으로 주입하는 OpenClaw 생태계 스킬이고, Antigravity FAQ는 OpenClaw를 금지 예시로 명시한다. 래퍼를 그대로 쓰지 말고 공식 `agy`를 직접 호출해야 한다 | https://github.com/Openclaw-Metis/agy-image , https://raw.githubusercontent.com/Openclaw-Metis/agy-image/main/references/agy-cli.md , https://antigravity.google/docs/faq/ |
| F09 | 1.2.6+ `AGY_ERROR` + exit 3. 1.1.28+ 타임아웃 시 부분 출력 + exit 0 + 경고. #1087(1.2.9)은 MCP 초기화 행 후 빈 SUCCESS. #318 비TTY 행. 1.2.6에서 기본 타임아웃 unlimited | CONFIRMED | 설치본 changelog 원문과 일치한다. #1087은 Open 상태이고 2026-09-23 등록, agy 1.2.9 macOS arm64, 결과는 `{"status":"SUCCESS","response":""}`다. 본문에 `"disabled": true`도 print 모드에서 무시된다고 적혀 있다. #318은 **Closed** 상태(1.0.6, Windows)다. StitchMCP는 서버 초기화가 실패할 때만 영향을 받는 조건부 위험이며, 이번 스모크 테스트는 정상이었다 | https://github.com/google-antigravity/antigravity-cli/issues/1087 , https://github.com/google-antigravity/antigravity-cli/issues/318 , https://antigravity.google/docs/cli/headless/ |
| F10 | agy 인증은 Google 로그인(플랜 쿼터) 또는 `modelProvider:"gemini"` + `GEMINI_API_KEY`(헤드리스·CI). FAQ상 서드파티 접근은 ToS 위반. 2026년 정지 사례 | CONFIRMED | install 문서의 "headless and CI runs, where no browser is available" 원문을 확인했다. 과금 방식은 문서에 없고 API 키 사용에서 추론한 것이다. plans: Free는 weekly, AI Pro는 5시간 갱신 + weekly, Ultra는 5시간 갱신 + 최고 weekly 한도. FAQ 질문은 "Claude Code, OpenClaw, OpenCode"를 예시로 든다. The Register(2026-02-23)는 OpenClaw·OpenCode 사용자 정지를 보도했다 | https://antigravity.google/docs/cli/install/ , https://antigravity.google/docs/plans/ , https://antigravity.google/docs/faq/ , https://www.theregister.com/2026/02/23/google_antigravity_compute_burden/ |
| F11 | Gemini CLI는 개인 OAuth에서 IneligibleTierError. 2026-06-18 중단. 유료 Gemini API 키로만 사용 가능 | **CORRECTED** | 로컬 재실행으로 `IneligibleTierError`/`UNSUPPORTED_CLIENT`와 trusted directory 경고를 재현했다. 다만 "유료 Gemini API 키로만"은 부정확하다. 원문은 "paid Gemini **and Gemini Enterprise Agent Platform** API keys"이고, Code Assist Standard/Enterprise 라이선스 조직은 "access remains unchanged"다. 개인 사용자 관점의 결론(API 키 필요, MVP 제외)은 유지한다 | https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/ , https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals |
| F15 | NB2는 객체 10장·인물 4장, Pro는 6장·5장. 512/1K/2K/4K, SynthID, 가격, 무료 티어 없음 | CONFIRMED | 수치가 모두 일치한다. 보충: 0.5K(512)는 **NB2 전용**이고 Pro는 1K/2K/4K만 지원한다. NB2는 스타일 레퍼런스를 별도로 최대 3장 받는다. Batch 가격은 NB2 1K $0.034, Pro 1K/2K $0.067이다 | https://ai.google.dev/gemini-api/docs/image-generation , https://ai.google.dev/gemini-api/docs/pricing |
| F17 | `box_2d`는 `[ymin, xmin, ymax, xmax]` 순서의 0~1000 정규화. 세그멘테이션은 박스·라벨·폴리곤을 반환하고 thinking minimal 권장 | CONFIRMED | 일치한다. **주의**: 폴리곤 mask는 **`[x, y]`** 순서(박스는 `[y, x]`)이므로 면적을 계산할 때 축 순서를 다르게 처리해야 한다 | https://ai.google.dev/gemini-api/docs/image-understanding |
| S1(추가) | 2.4 표: NB2 Lite 출력 해상도 "동일", 비용 "미확인" | **CORRECTED** | 공식 가격은 `gemini-3.1-flash-lite-image` 출력 $0.0336/1K 이미지(Batch $0.0168), 입력 $0.25/1M이고 무료 티어는 없다. 해상도는 **1K만** 지원한다 | https://ai.google.dev/gemini-api/docs/pricing , https://ai.google.dev/gemini-api/docs/image-generation |
| S2(추가) | 2.2.2 타임아웃 행: "로컬 help 기준 기본값 `5m0s`, 공식 문서도 5m" | **CORRECTED** | 현재 설치본 1.2.9의 help는 `--print-timeout ... 0 waits until the turn completes (default 0s)`다. 공식 headless 문서는 아직 5m으로 적혀 있어 문서와 바이너리가 다르다. "값을 항상 명시해야 한다"는 결론은 유지한다 | https://antigravity.google/docs/cli/headless/ (로컬 `agy --help`) |

### 누락 주제 (PRD 반영 권고)

1. **agy 자동 업데이트**: agy는 기동 시 백그라운드에서 스스로 업데이트한다(`auto_updater.go`, 15분 간격 확인). 이번 조사 중에도 1.1.23에서 1.2.9로 바뀌었다. 공식 install·reference 문서에서 끄는 방법을 찾지 못했으므로, agy에 대해서는 "버전 고정"(AI-02, 리스크 표)을 실현할 수단이 미확인이다. 매 기동 시 계약 스모크 테스트를 돌리는 것을 필수로 해야 한다.
2. **Claude Code 버전 고정 수단**: `DISABLE_AUTOUPDATER=1`(settings `env`), `DISABLE_UPDATES`, `autoUpdatesChannel: "stable"`, `minimumVersion`, 특정 버전 설치(`install.sh | bash -s <ver>`)를 요구사항에 명시해야 한다.
3. **인증 우선순위 사고**: `-p`에서는 `ANTHROPIC_API_KEY`가 설정돼 있으면 **항상** 그 키를 쓴다(구독 대신 API 과금). 서브프로세스 환경변수 화이트리스트로 의도하지 않은 키를 제거해야 한다. 반대로 구독 자동화에는 `claude setup-token`(1년 OAuth 토큰, `CLAUDE_CODE_OAUTH_TOKEN`) 경로도 있다(`--bare`에서는 동작하지 않음).
4. **비용 가드 플래그**: API 키 경로에서는 `claude -p --max-budget-usd`를 쓸 수 있다. AI-07의 일일 상한과 함께 적용한다.
5. **컨텍스트·보안 축소 대안 비교**: `--restricted`(user/project/local 설정 무시, 코드 실행 도구 제거), `--setting-sources`, `--disable-slash-commands`, `--strict-mcp-config`, 그리고 agy의 `--disable-slash-commands`가 있다. `--safe-mode` 외에 이 옵션들의 토큰 절감 효과도 측정해야 한다.
6. **`-p`의 신뢰 대화상자 생략**: `-p`는 workspace trust 대화상자 없이 cwd의 `.claude/settings.json` 훅과 `.mcp.json` 서버를 실행한다. AI-08의 "전용 빈 작업 디렉터리"를 필수로 하는 근거로 적어야 한다.
7. **이미지 생성 안전 필터·인물 생성 정책**: "한국 남자 아이돌" 프롬프트가 인물 생성 정책이나 콘텐츠 필터에 막힐 수 있다(agy 1.2.0 changelog의 content-filter stop reason). 거부 시 상태 판별과 재시도 정책, Gemini 인물 생성 정책 원문은 조사하지 않았다.
8. **이미지 모델 레이트리밋과 쿼터**: Gemini API 티어별 IPM/RPM과 agy 구독 경로의 이미지 쿼터 수치가 없어 처리량(동시성) 설계 입력값이 비어 있다.
9. **데이터 취급·학습 사용 여부**: 라쿠텐 이미지와 상품 정보를 소비자 구독 경로(Antigravity 개인 플랜)로 보낼 때와 Gemini API 유료 티어로 보낼 때 학습 사용 정책이 어떻게 다른지 조사하지 않았다.
10. **agy 헤드리스 권한 범위**: 공식 문서상 워크스페이스 안의 파일 읽기·쓰기는 자동 허용이고 셸 명령은 기본 거부다. 이미지 생성에 `--dangerously-skip-permissions`가 실제로 필요한지 스파이크에서 확인해야 한다(커뮤니티 래퍼는 무조건 주입한다).
11. **Claude 이미지 입력의 CLI 대안**: `claude -p --input-format stream-json`으로 base64 image 블록을 stdin에 넘기는 방식(Read 도구와 `--add-dir` 불필요)이 CLI에서도 되는지 검증하지 않았다.
12. **Gemini 좌표 축 순서**: 박스는 `[y, x]`, 폴리곤은 `[x, y]`다. IMG-04 구현 명세에 명시해야 한다.

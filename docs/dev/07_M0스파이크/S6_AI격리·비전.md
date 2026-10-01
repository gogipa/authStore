# M0 S6 — AI CLI 격리·오버헤드·비전 (claude·agy)

> **상태**: Proposed. 실측 결과와 추천안이다. 실측할 때는 앱 코드를 바꾸지 않았고, §9.2의 추천은 커밋 `dc3f61d`에서 앱에 반영했다(반영하지 않은 것은 [README](README.md) 표).
> **작성**: 2026-10-01. 오너 PC(macOS)에서 실제 CLI를 불러 쟀다.
> **범위**: PRD §17 S6 중 '호출 격리와 오버헤드', '비전 템플릿(`images_seen`)', '`stream-json` base64 대안'. 약관은 [S6_AI약관.md](S6_AI약관.md), 엔진 동등성·고시 추출 정확도(상품 10개)는 같은 폴더의 S7 보고서가 맡는다.
> **codex**: 이 PC에 설치돼 있지 않아(`which codex` → 없음) 모든 항목에서 뺐다.
> **CLI 호출 수**: claude 모델 호출 21회(+ 인증 실패로 토큰 0인 `--bare` 1회, `auth status` 1회). agy 모델 호출 12회(+ 모델 전에 끝난 실패 3회, `models`·`mcp list`·`plugin list` 감지 호출).

---

## 0. 한눈에 보기

| 항목 | claude | agy |
|---|---|---|
| 사용자 전역 설정이 새는가(앱 지금 템플릿) | **안 샌다.** `--safe-mode`로 훅·MCP·플러그인·CLAUDE.md·자동 메모리가 모두 꺼진다. 다만 `~/.claude/settings.json`은 여전히 읽는다 | **샌다.** 사용자 규칙(GEMINI.md), 사용자 MCP(StitchMCP), 플러그인 스킬, 내장 도구 58개가 모두 실린다. 끄는 플래그가 없다 |
| 추천 격리 플래그 | `--safe-mode --setting-sources "" --strict-mcp-config` + 환경변수 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | 없음(찾지 못함). `--disable-slash-commands`는 효과가 보이지 않았다 |
| 호출당 고정 토큰('OK' 한 번) | 격리 없음 38,258~48,282 → 격리 **5,211~5,396**(약 −87%) | 모델 단계마다 약 26,000. 구조화 답은 2단계라 입력 약 52,000 |
| 'OK' 지연 | 격리 없음 11~16초 → 격리 2.4~3.6초 | 16~18초 |
| 비전(이미지 3장, 고시 5필드) | 지금 템플릿 **성공**(2/2), 5필드 모두 정확, 10~13초 | 지금 템플릿 **실패**(0/2). 프롬프트에 절대 경로를 주면 성공(2/2), 48~89초 |
| `images_seen` 검사 | **믿을 수 없다.** 읽기가 거부돼도 프롬프트의 파일 이름을 그대로 적어 냈다 | 절대 경로로 돌려준다(앱 검사기는 마지막 조각만 보므로 통과) |
| base64 이미지(`stream-json` 입력) | **된다.** 파일 도구 없이 5필드 정확, 토큰 8,577(파일 방식의 47%) | **안 된다.** "only text" 오류 |
| 앱 live 테스트(`live-cli`) | 통과 | 통과 |

**가장 중요한 발견 4가지**

1. claude 비전 템플릿의 `--allowedTools Read`는 **모든 경로의 읽기를 미리 허용한다.** `--add-dir`를 빼도 다른 폴더의 이미지를 거부 없이 읽었다. `--allowedTools Read`를 빼면 `--add-dir` 안만 읽고 밖은 거부된다.
2. 읽기가 거부돼도 claude는 `images_seen`에 파일 이름 3개를 모두 적었다. 앱의 `images_seen` 검사만으로는 '실제로 봤는지'를 알 수 없다. 결과 봉투의 `permission_denials`를 같이 봐야 한다.
3. agy는 `status: "SUCCESS"`·exit 0으로 실패를 감춘다. 시간 초과, 도구 권한 거부 모두 그렇다. 앱은 지금 이것을 '빈 결과(AI_OUTPUT_INVALID)'로 본다.
4. agy는 호출할 때마다 사용자 MCP(StitchMCP)를 자식 프로세스로 띄운다. 이 프로세스는 오너의 API 키로 `stitch.googleapis.com`에 연결한다. 앱의 외부 호출 허용 목록 밖이다.

---

## 1. 목적

- claude를 빈 작업 폴더에서 `-p`로 부를 때 오너의 전역 설정(CLAUDE.md, 훅, 플러그인·스킬, MCP)이 실리지 않는 최소 플래그를 정한다(AI-01, F-BS-28).
- 플래그별 고정 토큰과 지연을 재서 PRD §8.9 '비용·쿼터 추정'의 가정(호출당 약 4.5만 토큰)을 고친다.
- 비전 템플릿(Read 도구 + `--add-dir`)이 실제로 이미지를 읽는지, `images_seen` 검사가 쓸모 있는지 본다.
- `stream-json` base64 이미지 대안이 `-p`에서 되는지 본다.
- agy의 격리 상태, 구조화 출력, `--print-timeout` 동작, 모델 목록, 비전을 본다.

---

## 2. 환경

| 항목 | 값 |
|---|---|
| OS | macOS (Darwin 24.6.0), Apple Silicon |
| claude | 2.1.269 (Claude Code). `auth status`: `loggedIn: true`, `authMethod: claude.ai`, `subscriptionType: max` |
| agy | 시작 때 **1.2.9**. 15:24:10에 스스로 **1.2.14로 업데이트**됐다(§6.9). agy 측정은 모두 1.2.14 |
| codex | 미설치 |
| Node | 24.21 (`nvm use`), 이미지 생성은 `apps/BE/node_modules`의 sharp |
| 모델 | claude 텍스트·비전 `sonnet`(init의 `model: claude-sonnet-5`). agy 텍스트 `gemini-3.8-flash-medium`, 비전 `gemini-3.8-flash-high` |
| 동시 실행 | 같은 시간에 S7 스파이크가 agy를 따로 부르고 있었다(프로세스 부모로 확인). agy 지연은 부풀었을 수 있다 |

**오너 PC의 사용자 전역 설정**(격리가 막아야 할 대상)

| 엔진 | 위치 | 내용 |
|---|---|---|
| claude | `~/.claude/CLAUDE.md` (+ `@RTK.md`) | '답은 한국어로', 'Rust Token Killer' 안내 |
| claude | `~/.claude/settings.json` | PreToolUse 훅(`rtk hook claude`), `model: opus`, `effortLevel: xhigh`, 허용 규칙 20개, 플러그인 3개 켜짐 |
| claude | 플러그인 | superpowers(SessionStart 훅이 약 3,600자 주입), frontend-design, skill-creator, forge |
| claude | 스킬 | `~/.claude/skills` 52개 + 플러그인 스킬 17개 |
| claude | MCP | `~/.claude.json` 6개(notebooklm, notebooklm-mcp, stitch, obsidian, mcp-fs, mcp-shell) + claude.ai 커넥터 1개(Claude Docs) |
| agy | `~/.gemini/GEMINI.md` | 'walkthrough.md는 한국어로' 규칙 |
| agy | `~/.gemini/config/mcp_config.json` | StitchMCP(`npx mcp-remote … --header X-Goog-Api-Key: …`) |
| agy | `~/.gemini/config/config.json` | 플러그인 6개 켜짐(android-cli, chrome-devtools, firebase, modern-web-guidance, obsigravity-claude-tools, science) |

---

## 3. 방법

- **앱과 같은 조건**으로 불렀다.
  - 호출마다 `os.tmpdir()` 아래 빈 폴더(`autostore-ai-XXXX`)를 새로 만들고 cwd로 썼다. 저장소 밖이다. 끝나면 지웠다. 끝난 뒤 cwd에 남은 파일은 모든 호출에서 0개였다.
  - 환경변수는 앱 허용 목록(`PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR`, `TERM` + claude만 `DISABLE_AUTOUPDATER=1`)만 넘겼다. API 키 변수는 넘기지 않았다.
  - 셸 없이 인자 배열로 실행했다. stdin은 닫았다(base64 실험만 stdin을 열었다).
- **비전과 live 테스트는 앱 코드를 그대로 썼다.** `apps/BE/dist`(10월 1일 14:06 빌드, 소스보다 새것)의 `ClaudeCodeAdapter`·`AgyAdapter`·`IsolatedCliRunner`·`buildFactPrompt`·`factAiSchema`·`composeAiPrompt`를 불러, 실행기가 받은 stdout만 따로 저장했다.
- **'OK' 호출**: 프롬프트 `Reply with exactly: OK`, 스키마 `{answer: enum ['OK']}`(앱 연결 테스트 스키마와 같음). `--output-format json`과 `stream-json`(`--verbose --include-hook-events --debug-file`)을 각각 불렀다.
- **카나리 호출**: 모델에게 자기 컨텍스트에 '한국어 규칙', 'Rust Token Killer', 자동 메모리 안내, 'You have superpowers', MCP·스킬 이름이 있는지 스키마로 답하게 했다. 디버그 로그·init 이벤트와 맞춰 봤다.
- **비전 이미지 3장**(sharp로 SVG 글자를 그림, 일본어는 Hiragino 글꼴로 정상 렌더링 확인)

| 순서 | 파일(복사 이름) | 내용 | 정답 |
|---|---|---|---|
| 1 | `spec-label.png` (`image-1.png`) | 品番 KZ-2041, サイズ 26.5cm, アッパー: 合成皮革, MADE IN VIETNAM | material_upper = 合成皮革, origin = VIETNAM/ベトナム |
| 2 | `spec-table.jpg` (`image-2.jpg`) | ライニング: メッシュ（ポリエステル）, アウトソール: ゴム底, ヒール高さ: 3.5cm, カラー | material_lining, material_sole, heel_height = 3.5cm |
| 3 | `size-chart.png` (`image-3.png`) | JP 26.5cm / US 8.5 / EU 42, 企画・販売: 日本, 製造国: ベトナム | origin = ベトナム(판매국 日本과 헷갈리면 오답) |

- 상품 글은 `KAZE RUNNER 軽量ランニングシューズ メンズ`만 넣었다(설명·속성 없음). 그래서 5필드 모두 이미지에서 찾아야 한다. `26.5cm`(사이즈)를 굽 높이로 잘못 쓰는지도 함께 본다.

---

## 4. 결과 — claude 격리와 오버헤드

### 4.1 변형별 결과('OK' 호출, `sonnet`)

공통 인자(앱 템플릿): `-p "Reply with exactly: OK" --model sonnet --output-format json --json-schema '<OK 스키마>' --tools "" --no-session-persistence` + 아래 격리 플래그.

| 변형 | 격리 플래그 | 훅 | MCP | 플러그인·스킬 | CLAUDE.md | 자동 메모리 | 사용자 settings.json |
|---|---|---|---|---|---|---|---|
| v0 | 없음 | **SessionStart 실행**(3,604자 주입) | **7개 연결**(claude.ai Claude Docs 포함) | **플러그인 3, 슬래시 명령 122** | **실림** | **켜짐** | 읽음(`effortLevel: xhigh` → 생각 토큰 694~1,029) |
| va (앱 지금) | `--safe-mode` | 없음 | 0(`claudeai-mcp Disabled in safe mode`) | 플러그인 꺼짐(init 목록에는 이름만 보임), 내장 스킬 40개만 | 안 실림 | 꺼짐 | **읽음**(허용 규칙 20개 적용 로그). 생각 토큰 12~13 |
| vc | `--setting-sources "" --strict-mcp-config` | 없음 | 0(커넥터 목록은 받아 오지만 붙이지 않음) | 플러그인 0, 내장 스킬만 | 안 실림 | **켜짐**(`memory_paths` 있음, 카나리도 true) | 안 읽음 |
| vd | 둘 다 | 없음 | 0 | 플러그인 0, 내장 스킬만 | 안 실림 | 꺼짐 | 안 읽음. 생각 토큰 0 |
| ve | `--bare` | — | — | — | — | — | **인증 실패**: `"Not logged in · Please run /login"`, exit 1, `is_error: true`(subtype은 `success`). OAuth·키체인을 읽지 않는다 |

| 변형 | 형식 | 프롬프트 토큰 합(input + cache_creation + cache_read) | 출력 토큰 | duration_ms | 벽시계(ms) | total_cost_usd(API 환산) |
|---|---|---|---|---|---|---|
| v0 | json | 38,258 | 1,084 | 13,170 | 16,328 | 0.1648 |
| v0 | stream-json | 48,282 | 749 | 7,848 | 11,175 | 0.2016 |
| va | json(첫 호출, 캐시 없음) | 5,397 | 53 | 1,401 | 5,529* | 0.0231 |
| va | json | 5,396 | 68 | 2,265 | 3,366 | 0.0048 |
| va | stream-json | 5,395 | 65 | 1,447 | 2,500 | 0.0047 |
| vc | json | 9,403 | 56 | 1,504 | 2,577 | 0.0391 |
| vc | stream-json | 9,401 | 53 | 1,360 | 2,423 | 0.0250 |
| vd | json | 5,396 | 53 | 2,150 | 3,172 | 0.0090 |
| vd | stream-json | 5,394 | 53 | 2,523 | 3,600 | 0.0046 |
| vd + `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | json | **5,211** | 53 | 2,211 | 2,370 | 0.0073 |

\* 첫 호출은 stdin을 열어 둔 채 불러 claude가 3초 기다렸다("no stdin data received in 3s"). 그 뒤로는 앱처럼 stdin을 닫았다.

- v0의 json과 stream-json 토큰 차이(약 1만)는 MCP 서버가 연결을 마친 시점에 따라 도구 목록이 달라져서다(stitch·mcp-shell이 `pending`이었다).
- 격리하면 프롬프트 토큰이 **약 86~89% 준다**(38~48k → 5.4k). 지연은 11~16초 → 2.4~3.6초.
- 캐시: 격리 템플릿은 앞부분 약 4,850토큰을 1시간 캐시로 다시 쓴다. 호출마다 약 540토큰만 새로 만든다(cwd 경로 같은 동적 부분).
- vc가 4,000토큰 더 많은 것은 자동 메모리 안내 때문이다(카나리 `auto_memory: true`, init `memory_paths` 있음).
- 모든 변형의 init에서 `apiKeySource: "none"`이었다. 구독(OAuth)으로 불렸다는 뜻이다(R14).

### 4.2 카나리(모델이 자기 컨텍스트를 답함)

| 변형 | 한국어 규칙 | 'Rust Token Killer' | 자동 메모리 | superpowers 훅 글 | MCP·스킬 이름 | 첫 사용자 지시 줄 | 프롬프트 토큰 | 지연 |
|---|---|---|---|---|---|---|---|---|
| v0 | true | true | true | true | claude.ai Claude Docs, notebooklm, obsidian, superpowers:* 등 | `@RTK.md` | 45,681 | 21.7초 |
| va `--safe-mode` | false | false | false | false | 없음 | 없음 | 5,747 | 6.6초 |
| vc `--setting-sources "" --strict-mcp-config` | false | false | **true** | false | 없음 | 없음 | 9,752 | 7.8초 |

디버그 로그(`--debug-file`)도 같은 결과다.
- va: `Skipping plugin hooks - safe mode disables plugins`, `Hooks: Found 0 total hooks`, `getSkills returning: 0 skill dir commands, 0 plugin skills, 40 bundled skills`, `[claudeai-mcp] Disabled in safe mode`. 그러나 `Applying permission update: Adding 20 allow rule(s) to destination 'userSettings'`가 있어 사용자 settings.json은 읽는다.
- vd: 위와 같고, 사용자 허용 규칙 적용 줄이 없다.

### 4.3 숨은 부가 호출: 세션 제목 생성

- 모든 변형에서 claude는 본 호출과 별도로 `claude-haiku-4-5`를 한 번 더 부른다. 디버그 로그의 `source=generate_session_title`이다. `--no-session-persistence`여도 부른다.
- 크기: 텍스트 호출 입력 897토큰, 비전 호출 1,783~1,821토큰. 이 부가 호출에 프롬프트(라쿠텐 자료) 내용이 들어간다.
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`을 주면 이 호출이 사라졌다(`modelUsage`에 sonnet만 남음). 이 변수는 텔레메트리·오류 보고·자동 업데이트도 끈다.

### 4.4 결론(claude 격리)

- **사용자 훅·MCP·CLAUDE.md·플러그인·스킬·자동 메모리를 막는 최소 조합은 `--safe-mode` 하나다.** 구독 인증은 그대로 된다.
- 다만 `--safe-mode`만으로는 사용자 `settings.json`(권한 규칙, 효과 수준 등)을 계속 읽는다. `--setting-sources ""`를 더하면 이것도 막힌다. 토큰·지연 차이는 없다. 그래서 **`--safe-mode --setting-sources "" --strict-mcp-config`를 추천**한다(셋 다 비용 없는 방어선).
- `--setting-sources "" --strict-mcp-config`만으로는 자동 메모리가 켜져 4,000토큰이 더 붙는다. 단독으로 쓰면 안 된다.
- `--bare`는 구독 인증을 읽지 않아 쓸 수 없다. PRD §10에 적힌 '`--bare` 기본화 예고'가 현실이 되면 앱이 깨진다. 버전 감시 대상이다.

---

## 5. 결과 — claude 비전

모델 `sonnet`, 시간 제한 180초, 스키마 = `factAiSchema(origin, material_upper, material_lining, material_sole, heel_height)` + `images_seen`, 프롬프트 = `composeAiPrompt(buildFactPrompt(...))` + 어댑터의 이미지 안내.

| 실행 | 인자(격리 플래그 외) | 결과 | 거부(`permission_denials`) | `images_seen` | 5필드 값 | image_index | 프롬프트 토큰 | 지연(ms) |
|---|---|---|---|---|---|---|---|---|
| r1 (앱 템플릿) | `--tools Read --allowedTools Read --add-dir <이미지 폴더>` + `--safe-mode` | 성공 | 0 | 3개 정확 | 5/5 | 5/5 | 18,324 | 12,955 |
| r2 (앱 템플릿) | 같음 | 성공 | 0 | 3개 정확 | 5/5 | 5/5 | 18,326 | 10,278 |
| `--add-dir` 뺌 | `--tools Read --allowedTools Read` | **성공(문제)** | **0** | 3개 | 5/5 | 5/5 | 18,194 | 9,626 |
| `--allowedTools` 뺌 | `--tools Read --add-dir <폴더>` | 성공 | 0 | 3개 정확 | 5/5 | 5/5 | 18,317 | 10,148 |
| 둘 다 뺌 | `--tools Read` | 값 모두 null | **3**(Read 3번 거부) | **3개(거짓)** | 0/5(모두 NONE) | — | 17,116 | 11,483 |
| 추천 템플릿 | `--tools Read --add-dir <폴더>` + `--safe-mode --setting-sources "" --strict-mcp-config` | 성공 | 0 | 3개 정확 | 5/5 | 5/5 | 18,324 | 10,670 |
| base64 | `--input-format stream-json --output-format stream-json --verbose --tools ""` + `--safe-mode`, stdin에 이미지 3장 | 성공 | — | 3개 | 5/5 | 5/5 | **8,577** | 6,484(벽시계 7,588) |

- origin은 모든 실행에서 `ベトナム`(근거 `製造国: ベトナム`, 3번 이미지)이었다. 판매국 `日本`이나 사이즈 `26.5cm`를 잘못 쓴 경우는 없었다.
- 파일 방식은 5턴(Read 3번 + 구조화 답)이다. base64 방식은 2턴이다.
- 합계: 정답이 나와야 하는 실행 6회 × 5필드 = **30/30 정확**. 합성 이미지라 실제 상품 정확도(PRD 기준 ≥ 90%)를 대신하지 않는다. 그것은 S7 보고서를 본다.

**발견 1 — `--allowedTools Read`가 경계를 없앤다.** 이미지 폴더를 `--add-dir`로 열지 않았는데도 다른 임시 폴더의 파일을 거부 없이 읽었다. `--allowedTools Read`는 경로 제한 없이 Read를 미리 허용하기 때문이다. 라쿠텐 글에 지시를 숨긴 공격(프롬프트 주입)이 있으면 비전 호출이 오너 PC의 다른 파일(예: 앱 `.env`)을 읽고 `evidence_quote`(최대 500자)에 옮길 수 있다. 고시 값은 스마트스토어에 공개될 수 있다. `--allowedTools`를 빼면 `--add-dir` 안은 그대로 읽히고(작업 폴더로 취급), 밖은 `-p`에서 자동 거부된다.

**발견 2 — `images_seen`은 증거가 못 된다.** 읽기가 3번 모두 거부됐는데도 `images_seen`에 `image-1.png`, `image-2.jpg`, `image-3.png`를 적었다. 프롬프트에 이름이 있기 때문이다. 앱 검사기(이름 집합 비교)는 통과시킨다. 이번에는 값이 모두 null이라 잘못된 값이 들어가지는 않았지만, '이미지를 봤다'는 판단은 틀렸다. 결과 봉투의 `permission_denials`가 비어 있지 않으면 실패로 봐야 한다.

**발견 3 — base64 대안은 `-p`에서 된다.** stdin 한 줄 `{"type":"user","message":{"role":"user","content":[{"type":"text",…},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"…"}}…]}}`. 파일 도구가 아예 없어(`--tools ""`) 경로 문제가 없다. 토큰은 47%, 지연은 약 65%다. 다만 앱 실행기는 지금 stdin을 닫는다(`stdio: ['ignore', …]`, PRD 'stdin을 닫는다'). 쓰려면 실행기와 규약을 바꿔야 한다.

---

## 6. 결과 — agy

### 6.1 격리 상태

`-p` 호출의 init 이벤트, 카나리, 프로세스 관찰 결과다. 인자: `-p "Reply with exactly: OK" --model gemini-3.8-flash-medium --output-format json --json-schema '<OK 스키마>' --print-timeout 120s --log-file <파일>`.

| 대상 | 결과 | 근거 |
|---|---|---|
| 내장 도구 | 58개가 실린다: `run_command`, `write_to_file`, `browser_*`, `execute_browser_javascript`, `call_mcp_tool`, `generate_image`, `search_web`, `read_url_content` 등 | stream-json init의 `tools` |
| 권한 모드 | `request-review`. 헤드리스에서 권한이 필요한 도구는 **자동 거부**된다(`run_command`, 작업 폴더 밖 `view_file` 확인) | init `permission_mode`, §6.5 |
| 사용자 규칙(GEMINI.md) | **실린다** | 카나리 `korean_walkthrough_rule: true`, 첫 줄 `# 규칙` |
| 사용자 MCP(StitchMCP) | **실린다.** 호출마다 `npm exec mcp-remote https://stitch.googleapis.com/mcp --header X-Goog-Api-Key: …`를 자식 프로세스로 띄운다 | 카나리가 Stitch 도구 10개 이름을 답함. `ps`에서 agy → npm exec mcp-remote → node mcp-remote 부모 관계 확인. agy가 끝나면 함께 끝났다 |
| 플러그인 스킬 | **실린다**(a11y-debugging, android-cli, antigravity-guide, brainstorming 등) | 카나리 |
| `--disable-slash-commands` | 컨텍스트·도구·토큰에 차이 없음(31,493 → 31,514). 슬래시 명령 확장만 막는 것으로 보인다 | 카나리, 토큰 |
| `HOME`을 빈 임시 폴더로 바꾸기 | **인증이 깨진다.** OAuth 주소를 stderr에 찍고 60초 기다린 뒤 exit 1, `{"status":"ERROR","error":"authentication failed or timed out"}`. 로그인은 하지 않았다 | 실측 1회 |
| MCP를 끄는 플래그 | `agy --help`에 없다. `agy mcp disable`은 사용자 전역 설정을 바꾸므로 앱이 하면 안 된다(규칙 5) | 도움말 |

- 사용자 MCP 도구를 모델이 실제로 부를 수 있는지(권한 자동 거부 대상인지)는 시험하지 않았다. 부르면 외부 서비스(Stitch)에 연결되기 때문이다.
- agy 바이너리 문자열에 `JETSKI_APP_DATA_DIR`, `ANTIGRAVITY_APP_DATA_DIR`, `ANTIGRAVITY_PERM_GRANTS` 환경변수 이름이 있다. 데이터 폴더를 옮기거나 권한을 주는 통로일 수 있으나 확인하지 않았다(로그인 흐름이 다시 뜰 수 있어서).

### 6.2 구조화 출력과 오버헤드

| 실행 | status | `structured_output` | `response`(잡음) | 단계 | 입력 토큰 | cache_read | duration_seconds | 벽시계 |
|---|---|---|---|---|---|---|---|---|
| json | SUCCESS | `{"answer":"OK"}` | `"OK\n{\"answer\":\"OK\",\"toolAction\":\"Finishing task\",\"toolSummary\":\"Finish task\"}\n"` | 2 | 31,493 | 20,385 | 12.1 | 18.3초 |
| stream-json | SUCCESS | `{"answer":"OK"}` | 같은 꼴 | 2 | 51,887(25,886 + 26,001) | 0 | 9.3 | 16.3초 |
| json + `--disable-slash-commands` | SUCCESS | `{"answer":"OK"}` | 같은 꼴 | 2 | 31,514 | 20,385 | 12.8 | 18.4초 |

- `response`에는 앞말(`OK\n`)과 스키마에 없는 키(`toolAction`, `toolSummary`)가 섞인다. `structured_output`은 스키마 키만 깨끗하게 담는다. 어댑터가 `structured_output`만 쓰는 지금 방식이 맞다.
- agy의 `input_tokens`는 캐시 읽기를 포함한 값으로 보인다(`total_tokens` = input + output). 모델 단계 하나에 약 26,000토큰이다. claude 격리 템플릿(5,400)의 약 5배, 호출 전체로는 약 10배다.
- 벽시계와 `duration_seconds`의 차이(약 6초)는 시작 비용이다(MCP 서버 띄우기 포함).

### 6.3 `--print-timeout`

| 인자 | exit | stdout | stderr |
|---|---|---|---|
| `--print-timeout 1s` | **0** | `{"status":"SUCCESS","response":"","num_turns":0,…}` — `structured_output` 없음 | `[agy] print timeout after 1s with turn in progress; returning partial output` |

- 시간 초과인데 **SUCCESS + exit 0**이다. 봉투에 `partial`·`warnings` 필드도 없다. 앱의 `hasAgyPartialWarning`은 이것을 못 잡는다. 지금 코드는 '빈 결과(AI_OUTPUT_INVALID)'로 끝난다. stderr의 `print timeout`을 보고 TIMEOUT으로 바꿔야 한다.
- 값에 단위가 필요하다는 PRD 설명(`120s`)은 맞다.

### 6.4 모델 목록(`agy models`, 1.2.14)

| ID | 표시 이름 |
|---|---|
| gemini-3.8-flash-high / medium / low | Gemini 3.8 Flash (High / Medium / Low) |
| gemini-3.7-flash-high / medium / low | Gemini 3.7 Flash (…) |
| gemini-3.6-flash-high / medium / low | Gemini 3.6 Flash (…) |
| gemini-3.1-pro-high / low | Gemini 3.1 Pro (High / Low) |
| claude-sonnet-4-6 | Claude Sonnet 4.6 (Thinking) |
| claude-opus-4-6-thinking | Claude Opus 4.6 (Thinking) |
| gpt-oss-120b-medium | GPT-OSS 120B (Medium) |

- PRD R12의 기본값(텍스트 `gemini-3.8-flash-medium`, 비전 `gemini-3.8-flash-high`)은 목록에 있다.
- 출력 첫 줄은 `Fetching available models...`다. 앱의 `parseAgyModels`(dist)에 실제 출력을 넣어 보니 이 줄은 건너뛰고 14개 ID를 모두 뽑았다.

### 6.5 비전

어댑터(`AgyAdapter.runStructured`)로 같은 이미지 3장, 같은 스키마를 넘겼다. 모델 `gemini-3.8-flash-high`.

| 실행 | 프롬프트의 이미지 안내 | `--add-dir` | 결과 | `denied_actions` | 5필드 값 | 생각 토큰 | duration_seconds | 벽시계 |
|---|---|---|---|---|---|---|---|---|
| r1 (앱 템플릿) | 폴더 경로 + 파일 이름(지금 `visionPromptSuffix`) | 있음 | **실패**: SUCCESS인데 결과 없음 → 앱 `AI_OUTPUT_INVALID: 빈 결과` | `RunCommand` | — | 3,694 | 31.2 | 37.0초 |
| r2 (앱 템플릿) | 같음 | 있음 | **실패**(같음) | `RunCommand` | — | 3,596 | 18.8 | 24.7초 |
| abs-1 | **파일 절대 경로 3줄 + 'view_file로 하나씩 열고 명령 실행·폴더 목록 도구는 쓰지 마라'** | 있음 | 성공(`view_file` 3번) | 없음 | 5/5 | 22,950 | 89.4 | 96.8초 |
| abs-2 | 같음 | 있음 | 성공 | 없음 | 5/5(`メッシュ (ポリエステル)`처럼 괄호가 반각으로 바뀜) | 7,830 | 48.4 | 54.4초 |
| abs, 폴더 안 엶 | 같음 | **없음** | 결과 없음 | `ViewFile`(read_file) | — | 701 | 9.2 | 14.5초 |
| base64 | stdin `{"event":"user","message":{…}}` | — | **실패**: `stream input content block type "image" is not supported (only "text")` | — | — | — | — | 4.1초 |

- 앱 템플릿에서는 모델이 먼저 명령(폴더 목록 보기로 추정)을 실행하려 했고, 헤드리스라 자동 거부돼 출력 없이 끝났다. stderr: `jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.`
- 절대 경로를 주면 `view_file`만 써서 성공했다. 작업 폴더(`--add-dir`) 밖은 `view_file`도 거부된다. claude와 달리 경계가 지켜진다.
- `images_seen`은 절대 경로로 돌아왔다. 앱 검사기는 경로의 마지막 조각만 비교하므로 통과한다.
- 성공한 2회는 5필드 모두 정확했다(10/10). 하지만 48~89초로 느리다. 생각 토큰이 많다(7,830~22,950). 시간 제한 180초 안이지만 여유가 크지 않다.
- agy의 `stream-json` 입력은 `{"event":"user","message":…}` 꼴이고 글만 받는다. `-p`가 값을 받는 플래그라 stdin 입력 때는 `-p ""`를 맨 뒤에 둬야 한다.

### 6.6 실패를 SUCCESS로 감추는 경우(정리)

| 상황 | exit | status | `structured_output` | 알아보는 단서 | 앱 지금 판정 |
|---|---|---|---|---|---|
| 시간 초과 | 0 | SUCCESS | 없음 | stderr `[agy] print timeout after …` | AI_OUTPUT_INVALID(빈 결과) |
| 도구 권한 자동 거부 | 0 | SUCCESS | 없음 | 봉투 `denied_actions`, stderr `jetski: no output produced` | AI_OUTPUT_INVALID(빈 결과) |
| 로그인 풀림 | 1 | ERROR | 없음 | `error: authentication failed or timed out`(60초 대기 뒤) | NOT_LOGGED_IN(패턴 일치, 맞음) |
| stream 입력 형식 오류 | 1 | ERROR | 없음 | `error` 필드 | CLI_FAILED |

### 6.7 로그와 비밀값

- agy 로그(`--log-file` 또는 `~/.gemini/antigravity-cli/log/`)에는 정상 호출에서도 `You are not logged into Antigravity.`가 수십 줄 찍힌다(토큰을 불러오기 전 단계). 이 로그를 로그인 판정에 쓰면 안 된다. stderr에는 나오지 않았다.
- `agy mcp list`는 MCP 명령 줄을 그대로 출력해 **사용자 API 키 값이 보인다.** 앱은 이 명령을 부르거나 그 출력을 기록하면 안 된다. 이 보고서에는 값을 옮기지 않았다.
- 같은 이유로 `ps` 프로세스 목록에도 키가 보인다. 오너의 agy 설정 문제이며 앱이 고칠 수 없다.

### 6.8 결론(agy 격리)

- **agy `-p`는 사용자 MCP·규칙·플러그인을 끌 방법이 확인되지 않았다.** `AGY_USER_MCP_DISABLE_KNOWN = false`와 시작 경고(규칙 13)는 그대로 둬야 한다.
- 헤드리스 권한 자동 거부가 실제 방어선 역할을 한다. 명령 실행, 작업 폴더 밖 파일 읽기는 막혔다.
- 그래도 사용자 MCP 서버는 호출마다 뜨고 외부(Stitch)에 연결한다. 오너가 원하면 오너 스스로 `agy mcp disable StitchMCP`로 끌 수 있다. 앱이 대신 바꾸면 안 된다.

### 6.9 자동 업데이트

- agy 실행 파일이 15:24:10에 1.2.9 → 1.2.14로 바뀌었다(`stat` 수정 시각, `agy --version`). 이 시각에 다른 agy 호출(S7)이 있었다. agy는 실행할 때 스스로 업데이트한다.
- 바뀐 뒤 도움말의 `--effort` 값에 `max`가 생겼다. 버전이 호출 사이에 바뀔 수 있다는 뜻이다(R11 StepRun의 CLI 버전 기록이 중요하다).
- 바이너리 문자열에 `AGY_CLI_DISABLE_AUTO_UPDATE`가 있다. 효과는 확인하지 못했다(새 버전이 없어 시험 불가).

---

## 7. 앱 live 테스트

```
AI_CLI_LIVE=1 AI_CLI_LIVE_ENGINES=claude,agy pnpm --filter @autostore/be test -- live-cli
```

| 결과 | 값 |
|---|---|
| Test Suites | 1 passed, 1 total |
| Tests | **2 passed**, 2 total (claude, agy 각각 감지·로그인 확인·연결 테스트 'OK') |
| 시간 | 16.9초 |

- 지금 템플릿(claude `--safe-mode`, agy 격리 플래그 없음)으로 통과했다. 연결 테스트는 비전·권한 거부·시간 초과를 보지 않는다.

---

## 8. PRD §17 S6 기준 대비

| S6 항목 | 기준 | 결과 | 판정 |
|---|---|---|---|
| claude 호출 격리(빈 cwd, 사용자 훅·MCP가 안 실림) | AI-01 | `--safe-mode`로 훅·MCP·CLAUDE.md·플러그인·자동 메모리 모두 막힘(init·디버그 로그·카나리 일치). 사용자 settings.json은 `--setting-sources ""`로 추가 차단 | **충족**(플래그 보강 추천) |
| 오버헤드 감소 | (수치 기준 없음) | 38~48k → 5.2~5.4k 토큰(−86~89%), 11~16초 → 2.4~3.6초 | 확인 |
| 비전 호출 성공 | 성공 | claude: 성공(앱 템플릿 2/2). agy: 앱 템플릿 0/2, 절대 경로 프롬프트 2/2 | claude **충족**, agy **템플릿 수정 필요** |
| 비전 템플릿 `images_seen` | 실제로 읽었는지 검증 | claude는 거부돼도 이름을 적음 → 검증 수단으로 부족 | **미흡**(`permission_denials` 검사 추가 필요) |
| `stream-json` base64 대안 | 확인 | claude 됨(토큰 −53%, 파일 도구 불필요). agy 안 됨(글만) | 확인 |
| 고시 필드 정확도(상품 10개) | ≥ 90% | 이 보고서는 합성 이미지 3장만 봤다(claude 30/30, agy 10/10). 실제 상품 기준은 **S7 보고서**를 따른다 | S7 참조 |
| AI 제공자 약관 | — | [S6_AI약관.md](S6_AI약관.md) | 별도 문서 |

---

## 9. 추천

### 9.1 claude 호출 템플릿(정확한 인자)

- 텍스트:
  `claude -p <prompt> --model <alias> --output-format json --json-schema <schema> --tools "" --no-session-persistence --safe-mode --setting-sources "" --strict-mcp-config`
- 비전(파일 방식, M1 유지):
  `claude -p <prompt> --model <alias> --output-format json --json-schema <schema> --tools Read --add-dir <이미지 전용 폴더> --no-session-persistence --safe-mode --setting-sources "" --strict-mcp-config`
  - **`--allowedTools Read`를 뺀다.** `--add-dir` 안의 읽기는 허용 없이도 된다(실측). 밖은 자동 거부된다.
- 환경변수: claude 자식에 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`을 더한다(세션 제목용 haiku 부가 호출 제거, 텍스트 호출당 약 900토큰·비전 약 1,800토큰 절약).
- `--setting-sources ""`의 빈 문자열은 인자 배열의 빈 원소로 넘긴다(셸 없음이라 그대로 전달됨, 실측).

### 9.2 앱 코드 변경 제안(커밋 `dc3f61d`에서 반영)

| # | 파일 | 바꿀 것 | 근거 |
|---|---|---|---|
| 1 | `ai-engine.constants.ts` | `CLAUDE_ISOLATION_ARGS = ['--safe-mode', '--setting-sources', '', '--strict-mcp-config']` | §4.4 |
| 2 | `adapters/claude-code.adapter.ts` `buildClaudeArgs` | 비전 도구를 `['--tools', 'Read', '--add-dir', imageDir]`로(`--allowedTools Read` 삭제). 인자 검사 테스트도 고친다 | §5 발견 1 |
| 3 | `adapters/claude-code.adapter.ts` `parseClaudeResult` | 봉투 `permission_denials`가 비어 있지 않으면 실패. 비전이면 `AI_IMAGES_NOT_SEEN`, 텍스트면 `CLI_FAILED` | §5 발견 2 |
| 4 | `process/env-allowlist.ts`, `cli-isolation.ts` | `CLAUDE_AUTOUPDATE_ENV`에 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'` 추가, 같은 키를 `AI_CLI_ENV_ALLOWLIST`에 추가(검사기가 모르는 키를 거부하므로) | §4.3 |
| 5 | `adapters/agy.adapter.ts` 비전 프롬프트 | agy만 이미지 안내를 '파일 절대 경로 목록 + view_file로 하나씩 열 것 + 명령 실행·폴더 목록 도구 금지'로 바꾼다 | §6.5 |
| 6 | `adapters/agy.adapter.ts` `parseAgyResult` | (a) stderr `print timeout after` → `TIMEOUT` (b) 봉투 `denied_actions` 비어 있지 않음 또는 stderr `no output produced` → 실패(비전이면 `AI_IMAGES_NOT_SEEN`, 아니면 `CLI_FAILED`, 메시지 '도구 권한 거부') | §6.3, §6.6 |
| 7 | `ai-engine.constants.ts` | `AGY_ISOLATION_ARGS = ['--disable-slash-commands']`(효과는 작지만 라쿠텐 글의 `/` 확장 방어, 비용 0). `AGY_USER_MCP_DISABLE_KNOWN`은 **false 유지** | §6.1, §6.8 |
| 8 | agy 환경변수 | `AGY_CLI_DISABLE_AUTO_UPDATE=1`은 효과를 확인한 뒤에 넣는다(지금은 문자열만 발견) | §6.9 |
| 9 | 감지 호출 | `agy mcp list`는 부르지 않는다. agy 로그 파일을 읽어 판단하지 않는다(`not logged into` 잡음) | §6.7 |
| 10 | `live-cli.spec.ts` | 비전 1건(이미지 1장) live 케이스를 더하고, claude는 `permission_denials`가 비었는지도 본다(Proposed) | §7 |

### 9.3 선택지(오너 결정 필요)

| 선택지 | 장점 | 단점 |
|---|---|---|
| A. claude 비전을 base64 `stream-json`으로 바꾼다 | 파일 도구 0개(경로 위험 없음), 토큰 8,577(−53%), 2턴, 6.5초 | 실행기가 stdin을 열어야 한다(지금 규약 'stdin을 닫는다'와 충돌). agy는 이 방식이 안 되므로 엔진별로 갈라진다 |
| B. 파일 방식 유지 + 추천 9.1·9.2 | 변경이 작다. 두 엔진이 같은 구조 | 토큰 1.8만, 경계가 claude 권한 규칙에 의존 |

- 추천: **M1은 B**, A는 M2 후보로 둔다(Proposed). 이유: 지금 코드·테스트 변경이 작고, 9.2-2·3으로 경계와 검증이 생긴다.

### 9.4 설정 기본값

| 설정 | 추천 | 근거 |
|---|---|---|
| claude 텍스트·비전 모델 | `sonnet` 유지 | 비전 5필드 정확, 10~13초 |
| agy 비전 모델 | `gemini-3.8-flash-high` 유지, 단 '느림' 안내 | 48~89초, 생각 토큰 많음. 더 낮은 등급·`--effort` 비교는 S7에서 |
| 시간 제한 | 텍스트 120초, 비전 180초 유지 | claude 최대 13초, agy 비전 최대 97초 |
| agy 엔진 카드(SCR-13) | '사용자 MCP·규칙·플러그인이 함께 켜집니다(끌 수 없음)' 경고 표시 | §6.8 |

### 9.5 PRD 고칠 곳

| 위치 | 지금 | 고칠 내용 |
|---|---|---|
| §8.9 호출 템플릿(claude 텍스트·비전) | 격리 플래그 없음, 비전에 `--allowedTools Read` | 9.1의 정확한 인자로. `images_seen`만 믿지 않고 `permission_denials`를 본다는 문장 추가. base64 대안 결과(된다, M2 후보) 기록 |
| §8.9 agy 템플릿 | 'SUCCESS인데 비었거나 부분 출력 경고면 실패' | `denied_actions`, stderr `print timeout`·`no output produced`를 실패 근거로 추가. 비전은 절대 경로로 안내. stream 입력은 글만 |
| §8.9 비용·쿼터 추정 | 호출당 고정 오버헤드 약 4.5만 토큰 | claude 격리: 텍스트 약 0.54만, 비전(파일) 약 1.8만, 비전(base64) 약 0.86만. agy: 모델 단계당 약 2.6만(구조화 답 약 5.2만). 표의 '고정 오버헤드 토큰/일'을 다시 계산 |
| §8.9 필수 실행 규약(환경변수) | `DISABLE_AUTOUPDATER` | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` 추가 |
| §10 외부 의존 표(agy) | — | 사용자 MCP가 호출마다 뜨고 외부에 연결됨, 자동 업데이트됨 |
| P-13 | 지원 버전 범위 | agy는 호출 사이에도 버전이 바뀔 수 있음(1.2.9 → 1.2.14 관찰) |

---

## 10. 한계와 남은 일

- 표본이 작다. 변형마다 1~2회다. 지연은 네트워크·서버 상태, 같은 시간 S7의 agy 호출에 따라 흔들린다.
- 비전 이미지는 합성 글자 이미지 3장이다. 실제 라쿠텐 스펙 이미지(사진·작은 글씨·표)의 정확도는 S7이 본다.
- agy의 MCP 도구 호출이 헤드리스에서 자동 거부되는지는 외부 연결이 생겨 시험하지 않았다.
- `AGY_CLI_DISABLE_AUTO_UPDATE`, `JETSKI_APP_DATA_DIR`, `ANTIGRAVITY_PERM_GRANTS`의 효과는 확인하지 않았다.
- `--safe-mode`만 쓸 때 사용자 settings.json의 `env` 항목이 자식 환경에 들어가는지는 오너 설정을 바꿔야 해서 시험하지 않았다. `--setting-sources ""`를 더하면 이 걱정이 없다.
- codex는 미설치라 하지 않았다.

---

## 11. 원자료

실행별 원자료(stdout·stderr·메타·claude 디버그 로그·agy 로그)는 세션 임시 폴더에 있다. 저장소에는 넣지 않았다(사용자 경로와 agy 로그 잡음이 많고, agy 쪽에는 비밀값이 섞일 수 있다).

| 내용 | 위치(세션 scratchpad `spikes/s6/`) |
|---|---|
| 실행 드라이버 | `run_cli.py`(앱 허용 환경변수·빈 cwd·셸 없음), `vision.mjs`(dist 어댑터 직접 호출), `make_images.mjs` |
| 변형별 결과 | `runs/claude_*`(`.out`, `.err`, `.meta.json`, `.debug.log`), `runs/agy_*`(`.out`, `.err`, `.meta.json`, `.agylog`) |
| 요약 | `runs/_iso_summary1.txt`, `runs/live-cli.log` |

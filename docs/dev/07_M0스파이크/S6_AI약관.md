# M0 S6 — AI 제공자 약관 점검

> **상태**: Proposed. 조사 결과와 추천안이다. 법률 판단이 아니며, 전문가 확인(E-10) 대상이다.
> **작성**: 2026-10-01. 출처는 제공자의 공식 약관·정책·도움말·문서만 썼다. 모든 출처의 접속일은 **2026-10-01**이다.
> **범위**: PRD §17 S6의 'AI 제공자 약관(상업 이용, 인물 생성, 학습 opt-out)'. 앱이 부를 수 있는 세 엔진을 본다.
> **CLI 호출**: 0회. 이 문서는 문서 조사만 했다. `codex`는 이 PC에 설치돼 있지 않아 실측 없이 약관·문서만 봤다.

> **2026-10-02 오너 결정 D-18~D-20** ([원천자료 09](../../prd/원천자료/09_M0결정_2026-10-02.md))
> - **D-18**: AGY를 계속 고를 수 있게 둔다. 오너 본인 사용의 agy 위험을 '상'에서 **'중'**으로 고쳤다. 오너 질문('인증을 탈취하는 것도 아니고 주어진 양만큼 쓰는데 왜 위험한가')이 맞았다. G2('제3자 소프트웨어로 접근', OpenClaw가 Antigravity OAuth를 쓰는 예)는 이 앱에 해당하지 않는다. 앱은 사용자 PC에서 수정하지 않은 공식 `agy`를 본인 로그인으로, 플랜 한도 안에서 부르고, 로그인 정보를 읽지 않는다(CON-11). G4(headless 문서)는 프로그램에서 쓰라고 안내한다. 남는 불확실성은 넓은 G3 문장('남용' 항목 아래)과, 제재가 Google 계정까지 갈 수 있다는 G12다. 처음 '상'은 G2와 G3을 나눠 보지 않고 G3을 가장 넓게 읽은 판정이었다. 동료 배포(G13)는 **E-10 확인 전**이고 배포본 기본값은 M2에서 정한다. AGY '실험적'은 결과 품질 이유만 남는다(S7).
> - **D-19**: S1 썸네일 생성 경로는 오너 Google 플랜의 agy `generate_image`다. Gemini API 키는 지금 두지 않는다. S1 미달이면 대안을 오너가 고른다(§6 #8, §10 #5).
> - **D-20**: 학습은 허용하지 않는다. §8 오른쪽 열의 계정 설정 3개는 오너가 끈다. 앱과 Claude는 계정 설정을 바꾸지 않는다(§10 #8).
> - 바꾼 칸에는 '(D-18)'처럼 결정 번호를 붙였다. 처음 판정·제안은 지우지 않고 '처음:'으로 남겼다.

---

## 0. 한눈에 보기

| 엔진 | 앱이 공식 CLI를 부르는 것 | 산출물 상업 이용 | 실존 인물 | 학습 opt-out | 위험(오너 / 동료 배포) |
|---|---|---|---|---|---|
| Claude Code `claude` + Claude Max | 문서가 `claude -p` 스크립트 사용을 안내하고, 구독 한도에서 빠진다고 적었다. 다만 한도는 '평범한 개인 사용'을 전제한다 | 된다. 산출물 권리를 사용자에게 넘긴다 | 기만적 사칭·가짜 인물 금지. Claude는 이미지를 만들지 않는다 | 된다(claude.ai 설정). 허용하면 5년, 끄면 30일 보관 | **중 / 중** |
| Antigravity CLI `agy` + 개인 Google 플랜 | headless 문서는 프로그램에서 쓰라고 안내한다. 하지만 약관은 **'Google이 제공하지 않은 제품과 연계해 쓰는 것'을 남용으로 든다** | 된다. Google이 소유권을 주장하지 않는다 | 기만 목적의 실존 인물 사칭 금지, 동의 없는 이미지 사용 금지 | 된다(설정 `enableTelemetry`). 기본값은 켜짐 | **중 / 상(E-10 확인 전)** (D-18. 처음: 상 / 상) |
| Codex CLI `codex` + ChatGPT 플랜 (미설치, 나중) | 플랜 비교표에 `codex exec`·스크립트 사용이 Plus·Pro 포함으로 나온다. 하지만 이용약관에 '프로그램으로 산출물을 추출하는 것' 금지 문구가 있다 | 된다. 산출물은 사용자 소유 | 동의 없는 실존 인물 모습 사용 금지 | 된다(ChatGPT 데이터 설정). 기본값은 학습 허용 | **중 / 중** |

- 세 회사 모두 **다른 프로그램이 구독을 쓰는 것보다 API 키를 권한다.** PRD ①-9의 'API 키 경로 대안'은 그대로 맞다.
- PRD와 가장 크게 달라진 곳은 agy다. 지금 PRD는 '제3자 도구로 접근하면 위반'이라고만 적었다. 약관 본문은 범위가 더 넓다(§6 #2).
- (D-18, 2026-10-02) 그 넓은 문장(G3)은 '남용' 항목 아래 있고, '제3자 도구 접근'(G2)은 OAuth를 빌려 쓰는 경우다. 둘을 나눠 보면 오너 본인 사용은 '중'이다(위 상자).

---

## 1. 조사 방법과 한계

- 공식 출처만 썼다. 출처 번호는 §11에 있다.
- `openai.com`·`help.openai.com`은 자동 접속을 403으로 막았다. 그래서 web.archive.org에 있는 **같은 주소의 보관본**(2026-09-22~30 저장)으로 원문을 읽었다. 오너가 브라우저로 한 번 더 열어 보기를 권한다.
- Anthropic 소비자 약관은 한국에서 열면 한국어 번역이 먼저 나온다. 인용은 같은 페이지에 담긴 영어 원문이다.
- Google 서비스 약관은 한국 접속 기준 판(시행 2026-07-30)이다.
- Antigravity 추가 약관에는 시행일·개정일 표시가 없다.

---

## 2. Anthropic — Claude Code(`claude`) + Claude Max 구독

| # | 질문 | 답 | 근거 인용 | 출처 |
|---|---|---|---|---|
| A1 | 어떤 약관이 적용되나 | Max 사용자는 소비자 약관이다. 사용 정책(AUP)도 함께 적용된다 | "Consumer Terms of Service - for Free, Pro, and Max users" / "Claude Code usage is subject to the Anthropic Usage Policy." | [A1] |
| A2 | 다른 로컬 프로그램이 `claude -p`를 부르는 것 | 공식 문서가 프로그램에서 부르는 방법을 안내한다. 사용량은 지금 구독 한도에서 빠진다 | "Use the Agent SDK to run Claude Code programmatically from the CLI, Python, or TypeScript." / "Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription's usage limits." | [A3], [A5] |
| A3 | 약관의 자동화 접근 금지 | 원칙은 금지다. 예외는 API 키, 또는 Anthropic이 명시적으로 허용한 경우다. `claude -p`는 공식 문서가 안내하므로 예외로 볼 여지가 크다(해석) | "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise." | [A2] §3 |
| A4 | 제3자 제품이 구독 로그인·한도를 쓰는 것 | 허용하지 않는다(사전 승인 제외). 법무 페이지에 '사용자 대신 구독 자격으로 요청을 보내는 것'과 '자격 정보를 모으거나 중개하는 것' 금지가 명시돼 있다 | "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow." / "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." | [A1], [A4] |
| A5 | 사용자가 수정하지 않은 공식 CLI에 자기 구독으로 로그인하는 것 | 막지 않는다. 앱 구조(CON-11)가 이 문장에 기댄다 | "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under Can customers offer Claude Code in their products? above." | [A1] |
| A6 | 앱을 남에게 나눠 주면(제품 안에서 Claude Code 실행) | 상업 약관 동의가 필요하다고 적혀 있다. 조건은 두 가지다: 바이너리 수정 금지, 최종 사용자가 자기 자격으로 인증하고 대신 결제·재판매·중개하지 않음. 앱 설계는 두 조건을 이미 따른다. '동의' 절차가 남는다 | "Unless we've mutually agreed otherwise, preinstalling or running Claude Code in your products or services (e.g. in hosted sandboxes or other agent infrastructure) requires agreeing to our Commercial Terms of Service and complying with the conditions below" / "The Claude Code binary must not be modified." / "Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential" | [A1] |
| A7 | 계정 공유 | 금지. 동료는 각자 구독해야 한다 | "You may not share your Account login information, Anthropic API key, or Account credentials with anyone else. You also may not make your Account available to anyone else." | [A2] §2 |
| A8 | 산출물 상업 이용 | 된다. 약관을 지키는 조건으로 산출물 권리를 넘긴다. 상업 이용 제한 문구는 '평가판 사용'에만 있다 | "Subject to your compliance with our Terms, we assign to you all of our right, title, and interest—if any—in Outputs." / "Use of our Services for evaluation purposes are for your personal, non-commercial use only." | [A2] §2·§4 |
| A9 | 입력물 권리 보증 | 사용자가 입력물(상품 사진·설명)에 필요한 권리를 가졌다고 보증한다 | "By submitting Inputs to our Services, you represent and warrant that you have all rights, licenses, and permissions that are necessary for us to process the Inputs under our Terms" | [A2] §4 |
| A10 | 학습 사용·opt-out | 설정에서 끌 수 있다. Claude Code 사용도 같은 설정을 따른다. 꺼도 피드백·안전 검토 대상은 학습에 쓸 수 있다 | "We will train new models using data from Free, Pro, and Max accounts when this setting is on (including when you use Claude Code from these accounts)." / "unless you opt out of training through your account settings. Even if you opt out, we will use Materials for model training when: (1) you provide Feedback to us regarding any Materials, or (2) your Materials are flagged for safety review" | [A6], [A2] §4 |
| A11 | 보관 기간 | 학습 허용 5년, 끄면 30일. 설정 위치는 claude.ai/settings/data-privacy-controls | "Users who allow data use for model improvement: 5-year retention period" / "Users who don't allow data use for model improvement: 30-day retention period" | [A6] |
| A12 | 사용 한도 | 5시간 단위 한도와 주간 한도가 있다. claude.ai·Claude Code가 한도를 같이 쓴다. Anthropic은 재량으로 더 제한할 수 있다 | "Your session-based usage limit will reset every five hours. Max plans also have a weekly usage limit that applies across all models." / "we may limit your usage in other ways, such as weekly and monthly caps or model and feature usage, at our discretion." / "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK." | [A7], [A1] |
| A13 | 과금 변경 예고 | `claude -p`를 구독 한도에서 빼고 월 크레딧(Max 5x $100, 20x $200)으로 돌리려던 계획이 **보류** 중이다. 다시 시작하면 미리 알린다고 했다 | "We're pausing the changes to Claude Agent SDK usage described below. For now, nothing has changed" / "We're working to update the plan to better support how users build with Claude subscriptions. When we have an update, we'll share it before anything takes effect." | [A5] (2026-06-16) |
| A14 | API 키가 있으면 | 구독 대신 API 요금이 나간다(앱은 이 변수를 넘기지 않는다) | "If you have an ANTHROPIC_API_KEY environment variable set on your system, Claude Code will use this API key for authentication instead of your Claude subscription" | [A8] |
| A15 | 실존 인물·기만 | 가짜 인물·사칭, 가짜 후기, AI 결과를 사람이 쓴 것처럼 보이게 하는 것을 금지한다 | "Impersonate real entities or create fake personas to falsely attribute content or mislead others about its origin without consent or legal right" / "Generate deceptive or misleading digital content such as fake reviews, comments, or media" / "Impersonate a human by presenting results as human-generated" | [A9] |
| A16 | 이름·로고 | 'Claude Code를 실행한다'고 글로 쓰는 것은 된다. 로고나 제휴처럼 보이는 표현은 안 된다 | "You can accurately say, in plain text, that your product has Claude Code preinstalled or that it runs Claude Code. But you can't use the Claude Code or Anthropic names or logos as part of your own product, feature, or company name, in your own logo, or in a way that suggests Anthropic built, endorses, or is partnered with your product." | [A1] |
| A17 | 집행 | 예고 없이 집행할 수 있다 | "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice." | [A1] |

---

## 3. Google — Antigravity CLI(`agy`) + 개인 Google 플랜

| # | 질문 | 답 | 근거 인용 | 출처 |
|---|---|---|---|---|
| G1 | 어떤 약관이 적용되나 | Google 서비스 약관 + Antigravity 추가 약관 + 개인정보처리방침. 개인 계정용이다 | "The following documents govern your use of the Service: a. the Google Terms of Service (the "Universal Terms"); b. these Google Antigravity Additional Terms of Service (the "Google Antigravity Terms"); and c. the Google Privacy Policy" / "Google Antigravity is available to individual accounts under terms derived from Google's Terms of Service" | [G1], [G3] |
| G2 | 제3자 소프트웨어로 접근 | 약관 위반이다. 계정 정지·해지 사유다 | "Using third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement. Such actions may be grounds for suspension or termination of your Antigravity and/or Gemini CLI accounts." | [G1] |
| G3 | **Google이 만들지 않은 제품과 연계해 쓰는 것** | 약관이 남용의 예로 든다. 공식 `agy`를 autoStore가 부르는 것도 문장 그대로 읽으면 해당될 수 있다. **PRD에 없던 문구다** | "You must not abuse, harm, interfere with, or disrupt the Service. This includes, but is not limited to, using the Service in connection with products not provided by us." | [G1] |
| G4 | 공식 CLI를 프로그램에서 쓰는 것 | headless 문서는 스크립트·프로그램에서 쓰라고 안내한다. G3과 부딪힌다(해석이 갈림) | "Run Antigravity CLI non-interactively to script agent tasks, integrate with CI pipelines, and capture machine-readable output." / "Use it whenever you need the agent's output in a program instead of a terminal UI." | [G4] |
| G5 | Google이 권하는 대안 | 제3자 도구에는 API 키를 권한다. CLI도 Gemini API 키 모드를 headless·CI용으로 안내한다 | "To use a third-party coding agent with Gemini, we recommend using a Gemini Enterprise or Google AI Studio API key." / "Run Antigravity CLI with your own Gemini API key instead of a signed-in Google account. ... This suits headless and CI runs, where no browser is available to complete a sign-in." | [G2], [G5] |
| G6 | 산출물 상업 이용 | 된다. Google이 소유권을 주장하지 않는다. 상업 이용 금지 문구는 찾지 못했다 | "Some of our services allow you to generate original content. Google won't claim ownership over that content." | [G8] |
| G7 | 셀러가 업무로 쓰면 | Google 약관상 '사업자 이용자'다. 이때는 Google을 면책(indemnify)할 의무가 생긴다 | "An individual who uses Google services for personal, non-commercial purposes outside of their trade, business, craft, or profession." (consumer 정의) / "If you're a business user or organization: To the extent allowed by applicable law, you'll indemnify Google ... for any third-party legal proceedings ... arising out of or relating to your unlawful use of the services or violation of these terms" | [G8] |
| G8 | 실존 인물 이미지 | 기만 목적의 사칭, 동의 없는 이미지·생체 정보 사용을 금지한다. Gemini 이미지 문서도 권리 침해·기만 이미지를 금지한다 | "Impersonating an individual (living or dead) without explicit disclosure, in order to deceive." / "Violates the rights of others, including privacy and intellectual property rights -- for example, using personal data or biometrics without legally-required consent." / "Make sure you have the necessary rights to any images you upload. Don't generate content that infringe on others' rights, including videos or images that deceive, harass, or harm." | [G9], [G11] |
| G9 | AI 결과를 사람이 만든 것처럼 | 금지 | "misleading others into thinking that generative AI content was created by a human" | [G8] |
| G10 | 학습 사용·opt-out | 사용 기록(Interactions)을 모델 개선에 쓰고 사람이 볼 수 있다. 설정에서 끌 수 있다. CLI 설정 `enableTelemetry`의 기본값은 `true`다. 다만 문서마다 이 설정 설명이 다르다 | "We use Interactions to evaluate, develop, and improve Google and Alphabet research, products, services and machine learning technologies." / "Google employees and contractors may access, view, review and use Interactions. If you don't want your Interactions used in this way, navigate to settings to change your preference" / "When toggled on, Antigravity collects interactions for use in evaluating, developing, and improving Antigravity and models that support Antigravity." / "enableTelemetry boolean true Permits metric collection and crash log streaming to improve tool reliability." | [G1], [G6], [G7] |
| G11 | 사용 한도 | 무료는 주간, AI Pro는 5시간 + 주간, Ultra가 가장 높다. 수치는 없다. 한도는 남용 방지용이고 바뀔 수 있다 | "A high, generous quota, refreshed every five hours until the weekly limit is reached" (AI Pro) / "The baseline rate limits are primarily determined by available capacity and exist to prevent abuse." / "Usage limits for this service are subject to modification." | [G3] |
| G12 | 제재 범위 | Antigravity 추가 약관은 Antigravity·Gemini CLI 계정을 말한다. Google 서비스 약관은 중대·반복 위반이면 Google 계정 삭제까지 적었다 | "Google may suspend or terminate your access to the services or delete your Google Account if any of these things happen: you materially or repeatedly breach these terms, service-specific additional terms, or policies" | [G1], [G8] |
| G13 | 배포한 사람의 책임 | 남이 약관을 어기도록 부추기는 서비스 제공을 금지한다. 동료에게 agy 연동 앱을 나눠 주면 문제 될 수 있다(해석) | "providing services that encourage others to violate these terms" | [G8] |
| G14 | agy에서 Claude 모델을 고르면 | 그 모델의 약관을 따른다. Anthropic 모델은 Anthropic 상업 약관에 동의하는 것이 된다 | "If you select a third party or open source model as your main agent model, you will be subject to the terms of that model. For Anthropic specifically, you agree to be bound by its terms and conditions found at https://www.anthropic.com/legal/commercial-terms." | [G1] |
| G15 | 나이·지역 | 18세 이상, 개인 Google 계정. 한국은 지원 국가다 | "Currently, Antigravity is unavailable to users under 18." / "Google Antigravity is currently available for personal Google Accounts in approved geographies." | [G2] |
| G16 | (참고) Gemini API 키 경로 | 업무용 서비스다. 유료면 학습에 쓰지 않고, 무료 할당량은 학습·사람 검토 대상이다 | "Use of Google AI Studio and Gemini API is for developers building with Google AI models for professional or business purposes, not for consumer use." / "When you use Paid Services ... Google doesn't use your prompts ... or responses to improve our products" / "When you use Unpaid Services ... human reviewers may read, annotate, and process your API input and output." | [G10] |

---

## 4. OpenAI — Codex CLI(`codex`) + ChatGPT 플랜 (미설치, 나중에)

| # | 질문 | 답 | 근거 인용 | 출처 |
|---|---|---|---|---|
| O1 | 어떤 약관이 적용되나 | ChatGPT 계정으로 로그인하면 ChatGPT 이용약관·개인정보처리방침이 적용된다. 한국은 EEA·스위스·영국 외 판(시행 2026-01-01) | "When you sign in to Codex using an existing ChatGPT account, the ChatGPT Terms of Use and Privacy Policy ... apply to data shared between Codex and ChatGPT." | [O10], [O1] |
| O2 | 다른 프로그램이 `codex exec`를 부르는 것 | 공식 문서가 스크립트 사용을 안내한다. 플랜 비교표에서 'Codex SDK, `codex exec`, and scriptable workflows'가 Plus·Pro에 '가능'으로 표시된다. `codex exec`는 저장된 로그인을 그대로 쓴다 | "Non-interactive mode lets you run Codex from scripts (for example, continuous integration (CI) jobs) without opening the interactive TUI." / "codex exec reuses saved CLI authentication by default." | [O4], [O5] |
| O3 | 이용약관의 자동 추출 금지 | '프로그램으로 데이터나 산출물을 추출하는 것'을 금지한다. O2와 부딪힌다(해석이 갈림) | "Automatically or programmatically extract data or Output (defined below)." | [O1] |
| O4 | OpenAI가 권하는 인증 | 프로그램 사용에는 API 키를 권한다. ChatGPT 계정으로 자동화하는 것은 '고급' 경로로 따로 안내한다 | "Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs." / "API keys are the right default for automation because they are simpler to provision and rotate. Use this path only if you specifically need to run as your Codex account." | [O3], [O4] |
| O5 | 제3자 앱이 사용자 플랜을 쓰는 공식 경로 | 있다. 'Sign in with ChatGPT'의 플랜 사용 권한이다. 오픈소스·로컬 앱용 문서가 공개돼 있고(미리보기), 유료·원격 앱은 신청서를 내야 한다. 이 경로로는 이미지 생성을 못 한다 | "In supported apps, eligible ChatGPT Plus and Pro subscribers can also choose to use their ChatGPT plan for AI requests." / "These docs explain ChatGPT plan usage for open-source and locally hosted apps. If you're interested in offering it in a paid or remotely hosted app, complete the interest form." / "Unsupported tools: Image generation, file search, Code Interpreter" | [O8], [O7] |
| O6 | 계정 공유 | 금지 | "You may not share your account credentials or make your account available to anyone else" | [O1] |
| O7 | 산출물 상업 이용 | 된다. 산출물은 사용자 소유다. 다만 다른 사람도 비슷한 결과를 받을 수 있다 | "you (a) retain your ownership rights in Input and (b) own the Output. We hereby assign to you all our right, title, and interest, if any, in and to Output." / "output may not be unique and other users may receive similar output from our Services." | [O1] |
| O8 | 입력물 권리 보증 | 사용자가 보증한다 | "You represent and warrant that you have all rights, licenses, and permissions needed to provide Input to our Services." | [O1] |
| O9 | 학습 사용·opt-out | 개인 플랜의 Codex 작업도 학습에 쓸 수 있다. ChatGPT 'Improve the model for everyone'을 끄거나 개인정보 포털에서 거부하면 된다 | "When you use our services for individuals, such as ChatGPT and Codex, we may use your content to train our models." / "Either option is sufficient for ChatGPT conversations and Codex tasks." / "Pro and Plus Conversations may be used to improve models unless you turn off training in ChatGPT data controls." | [O9], [O10] |
| O10 | 사용 한도 | Plus는 5시간 단위(모델별 추정치), Pro는 현재 5시간 한도 없음. 주간 한도가 있다. 한도를 넘어도 진행 중인 턴은 '공정 사용 한도' 안에서 끝낸다. 한도 회피는 금지 | "Pro plans currently have no five-hour limit." / "If you reach your usage limits during an active turn, the agent will be able to continue working on that turn, subject to fair use limits." / "Interfere with or disrupt our Services, including circumvent any rate limits or restrictions" | [O5], [O1] |
| O11 | API 키 과금 전환 | 환경에 API 키가 있으면 API 요금이 나간다. `CODEX_API_KEY`도 같다 | "For larger batches, set OPENAI_API_KEY in your environment and ask ChatGPT to generate images through the API so API pricing applies." / "You can use CODEX_API_KEY with codex exec" | [O6], [O4] |
| O12 | 실존 인물 | 동의 없이 실존 인물의 사실적 모습·목소리를 쓰는 것을 금지한다. 사칭도 금지 | "use of someone's likeness, including their photorealistic image or voice, without their consent in ways that could confuse authenticity" / "deceit, fraud, scams, spam, or impersonation" | [O2] |
| O13 | AI 결과를 사람이 만든 것처럼 | 금지 | "Represent that Output was human-generated when it was not." | [O1] |
| O14 | 사업자 면책·나이 | 사업자는 OpenAI를 면책한다. 13세 이상(18세 미만은 보호자 허락) | "If you are a business or organization, to the extent permitted by law, you will indemnify and hold harmless us" / "You must be at least 13 years old" | [O1] |

---

## 5. 자동화·제3자 도구·한도 비교

| 항목 | Anthropic | Google | OpenAI |
|---|---|---|---|
| 공식 CLI를 스크립트로 쓰는 문서 | 있다(`claude -p`) [A3] | 있다(`agy -p`) [G4] | 있다(`codex exec`, Plus·Pro 포함) [O4][O5] |
| 구독 사용량 차감 명시 | 있다. '`claude -p`·제3자 앱 사용도 구독 한도에서 빠짐' [A5] | 문서 없음 | `codex exec` 기본은 저장된 로그인 [O4] |
| 제3자 제품 금지 문구 | 'claude.ai 로그인 제공·사용자 대신 구독 자격으로 요청' 금지 [A1] | '제3자 소프트웨어로 접근', **'Google이 만들지 않은 제품과 연계'** 금지 [G1] | 직접 금지 문구 없음. '프로그램으로 산출물 추출' 금지 [O1] |
| 공식 예외·대안 | 수정하지 않은 공식 바이너리 + 본인 구독은 막지 않음 [A1]. 개발자 제품은 API 키 [A1] | API 키(Gemini API) 권장 [G2][G5] | API 키 권장 [O3]. 제3자 로컬 앱용 'Sign in with ChatGPT' 플랜 사용(미리보기) [O7] |
| 한도 구조 | 5시간 + 주간, 재량 추가 제한 [A7] | 5시간 + 주간(AI Pro), 남용 방지용 [G3] | 5시간(Plus) + 주간, 공정 사용 [O5] |
| 집행 | 예고 없이 [A1] | 계정 정지·해지, Google 계정 삭제 가능 [G1][G8] | 정지·해지·계정 삭제 [O1] |

---

## 6. PRD와 대조 — 바뀐 점

PRD 위치: §3 #15, ①-9, K16, K25, CON-11, §8.9(R5·R12·R14, 썸네일 생성 공급자, 비용·쿼터), §17 S6.

| # | PRD 위치 | PRD 지금 내용 | 이번 확인 | 판정 | 제안 |
|---|---|---|---|---|---|
| 1 | §3 #15, ①-9 리스크, K16 (claude) | '제3자 제품이 claude.ai 로그인·구독 한도를 쓰게 하는 것을 허용하지 않는다(사전 승인 제외). 수정하지 않은 공식 CLI에 자기 구독으로 로그인하는 것은 막지 않는다' | 두 문장 모두 그대로 있다. 법무 페이지에 세 가지가 새로 있다: ① '사용자 대신 구독 자격으로 요청 보내기' 금지 ② 자격 정보 수집·저장·중개 금지 ③ 제품 안에서 Claude Code를 돌리려면 상업 약관 동의 + 조건 2개 (A4·A6) | **보강** | ①-9 리스크 칸에 ①~③을 더한다. ③은 동료 배포(GEN-09) 때 오너가 할 일일 수 있어 E-10에 넣는다 |
| 2 | §3 #15, ①-9 리스크, K16 (agy) | 'agy는 제3자 도구로 접근하는 것을 약관 위반으로 본다' | 약관 본문은 'Google이 제공하지 않은 제품과 연계해 쓰는 것'도 남용으로 든다(G3). 공식 agy를 다른 앱이 부르는 경우도 걸릴 수 있다. 제재는 Google 계정 삭제까지 갈 수 있다(G12) | **변경 → 다시 변경(D-18)** | **D-18(2026-10-02)**: 오너 본인 사용은 '중'이다(G2는 해당 없음, G3·G12만 남음). AGY '실험적'은 결과 품질 이유만이고 약관 위험 표시는 하지 않는다. 배포본(GEN-09) 기본값은 M2에서 E-10(E10-d·e) 확인 뒤 정한다. 처음: agy 위험을 '중'에서 '상'으로 올린다. SCR-13의 AGY 카드는 '실험적·약관 위험'으로 표시한다. 배포본은 AGY를 기본으로 끄고 따로 동의를 받는다 |
| 3 | K16 '평범한 개인 사용' | 대량 처리 때 '평범한 개인 사용'을 넘는다는 판단 위험 | Anthropic 원문 그대로다(A12). Max 플랜은 재량으로 더 제한할 수 있다고도 적었다. Google은 한도가 '남용 방지용'(G11), OpenAI는 '공정 사용 한도'(O10) | **유지·보강** | 하루 50건(호출 250회) 시나리오는 이 문구에 가장 가깝다. 일일 상한(AI-06) 기본 250회를 유지하고, 넘기면 API 키 경로를 권한다 |
| 4 | §8.9 비용·쿼터 | 구독 경로는 현금 비용 대신 쿼터를 쓴다 | `claude -p`를 구독 한도에서 빼고 월 크레딧으로 돌리려는 계획이 **보류** 중이다(A13). 다시 시작하면 Max 20x는 월 $200 크레딧 안에서만 쓴다 | **보강** | 비용 표 아래에 이 예고를 적는다. 공지 모니터링(OP-08) 대상에 [A5]를 넣는다 |
| 5 | CON-11 | 공식 바이너리를 고치지 않고 본인 구독으로 호출. OAuth 토큰 추출·서드파티 래퍼 금지 | 세 회사 문구와 맞는다(A4·A5, G2의 OpenClaw 예시, O6) | **유지** | 근거 출처에 [A1]·[G1]을 더한다 |
| 6 | §8.9 R14 | `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`를 넘기지 않는다 | `codex exec`는 `CODEX_API_KEY`도 받는다(O11). agy는 `GEMINI_API_KEY` + 설정 `modelProvider`로 API 과금 모드가 된다(G5). 구현은 허용 목록 방식이라 이미 막힌다 | **보강** | R14와 `AI_CLI_FORBIDDEN_ENV`에 `CODEX_API_KEY`·`GEMINI_API_KEY`를 명시한다(문서화 목적) |
| 7 | §8.9 R12 (AGY 모델 목록) | `agy models` 결과를 그대로 보여 준다(로컬 목록에 `claude-sonnet-4-6`·`gpt-oss-120b` 포함, R06) | agy에서 제3자 모델을 고르면 그 모델 약관을 따르고, Anthropic 모델은 상업 약관 동의로 본다(G14) | **변경 제안** | AGY 모델 선택지를 `gemini-*`로 제한한다 |
| 8 | §8.9 썸네일 생성 공급자(M0 S1, IM-09) | agy `generate_image` 또는 Gemini API | agy 경로에도 G3이 그대로 적용된다. Gemini API 유료 경로는 '업무용'이고 학습에 쓰지 않는다(G16) | **보강 → 결정(D-19)** | **D-19(2026-10-02)**: 오너가 계정 위험을 받아들여 S1 경로를 agy `generate_image`로 정했다. Gemini API 키는 지금 두지 않는다. S1 미달이면 대안(Gemini API 유료 키 또는 대표이미지 대안)을 오너가 고른다. 배포본 기본은 M2에서 E-10 뒤 정한다. 처음: 배포본 기본은 Gemini API(유료 키)로 한다. agy 경로는 오너가 계정 위험을 받아들일 때만 쓴다. S1 결정 때 이 표를 함께 본다 |
| 9 | §8.9 R5·R14 고지 문구 | '구독 약관·쿼터 책임은 사용자에게 있다'를 엔진마다 한 줄 | 구현 문구는 세 엔진이 같다(`ai-engine-options.ts`). 엔진마다 위험이 다르다 | **변경 제안** | §8의 엔진별 문구로 바꾼다 |
| 10 | ①-9 추천안 'API 키 경로 대안' | Gemini API 등 API 키 경로를 대안으로 함께 제공 | 세 회사 모두 프로그램·제3자 도구에는 API 키를 권한다(A4, G5, O4) | **유지·강화** | 배포본에서는 API 키 경로를 '권장', 구독 경로를 '본인 책임'으로 표시한다 |
| 11 | §17 S6 '상업 이용, 인물 생성, 학습 opt-out' | 확인 항목 | 이 문서로 확인했다(법률 판단 제외) | **충족** | — |
| 12 | R06 누락 주제 9(학습 사용 여부) | 조사하지 않음 | 세 회사 모두 개인 플랜은 기본이 학습 허용 또는 사용자 선택이다(A10, G10, O9). Gemini API 유료는 학습 안 함(G16) | **해소** | GEN-09 첫 실행 고지에 엔진별 opt-out 위치를 넣는다. D-20(2026-10-02): 학습은 허용하지 않는다(오너가 계정 설정을 끈다) |
| 13 | GEN-09 첫 실행 고지·①-9 | 약관·법규 준수와 계정 책임은 사용자에게 | 나이 제한(Anthropic·Antigravity 18세, OpenAI 13세), 계정 공유 금지(A7, O6), 입력물 권리 보증(A9, O8) | **보강** | 고지 목록에 세 항목을 더한다 |
| 14 | 이름·로고 (SCR-13 엔진 카드) | 정한 것 없음 | Anthropic은 글로 쓴 이름은 되고 로고·제휴 암시는 안 된다(A16) | **보강** | 엔진 카드는 글자 이름만 쓰고 로고를 쓰지 않는다 |

---

## 7. 위험

### 7.1 오너

| # | 위험 | 정도 | 근거 | 대응 |
|---|---|---|---|---|
| R-O1 | agy를 앱에서 부르는 것이 'Google이 제공하지 않은 제품과 연계 사용'으로 판단돼 Antigravity·Gemini CLI 계정, 심하면 Google 계정이 정지된다 | **중**(D-18. 처음: 상) | G3, G12 (G2·G4와 대조) | **D-18**: 오너가 받아들였다. G2(OAuth를 빌려 쓰는 제3자 소프트웨어)는 해당하지 않고 G3 문장의 범위만 불확실하다. 업무 메일과 다른 Google 계정으로 agy에 로그인하면, Google이 잘못 판단해도 업무 메일에는 영향이 가지 않는다. 이미지 생성도 agy로 한다(D-19). 처음: 오너가 agy 사용을 받아들일지 정한다. 업무 메일과 같은 Google 계정이면 따로 쓰는 계정을 검토한다. 이미지 생성은 Gemini API 키 경로를 우선한다 |
| R-O2 | `claude -p` 대량 호출이 '평범한 개인 사용'을 넘는다고 보여 한도가 줄거나 제재된다 | 중 | A12, A17 | 동시 2·일일 250회 상한(AI-05·06). 호출 묶기(S6 오버헤드 실측). 넘으면 API 키 |
| R-O3 | Anthropic이 보류한 과금 변경을 다시 시작하면 `claude -p`가 구독 한도 대신 월 크레딧으로 바뀐다 | 중 | A13 | 공지 모니터링. 비용 표에 시나리오를 둔다 |
| R-O4 | 상품 정보·라쿠텐 이미지가 학습에 쓰인다. 프롬프트에 가격·마진 같은 영업 정보가 들어가면 함께 쓰인다 | 하~중 | A10, G10, O9 | 엔진별 학습 설정을 끈다(D-20: 오너가 끈다). 프롬프트에 원가·마진을 넣지 않는다 |
| R-O5 | 라쿠텐 사진·설명을 AI에 넣을 권리를 오너가 보증한 셈이 된다 | 중 | A9, O8, G11 | ①-3 결정(신발 단독 컷만)과 함께 E-10에서 본다 |
| R-O6 | AI 산출물은 독점이 아니다. 다른 셀러도 비슷한 카피·이미지를 받을 수 있다 | 하 | O7, G16 | 템플릿·브랜드 사전으로 차별화. 저작권 보호 여부는 E-10 |

### 7.2 동료 셀러(GEN-09)

| # | 위험 | 정도 | 근거 | 대응 |
|---|---|---|---|---|
| R-P1 | 오너가 앱을 나눠 주면 Anthropic 기준으로 '제품 안에서 Claude Code 실행'이 되어 상업 약관 동의가 필요할 수 있다 | 중 | A6 | 조건 2개는 설계가 이미 따른다(CON-11). 동의 필요 여부는 E-10 |
| R-P2 | agy 연동 앱을 나눠 주는 것이 '남이 약관을 어기도록 부추기는 서비스'로 보일 수 있다. 동료 계정은 정지될 수 있다 | 상(**E-10 확인 전**, D-18) | G3, G13 | **D-18**: 배포본 AGY 기본값은 M2에서 E-10(E10-d·e) 확인 뒤 정한다(PRD K25). 후보는 기본 끔·별도 동의, 대안 Gemini API 키. 처음: 배포본에서 AGY는 기본 끔·'실험적'·별도 동의. 대안은 Gemini API 키 |
| R-P3 | 동료가 오너 계정을 빌려 쓰면 약관 위반이다 | 상 | A7, O6 | 설치본마다 본인 계정(CON-10·CON-11). 첫 실행 고지에 명시 |
| R-P4 | 셀러는 Google·OpenAI 약관상 '사업자'라 면책 의무를 진다. 소비자 보호가 약하다 | 중 | G7, O14 | 첫 실행 고지에 '업무용 사용 책임은 본인'을 넣는다. 국내 약관법 관계는 E-10 |
| R-P5 | 낮은 플랜(Claude Pro, agy 무료·AI Pro, ChatGPT Plus)은 한도가 빨리 찬다 | 중 | A12, G11, O10 | P-13 권장 플랜. 낮은 플랜이면 일일 상한(AI-06)을 낮춘다 |
| R-P6 | 학습 기본값이 엔진마다 다르고, 앱이 대신 끌 수 없다 | 하~중 | A10, G10, O9 | 첫 실행 고지·SCR-13에 설정 위치를 안내한다. D-20: 앱은 학습을 켜지 않고 '학습 허용' 옵션을 두지 않는다 |
| R-P7 | 18세 미만은 Claude·agy를 쓸 수 없다 | 하 | A2, G15 | 첫 실행 고지에 넣는다 |
| R-P8 | 제공자 로고를 쓰면 제휴처럼 보일 수 있다 | 하 | A16 | 글자 이름만 쓴다 |

---

## 8. SCR-13 엔진별 고지 문구 (추천안, 한 줄씩)

처음 구현(`apps/BE/src/modules/settings/ai-engine/ai-engine-options.ts`)은 세 엔진 모두 '○○ 구독의 약관·쿼터 책임은 사용자에게 있습니다.'였다. 엔진마다 위험이 달라 아래처럼 바꾸기를 권했고 2026-10-01에 반영했다. AGY 문구는 D-18(2026-10-02)로 다시 바꿨다.

| 엔진 | 한 줄 고지 (추천) | 함께 보여 줄 학습 설정 위치 |
|---|---|---|
| `CLAUDE` | 본인 Claude 구독 한도를 씁니다. 대량·상시 사용은 Anthropic 약관상 제한될 수 있고, 계정 책임은 본인에게 있습니다. | claude.ai › 설정 › 개인정보(data-privacy-controls) › 'Help improve Claude' 끄기 |
| `AGY` | 실험적(결과 품질 기준 미달). 본인 Google 계정 한도를 쓰며, Google 약관과 계정 책임은 본인에게 있습니다. 사용자 MCP·규칙·플러그인도 함께 켜집니다(끌 수 없음). **(D-18로 바꿈.** 처음 추천: '실험적: Google 약관은 다른 프로그램과 함께 쓰는 것을 막을 수 있어 Google 계정이 정지될 위험이 있습니다.') | Antigravity 설정 › 계정 › Enable Telemetry 끄기 |
| `CODEX` | 본인 ChatGPT 플랜 한도를 씁니다. OpenAI 약관과 계정 책임은 본인에게 있습니다. | ChatGPT › 설정 › 데이터 제어 › 'Improve the model for everyone' 끄기 |

- 문구는 오너 검토 대상이다(D-11 위임 범위).
- AGY 문구의 '실험적'은 S7 결과 품질(스키마 86%, 비전 3/10)과 사용자 MCP 자동 적재(S6 격리) 때문이다. 약관 위험 표시가 아니다(D-18). 카드의 '실험적' 칩(`experimental`)은 그대로 켠다.
- D-20(2026-10-02): 학습은 허용하지 않는다. 오른쪽 열의 설정은 오너가 끈다. 앱은 대신 바꾸지 않는다.
- 첫 실행 고지(GEN-09)에는 공통으로 '본인 계정만, 계정 공유 금지', '18세 이상', 'AI에 넣는 사진·설명의 권리는 본인 책임'을 넣는다.

---

## 9. 전문가 확인 항목 (E-10에 추가)

| # | 확인할 것 | 관련 |
|---|---|---|
| E10-a | 무료로 나눠 준 로컬 앱이 사용자 PC의 Claude Code를 하위 프로세스로 부르는 것이 'running Claude Code in your products or services'에 해당하는가. 해당하면 오너가 상업 약관에 동의해야 하는가, 어떻게 동의하는가 | A6, R-P1 |
| E10-b | 같은 구조가 'route requests through Free, Pro, or Max plan credentials on behalf of their users'에 해당하는가, 아니면 'end user ... signing in to the unmodified Claude Code binary' 예외인가 | A4, A5 |
| E10-c | 소비자 약관의 자동화 금지 예외 'where we otherwise explicitly permit it'를 공식 headless 문서·지원 문서로 충족한다고 볼 수 있는가 | A2, A3 |
| E10-d | Antigravity 약관의 'using the Service in connection with products not provided by us'가 공식 `agy`를 다른 로컬 앱이 부르는 경우까지 포함하는가. headless 문서('in a program')와 어떻게 맞춰 읽는가. 제재가 Google 계정 전체로 번지는가 | G3, G4, G12 |
| E10-e | agy 연동 앱 배포가 Google 약관의 'providing services that encourage others to violate these terms'에 해당하는가 | G13 |
| E10-f | OpenAI 이용약관의 'Automatically or programmatically extract data or Output' 금지와 공식 `codex exec` 문서의 관계. 제3자 로컬 앱은 'Sign in with ChatGPT' 플랜 사용 경로를 써야 하는가 | O2, O3, O5 |
| E10-g | 셀러가 개인(소비자) 플랜을 업무에 쓸 때 Google·OpenAI 약관의 사업자 면책 조항이 적용되는가. 국내 약관규제법과의 관계 | G7, O14 |
| E10-h | AI가 만든 상세 카피·썸네일의 저작권 보호 여부. '다른 사용자도 비슷한 결과를 받을 수 있다' 조항 아래 경쟁 셀러와 문구가 겹칠 때의 분쟁 | O7, G16 |
| E10-i | 라쿠텐 상품 사진·설명을 AI 제공자에게 보낼 때 입력물 권리 보증 조항 위반 소지(①-3과 함께) | A9, O8, G8 |

---

## 10. 권장 후속 작업

| # | 대상 | 할 일 | 근거 |
|---|---|---|---|
| 1 | `apps/BE/src/modules/settings/ai-engine/ai-engine-options.ts` (R14 문구) | §8의 엔진별 문구로 바꾼다. FE 테스트 fixture(`apps/FE/src/test/fixtures/aiEngine.ts`)도 함께. → **반영**(2026-10-01). AGY는 D-18로 다시 바꿨다(2026-10-02) | §6 #9 |
| 2 | SCR-13 AGY 카드, GEN-09 배포본 기본값 | AGY를 '실험적·약관 위험'으로 표시하고, 배포본은 기본 끔·별도 동의. → **D-18(2026-10-02)**: '실험적'은 품질 이유로만 표시한다(약관 위험 표시 안 함, 문구 반영). 배포본 기본값은 M2에서 E-10 뒤 정한다 | G3, G13 |
| 3 | `apps/BE/src/modules/integrations/ai-engine/agy-models.provider.ts` (R12) | AGY 모델 선택지를 `gemini-*`로 제한한다. → **반영**(2026-10-01, `AGY_ALLOWED_MODEL`) | G14 |
| 4 | `apps/BE/src/modules/integrations/ai-engine/cli-isolation.ts` | `AI_CLI_FORBIDDEN_ENV`에 `CODEX_API_KEY`·`GEMINI_API_KEY`를 명시한다(허용 목록이 이미 막지만 의도를 드러냄). → **반영**(2026-10-01) | O11, G5 |
| 5 | M0 S1 이미지 생성 경로 결정(IM-09) | 배포본 기본을 Gemini API(유료 키)로 둔다. agy `generate_image`는 오너가 계정 위험을 받아들일 때만. → **D-19(2026-10-02)**: 오너가 받아들여 S1 경로를 agy `generate_image`로 정했다. Gemini API 키는 지금 없다. S1 미달이면 대안을 오너가 고른다. 배포본 기본은 M2에서 정한다 | G3, G16 |
| 6 | PRD §3 #15, ①-9 리스크 칸, K16, K25, §16 E-10, §8.9 비용 아래 | §6 #1·#2·#4와 §9를 반영한다. → **반영**(2026-10-01). D-18~D-20으로 다시 고쳤다(PRD 0.4.4) | §6 |
| 7 | OP-08 공지 모니터링 대상 | [A5](과금 변경 보류), [A1](법무 페이지), [G1](날짜 없음), [O5](한도). → **반영**(2026-10-01, PRD §8.8) | A13 |
| 8 | 오너 계정 설정 | Claude·Antigravity·ChatGPT 학습 설정을 끌지 오너가 정한다(앱은 대신 바꾸지 않음). → **D-20(2026-10-02)**: 학습 허용 안 함. 오너가 계정 설정 3개(§8 오른쪽 열)를 끈다. M1 리허설 사전 점검에 넣었다. agy를 호출 단위로 끄는 스위치는 S1 탐색에서 본다 | A10, G10, O9 |
| 9 | (M2 이후) codex 배포 경로 | 동료 배포에서 codex를 쓸 거면 'Sign in with ChatGPT' 플랜 사용 경로(미리보기)를 검토한다 | O5 |

---

## 11. 출처 (모두 2026-10-01 접속)

**Anthropic**
- [A1] Claude Code Legal and compliance — https://code.claude.com/docs/en/legal-and-compliance
- [A2] Consumer Terms of Service(시행 2025-10-08) — https://www.anthropic.com/legal/consumer-terms
- [A3] Run Claude Code programmatically — https://code.claude.com/docs/en/headless
- [A4] Agent SDK overview — https://code.claude.com/docs/en/agent-sdk/overview
- [A5] Use the Claude Agent SDK with your Claude plan(2026-06-16) — https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- [A6] Claude Code Data usage — https://code.claude.com/docs/en/data-usage
- [A7] What is the Max plan? — https://support.claude.com/en/articles/11049741-what-is-the-max-plan
- [A8] Use Claude Code with your Pro or Max plan — https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
- [A9] Usage Policy(시행 2025-09-15) — https://www.anthropic.com/legal/aup

**Google**
- [G1] Google Antigravity Additional Terms of Service(날짜 표시 없음) — https://antigravity.google/terms/
- [G2] Antigravity FAQ — https://antigravity.google/docs/faq/
- [G3] Antigravity Plans — https://antigravity.google/docs/plans/
- [G4] Antigravity CLI Headless mode — https://antigravity.google/docs/cli/headless/
- [G5] Antigravity CLI Installation and auth — https://antigravity.google/docs/cli/install/
- [G6] Antigravity Settings — https://antigravity.google/docs/settings/
- [G7] Antigravity CLI Reference — https://antigravity.google/docs/cli/reference/
- [G8] Google Terms of Service(시행 2026-07-30, 한국 접속) — https://policies.google.com/terms
- [G9] Generative AI Prohibited Use Policy(2024-12-17) — https://policies.google.com/terms/generative-ai/use-policy
- [G10] Gemini API Additional Terms of Service(2026-04-28) — https://ai.google.dev/gemini-api/terms
- [G11] Gemini API Image generation(2026-09-23) — https://ai.google.dev/gemini-api/docs/image-generation

**OpenAI** (openai.com·help.openai.com은 자동 접속 403 → web.archive.org 보관본으로 원문 확인)
- [O1] Terms of Use(시행 2026-01-01) — https://openai.com/policies/row-terms-of-use/ (보관본 2026-09-30)
- [O2] Usage policies(시행 2025-10-29) — https://openai.com/policies/usage-policies/ (보관본 2026-09-30)
- [O3] Codex Authentication — https://learn.chatgpt.com/docs/auth (developers.openai.com/codex/auth에서 이동)
- [O4] Codex Non-interactive mode — https://learn.chatgpt.com/docs/non-interactive-mode
- [O5] Codex Pricing — https://learn.chatgpt.com/docs/pricing
- [O6] Codex Image generation — https://learn.chatgpt.com/docs/image-generation
- [O7] Sign in with ChatGPT: ChatGPT plan usage for open-source apps — https://developers.openai.com/siwc/token-sharing-open-source , https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- [O8] Sign in with ChatGPT(사용자 도움말) — https://learn.chatgpt.com/docs/sign-in-with-chatgpt
- [O9] How your data is used to improve model performance — https://help.openai.com/en/articles/5722486-how-your-data-is-used-to-improve-model-performance (보관본 2026-09-29)
- [O10] Using Codex with your ChatGPT plan — https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan (보관본 2026-09-22)

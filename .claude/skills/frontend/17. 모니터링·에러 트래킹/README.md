# fe-monitoring — 모니터링·에러 트래킹 자동화 스킬

프로덕션에 올라간 프론트엔드를 **관측 가능하게** 만드는 스킬입니다. Sentry 에러 트래킹(+sourcemap),
web-vitals RUM(현장 Core Web Vitals), GA4 제품 분석 세 축을 깔고 그 위에 알림 룰을 얹습니다.
사람은 **알림 임계값·노이즈/PII 정책 합의 1번**만 개입합니다.

> FE 프로세스 17단계 "모니터링·에러 트래킹"을 자동화합니다.
> 역할 분담: AI는 SDK 초기화·계측·알림 룰 초안까지, **무엇을 노이즈로 거를지·어떤 이벤트가 의미 있는지·PII 마스킹은 사람**. 수집된 에러를 고치는 일은 `systematic-debugging`의 몫.

## 무엇을 만들어 주나

`frontend-output/<주제-슬러그>/17_모니터링/`에 생성:

| 파일 | 내용 |
|---|---|
| `17-1_sentry설정.md` | client/server/edge 초기화·instrumentation.ts·global-error.tsx·beforeSend(노이즈/PII)·CI sourcemap 스텝 |
| `17-2_web-vitals·RUM.md` | LCP/INP/CLS/TTFB/FCP 리포터, Sentry·GA4 양쪽 전송, 라우트/디바이스 분해 |
| `17-3_GA4이벤트.md` | 이벤트 카탈로그 표 + 유니온 타입 trackEvent() 래퍼, PII 가드, consent 분기 |
| `17-4_알림룰.md` | Sentry Alerts+Slack 룰 표(릴리즈 회귀·에러 급증·결제/예약·웹바이탈) |
| `_검증체크리스트.md` | 사람이 확인할 항목 |

## 준비물 (입력)

필수 입력은 없습니다(상위 산출물이 없어도 초안 생성 가능, 없는 영역은 ⚠️ 표기). 있으면 계승합니다:

1. **(권장) 16 배포** — `16_배포/`의 CI 워크플로우·env/시크릿 규약·배포 환경(sourcemap 스텝 끼움·`environment` 태그 정합).
2. **(권장) 13 성능** — Core Web Vitals 기준선(RUM 임계값 정렬).
3. **(권장) 기획 17 지표 정의서** — 이벤트 택소노미·북극성 지표·AARRR 퍼널 원본.
4. **(권장) BE 도메인 용어** — 이벤트 단계 값을 BE `Booking` 상태와 매핑.

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| Context7 MCP | 선택 | 내장 지식 + "버전 확인 필요 ⚠️"(Sentry·web-vitals는 버전별 설정 변동 큼) |
| sentry-cli / @sentry/wizard | 선택 | 설정·스크립트는 생성, "로컬에서 wizard 직접 실행" 안내 |
| @next/third-parties | 선택 | 설치 안내 + 수기 Script 주입 대안 |

## 설치

```bash
mkdir -p ~/.claude/skills/fe-monitoring
cp SKILL.md ~/.claude/skills/fe-monitoring/SKILL.md
```

## 사용법

(권장 입력이 있으면 준비한 뒤) 트리거:

```
포밋 프론트 모니터링·에러 트래킹 깔아줘
```

1. Sentry 초기화·React 에러 경계 → sourcemap CI 스텝 → web-vitals RUM → GA4 이벤트 택소노미·타입 래퍼 → beforeSend 노이즈/PII 스크럽 (자동 초안)
2. **알림 임계값·노이즈/PII 정책 합의** → 당신이 OK/수정 (유일한 개입)
3. 알림 룰 명세 → systematic-debugging 연결 → 검증 체크리스트 (자동)

발동 키워드: `프론트 모니터링`, `에러 트래킹`, `Sentry`, `sourcemap 업로드`, `web-vitals RUM`, `GA4 이벤트 택소노미`, `PII 스크럽`, `알림 룰`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `frontend-output/`를 볼트 등 원하는 경로로 |
| 계승 출처 | `## 입력` | 16 배포·13 성능·기획 17 폴더 경로를 본인 구조로 |
| 도구(Sentry/GA4) | `## 도구 정확성` | sentry-cli·wizard·@next/third-parties 가용에 맞게 |
| 스택 버전 | 상단 변경 포인트 4 | Sentry instrumentation.ts·web-vitals v4 전제 — 다르면 Context7 재확인 |
| 트리거 키워드 | frontmatter `description` | 자기 표현으로 |

## 주의

- **PII를 외부 SaaS로 흘리지 마세요** — breadcrumb·GA4 파라미터에 이메일·전화·이름·토큰이 쉽게 섞입니다. beforeSend 스크럽·PII 가드 필수, 식별은 가명 ID만.
- **동의 없는 추적은 법적 리스크** — GA4는 consent 기반이어야 하는 지역/정책이 있습니다. 동의 전 전송 보류 분기를 빼먹지 마세요.
- **노이즈 필터를 너무 세게 걸지 마세요** — 공격적 ignoreErrors는 진짜 회귀까지 삼킵니다. 드롭 규칙마다 근거.
- **sourcemap `.map`을 공개 경로에 남기지 마세요** — 노출 시 전체 소스 유출. 업로드 후 삭제 스텝을 배포물에서 직접 확인.
- **샘플링·쿼터 의식** — `tracesSampleRate=1.0`을 켜두면 쿼터가 며칠 만에 소진됩니다. 0.1로 시작, 18단계 조정.
- **모니터링은 관측이지 수정이 아닙니다** — 이슈 트리아지·systematic-debugging으로 닫는 루프까지 운영 약속으로.

## 원본 가이드

이 스킬은 FE 가이드 **"17. 모니터링·에러 트래킹"**을 자동화한 것입니다.

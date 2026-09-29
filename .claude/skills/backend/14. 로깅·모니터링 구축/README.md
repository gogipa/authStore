# be-observability — 로깅·모니터링 구축 자동화 스킬

09 API·03 아키텍처를 넣으면 구조화 로깅(JSON+traceId) → RED/USE 메트릭·Grafana 대시보드 → SLO 기반 알림 룰 → 분산 트레이싱·SLO/SLI 정의의 초안을 생성하는 Claude Code 스킬입니다. 사람은 **SLO 목표·알림 임계값·민감정보 마스킹 대상 합의 1번**에 개입합니다.

> BE 프로세스 14단계 "로깅·모니터링 구축"을 자동화합니다.
> 역할 분담: AI는 정형 설정 코드(MDC·Micrometer·대시보드 JSON·PromQL), **의미와 기준(지표 선정·임계값·SLO)은 사람**.

## 무엇을 만들어 주나

`backend-output/<주제>/14_관측성/`에 생성:

| 파일 | 내용 |
|---|---|
| `14-1_로깅설정.md` | logback-spring.xml(콘솔/운영 JSON 분기)·MDC traceId 필터·민감정보 마스킹 컨버터 |
| `14-2_메트릭대시보드.md` | Micrometer RED 메트릭(Counter/Timer/Gauge) + Grafana 대시보드 JSON(RED·USE) |
| `14-3_알림룰.md` | Prometheus 알림 룰(PromQL·`for:`·warning/critical) + Alertmanager 라우팅 |
| `14-4_SLO_SLI.md` | SLI/SLO 목표·에러버짓 + OpenTelemetry 트레이싱(Tempo OTLP·샘플링)·traceId 상호 점프 |
| `_검증체크리스트.md` | 사람이 확인할 항목 |

임계값·SLO 목표는 전부 `{{합의}}` placeholder로 비워 두고, 사람이 운영 데이터를 보고 채웁니다.

> 14-2 대시보드 JSON·14-3 알림 룰 YAML은 `.md` 코드블록과 함께 검증 가능한 형제 파일(`14-2_grafana-dashboard.json`·`14-3_alert-rules.yaml`)로도 내보내 python3로 정적 파싱합니다.

## 준비물 (입력)

1. **(필수) 09 API개발** — `backend-output/<주제>/09_API개발/`(엔드포인트·전역 예외 핸들러). 메트릭/로그를 붙일 대상.
2. **(권장) 03 아키텍처** — `03_아키텍처/`(컴포넌트·외부 호출 경로). 트레이스 span 경계·USE 자원 식별. 없으면 미계승 처리.
3. **(참조) 06 정책·15 보안** — 민감정보 마스킹 규칙 근거. 없으면 마스킹 대상을 사람 확정으로 회부.

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| Context7 MCP | 선택 | Micrometer/OTel 설정 내장 지식 + "버전 확인 필요 ⚠️" |
| Figma MCP | 선택 | 데이터흐름 다이어그램 Mermaid 폴백 |
| python3 | 선택 | 대시보드 JSON·룰 YAML 정적 검증 체크리스트로 degrade |

## 설치

```bash
mkdir -p ~/.claude/skills/be-observability
cp SKILL.md ~/.claude/skills/be-observability/SKILL.md
```

## 사용법

09(있으면 03도) 산출물을 준비한 뒤:

```
포밋 관측성 구축해줘 — 로깅·메트릭·대시보드·알림
```

1. 입력 확인 → 민감정보 닿는 로그 경로 스캔
2. **SLO 목표·알림 critical 기준·마스킹 대상 합의** → 당신이 확정 (유일한 개입)
3. 로깅(14-1) → 메트릭·대시보드(14-2) → 알림 룰(14-3) → 트레이싱·SLO(14-4) 자동

발동 키워드: `로깅`, `모니터링`, `관측성`, `메트릭`, `대시보드`, `트레이싱`, `SLO`, `알림 룰`, `Grafana`, `Prometheus`, `observability`, `logging`, `monitoring`, `metrics`, `tracing`, `alerting`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `backend-output/`를 원하는 경로로(본인 볼트는 BE/실행산출물/) |
| 계승 출처 | `## 입력` | 03·09 폴더 경로를 본인 구조로 |
| SLO/알림 기본 제안 | `### 🚦 게이트` | 예시 임계(p99·99.9%)를 서비스 약속에 맞게 |
| 스택 도구 | 변경 포인트 주석 4 | Micrometer/Tempo/OTel을 팀 스택으로(인코더·exporter·브리지 교체) |

## 주의

- **임계값을 AI가 정하게 두지 마세요.** 근거 없는 추정치 — 검토 없이 켜면 오탐 폭탄으로 알림이 무시당합니다.
- **민감정보가 로그로 샙니다.** 마스킹 규칙은 06/15 기준 사람이 정의, Loki 전송 전 검증.
- **메트릭 카디널리티 폭발** — bookingId 같은 고유값을 태그로 쓰면 Prometheus가 터집니다(태그는 유한 분류만).
- **Context7 생략은 흔한 실수** — OTel/Micrometer Tracing은 버전 간 설정이 크게 다릅니다.
- **대시보드는 보지 않으면 노이즈** — SLO 리뷰 주기·담당자를 정하세요. 모니터링은 테스트(13)를 대체하지 않습니다.

## 원본 가이드

이 스킬은 BE 가이드 **"14. 로깅·모니터링 구축"**을 자동화한 것입니다.

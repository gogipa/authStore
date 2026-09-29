---
name: be-observability
description: 백엔드 서비스에 구조화 로깅·메트릭·대시보드·트레이싱·SLO/알림을 깔아 "지금 건강한가"를 보이게 만든다. 임계값은 사람이 합의, 계측 골격은 AI가 생성. "로깅","모니터링","관측성","메트릭","대시보드","트레이싱","SLO","SLI","알림 룰","Grafana","Prometheus","OpenTelemetry","observability","logging","monitoring","metrics","tracing","alerting" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# 로깅·모니터링 구축 (Observability)

배포 후 운영 중인 시스템이 지금 건강한지 눈으로 보고 무너지기 전에 경보를 받는 체계를, 구조화 로깅·메트릭·대시보드·트레이싱·SLO/알림 초안으로 만든다. 산출물 = 로깅 설정·메트릭 계측·Grafana 대시보드 JSON·SLO/알림 룰 + 검증 체크리스트. **AI는 정형 설정 코드(MDC traceId·Micrometer·대시보드 JSON·PromQL)를 빠르게 뽑고, "무엇을 측정할지·임계값·SLO 목표·알림 우선순위"는 도메인/운영을 아는 사람이 정한다.**

<!-- ───────────────────────────────────────────────────────────────
변경 포인트 (배포본 → 본인 환경에 맞게 수정)
  1. 출력 경로: 본인 볼트 설치본은 BE/실행산출물/<주제>로 고정 가능. 기본은 backend-output/<주제-슬러그>/14_관측성/.
  2. 계승 출처: 상위 산출물(03 아키텍처·09 API개발) 경로를 본인 폴더 구조로 수정.
  3. 도구(MCP/CLI): Context7(라이브러리 최신)·Figma generate_diagram(데이터흐름)·python3(JSON/PromQL 정적 검증). 없으면 degrade.
  4. 스택 버전: Java 21 / Spring Boot 3.3 / Micrometer + Prometheus / Grafana(Loki·Tempo) / OpenTelemetry. 팀 스택이 다르면 인코더·exporter·브리지 교체.
──────────────────────────────────────────────────────────────── -->

## 핵심 원칙
- **상위 산출물 계승·재발명 금지**: 03 아키텍처(컴포넌트·외부 경로)·09 API(엔드포인트·예외 핸들러)에서 관측 대상과 핵심 경로를 계승. 확정 상태일 때만 계승하고, 미확정은 `⚠️`로 보존한다.
- **로그는 데이터로, 메트릭은 프레임으로**: 자유 형식 로그 금지 — JSON + traceId(MDC)로 한 요청의 전 구간을 한 ID로 묶는다. 메트릭은 마구 늘리지 말고 **RED**(Rate·Errors·Duration, 서비스 관점)·**USE**(Utilization·Saturation·Errors, 자원 관점) 프레임으로 강제한다.
- **지표 선정·임계값·SLO 목표는 사람이 정한다**: AI가 박은 임계값은 근거 없는 추정치다. 모든 목표치·임계값은 `{{합의}}` placeholder로 비워 생성하고 사람이 채운다.
- **알림은 적을수록 강하다**: SLO·에러버짓 기준으로 "사용자 영향 + 사람 개입 필요"한 것만 critical. AI 알림 후보는 반드시 사람이 솎는다.
- **traceId가 모든 신호를 꿴다**: 로그·메트릭·트레이스가 같은 traceId를 공유해야 대시보드 → 트레이스 → 로그로 한 번에 내려갈 수 있다(18 장애 대응 시간이 여기서 결정).
- **카디널리티 통제**: `bookingId`처럼 값이 무한한 것은 절대 메트릭 태그로 쓰지 않는다 — 태그는 유한한 분류(상태·사유)만.

## 입력
- **필수**: `backend-output/<주제-슬러그>/09_API개발/`(엔드포인트·전역 예외 핸들러 — 메트릭/로그를 붙일 대상). 없으면 09 위치를 묻고 degrade(핵심 경로를 사용자에게 질의해 RED 골격만 생성, ⚠️ 표기).
- **권장**: `03_아키텍처/`(컴포넌트·외부 호출 경로 — 트레이스 span 경계·USE 자원 식별). 없으면 "아키텍처 미계승" 처리 + 03 먼저 권장.
- **참조**: 06 정책·15 보안(민감정보 마스킹 규칙 근거). 없으면 마스킹 대상을 사람 확정으로 회부.

> 정본 스택: Java 21 / Spring Boot 3.3 / Micrometer-registry-prometheus / Grafana(Prometheus·Loki·Tempo) / OpenTelemetry. 관통 예시 = 포밋 예약·결제 경로(Member/Booking/Payment/Settlement).

## 출력 위치: `backend-output/<주제-슬러그>/14_관측성/`

<!-- 변경 포인트(출력 경로): 본인 볼트 설치본은 BE/실행산출물/<주제>로 고정 가능. 기본은 backend-output/<주제-슬러그>/ -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `14-1_로깅설정.md` | logback-spring.xml(콘솔/운영 JSON 분기)·MDC traceId 필터(X-Trace-Id 노출)·민감정보 마스킹 컨버터 초안 + 변경포인트 주석 | Stage 1 |
| `14-2_메트릭대시보드.md` | Micrometer 커스텀 메트릭(RED 기준 Counter/Timer/Gauge) + Grafana 대시보드 JSON(RED·USE 패널, 임계 색상 `{{합의}}`) | Stage 2 |
| `14-3_알림룰.md` | Prometheus 알림 룰(PromQL·`for:`·warning/critical) + Alertmanager 라우팅, 임계값 `{{합의}}` placeholder, runbook_url 라벨 자리 | Stage 3 |
| `14-4_SLO_SLI.md` | SLI 정의·SLO 목표(`{{합의}}`)·에러버짓·OpenTelemetry 트레이싱 연동(Tempo OTLP·샘플링)·traceId↔트레이스 상호 점프 | Stage 4 |
| `_검증체크리스트.md` | 사람 확인 항목 | Stage 5 |

- 출력 폴더가 없으면 생성한다. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`).
- **정적 검증용 사이드카 파일**: 대시보드 JSON·알림 룰 YAML은 `.md` 코드블록에 더해 검증 가능한 형제 파일(`14-2_grafana-dashboard.json`·`14-3_alert-rules.yaml`)로도 내보내 python3 `json.load`/`yaml.safe_load`로 파싱한다(바이블 §148 — `.md` 또는 실제 확장자 허용). python3 부재 시 정적 체크리스트로 degrade.

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- 09 필수(없으면 위치 질의 → degrade: 핵심 경로 사용자 질의). 03 권장(없으면 미계승 처리).
- **도구 probe**: Context7(ToolSearch 존재) = Micrometer Tracing/OpenTelemetry Boot 3.3 최신 설정 / Figma generate_diagram = 관측 데이터흐름 다이어그램(옵트인) / python3 = JSON·PromQL 정적 검증.
- **민감정보 식별**: 09 예외 핸들러·외부 호출에서 카드번호·전화번호·이메일·토큰이 로그 경로에 닿는지 스캔 → 마스킹 대상 후보를 게이트 회부.

### 🚦 게이트 — SLO/SLI 목표·알림 임계값·마스킹 대상 합의 (AskUserQuestion, 필수)
AskUserQuestion으로 사람이 결정해야 하는 핵심을 묻는다(AI 추천 1안 제시, 확정 아님):
- **SLO/SLI 목표**: 예약/결제 API 지연 p99 임계, 가용성(5xx 비율) 목표, 결제 승인 성공률 목표 — 기본 제안(p99 < 500ms·99.9% 등)은 예시일 뿐, 사용자 약속·인프라 비용·도메인으로 사람이 확정.
- **알림 critical 기준**: "새벽에 깨울 가치가 있는 것"만 critical, 나머지는 warning(묶음). 에러버짓 소진 속도 기반 등급.
- **민감정보 마스킹 대상**: 06 정책·15 보안 기준으로 로그에 남기지 않을 필드 확정(카드번호·주민번호·전화번호·토큰 등).

게이트 전에는 다음 Stage로 넘어가지 않는다. 목표치·임계값은 산출물에 `{{합의}}` placeholder로 남기고 합의값을 채운다.

### Stage 1 — 구조화 로깅 + traceId 주입 → 14-1
- Context7로 Spring Boot 3.3 + Micrometer Tracing의 MDC traceId 연동 최신 방식을 먼저 확인(없으면 내장 지식 + ⚠️ 버전 주의).
- `logback-spring.xml`: 콘솔은 사람이 읽는 포맷, 운영 프로파일은 JSON 인코더(Loki 수집용).
- 모든 로그 라인에 `traceId`·`spanId`·`application=pomit-api`(MDC). 요청 진입 시 traceId 없으면 생성, 응답 헤더 `X-Trace-Id`로 노출하는 필터.
- **민감정보 마스킹 컨버터**: 게이트에서 확정한 대상(카드번호·전화번호·이메일 등)만 마스킹. 마스킹 규칙은 06/15 기준 사람 확정값을 반영(AI가 임의 확정 금지).

### Stage 2 — 핵심 비즈니스 메트릭(RED) + 대시보드(RED/USE) → 14-2
- Micrometer 커스텀 메트릭을 RED 프레임으로 09 핵심 경로(예약·결제)에 계측:
  - Rate: 예약 생성 수(`booking.created.total`)·결제 시도 수(`payment.attempt.total`) — Counter
  - Errors: 결제 실패 수(`payment.failed.total`, 태그 `reason=...`) — Counter
  - Duration: 결제 승인 소요시간(`payment.approval.duration`) — Timer
  - 비즈니스 Gauge: 진행중 예약 수(`booking.in_progress`)
- **중복 계측 금지**: HTTP 레벨 RED(`http.server.requests`)는 Actuator 자동 제공.
- **카디널리티 못 박기**: `bookingId` 등 고유값은 태그 금지 — 유한 분류(상태·사유)만.
- Grafana 대시보드 JSON: RED 행(요청률·5xx 비율·p50/p95/p99) / 비즈니스 행(시간당 예약·결제 성공률·승인 p99) / USE 행(JVM heap·GC·hikaricp 풀 사용률·Redis·CPU). 각 패널 PromQL 포함, 임계 색상 구간은 `{{합의}}`로 비움.

### Stage 3 — SLO 기반 알림 룰 → 14-3
- Prometheus 알림 룰(PromQL): 5xx 에러율 5분 임계 초과(에러버짓 소진 속도 기반 warning→critical), 결제 실패율 급증, DB 커넥션 풀 포화(USE), p99 임계 초과.
- 각 알림에 `runbook_url` 라벨 자리(18 장애 플레이북 링크)·주간/야간 라우팅.
- **알림 피로 방지**: warning은 묶고 critical만 즉시 호출, `for:` 지속시간으로 순간 스파이크 무시.
- 임계값은 전부 `{{합의}}` placeholder — 게이트 합의값만 채운다.

### Stage 4 — 분산 트레이싱 연결 + SLO/SLI 정의 → 14-4
- Context7로 Micrometer Tracing ↔ OpenTelemetry 브리지 Boot 3.3 최신 설정 확인(없으면 내장 지식 + ⚠️).
- 트레이스 exporter = Tempo(OTLP). 예약 생성 → 결제 승인(토스페이먼츠 호출) → 정산 행 생성 경로가 하나의 trace로. 외부 호출(토스페이먼츠) span에 결과/지연 속성.
- 운영 부하 고려 샘플링(기본 10% + 에러 100% **정책 제안** — 사람 확정). 로그 traceId ↔ Tempo trace가 Grafana에서 상호 점프되게 연동.
- SLI 정의 + SLO 목표(게이트 합의값) + 에러버짓 산식. 이 값이 18 출동 기준·19 회귀 베이스라인으로 이어짐을 명시.
- (옵트인) Figma generate_diagram으로 관측 데이터흐름(앱→Prometheus/Loki/Tempo→Grafana)·알림 라우팅 다이어그램. 없으면 Mermaid 폴백.

### Stage 5 — 마무리(_검증체크리스트 + 경로 보고)
`_검증체크리스트.md` 생성(아래 본문, `<주제>`/`<날짜>` 치환). 산출물 폴더 경로와 "임계값·SLO는 초안 — 운영 데이터로 조정 필수, 알림 켜기 전 사람 솎기" 고지를 보고한다. 🔴 미합의(SLO·임계값·마스킹) 잔존 시 ⚠️ 표기 + 완료 보고 금지.

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe = ToolSearch 존재) = Micrometer Tracing/OpenTelemetry Boot 3.3 최신 설정 확인. 부재 시 내장 지식으로 진행 + "버전 확인 필요 ⚠️"(생략 위험은 아래 주의 참조).
- **Figma MCP generate_diagram**(probe) = 관측 데이터흐름·알림 라우팅 다이어그램(옵트인). 부재 시 Mermaid 폴백.
- **python3**(bash) = 대시보드 JSON `json.load`·PromQL/룰 YAML `yaml.safe_load` 정적 파싱. 부재 시 정적 체크리스트 degrade.
- **중단**: 필수 입력(09) 부재 시에만(그래도 핵심 경로 질의로 RED 골격 degrade 가능). 그 외는 degrade.

## _검증체크리스트 본문 (Stage 5 생성)
```markdown
# 검증 체크리스트 — <주제> 로깅·모니터링 구축 (작성일: <날짜>)

> AI는 계측 코드·대시보드 골격까지. 의미와 기준(지표 선정·임계값·SLO)은 사람의 일이다.

- [ ] 민감정보 마스킹: 카드번호·주민번호·전화번호·토큰이 로그(Loki 전송 전)에 평문으로 안 남는지 검증
- [ ] 메트릭 카디널리티: AI 생성 태그가 전부 유한한 분류(상태·사유)인지 — bookingId 등 고유값 태그 0개
- [ ] 중복 계측 없음: HTTP 레벨 RED는 Actuator 자동 제공분 사용(http.server.requests 재계측 안 함)
- [ ] SLO/SLI 목표(`{{합의}}`) 전부 사람 확정 — 운영 초기 보수적, 실제 트래픽으로 조정 예정
- [ ] 알림 임계값 사람 확정 + critical은 "새벽에 깨울 가치" 있는 것만 / warning 묶음 / `for:` 설정
- [ ] runbook_url 라벨이 18 장애 플레이북으로 연결될 자리 확보
- [ ] traceId가 로그·메트릭·트레이스에서 동일 — Grafana 상호 점프 동작
- [ ] OTel/Micrometer Tracing 설정 Context7로 현재 버전 대조(미대조 시 ⚠️)
- [ ] 트레이스 샘플링·로그 보존 기간이 운영 규모/비용에 맞게 설정
- [ ] 대시보드를 매일 볼 사람·SLO 리뷰 주기 지정(보지 않는 대시보드는 노이즈)
```

## 주의
- **민감정보가 로그로 샌다.** 마스킹 규칙은 06/15 기준으로 사람이 정의하고, Loki 전송 전에 검증한다.
- **알림 임계값을 AI가 정하게 두지 말 것.** AI가 박은 값은 근거 없는 추정치 — 검토 없이 켜면 오탐 폭탄으로 알림이 무시당한다.
- **흔한 실수 — Context7 생략.** OTel·Micrometer Tracing은 버전 간 설정이 크게 달라, AI 학습 시점 설정을 그대로 쓰면 동작하지 않는다.
- **흔한 실수 — 대시보드만 만들고 안 본다.** 누군가 매일 보고 SLO를 리뷰해야 살아 있다. 모니터링은 테스트(13)를 대체하지 않는다(보완 관계).
- 관측 비용도 비용 — 트레이스 100% 샘플링·고빈도 메트릭·과도한 로그 보존은 스토리지/전송 비용을 키운다.

## 원본 가이드
- 이 스킬은 BE 가이드 **"14. 로깅·모니터링 구축"**을 자동화한 것입니다.

---
name: be-database-design
description: >-
  03 아키텍처의 도메인 모듈과 01 도메인 분석을 받아 ERD(Mermaid)·PostgreSQL DDL·JPA
  엔티티 초안·정규화/인덱스 점검·Flyway 마이그레이션을 한 원본에서 정합하게 파생한다.
  "DB 설계", "데이터베이스 설계", "ERD", "스키마", "DDL", "정규화", "마이그레이션",
  "인덱스 설계", "Flyway", "JPA 엔티티", "database design", "ERD", "schema",
  "DDL", "normalization", "migration", "index design" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# 데이터베이스 설계 (ERD·스키마) (Database Design)

03에서 정한 도메인 모듈을 입력으로, 도메인 모델을 ERD로 시각화하고 그것을 PostgreSQL 16 DDL과
JPA 엔티티 초안으로 내린 뒤, 정규화·인덱스·제약을 점검하고 첫 Flyway 마이그레이션까지 만든다.
산출물 = ERD·schema.sql·엔티티 초안·Flyway V1/V2·인덱스제약 점검 리포트.
**AI는 도메인 모델→ERD→DDL→엔티티의 규칙 있는 변환, 트레이드오프(정규화/인덱스/삭제 정책)는 사람.**

<!-- 변경 포인트 (배포본 → 본인 환경에 맞게 수정)
  1. 출력 경로: 기본 backend-output/<주제-슬러그>/04_데이터베이스/. 본인 볼트 설치본은 BE/실행산출물/<주제>로 고정 가능.
  2. 계승 출처 경로: 상위 산출물(01 도메인분석·03 모듈경계) <루트>=backend-output/<주제-슬러그> 기준. 본인 폴더 구조면 수정.
  3. 도구(MCP/CLI): Context7(JPA/Hibernate·Flyway 최신) / Figma generate_diagram(ERD 공유본 옵트인) / docker·psql(로컬 PG 적용 검증).
  4. 스택 버전: PostgreSQL 16 / Java 21 / Spring Boot 3.3 / Hibernate 6 / Flyway. 팀 버전이 다르면 DDL 타입·매핑·네이밍 규칙 교체.
-->

## 핵심 원칙
- **상위 산출물 계승·재발명 금지**: 01의 엔티티/애그리거트와 03의 모듈 경계가 확정이면 그대로 계승하고, 미확정·[확인 필요]는 `⚠️`로 보존해 게이트 회부(엔티티명을 임의로 바꾸지 않는다).
- **ERD를 단일 원본으로** — DDL·JPA 엔티티는 ERD에서 같은 세션에 파생시켜 셋이 정합한 상태로 시작. 변경도 ERD부터 고치고 내린다(타입·nullable·연관관계 갈라짐 차단).
- **변환은 AI, 트레이드오프는 사람** — 정규화 vs 반정규화, 인덱스 채택, FK 삭제 정책은 트래픽 가정·도메인 지식이 필요한 판단이라 사람이 확정.
- **DDL은 만들고 끝이 아니라 실제 DB에 올려봐야 끝** — "코드처럼 보이는 SQL"이 아니라 "실제로 도는 스키마"를 산출물로 본다(로컬 PG 적용을 워크플로우에 포함).
- **금액·시각 타입 강제** — 금액은 `numeric`(또는 정수 최소단위), 시각은 `timestamptz`. AI가 `double`/`timestamp`로 만들면 교정.

## 입력
- **필수**: `<루트>/01_요구사항분석/01-1_도메인분석.md`(엔티티/애그리거트 후보·바운디드 컨텍스트·유스케이스). 없으면 위치를 묻고 **중단**(또는 사용자에게 엔티티 정본 직접 질의).
- **권장**: `<루트>/03_아키텍처/`(모듈 경계 — 스키마 분할·엔티티 배치 기준), `<루트>/01_요구사항분석/01-2_비기능요구.md`(트랜잭션·동시성 가정 — 인덱스/제약 판단 근거).
- 03이 없으면 **degrade**(단일 모듈 가정으로 진행 + "모듈 경계 미확인 ⚠️" 표기).

## 출력 위치: `backend-output/<주제-슬러그>/04_데이터베이스/`
| 파일 | 내용 | 생성 stage |
|---|---|---|
| `04-1_ERD.md` | Mermaid `erDiagram`(엔티티·속성·타입·PK/FK·카디널리티, 핵심 상태 enum 명시) | Stage 1 |
| `04-2_schema.sql` | PostgreSQL 16 DDL(타입·PK/FK·UNIQUE·NOT NULL·CHECK, snake_case, enum=varchar+CHECK) | Stage 2 |
| `04-3_JPA엔티티초안.md` | `@Entity`/`@Table`/LAZY 연관관계·`@Enumerated(STRING)`·BaseEntity(@MappedSuperclass) 초안 | Stage 2 |
| `04-4_V1__init.sql` | Flyway V1(테이블·제약 생성) + V2(인덱스 추가) 마이그레이션 초안 | Stage 4 |
| `04-5_인덱스제약점검.md` | 정규화 1~3NF 점검·반정규화 제안·인덱스 후보(근거)·FK ON DELETE·UNIQUE/CHECK 점검 | Stage 3 |
| `_검증체크리스트.md` | 사람 확인 항목(로컬 PG 적용 포함) | Stage 5 |

- 출력 폴더가 없으면 생성. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`).

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- 01 도메인분석 로드(없으면 중단). 03 모듈경계 로드(없으면 degrade + ⚠️). 01-2 비기능요구로 트래픽·동시성 가정 확보.
- **엔티티 확정 = 01 우선**: 01 도메인분석의 엔티티/애그리거트 후보를 그대로 계승(재작명·발명 금지, 미확정은 `⚠️` 보존). 아래 포밋(돌봄 매칭) 엔티티 세트 — Member / SitterProfile / Pet / CareService / Booking / Payment / Settlement / Review (+ Chat / Notification) — 는 **이 스킬의 관통 예시일 뿐 정본 강제가 아니다.** 입력 도메인이 다르면(예: 구독형 서비스 → Member / SubscriptionPlan / Subscription / Payment / Refund / Delivery 등) **01의 엔티티 구성을 따른다.**
- **도구 probe**: Context7(ToolSearch 존재 시 가용), Figma `generate_diagram`(옵트인), `docker`/`psql`(bash 시도로 판별). 부재 시 degrade(아래 도구 정확성 절).

### Stage 1 — 도메인 모델 → ERD (`04-1_ERD.md`)
- 01 엔티티/관계를 Mermaid `erDiagram`으로. 각 엔티티에 주요 속성·타입·PK/FK 표시, 카디널리티(1:N / N:M / 1:1) 명시.
- 예시(포밋) 핵심 관계: Member(OWNER) 1:N Pet / Member(SITTER) 1:1 SitterProfile / SitterProfile 1:N CareService / Booking은 Member·CareService·Pet에 N:1 / Booking 1:1 Payment·Review(선택)·Settlement. **입력 도메인이 다르면 01의 관계를 따른다**(이 관계는 예시 가이드).
- 핵심 상태 컬럼(예: Booking.status REQUESTED/ACCEPTED/IN_PROGRESS/COMPLETED/CANCELED)은 enum 컬럼으로 명시. **상태값은 01·기획 상태정의(SSOT)를 그대로 보존**(임의 변경 금지).
- 01에서 관계가 모호하면 추정하지 말고 `⚠️ [확인 필요]`로 표기해 게이트 회부.

### Stage 2 — DDL·JPA 엔티티 초안 (`04-2_schema.sql`, `04-3_JPA엔티티초안.md`)
- **먼저 Context7로 Spring Boot 3.3 + Spring Data JPA(Hibernate 6) 매핑·Flyway 최신 권장 확인**(probe 가용 시). 부재 시 내장 지식 + "버전 확인 필요 ⚠️".
- DDL 규칙: id=`bigint GENERATED ALWAYS AS IDENTITY`, 금액=`numeric`, 시각=`timestamptz`, 텍스트=`varchar/text`. PK·FK(ON DELETE 정책 명시)·UNIQUE(`member.email`)·NOT NULL·CHECK(`booking.status IN (...)`). **enum은 PG enum 타입 대신 `varchar + CHECK`**(변경 유연성). snake_case 테이블/컬럼, FK는 `{참조테이블}_id`.
- JPA 엔티티 규칙: 엔티티는 class(record는 DTO 전용). 연관관계 기본 LAZY·`@ManyToOne` 위주(양방향 남발 금지). 상태는 `@Enumerated(EnumType.STRING)`. 공통 필드(`created_at`/`updated_at`)는 `@MappedSuperclass BaseEntity`.
- ERD와 1:1 정합(타입·nullable·연관관계 어긋나면 ERD 기준으로 양쪽 교정).

### Stage 3 — 정규화·인덱스·제약 점검 (`04-5_인덱스제약점검.md`)
- **정규화 점검**: 1~3NF 위반·중복 저장·이행적 종속 후보 지적. **의도적 반정규화**가 필요한 곳(예: Booking에 결제 시점 금액·시터명 스냅샷)은 "정규화를 깨는 게 맞는 이유"(분쟁 방지·이력 보존)와 함께 제안.
- **인덱스 후보**: 조회 패턴별로 제안 + 각각 근거. 예시(포밋) 패턴 — ① CareService 지역+날짜 검색(가장 잦음) ② Member별 Booking 목록(상태 필터) ③ Settlement 시터별·기간 집계. **입력 도메인이 다르면 01 유스케이스·핵심 조회 경로에서 패턴을 도출한다.** **과도한 인덱스는 쓰기 비용을 키우니 "이건 불필요" 항목도 표시**(AI는 인덱스를 과하게 권한다).
- **제약 점검**: FK ON DELETE 정책이 도메인상 맞는지(결제된 Booking의 Pet 삭제 거동 등 — 대부분 soft delete 권장), 빠진 UNIQUE, CHECK로 막을 불변식.
- 확신 낮거나 트래픽 가정이 필요한 항목은 **"사람 판단 필요"**로 표시.

### 🚦 게이트 — 스키마·정규화·인덱스·삭제 정책 확정 (AskUserQuestion, 필수)
Stage 1~3 산출물(ERD·DDL·점검 리포트)이 게이트 시점에 모두 존재해야 한다. AI 추천 1안으로 질문하고 사람이 OK/수정한다. 확정 전에는 Stage 4(마이그레이션)로 넘어가지 않는다.
- **정규화 vs 반정규화** 채택안(Booking 스냅샷 등 — 도메인 판단).
- **인덱스 후보** 확정(쓰기 비용 감수 가치 — "불필요" 처리 항목 포함).
- **FK ON DELETE / soft-delete 정책** 확정(거래 이력 증발 방지 — 케이스별).
- **enum 전략 일관성**(포밋 정본 `varchar + CHECK`, 팀이 다르면 전 테이블 통일).

### Stage 4 — Flyway 마이그레이션 초안 (`04-4_V1__init.sql`)
- **Context7로 Flyway 최신 마이그레이션 네이밍·baseline 규칙 확인**(probe 가용 시).
- 게이트에서 확정한 스키마로: Flyway 파일명 규칙 `V{버전}__{설명}.sql`. 산출물 `04-4_V1__init.sql` 한 파일 안에 **V1(`V1__init.sql`)=테이블·제약 생성 / V2(`V2__add_indexes.sql`)=인덱스 추가** 두 마이그레이션을 가독성 위해 섹션으로 분리해 담는다(실제 Flyway 배치 시 두 파일로 떼어 둘 것을 주석으로 안내). 운영 중 변경 가정 — 컬럼 추가 시 NOT NULL+DEFAULT 조합 주의를 주석으로, 되돌릴 수 없는 변경(DROP)에는 경고 주석.
- **첫 테이블부터 V1 마이그레이션으로 시작**(Flyway 뒤늦게 붙이면 baseline 꼬임).
- 로컬 PG 16 적용 psql 명령 안내 동봉(아래).

### Stage 5 — 마무리(`_검증체크리스트.md` + 경로 보고)
- 산출물 폴더 경로 보고. **"로컬 PG 적용 성공까지가 한 묶음"** 고지(05 API는 이 엔티티를, 08 비즈니스 로직은 이 상태 전이를, 10 쿼리 최적화는 이 인덱스를 계승).

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe) = JPA/Hibernate 6 매핑·Flyway 명명/baseline 최신 문서. 2-step(resolve-library-id → query-docs ≤3). 부재 **또는 호출 실패(쿼터 초과·네트워크 등)** → 내장 지식 + "버전 확인 필요 ⚠️"로 degrade(ToolSearch에 존재해도 실제 호출이 거부될 수 있으니 결과로 판별).
- **Figma `generate_diagram`**(probe, 옵트인) = ERD 팀 공유본 FigJam. 부재 → Mermaid `erDiagram`만(기본 산출물). Mermaid가 SSOT, Figma는 공유본.
- **docker / psql**(bash 시도) = 로컬 PG 16에 DDL/마이그레이션 적용 검증. 부재 → 산출물(SQL)은 생성하되 "로컬에서 직접 적용 필요" 안내(검증 단계 degrade).

## 로컬 PG 적용 검증 (Stage 4 후 권장)
```bash
# 06에서 구성하는 로컬 PG 16에 마이그레이션 적용 테스트 (예시 — <주제-슬러그>는 본인 DB명으로)
# 산출물 04-4_V1__init.sql 안의 V1(테이블·제약)·V2(인덱스) 섹션을 순서대로 적용
psql -h localhost -U <주제-슬러그> -d <주제-슬러그> -f 04-4_V1__init.sql
# (로컬 psql 버전이 PG16 미만이면 docker로 PG16 컨테이너를 띄워 검증: docker run --rm -d -p 5432:5432 postgres:16)
```
AI 생성 DDL은 PG 버전별 문법 차이·예약어 컬럼명·제약 충돌을 종종 놓치므로 반드시 한 번 올려본다.

## _검증체크리스트 본문 (Stage 5 생성, `<주제>`/`<날짜>` 치환)
```markdown
# 검증 체크리스트 — <주제> 데이터베이스 설계 (작성일: <날짜>)

> 변환은 AI, 트레이드오프(정규화·인덱스·삭제 정책)는 사람. DDL은 로컬 DB에 올려봐야 끝이다.

- [ ] 엔티티명이 01 도메인분석과 1:1(임의 재작명 0건), 미확정은 ⚠️ 보존
- [ ] ERD ↔ DDL ↔ JPA 엔티티 정합(타입·nullable·연관관계 불일치 0건)
- [ ] 금액=numeric / 시각=timestamptz 강제(float·timestamp 잔존 0건)
- [ ] enum 컬럼 전략 일관(varchar+CHECK 또는 팀 합의 전략으로 전 테이블 통일)
- [ ] 인덱스는 핵심 조회 경로에만 — 과적 인덱스 제거, "불필요" 처리 근거 확인
- [ ] FK ON DELETE / soft-delete 정책을 도메인으로 사람 확정(거래 이력 증발 방지)
- [ ] 첫 테이블부터 V1 마이그레이션으로 시작(baseline 꼬임 방지)
- [ ] **로컬 PostgreSQL 16에 V1·V2 적용 성공 확인**(제약 충돌·예약어 검출)
```

## 주의
- **AI는 인덱스를 과하게 권한다** — 핵심 조회 경로(지역+날짜 검색 등)에만 깔고 나머지는 운영 중 느린 쿼리 보고 추가. 인덱스는 쓰기 성능·저장 공간을 깎는다.
- **정규화 vs 반정규화는 도메인 판단** — AI는 3NF로 정규화하려 하나, Booking 스냅샷 같은 의도적 반정규화가 분쟁 방지·이력 보존엔 옳을 수 있다. "정규화가 정답"을 도메인 맥락으로 깎는다.
- **금액·시각 타입을 흘려보지 말 것** — `float`/`double`은 정밀도 오류, `timestamp`는 타임존 사고. `numeric`·`timestamptz` 강제.
- **FK ON DELETE를 도메인으로 검증** — 결제 완료 Booking의 Pet을 CASCADE로 지우면 이력 증발. 삭제는 대부분 soft delete, 물리 삭제 FK 정책은 케이스별 사람 결정.
- **흔한 실수 — 로컬 적용 생략**: "보기 좋다"고 통과시키면 PG에 올릴 때 제약 충돌·예약어 문제가 터진다. 첫 마이그레이션은 반드시 로컬 PG 적용으로 통과 확인.
- **흔한 실수 — 마이그레이션을 나중에 도입**: 손으로 만들고 Flyway를 뒤늦게 붙이면 baseline이 꼬인다.

## 원본 가이드
- 이 스킬은 BE 가이드 **"04. 데이터베이스 설계 (ERD·스키마)"**를 자동화한 것입니다.

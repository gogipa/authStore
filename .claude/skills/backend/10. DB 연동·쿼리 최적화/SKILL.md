---
name: be-query-optimization
description: >-
  04 DB설계·09 API개발을 받아 JPA/QueryDSL 쿼리의 N+1 진단·EXPLAIN ANALYZE 실행계획 해석·
  인덱스/페이징(no-offset) 개선을 측정 기반으로 진단한다. "쿼리 최적화", "N+1", "JPA 최적화",
  "QueryDSL", "실행계획", "EXPLAIN", "인덱스", "fetch join", "페이징 최적화", "슬로우 쿼리",
  "query optimization", "N+1", "EXPLAIN ANALYZE", "index tuning", "no-offset paging"
  같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# DB 연동·쿼리 최적화 (Query Optimization)

09단계 컨트롤러가 호출하는 서비스가 04단계 ERD 위에서 도는 쿼리를, JPA/QueryDSL로 연결하고
"빠른가 느린가"를 **측정으로** 진단·개선한다. 산출물 = N+1 진단·실행계획/인덱스 개선·QueryDSL
초안. 이 단계의 문제는 "코드는 멀쩡한데 느린 것"이라, 핵심은 코드 생성이 아니라 **느린 원인을
측정으로 찾는 것**이다.

**역할 분담**: AI는 쿼리 생성·실행계획 해석·처방 후보 제시. **처방 선택·실측 검증은 사람**(이
트래픽·읽기쓰기 비율에 어떤 처방이 맞는가는 운영을 아는 사람의 판단).

<!-- ───────────────────────────────────────────────────────────────
변경 포인트 (배포본 → 본인 환경에 맞게 수정)
  1. 출력 경로: 기본 backend-output/<주제-슬러그>/10_쿼리최적화/. 본인 볼트 설치본은
     BE/실행산출물/<주제>로 고정 가능.
  2. 계승 출처: 상위 산출물(04 데이터베이스·09 API개발) 경로를 본인 폴더 구조로 수정.
  3. 도구(MCP/CLI): Context7(QueryDSL/Hibernate 최신)·Postgres MCP(있으면 쿼리 실행 위임)·
     docker(Testcontainers)·psql. 없으면 degrade(아래 도구 정확성).
  4. 스택 버전: Java 21 / Spring Boot 3.3 / Hibernate 6 / QueryDSL 5.x(jakarta) /
     PostgreSQL 16 / Flyway. 팀 스택이 다르면 교체.
──────────────────────────────────────────────────────────────── -->

## 핵심 원칙

- **상위 산출물 계승·재발명 금지**(확정 상태일 때만 계승, 미확정은 ⚠️ 보존). 04 ERD의 엔티티·
  연관관계·인덱스, 09의 조회 메서드·DTO 변환 규약을 그대로 인용한다. 엔티티명·컬럼명을 새로
  지어내지 않는다.
- **측정이 먼저, 처방은 나중**: 추측으로 인덱스/fetch join을 박지 않는다. `systematic-debugging`
  으로 "재현→측정→가설→한 번에 한 처방→재측정"을 강제한다. AI의 그럴듯한 처방도 before/after
  실측이라는 관문을 통과해야 채택.
- **N+1은 코드 리뷰가 아니라 쿼리 로그로 잡는다**: `generate_statistics`로 쿼리 횟수를 보이게
  만들고 로그를 읽힌다. 코드만 봐선 안 보인다.
- **목록+페이징에 컬렉션 fetch join은 함정**: `setMaxResults`+컬렉션 fetch join은 전체를 메모리에
  올린다(`HHH000104`). 목록 화면엔 batch size·DTO Projection 우선, fetch join은 단건/소량 연관에만.
- **인덱스는 공짜가 아니다**: 읽기를 빠르게 하되 쓰기를 느리게 하고 공간을 쓴다. before/after
  EXPLAIN으로 Index Scan 전환·시간 단축을 확인한 뒤에만 Flyway로 못 박는다.
- **처방의 채택 권한은 사람**: 실행계획 해석은 AI, "이 트래픽에 이 처방이 맞는가"는 사람.

## 입력

- **필수**: `<루트>/09_API개발`(09-1 컨트롤러DTO초안·09-3 명세대조표 — 어떤 조회 메서드가 어떤
  데이터를 읽는지의 출처) + `<루트>/04_데이터베이스`(04-1 ERD·04-2 schema.sql·04-3 JPA엔티티초안·
  04-5 인덱스제약점검 — 최적화 대상 스키마·기존 인덱스). 둘 다 없으면 **중단**(위치 질의).
- **권장**: 실제 실행 쿼리 로그(`generate_statistics`/SQL DEBUG 출력)·`EXPLAIN (ANALYZE, BUFFERS)`
  출력. 사용자가 붙여주면 진단 정밀도가 오른다. 없으면 Testcontainers 통합 테스트로 직접 계측 시도
  (docker 가용 시), 불가하면 진단 골격만 만들고 "실측 필요 ⚠️" 표기.
- 04·09 중 하나라도 미확정(⚠️/[확인 필요])이면 그 플래그를 진단에 보존한다.

## 출력 위치: `backend-output/<주제-슬러그>/10_쿼리최적화/`

<!-- 변경 포인트(출력 경로): 기본은 현재 작업 폴더의 backend-output/<주제-슬러그>/10_쿼리최적화/.
     본인 설치본은 볼트 BE/실행산출물 경로 고정 가능. -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `10-1_N+1진단.md` | 대상 쿼리별 실행 쿼리 횟수·총 시간(before), N+1 발생 지점·원인 연관관계(04 연관 인용), LAZY 유발 지점, 측정 방법(generate_statistics 설정) | Stage 1·2 |
| `10-2_실행계획·인덱스개선.md` | EXPLAIN (ANALYZE, BUFFERS) 해석(Seq Scan·정렬 비용·예상/실제 행수 괴리), 복합 인덱스 후보(컬럼 순서 근거)+손해 경고(쓰기 빈번·낮은 카디널리티), `V__add_*_index.sql`(Flyway 초안·게이트 채택분만), before/after 표 | Stage 4a(before)·4b(after) |
| `10-3_QueryDSL초안.md` | 처방 후보 비교표(fetch join/@EntityGraph/@BatchSize·default_batch_fetch_size/DTO Projection), 추천 처방 동적 쿼리 초안, no-offset(커서) 페이징 QueryDSL 초안+정렬키 인덱스 후보 | Stage 3·5 |
| `_검증체크리스트.md` | 사람 확인 항목(처방 채택 전 게이트) | 마지막 |

- 출력 폴더가 없으면 생성. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`).
- 관통 예시: 포밋 **시터 검색**(`CareService` 검색 목록) + **예약 목록 조회**(`Booking`+`SitterProfile`·`Pet` 페이징).
  - 도메인이 다르면 **04·09의 실제 조회 메서드로 대치**(엔티티명 발명 금지). 예: 펫사료구독은 시터/예약이 없으므로
    "회원별 **구독 목록**(상태 필터·N+1)" + "**결제 목록** 페이징(no-offset)"으로 매핑(04-5의 도메인 대치 패턴 계승).

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- `<루트>/09_API개발`·`<루트>/04_데이터베이스`를 읽는다(없으면 중단, 위치 질의). 04 ERD에서
  최적화 대상 쿼리의 연관관계(예: `CareService`→`SitterProfile`→`Member`)·기존 인덱스를 파악.
- 사용자가 붙여준 실행 쿼리 로그/EXPLAIN 출력이 있으면 우선 사용. 없으면 docker probe →
  Testcontainers 계측 가능 여부 판단.
- **도구 probe**: Context7(ToolSearch 존재) / Postgres MCP(존재 시 쿼리 실행 대화 위임) / docker
  CLI(Testcontainers) / psql. 부재 시 degrade(아래 도구 정확성).
- 진단 대상 쿼리 목록을 정리(09 조회 메서드 기준). 04·09 미확정 플래그 보존.

### Stage 1 — 느린 현상 재현·계측 (추측 금지)
- `systematic-debugging` 규율로 **측정부터**. 추측 인덱스/fetch join 금지.
- docker 가용 시: 대상 Repository 메서드를 Testcontainers(PostgreSQL 16)로 호출하는 통합 테스트
  골격 + 더미 데이터 적재(예: `CareService` 1000건+연관) 안내. `generate_statistics` 로그로 "실제
  나간 쿼리 횟수·총 ms"를 캡처. **H2 금지**(옵티마이저·인덱스 거동이 운영과 달라 검증 무효).
- docker 부재/로그 미제공 시: 측정 절차(`application-local.yml` 로깅 설정·테스트 골격)를 제시하고
  "로컬에서 실행해 로그를 붙여달라" 안내 + "실측 필요 ⚠️".
- 결과(쿼리 N건·총 ms)를 표로 `10-1`에 before로 기록. **아직 원인 단정/수정 금지.**

### Stage 2 — N+1 탐지·원인 식별
- Stage 1 캡처(또는 사용자 제공) 쿼리 로그를 읽어 N+1 발생 여부·원인 연관관계를 지목.
- 어느 연관(04 ERD 인용: 예 `CareService`→`SitterProfile`)의 LAZY 지점이 추가 쿼리를 유발하는지
  확정. **원인 한 가지만 확정**, 수정 코드는 아직 제안하지 않는다. → `10-1` 완성.

### Stage 3 — 처방 후보 비교·제시
- N+1 처방 후보 비교표(각 후보: 적용 코드 초안 + 장단점 + 이 목록+페이징 시나리오 적합성):
  A. fetch join(JPQL/QueryDSL) — 페이징 동시 사용 제약 명시
  B. `@EntityGraph`
  C. `@BatchSize`/`default_batch_fetch_size`(IN 절 배치 로딩)
  D. 조회 전용 DTO Projection(필요 컬럼만 select)
- **컬렉션 fetch join + 페이징 = 메모리 페이징 위험** 경고 포함. 목록+페이징엔 batch size·DTO
  Projection을 우선 추천하되, **선택은 게이트에서 사람이**. → `10-3`에 비교표 기록.

### Stage 4a — EXPLAIN ANALYZE 해석·인덱스 후보 (게이트 전 · before만)
> 게이트가 ③(인덱스 반영 여부)을 결정하려면 **근거 EXPLAIN이 게이트 시점에 이미 있어야** 한다.
> 그래서 EXPLAIN 해석과 인덱스 후보 제시(before)는 게이트 **앞**에서 한다. **after 재측정·Flyway 작성은
> 게이트 통과 후 Stage 4b.** (이 분리가 "게이트 통과 전 Stage 4·5 금지" 규칙과 게이트 ③ 근거 요구 사이의 순환을 푼다.)
- `EXPLAIN (ANALYZE, BUFFERS)` 출력을 해석: Seq Scan 발생 테이블·비용, 예상/실제 행수 괴리(통계
  부정확 신호), 정렬(Sort) 비용·원인 ORDER BY. (해석은 분석이므로 항상 `10-2`에 기록.)
- WHERE/ORDER BY/조인 컬럼 조합에 맞는 복합 인덱스 후보(**컬럼 순서 근거**) 제시 + **손해 경고**
  (쓰기 빈번·낮은 카디널리티면 인덱스가 손해). **여기선 before EXPLAIN·후보·근거까지만** `10-2`에 기록.
  Flyway는 아직 만들지 않는다(채택은 게이트). 후보가 기존 UNIQUE/복합 인덱스 선두 prefix로 이미
  커버되면 "중복·불필요"로 표기(예: `payment(subscription_id)`가 `(subscription_id,cycle_no)` UNIQUE로 커버).

### 🚦 게이트 — 측정 결과 검토 + 처방 채택 결정 (AskUserQuestion, 필수)
- **측정이 먼저, 처방은 나중**. before 측정(쿼리 횟수·시간)·처방 후보 비교표·Stage 4a 인덱스 후보(before
  EXPLAIN·손해 경고)를 사람에게 제시하고, **어느 처방을 채택할지·어느 인덱스를 추진할지**를 사람이 확정한다.
- 제시 항목: ① 진단된 N+1 원인이 타당한가 ② 후보 A~D 중 이 트래픽(읽기:쓰기 비율·목록 패턴)에
  맞는 처방 ③ Stage 4a 인덱스 후보 중 **어느 것을 Stage 4b에서 after EXPLAIN 검증·Flyway 반영까지 추진**할지.
- **게이트 통과 전에는 Stage 4b·5로 넘어가지 않는다.** AI 추천은 일반론이며, 추측 인덱스·다중 처방
  동시 적용은 차단한다(한 번에 한 가지만).

### Stage 4b — 인덱스 적용·after 재측정·Flyway (게이트 통과 후)
- **게이트 ③에서 추진 채택한 인덱스만** 실제 생성 후 같은 `EXPLAIN (ANALYZE, BUFFERS)`를 다시 떠
  before/after를 비교(스캔 방식 Seq→Index 전환·시간 단축 확인). 미채택·중복 후보는 후보·근거만 남기고 Flyway 미생성.
- before/after 표(스캔 방식·cost·Buffers·시간) → `10-2`. **before/after로 개선 확인 전엔 확정하지 않는다.**
  확인된 후보만 `V__add_<table>_search_index.sql`(Flyway) 초안 작성.

### Stage 5 — 페이징 최적화 (no-offset, 필요 시)
- OFFSET 페이징이 깊은 페이지에서 느려지는 쿼리(예: 예약 목록)를 no-offset(커서) QueryDSL 초안으로
  전환. 정렬 키 `(createdAt DESC, id DESC)` 복합(tie-break용 id), 마지막 본 `(createdAt, id)`를
  커서로 받아 그 다음부터, `size+1` 조회 후 잘라 `hasNext` 판단. 커서 정렬키 복합 인덱스 후보 동반.
- 기존 OFFSET 대비 깊은 페이지 비용 차이를 주석으로. **충분히 큰 데이터에서 측정해야 효과 확인**
  (더미 100건으론 안 느림) 명시. → `10-3`.

### Stage N+1 — 마무리: before/after 실측 + 검증체크리스트
- 채택한 처방 적용 후 **Stage 1과 동일한 측정**을 다시 돌려 쿼리 횟수(N+1→1~2건)·총 시간·EXPLAIN
  스캔 방식 개선을 before/after 표로 확인한 뒤에만 완료로 본다. 숫자가 안 좋아졌으면 되돌리고 가설
  부터 다시(`systematic-debugging` 규율).
- `_검증체크리스트.md`(아래 본문, `<주제>`/`<날짜>` 치환) 생성 + 산출물 폴더 경로 보고.
- 04·09 미확정 또는 실측 미완료(⚠️) 잔존 시 ⚠️ 명시하고 "완료" 단정 금지.

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe) = QueryDSL 5.x(jakarta 전환)·Spring Data JPA·Hibernate 6 최신 확인.
  특히 fetch join+페이징 제약, `@EntityGraph` 문법, `default_batch_fetch_size`는 학습 시점과 자주
  다름. 부재 시 내장 지식 + "버전 확인 필요 ⚠️".
- **Postgres MCP**(probe, 옵션) = 연결돼 있으면 EXPLAIN/쿼리 실행을 대화로 위임. 없으면 사용자가
  psql/DBeaver로 실행해 출력을 붙이는 방식.
- **docker CLI**(probe) = Testcontainers(실제 PostgreSQL 16) 계측. 없으면 측정 절차만 안내 +
  "로컬 실행 후 로그 붙여달라"(H2 대체 금지 — 실행계획이 운영과 다름).
- **psql/python3** = bash 가용 시 보조. 부재 시 수동 안내.
- **중단**은 필수 입력(04·09) 부재 시에만. 그 외는 degrade.

## _검증체크리스트 본문 (마지막 생성)
```markdown
# 검증 체크리스트 — <주제> DB 연동·쿼리 최적화 (작성일: <날짜>)

> 측정이 먼저, 처방은 나중. AI 처방은 before/after 실측을 통과해야 채택된다.

- [ ] before 측정(쿼리 횟수·총 시간)이 실제 실행 로그로 캡처됐다 (추측 아님)
- [ ] N+1 원인 연관관계가 04 ERD의 실제 연관과 일치 (지어낸 엔티티 아님)
- [ ] 처방은 한 번에 한 가지만 적용·재측정했다 (다중 처방 동시 적용 금지)
- [ ] 목록+페이징에 컬렉션 fetch join을 쓰지 않았다 (HHH000104 메모리 페이징 회피)
- [ ] AI 제안 인덱스를 실측 없이 운영에 넣지 않았다 — before/after EXPLAIN로 Index Scan 전환·시간 단축 확인 후에만 Flyway 반영
- [ ] 인덱스 손해(쓰기 빈번·낮은 카디널리티) 경고를 검토했다
- [ ] no-offset 전환 효과를 충분히 큰 데이터에서 측정했다 (더미 100건 아님)
- [ ] 검증은 Testcontainers 실제 PostgreSQL 16에서 했다 (H2 아님)
- [ ] generate_statistics·SQL TRACE 로깅이 로컬 프로파일에만 켜져 있다 (운영 방치 금지)
- [ ] 로딩 전략이 09 DTO 변환 규약과 정합 — 트랜잭션 밖 LAZY 접근(LazyInitializationException) 없음
- [ ] 04·09 미확정(⚠️) 항목과 처방의 의존 관계를 보존했다
```

## 주의
- **AI가 제안한 인덱스를 실측 없이 운영에 넣지 말 것.** 그럴듯한 복합 인덱스가 옵티마이저에 안
  쓰이거나 쓰기를 무겁게 할 수 있다 — EXPLAIN before/after 확인 후 Flyway 반영.
- **fetch join + 페이징의 메모리 페이징 함정**: 컬렉션 fetch join에 `setMaxResults`면 전체를 메모리에
  올린다. 목록 화면엔 batch size·DTO Projection, fetch join은 단건/소량 연관에만.
- **H2로 검증하면 운영과 실행 계획이 다르다** — Testcontainers 실제 PostgreSQL 16에서 검증.
- **트랜잭션 경계와 LAZY 충돌**: 10의 로딩 전략은 09의 DTO 변환 규약과 함께 가야 한다
  (`LazyInitializationException` 방지).
- **흔한 실수 — 한 번에 여러 처방 동시 적용**: 빨라져도 무엇 덕분인지, 느려져도 원인을 못 짚는다.
  한 번에 한 가지만 바꾸고 재측정.
- **흔한 실수 — 통계 로깅을 운영에 방치**: `generate_statistics`·SQL TRACE는 진단용. 운영 방치 시
  로그 폭증·성능 저하. 로컬 프로파일에만 켠다.

## 원본 가이드
- 이 스킬은 BE 가이드 **"10. DB 연동·쿼리 최적화"**를 자동화한 것입니다.

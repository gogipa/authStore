# be-query-optimization — DB 연동·쿼리 최적화 자동화 스킬

04 DB설계·09 API개발을 넣으면 JPA/QueryDSL 쿼리의 N+1을 진단하고, EXPLAIN ANALYZE 실행계획을
해석하고, 인덱스·no-offset 페이징 처방을 **측정 기반으로** 제시하는 Claude Code 스킬입니다.

> BE 프로세스 10단계 "DB 연동·쿼리 최적화"를 자동화합니다.
> 역할 분담: AI는 쿼리 생성·실행계획 해석·처방 후보 제시, **처방 선택·실측 검증은 사람**.
> 이 단계의 문제는 "코드는 멀쩡한데 느린 것" — 핵심은 코드 생성이 아니라 측정으로 원인 찾기.

## 무엇을 만들어 주나

`backend-output/<주제>/10_쿼리최적화/`에 생성:

| 파일 | 내용 |
|---|---|
| `10-1_N+1진단.md` | 대상 쿼리별 실행 쿼리 횟수·총 시간(before), N+1 발생 지점·원인 연관관계(04 인용), LAZY 유발 지점, 측정 방법 |
| `10-2_실행계획·인덱스개선.md` | EXPLAIN ANALYZE 해석(Seq Scan·정렬 비용·행수 괴리), 복합 인덱스 후보(순서 근거)+손해 경고, Flyway 인덱스 초안, before/after 표 |
| `10-3_QueryDSL초안.md` | 처방 후보 비교표(fetch join/@EntityGraph/@BatchSize/DTO Projection), 동적 쿼리 초안, no-offset 커서 페이징 초안 |
| `_검증체크리스트.md` | 처방 채택 전 사람이 확인할 항목 |

## 준비물 (입력)

1. **필수 — 09 API개발** `backend-output/<주제>/09_API개발/`(09-1 컨트롤러DTO초안·09-3 명세대조표).
   어떤 조회 메서드가 어떤 데이터를 읽는지의 출처.
2. **필수 — 04 데이터베이스** `backend-output/<주제>/04_데이터베이스/`(04-1 ERD·04-2 schema.sql·
   04-3 JPA엔티티초안·04-5 인덱스제약점검). 최적화 대상 스키마·기존 인덱스·연관관계의 출처.
3. **(권장) 실측 자료** — `generate_statistics`/SQL DEBUG 실행 쿼리 로그, `EXPLAIN (ANALYZE, BUFFERS)`
   출력. 붙여주면 진단 정밀도가 오릅니다. 없으면 측정 절차를 안내하거나(docker 있으면) Testcontainers
   계측을 시도합니다.

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| 04·09 산출물 | 필수 | 중단(위치 질의) |
| Context7 MCP | 선택 | 내장 지식 진행 + "버전 확인 필요 ⚠️"(QueryDSL/Hibernate 최신 미확인) |
| docker (Testcontainers) | 선택 | 측정 절차만 안내, "로컬 실행 후 로그 붙여달라"(H2 대체 금지) |
| Postgres MCP | 선택 | psql/DBeaver로 EXPLAIN 직접 실행해 출력 붙이기 |

## 설치

```bash
mkdir -p ~/.claude/skills/be-query-optimization
cp SKILL.md ~/.claude/skills/be-query-optimization/SKILL.md
```

## 사용법

04·09 산출물을 준비한 뒤:

```
시터 검색 목록이 느린데 N+1 진단하고 쿼리 최적화해줘
```

1. 측정 먼저 — before 쿼리 횟수·총 시간 캡처(추측 금지) → N+1 원인 식별
2. 처방 후보 비교표(fetch join/@EntityGraph/batch size/DTO Projection) + EXPLAIN 해석·인덱스 후보(before·근거) 제시
3. **🚦 게이트 — 측정 결과 검토 + 처방 채택 결정** → 당신이 채택할 처방·추진할 인덱스 확정(근거 EXPLAIN을 게이트에서 같이 봄)
4. 채택분만 인덱스 적용·after 재측정(Flyway 초안) → no-offset 페이징 전환
5. before/after 실측으로 마감 — 안 좋아졌으면 되돌리고 가설부터 다시

발동 키워드: `쿼리 최적화`, `N+1`, `JPA 최적화`, `QueryDSL`, `실행계획`, `EXPLAIN`, `인덱스`,
`fetch join`, `페이징 최적화`, `슬로우 쿼리`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `backend-output/`를 원하는 경로(볼트 BE/실행산출물 등)로 |
| 계승 출처 | `## 입력` | 04·09 상위 산출물 경로를 본인 폴더 구조로 |
| 도구(MCP/CLI) | `## 도구 정확성` | Context7·Postgres MCP·docker 가용 여부에 맞게 |
| 스택 버전 | 변경 포인트 주석 | Java21/SpringBoot3.3/Hibernate6/QueryDSL5.x(jakarta)/PG16을 팀 스택으로 |
| 트리거 키워드 | frontmatter `description` | 자기 표현으로 |

## 주의

- **AI 제안 인덱스를 실측 없이 운영에 넣지 마세요.** before/after EXPLAIN으로 Index Scan 전환·시간
  단축을 확인한 뒤에만 Flyway로 반영합니다.
- **목록+페이징에 컬렉션 fetch join은 함정**(메모리 페이징, HHH000104). batch size·DTO Projection
  우선, fetch join은 단건/소량 연관에만.
- **H2로 검증하면 운영과 실행 계획이 다릅니다** — Testcontainers 실제 PostgreSQL 16에서 검증.
- **한 번에 한 처방만** 적용·재측정. 여러 개를 동시에 바꾸면 원인을 못 짚습니다.
- **통계 로깅(`generate_statistics`·SQL TRACE)은 진단용** — 운영 방치 금지, 로컬 프로파일에만.
- 로딩 전략은 09 DTO 변환 규약과 함께 가야 합니다(`LazyInitializationException` 방지).

## 원본 가이드

이 스킬은 BE 가이드 **"10. DB 연동·쿼리 최적화"**를 자동화한 것입니다.

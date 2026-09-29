# be-database-design — 데이터베이스 설계 (ERD·스키마) 자동화 스킬

01 도메인 분석과 03 모듈 경계를 넣으면 ERD(Mermaid) → PostgreSQL 16 DDL → JPA 엔티티 초안 →
정규화/인덱스/제약 점검 → Flyway 마이그레이션을 **한 원본에서 정합하게** 파생하는 Claude Code 스킬입니다.
사람은 **스키마·정규화·인덱스·삭제 정책 확정 1번**만 개입합니다.

> BE 프로세스 4단계 "04. 데이터베이스 설계 (ERD·스키마)"를 자동화합니다.
> 역할 분담: AI는 도메인 모델→ERD→DDL→엔티티의 규칙 있는 변환, **트레이드오프(정규화·인덱스·삭제 정책)는 사람**.

## 무엇을 만들어 주나

`backend-output/<주제>/04_데이터베이스/`에 생성:

| 파일 | 내용 |
|---|---|
| `04-1_ERD.md` | Mermaid `erDiagram` (엔티티·속성·타입·PK/FK·카디널리티, 핵심 상태 enum) |
| `04-2_schema.sql` | PostgreSQL 16 DDL (PK/FK·UNIQUE·NOT NULL·CHECK, enum=varchar+CHECK) |
| `04-3_JPA엔티티초안.md` | `@Entity`·LAZY 연관관계·`@Enumerated(STRING)`·BaseEntity 초안 |
| `04-4_V1__init.sql` | Flyway V1(테이블·제약) + V2(인덱스) 마이그레이션 초안 |
| `04-5_인덱스제약점검.md` | 정규화 점검·반정규화 제안·인덱스 후보(근거)·FK ON DELETE·UNIQUE/CHECK |
| `_검증체크리스트.md` | 사람이 확인할 항목(로컬 PG 적용 포함) |

## 준비물 (입력)

1. **(필수) 01 도메인 분석** — `backend-output/<주제>/01_요구사항분석/01-1_도메인분석.md`. 엔티티/애그리거트·바운디드 컨텍스트·유스케이스. 없으면 중단(엔티티 정본 위치를 물음).
2. **(연결) 03 모듈 경계** — `03_아키텍처/`. 스키마 분할·엔티티 배치 기준. 없으면 단일 모듈 가정 + ⚠️ 표기.
3. **(연결) 01-2 비기능요구** — 트랜잭션·동시성 가정. 인덱스/제약 판단 근거로 활용.

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| Context7 MCP | 선택 | JPA/Hibernate 6·Flyway 내장 지식으로 진행 + "버전 확인 필요 ⚠️" |
| Figma MCP (`generate_diagram`) | 선택 | Mermaid `erDiagram`만 생성(ERD 공유본 스킵) |
| docker / psql | 선택 | SQL은 생성, "로컬 PG에 직접 적용 필요" 안내(검증 degrade) |

## 설치

```bash
mkdir -p ~/.claude/skills/be-database-design
cp SKILL.md ~/.claude/skills/be-database-design/SKILL.md
```

## 사용법

01 도메인 분석을 준비한 뒤:

```
포밋 도메인 모델로 DB 설계해줘 (ERD·스키마)
```

1. 도메인 모델 → ERD → DDL·JPA 엔티티 → 정규화·인덱스·제약 점검 자동 생성
2. **🚦 스키마·정규화·인덱스·삭제 정책 확정** → 당신이 OK (유일한 개입)
3. 확정안으로 Flyway V1/V2 마이그레이션 초안 → 로컬 PG 적용 명령 안내
4. 마지막으로 **로컬 PostgreSQL 16에 직접 적용**해 통과 확인(스킬이 안내)

발동 키워드: `DB 설계`, `데이터베이스 설계`, `ERD`, `스키마`, `DDL`, `정규화`, `마이그레이션`, `Flyway`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `backend-output/<주제>/`를 본인 볼트 경로로 |
| 계승 출처 | `## 입력` | 01·03 산출물 경로를 본인 폴더 구조로 |
| 도구(MCP/CLI) | `## 도구 정확성` | Context7·Figma·docker/psql 가용에 맞게 |
| 스택 버전 | 변경 포인트 주석 | PostgreSQL 16/Java 21/Spring Boot 3.3/Flyway가 다르면 타입·매핑·네이밍 교체 |
| enum 전략 | `### Stage 2` | 팀이 PG enum 타입을 쓰면 전 테이블 통일 |

## 주의

- **AI는 인덱스를 과하게 권합니다.** 핵심 조회 경로에만 깔고, 나머지는 운영 중 느린 쿼리 보고 추가.
- **정규화 vs 반정규화는 도메인 판단.** Booking 스냅샷 같은 의도적 반정규화는 분쟁 방지·이력 보존에 옳을 수 있습니다.
- **금액=numeric / 시각=timestamptz 강제.** float·timestamp는 정밀도·타임존 사고.
- **FK ON DELETE는 도메인으로 검증.** 결제 완료 Booking의 Pet을 CASCADE로 지우면 이력 증발 — 대부분 soft delete.
- **로컬 적용 생략 금지.** AI 생성 DDL은 PG 문법·제약 충돌을 놓칩니다 — 첫 마이그레이션은 반드시 로컬 PG에 올려 통과 확인.

## 원본 가이드

이 스킬은 BE 가이드 **"04. 데이터베이스 설계 (ERD·스키마)"**를 자동화한 것입니다.

# fe-api-integration — API 연동 자동화 스킬

BE 05 OpenAPI 명세를 넣으면 타입·클라이언트 생성 → query/mutation 훅 골격 → 로딩/에러/빈 상태 4분기 → 낙관적 업데이트·재시도 정책 초안을 만드는 Claude Code 스킬입니다. 사람은 **API 계약 대조 + 캐시 전략(staleTime·무효화·낙관적 적용 여부) 확정**에 개입합니다.

> FE 프로세스 10단계 "API 연동"을 자동화합니다.
> 역할 분담: AI는 계약→타입 생성·훅 보일러플레이트·상태 분기·에러 매핑 초안, **캐시 전략·낙관적 적용 판단은 사람**.

## 무엇을 만들어 주나

`frontend-output/<주제>/10_API연동/`에 생성:

| 파일 | 내용 |
|---|---|
| `10-1_타입생성.md` | openapi-typescript `gen:api` 스크립트 + openapi-fetch 타입드 클라이언트(schema.d.ts "수정 금지" 명시) |
| `10-2_query훅초안.md` | queryKey 팩토리(all/list/detail) + query/mutation 훅 골격 + staleTime 제안 |
| `10-3_로딩에러빈상태.md` | 화면별 4분기(loading/error/empty/success) 연결 + errorMessage 매핑 표 |
| `10-4_낙관적업데이트.md` | onMutate/onError/onSettled 롤백 + 무효화 표 + 낙관적 적용/금지 기준 표 + 메서드별 retry |
| `_검증체크리스트.md` | 사람이 확인할 항목 |

## 준비물 (입력)

1. **(필수) BE 05 OpenAPI** — `backend-output/<주제>/05_API/05-2_openapi.yaml` 또는 프로젝트 루트 `./openapi.yaml`(BE에서 받은 명세). **타입의 출처(SSOT)** — 없으면 중단합니다.
2. **(권장) FE 09 상태관리** — `09_상태관리/09-1_상태분류표.md`·`09-2_query키설계.md`. queryKey 컨벤션·서버/클라 경계를 계승. 없으면 본 단계에서 제안 + ⚠️.
3. **(권장) FE 08 상태화면** — `08_화면구현/08-2_상태화면커버리지.md`. 어떤 스켈레톤/에러/빈 컴포넌트에 연결할지. 없으면 컴포넌트명 플레이스홀더.

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| BE OpenAPI 명세 | 필수 | 중단 (타입의 출처) |
| Context7 MCP | 선택 | 내장 지식 + "v5 마이그레이션 대조 필요 ⚠️" |
| openapi-typescript / openapi-fetch | 선택 | 스크립트는 생성, "로컬에서 `pnpm gen:api` 실행" 안내 |
| pnpm / node | 선택 | typecheck 스킵, "로컬 실행 필요" 안내 |

## 설치

```bash
mkdir -p ~/.claude/skills/fe-api-integration
cp SKILL.md ~/.claude/skills/fe-api-integration/SKILL.md
```

## 사용법

BE OpenAPI 명세를 준비한 뒤:

```
BE OpenAPI 명세로 시터 검색·예약 API 연동해줘
```

1. 타입·클라이언트 생성(10-1) + queryKey 팩토리·훅 골격(10-2) 자동
2. **🚦 게이트 — API 계약 대조 + 캐시 전략 확정** → 당신이 OK/수정 (사람 개입 지점)
3. 로딩/에러/빈 4분기(10-3) + 낙관적 업데이트·재시도(10-4) 자동
4. `pnpm typecheck` + 검증 체크리스트

도메인별(시터·예약·결제)로 끊어 진행합니다 — "모든 API 한 번에"는 금지(캐시 전략 판단을 AI에 떠넘김).

발동 키워드: `API 연동`, `데이터 페칭`, `openapi-typescript`, `TanStack Query 훅`, `낙관적 업데이트`, `캐시 무효화`, `에러 매핑`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `frontend-output/`를 볼트 경로 등으로 |
| 계승 출처 | `## 입력` | BE 명세·09 산출물 경로를 본인 폴더 구조로 |
| 명세를 URL로 받을 때 | `### Stage 1` | `gen:api` 입력을 `/openapi.json` URL로 |
| 도구 (Context7/openapi-typescript) | `## 도구 정확성` | 미사용 시 degrade 단락 참고 |
| 스택 버전 | frontmatter 주석 | TanStack Query v5 고정 — v4 혼용 금지 |

## 주의

- **schema.d.ts는 직접 수정 금지** — BE 명세에서 재생성되는 파일. 타입을 바꾸려면 BE 명세 수정(=BE 협의).
- **TanStack Query v4/v5 혼용 주의** — AI가 v4 패턴(`isLoading` 단독·query `onSuccess`·`cacheTime`)을 섞습니다. v5는 `isPending`/`gcTime`. Context7로 확인.
- **낙관적 업데이트 롤백은 직접 테스트** — 네트워크 끊기/500 주입으로 `onError` 롤백 확인. 행복한 경로만 보면 거짓 상태가 남습니다.
- **낙관적 적용 여부·캐시 무효화 범위는 사람 판단** — 결제 생성=낙관적 금지. AI 초안을 그대로 확정하지 마세요.
- **raw fetch 잔존 금지** — 데이터 접근은 openapi-fetch 클라이언트로 단일화.
- **토큰 저장은 12 소관** — 이 단계는 Authorization 주입 지점만 남깁니다.

## 원본 가이드

이 스킬은 FE 가이드 **"10. API 연동"**을 자동화한 것입니다.

# fe-forms-validation — 폼·유효성 검증 자동화 스킬

10단계 API 연동(BE 05 OpenAPI 계약 타입·뮤테이션 훅)을 넣으면 **Zod 스키마(SSOT) → 클라↔BE 정합 점검
→ RHF 폼 골격 → 에러 메시지 UX → 422 서버 에러 어댑터**를 생성하는 Claude Code 스킬입니다. AI는 스키마·연결
코드의 초안과 정합 점검을, 사람은 **에러 문안과 "어디까지 클라에서 막고 어디부터 서버에 맡길지"라는 신뢰 경계**를 맡습니다.

> FE 프로세스 11단계 "폼·유효성 검증"을 자동화합니다.
> 스택 정본: React 19 / Next 15 / TS strict / React Hook Form + Zod + @hookform/resolvers.

## 무엇을 만들어 주나

`frontend-output/<주제>/11_폼/`에 생성:

| 파일 | 내용 |
|---|---|
| `11-1_zod스키마.md` | 폼별 Zod 스키마(필드명·enum 계약 1:1, 제약 1:1, `z.infer` 타입) + 클라↔BE 정합 점검표 |
| `11-2_RHF폼초안.md` | `zodResolver` 연결 폼 골격(onBlur·07 공통 필드 재사용·10 뮤테이션 훅·접근성) |
| `11-3_에러메시지UX.md` | 메시지 후보 표(2안·노출 타이밍) + `applyServerErrors` 422→폼 필드 어댑터 |
| `_검증체크리스트.md` | 사람이 확인할 항목 |

## 준비물 (입력)

1. **(필수) 10 API 연동 산출물** — `10_API연동/`의 `api.d.ts`(계약 타입)·뮤테이션 훅.
2. **(필수) BE 05 openapi.yaml** — 검증 제약(required/maxLength/pattern/enum)과 422 응답 스키마의 출처.
3. **(권장) 07 공통 컴포넌트** — `07_공통컴포넌트/`의 폼 필드(TextField/Select/FormError) 재사용 대상.
4. **(권장) BE 06 정책** — 명세에 없는 제약을 사람이 확정할 근거.

10 산출물·BE 검증 제약 중 하나라도 없으면 스킬이 위치를 묻고 중단합니다.

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| 10 API 연동 + BE 05 openapi.yaml | 필수 | 중단(검증 규칙 출처 없음) |
| Context7 MCP | 선택 | 내장 지식 + "버전 확인 필요 ⚠️"(RHF·Zod API는 버전차 큼) |
| frontend-design 스킬 | 선택 | 접근성 속성 직접 기술 + 토큰 수기 적용 안내 |

## 설치

```bash
mkdir -p ~/.claude/skills/fe-forms-validation
cp SKILL.md ~/.claude/skills/fe-forms-validation/SKILL.md
```

## 사용법

10단계 산출물과 BE 05 openapi.yaml을 준비한 뒤:

```
Pet 등록 폼이랑 회원가입 후 프로필 폼 검증 만들어줘
```

1. OpenAPI 제약 → **Zod 스키마 초안** 생성 (필드명·enum 계약 1:1, 미명시는 `// 확인필요`)
2. **클라↔BE 정합 점검표** 출력 (서버는 막는데 클라는 통과 등 불일치 검출)
3. 🚦 **검증 규칙 BE 동기화 확정** → 당신이 OK/수정 (유일한 필수 개입)
4. **RHF 폼 골격**(zodResolver·07 공통 필드·10 뮤테이션 훅·접근성) 생성
5. **에러 메시지 후보 표** → 사람이 문구 확정 → 스키마 주입
6. **422 서버 에러 어댑터**(`applyServerErrors`) + 검증 체크리스트

발동 키워드: `폼 검증`, `유효성 검증`, `React Hook Form`, `Zod 스키마`, `zodResolver`, `서버 에러 매핑`, `forms`, `form validation`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `frontend-output/`를 볼트 경로(FE/실행산출물/<주제>) 등으로 |
| 계승 출처(10·BE 05·07 경로) | `## 입력` 변경 포인트 주석 | 본인 폴더 구조에 맞게 |
| 메시지 톤 가이드 | `### Stage 4` | 제품 톤(존댓말/길이/금칙어)에 맞게 |
| 422 응답 스키마 형태 | `### Stage 5` | BE 05 실제 에러 응답 구조(`errors[].field/code/message`)로 |
| Zod 버전(v3/v4) | frontmatter `metadata` 주석·Stage 1 | 팀이 쓰는 버전·메시지 API로 |
| 트리거 키워드 | frontmatter `description` | 자기 표현으로 |

## 주의

- **클라 검증은 신뢰 경계가 아닙니다.** Zod 통과 = 안전이 아닙니다(우회 가능). 중복·권한·재고는 BE가 422로 막고, FE는 그걸 폼에 되돌립니다.
- **AI는 명세에 없는 제약을 지어냅니다.** "비밀번호 8자 이상" 류. `// 확인필요` 주석을 BE 정책·담당자에게 확인한 뒤에만 확정하세요.
- **enum·필드명 재작명 사고.** `species`→`petType`, `DOG`→`Dog`. Stage 2 정합 점검에서 계약과 대조해 잡습니다.
- **에러 메시지 방치 금지.** AI 기본값("Required"/"Invalid")을 그대로 배포하지 말고 사용자 언어로 교체(Stage 4).
- **한 방 프롬프트 금지.** 스키마·폼·메시지·서버 매핑을 한 번에 시키면 검토가 어렵습니다 — Stage를 끊어 스키마부터.
- 필드 UI 컴포넌트는 07 공통 컴포넌트를 재사용합니다(새 인풋 신설·디자인 토큰 정의는 이 단계 범위 밖).

## 원본 가이드

이 스킬은 FE 가이드 **"11. 폼·유효성 검증"**을 자동화한 것입니다.

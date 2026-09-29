---
name: fe-forms-validation
description: >-
  10단계 API 연동(BE 05 OpenAPI 계약 타입·뮤테이션 훅)을 받아 폼·유효성 검증을
  구현한다. OpenAPI 제약→Zod 스키마 초안 → 클라↔BE 정합 점검 → RHF 폼 골격
  (zodResolver·접근성) → 에러 메시지 문안(사람 확정) → 422 서버 에러를 폼 필드로
  되돌리는 어댑터. 스키마 하나가 타입·검증·메시지의 SSOT. "폼 검증", "유효성 검증",
  "React Hook Form", "RHF", "Zod 스키마", "zodResolver", "서버 에러 매핑", "에러 메시지",
  "폼", "forms", "form validation", "zod", "react hook form" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# 폼·유효성 검증 (Forms & Validation)

회원가입·펫 등록·예약 요청·리뷰 작성처럼 사용자가 값을 입력하는 화면의 **폼과 유효성 검증**을 구현한다.
산출물 = Zod 스키마(SSOT) → RHF 폼 골격 → 에러 메시지 UX → 서버 에러 매핑 어댑터. **AI는 스키마·연결
코드의 초안과 정합 점검(회수율), 에러 문안과 "어디까지 클라에서 막고 어디부터 서버에 맡길지"라는 신뢰
경계·UX 판단은 사람.** 스택은 React Hook Form + Zod + `@hookform/resolvers`(정본).

<!-- 변경 포인트 (배포본 → 본인 환경에 맞게 수정):
  1. 출력 경로: 기본 frontend-output/<주제-슬러그>/11_폼/. 볼트 설치본은 FE/실행산출물/<주제>로 고정 가능.
  2. 계승 출처: 10_API연동(api.d.ts·뮤테이션 훅), BE 05 openapi.yaml(검증 제약·422 응답 스키마), 07_공통컴포넌트(폼 필드)의 경로를 본인 폴더 구조로 수정.
  3. 도구(MCP/CLI): Context7(react-hook-form·zod·@hookform/resolvers 최신) / frontend-design(필드 시각·접근성) — 없으면 degrade.
  4. 스택 버전: React 19 / Next 15 / TS strict / RHF v7 / Zod v3 또는 v4 / @hookform/resolvers. 메시지 API는 Zod 버전 차이가 크므로 Context7로 확인.
-->

## 핵심 원칙

- **상위 산출물 계승, 재발명 금지 — 단 확정 상태일 때만.**
  - **10_API연동 `api.d.ts`·BE 05 openapi.yaml = 검증 규칙의 출처.** Zod 스키마의 필드명·enum 값은
    계약을 **그대로** 따른다(임의 재작명 금지 — 예: `species`를 `petType`으로, `DOG`를 `Dog`로 바꾸지 않는다.
    Booking 상태는 `REQUESTED|ACCEPTED|IN_PROGRESS|COMPLETED|CANCELED` 그대로).
  - **검증 흐름은 단방향**: OpenAPI 제약(required/maxLength/pattern/minimum/format/enum) → Zod로 1:1 반영.
    양쪽을 따로 정의하면 반드시 어긋난다. 클라는 출처가 아니라 따라가는 쪽.
  - **명세에 없는 제약은 추측 금지** — "비밀번호 8자 이상" 같은 그럴듯한 규칙을 명세에 없어도 넣지 않는다.
    미명시 필드는 `// 확인필요: BE 제약 미명시` 주석으로 분리(BE 06 정책·BE 담당자 확인 후에만 확정).
- **클라 검증은 신뢰 경계가 아니다.** Zod 통과 = 안전이 아니다. 형식·필수·길이처럼 즉시 판단 가능한 것은
  클라가 막아 왕복을 줄이고(UX), 중복·권한·재고처럼 서버만 아는 것은 422로 받아 폼에 되돌린다(신뢰).
  이 경계를 코드 구조(스키마 vs `applyServerErrors`)로 못 박는다.
- **스키마를 단일 소스(SSOT)로 둔다.** Zod 스키마 하나에서 입력 타입(`z.infer`)·런타임 검증·에러 메시지가
  모두 파생된다. "스키마부터, 폼은 그다음" 순서를 강제한다.
- **에러 문안은 AI 초안 + 사람 확정으로 나눈다.** 규칙 추출은 기계적이라 AI가 잘하지만, "사용자에게 뭐라고
  말할까"는 제품 톤의 문제. 후보만 받고 스키마 주입은 사람이 한다.
- **단계별 산출물로 끊는다**: 스키마(Stage 1) → 정합 점검(Stage 2) → 폼(Stage 3) → 메시지(Stage 4) →
  서버 매핑(Stage 5). 한 방 프롬프트("이 화면 폼 만들어줘") 금지 — 명세에 없는 규칙과 임시 메시지가 섞인다.
- **디자인 시리즈 중복 금지**: 필드 UI 컴포넌트(TextField/Select/FormError)는 07_공통컴포넌트의 것을
  재사용한다. 새 인풋을 만들지 말고 검증 연결만 이 단계에서 얹는다.

## 입력

- **필수**: `<루트>/10_API연동/`(10-1 `api.d.ts`·10-2 뮤테이션 훅) **+ BE 05 `openapi.yaml`**(검증 제약·422 응답 스키마).
  <!-- 변경 포인트(입력 경로): 본인 설치본은 <루트>=FE/실행산출물/<주제>. 상위 산출물이 다른 폴더면 수정 -->
- **권장**:
  - `07_공통컴포넌트/`(폼 필드 컴포넌트 — TextField/Select/FormError 재사용 대상)
  - BE 06 정책(또는 10이 계승한 검증 규칙 출처) — 명세 미명시 제약을 사람이 확정할 근거
- **둘 중 하나라도(10 산출물·BE 검증 제약) 없으면 중단**(또는 위치 질의). 그 외 보조 입력은 degrade.

> 클라 검증은 신뢰 경계가 아니다. 보안·중복·권한 검증의 최종 판단은 BE이며, FE의 Zod는 UX(즉시 피드백)와
> 페이로드 형태 보장이 목적이다. 이 전제를 잊으면 "클라에서 막았으니 안전하다"는 착각이 생긴다.

## 출력 위치: `frontend-output/<주제-슬러그>/11_폼/`

<!-- 변경 포인트(출력 경로): 기본은 현재 작업 폴더의 frontend-output/<주제-슬러그>/11_폼/.
     볼트 설치본은 FE/실행산출물/<주제>로 고정 가능. 모든 FE 스킬이 같은 <루트>를 공유한다. -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `11-1_zod스키마.md` | 폼별 Zod 스키마(필드명·enum 계약 1:1, 제약 1:1 반영, `z.infer` 타입 export). 메시지는 비우고 `// TODO`, 미명시는 `// 확인필요`. **+ 클라↔BE 정합 점검표**(필드·OpenAPI 제약·Zod 규칙·일치/불일치·비고) | Stage 1~2 |
| `11-2_RHF폼초안.md` | `zodResolver` 연결 폼 골격(`mode: 'onBlur'`). 07 공통 필드 재사용, 10 뮤테이션 훅 호출, 접근성(label·`aria-invalid`·`aria-describedby`·포커스), `isSubmitting` disabled. 서버 매핑 자리 `// TODO` | Stage 3 |
| `11-3_에러메시지UX.md` | 필드·규칙·메시지 후보(2안)·노출 타이밍(onBlur/onSubmit) 표(사람 확정 전제) + `applyServerErrors(form, error)` 어댑터(422 `field→message` 매핑, 비매칭 전역 alert 분리, code→우리 문안 매핑 자리) | Stage 4~5 |
| `_검증체크리스트.md` | 사람 확인 항목 | Stage 5 |

- 출력 폴더가 없으면 생성. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`).

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- `<루트>/10_API연동/`(api.d.ts·뮤테이션 훅)과 **BE 05 openapi.yaml**을 읽는다. **둘 중 하나라도 없으면 중단**(위치 질의).
- `07_공통컴포넌트/`의 폼 필드(TextField/Select/FormError)·BE 06 정책을 로드(있으면). 07 부재 시 Stage 3에서 ⚠️("07 미완 — 임시 인풋, 07 완료 후 교체").
- **도구 probe**: Context7(ToolSearch 존재) / frontend-design(스킬 가용). 없으면 degrade(아래 "도구 정확성").
- 폼 대상 화면(가입 후 프로필·Pet 등록·Booking 요청·Review 작성 등)을 확인한다.

### Stage 1 — OpenAPI 제약 → Zod 스키마 초안 → 11-1
- Context7로 zod 최신 메시지 API(v3/v4 차이)를 확인한 뒤, `api.d.ts`·openapi.yaml의 대상 스키마(예: `PetCreateRequest`,
  `MemberProfileUpdateRequest`)를 읽어 Zod 스키마를 작성. 권장 배치 = `src/features/<도메인>/schema.ts`.
- 규칙:
  - **필드명·enum 값은 계약 1:1**(재작명 금지). 예: `Pet.species`는 명세 enum(`DOG|CAT|ETC`)을 `z.enum`으로.
  - OpenAPI 제약을 1:1 반영: `required`/`nullable`, `maxLength`/`minLength`, `pattern`, `minimum`/`maximum`, `format`(email 등).
  - `.min()`/`.max()` 등의 **message 인자는 비워두고 `// TODO: 메시지`** 주석만(메시지는 Stage 4).
  - `z.infer`로 폼 입력 타입 export(예: `export type PetCreateInput = z.infer<typeof petCreateSchema>`).
  - **명세 미명시 필드는 추측 금지 — `// 확인필요: BE 제약 미명시`** 주석.
- → `11-1_zod스키마.md`

### Stage 2 — 클라 스키마 ↔ BE 명세 정합 점검 → 11-1에 추가
- 스키마를 손으로 다듬기 전에, 명세와의 불일치를 먼저 뽑는다. **자동 수정 금지 — 제안만.**
- 표: `필드 | OpenAPI 제약 | Zod 규칙 | 일치/불일치 | 비고`. 점검 항목:
  - 클라에만 있거나 서버에만 있는 필드.
  - 제약이 더 느슨(서버는 막는데 클라는 통과)하거나 더 빡빡한 경우.
  - **enum 값 집합·필드명이 다른 경우**(재작명 사고 검출).
- 불일치는 **"서버 기준이 정본"** 원칙으로 어느 쪽을 고칠지 제안. 계약(`api.d.ts`)을 정본으로 고친다.

### 🚦 게이트 — 검증 규칙 BE 동기화 확정 (사람 개입, 필수)
AskUserQuestion으로 11-1(스키마 + 정합 점검표)을 제시 → 사용자가 OK/수정. 핵심 결정 항목:
- **명세 미명시 제약(`// 확인필요`) 처리** — BE 06 정책·BE 담당자에게 확인한 규칙만 확정(추측 확정 금지).
- **정합 불일치 항목의 수정 방향** — 서버 기준 정본 원칙으로 클라/서버 어느 쪽을 고칠지.
- **클라/서버 검증 경계** — 어느 규칙까지 Zod로 즉시 막고, 어느 것(중복·권한 등)을 422로 받을지.
- **표(11-1)를 사람이 확정하기 전에는 Stage 3(폼)로 넘어가지 않는다**(한 방 생성 방지 — 중간 판단을 검토해야 한다).

### Stage 3 — RHF 폼 컴포넌트 골격 → 11-2
- Context7로 react-hook-form + `@hookform/resolvers` 최신 사용법(`zodResolver` 옵션, `Controller` vs `register`)을 확인한 뒤 생성.
- 골격 규칙:
  - `useForm<PetCreateInput>({ resolver: zodResolver(petCreateSchema), mode: 'onBlur' })`.
  - **입력 UI는 07_공통컴포넌트(TextField/Select/FormError)를 재사용 — 새 인풋 만들지 말 것.**
  - 제출은 **10단계 뮤테이션 훅**(예: `useCreatePet`)을 호출(낙관적 업데이트 정책은 10단계 그대로).
  - 접근성: 각 필드 `label` 연결(`htmlFor`/`id`), 에러 시 `aria-invalid`·`aria-describedby`로 메시지 연결, 첫 에러 필드 포커스 이동.
  - `isSubmitting` 동안 제출 버튼 `disabled` + 로딩 표시.
  - **서버 에러 매핑은 Stage 5 자리만 `// TODO`** 주석으로 비워둔다.
- → `11-2_RHF폼초안.md`

### Stage 4 — 에러 메시지 문안 후보 → 11-3 (사람 확정 전제)
- 정책·필드 의미를 주고 한국어 메시지 후보를 표로 받는다. **스키마 자동 주입 금지 — 표만.**
- 톤 가이드: 짧게(20자 내외), 무엇이 틀렸고 어떻게 고치는지 행동 지시("8자 이상 입력해 주세요"). 비난조 금지
  ("잘못된 값입니다" X), 사용자 언어(영문 필드명 노출 X). 빈 값/형식 오류/길이 초과를 구분.
- 표: `필드 | 규칙 | 메시지 후보(2안) | 노출 타이밍(onBlur/onSubmit)`.
- 검토 후 **사람이 고른 문구만** Stage 1 스키마의 `message` 인자에 채워 SSOT 완성. → `11-3_에러메시지UX.md`(표 부분)

### Stage 5 — 서버 에러(422) → 폼 필드 어댑터 → 11-3 + 검증 체크리스트
- **BE 05의 검증 실패 응답 스키마를 그대로 읽어 그 포맷에 맞춰** `applyServerErrors(form, error)` 어댑터 작성(권장 배치 `src/lib/form/applyServerErrors.ts`).
  배열 키·항목 필드명·`code` 위치·status 코드는 **BE 명세가 진실** — 아래는 흔한 두 형태일 뿐 추측 적용 금지(실제 BE 05의 `ErrorResponse`를 대조해 맞춘다):
    - 형태 A: `{ errors: [{ field, code, message }] }`
    - 형태 B(스프링/`@RestControllerAdvice` 흔함): `{ code, message, status, fieldErrors: [{ field, reason }] }`
  - 응답의 **필드별 항목 배열**(`errors`/`fieldErrors` 등)을 순회해, `field`가 폼 필드명과 일치하면 `form.setError(field, { type: 'server', message })`(메시지 소스는 항목의 `message`/`reason` 중 BE가 주는 키).
  - 매칭 필드 없는 에러(전역/네트워크)는 폼 상단 alert 영역용으로 따로 반환.
  - 11-2 폼의 mutation `onError`에서 이 어댑터를 호출하도록 연결(Stage 3의 `// TODO` 자리).
  - **서버 message를 그대로 노출하되, `code` 기반 우리 문안 우선 적용 매핑 테이블 자리(`// TODO`)** 남김
    (BE 원문 에러를 그대로 보여주면 영문·기술 용어·내부 코드 노출 위험).
    **이 code→문안 매핑이 10단계 산출물에 이미 있으면**(예: 10-3 `errorMessage.ts`의 `toUserMessage`) **재사용**하고 폼 단계에서 중복 정의하지 않는다(SSOT 1소스).
- → `11-3_에러메시지UX.md`(어댑터 부분)
- **(선택) 검증 케이스 목록**: 스키마 기반 경계/빈값/형식 오류 입력 케이스를 목록화해 15단계 테스트 입력으로 재사용 가능하게 남긴다.
- `_검증체크리스트.md` 생성(`<주제>`/`<날짜>` 치환, 아래 본문).
- 마지막으로 산출물 폴더 경로와 **"Zod 스키마가 SSOT — 메시지 확정·정합 검토는 사람, 클라 검증은 신뢰 경계 아님"** 고지를 보고한다.

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe) = react-hook-form·zod·`@hookform/resolvers` 최신 API 조회(2-step: resolve-library-id → query-docs).
  `zodResolver` 옵션·RHF `Controller` vs `register`·Zod v3/v4 메시지 API는 마이너 버전 차가 크니 기억 의존 금지.
  부재 시 **내장 지식 + "버전 확인 필요 ⚠️"** 표기.
- **frontend-design 스킬**(probe) = 입력 필드·에러 상태·헬퍼 텍스트의 시각·접근성 구현(label 연결·`aria-invalid`·`aria-describedby`·포커스)을
  디자인 토큰에 맞춰 짤 때 사용. 부재 시 접근성 속성을 골격에 직접 기술 + "디자인 토큰 수기 적용 필요" 안내.
- **중단**은 필수 입력(10 산출물·BE 검증 제약) 부재 시에만. 그 외는 degrade.

## _검증체크리스트 본문 (Stage 5 생성)
```markdown
# 검증 체크리스트 — <주제> 폼·유효성 검증 (작성일: <날짜>)

> AI는 스키마·연결 코드 초안과 정합 점검까지. 에러 문안·신뢰 경계는 사람의 판단이다.

- [ ] 11-1 스키마(정합 점검표 포함)를 사람이 확정한 뒤 폼으로 넘어갔는가 (한 방 생성 금지)
- [ ] 필드명·enum 값이 api.d.ts·openapi.yaml 계약과 1:1 (재작명 0건 — species/DOG 등 대조)
- [ ] 명세 미명시 제약(`// 확인필요`)을 BE 06 정책·BE 담당자에게 확인한 뒤에만 확정 (AI 추측 규칙 차단)
- [ ] 정합 점검: "서버는 막는데 클라는 통과" 항목을 서버 기준으로 해소
- [ ] 에러 메시지를 AI 기본값("Required"/"Invalid")이 아닌 사용자 언어 문안으로 교체 (Stage 4 미스킵)
- [ ] 검증 타이밍(onBlur/onSubmit)을 필드 성격에 맞게 사람이 정함 (onChange 즉시검증 깜빡임 회피)
- [ ] 폼 필드 UI가 07 공통 컴포넌트 재사용 (새 인풋 미신설)
- [ ] 접근성: label 연결·aria-invalid·aria-describedby·첫 에러 포커스 이동 포함
- [ ] applyServerErrors가 mutation onError에 연결 + 비매칭 전역 에러 alert 분리 + code→우리 문안 매핑 자리 존재
- [ ] 서버 원문 메시지를 그대로 노출하지 않음 (영문·기술 용어·내부 코드 노출 점검)
```

## 주의
- **클라 검증을 보안으로 착각하지 않는다.** Zod 통과 = 안전이 아니다(스크립트 직접 호출 우회 가능). 신뢰 판단은 BE.
- **AI는 명세에 없는 제약을 지어낸다.** "비밀번호 8자 이상" 류. Stage 1에서 "미명시는 추측 금지·확인필요 주석"을 강제하고 정책·BE 확인 규칙만 확정.
- **enum·필드명 재작명 사고.** `species`→`petType`, `DOG`→`Dog` 같은 변경을 Stage 2 정합 점검에서 enum 집합·필드명 대조로 검출, 계약을 정본으로 고친다.
- **검증 타이밍이 UX를 망친다.** 모든 필드를 `onChange` 즉시 검증하면 빨간 에러가 깜빡인다. 보통 `onBlur`(또는 제출 후 onChange 전환)가 무난 — 필드 성격에 따라 사람이.
- **서버 메시지를 그대로 노출하는 위험.** BE 원문(영문·기술 용어·내부 코드)을 그대로 보이면 UX·보안 모두 나쁘다 — code→우리 문안 매핑 자리를 둔 이유.
- **흔한 실수 — 한 방 프롬프트·메시지 방치**: "이 화면 폼 만들어줘"로 스키마·폼·메시지·서버 매핑을 한 번에 시키면 명세 없는 규칙·AI 기본 메시지("Required"/"Invalid")가 섞여 배포된다. Stage를 끊어 스키마부터 확정하고 Stage 4에서 사용자 언어 문안으로 교체.

## 원본 가이드
- 이 스킬은 FE 가이드 **"11. 폼·유효성 검증"**을 자동화한 것입니다.

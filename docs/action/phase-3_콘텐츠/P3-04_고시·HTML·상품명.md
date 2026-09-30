# P3-04. ⑥-3 고시 매핑·구매대행 고지·원산지 코드·상세 HTML·상품명

| 항목 | 내용 |
|---|---|
| Phase | Phase 3 · 콘텐츠 (4/5) |
| 선행 작업 | [P3-03](P3-03_카피·사양.md), [P1-09](../phase-1_기반/P1-09_구매대행프로필.md) |
| 모듈 | content |
| 규모 | 기능 23 · API 2 · 테이블 1 · 화면 SCR-06 |
| 상태 | 완료 (2026-10-01) |

> 실행: Claude Code에 `@docs/action/phase-3_콘텐츠/P3-04_고시·HTML·상품명.md 실행해`라고 입력한다. 끝나면 [진행표](../README.md#진행표)에 체크한다.

## 1. 목표

이 문서가 끝나면 ⑥-3 단계가 AI 없이 규칙으로 산출물을 조립한다. 재료는 ⑥-1 카피, ⑥-2 원자료, 후보 성별, ③ 판매 사이즈, 구매대행 프로필이다. 결과는 `SHOES` 고시 필드, 원산지 코드, 상품 사양 블록, 구매대행 고지(조건부·AI 고지 포함), 이미지 자리표시자를 쓴 상세 HTML, 상품명 제안이다. ⑥-2에는 색상 한국어 표기와 소재별 주의 문구 원자료를 더한다. 오너는 SCR-06에서 고시·상품명을 원문 근거와 대조해 고치고, 실제 모습대로 렌더링한 미리보기를 본다. 흐름상 ⑥의 마지막 단계이며, ⑧ 업로드(P4-01)와 사전 검증(P4-02)이 이 산출물을 읽는다.

## 2. 범위

### 2.1 기능 (M1)

| ID | 기능 | 설명 | 유형 | 인수조건 |
|---|---|---|---|---|
| `F-CT-01` | 상세 AI 생성 고지 한 줄 | AI 표시가 켜져 있으면(기본값 켬) 고지에 '대표이미지는 AI를 기반으로 생성된 가상인물이 포함된 이미지입니다.' 한 줄을 넣는다. ②-15 결정에 따라 이 한 줄은 M1에 넣는다. | 시스템 | — |
| `F-CT-02` | 구매대행 고지 자동 삽입 | 설정 파일의 고지 템플릿을 프로필·설정 값으로 채워 상세페이지 첫 블록에 넣는다. 채우는 값은 상호, 배송기간(기본 10~20영업일), 주문당 수량, 반품비, 교환 정책, A/S다. 템플릿 기준일도 함께 표시한다. | 시스템 | US-16 AC1 |
| `F-CT-03` | 가죽·정보 없음 조건부 고지 | 소재에 천연·인조 가죽이 있거나 소재가 '정보 없음'이면 '안전관리대상제품(안전기준준수대상)' 고지 문장을 자동으로 붙인다. | 시스템 | US-16 AC3 |
| `F-CT-04` | 구매대행 고지 미리보기 | 채워진 고지 블록, 기준일, 붙은 조건부 문장을 상세 콘텐츠 화면에서 미리 본다. | 화면 | US-16 AC1 |
| `F-CT-16` | 고시 소재 겉감·안감·밑창 | 고시 `material`을 겉감·안감·밑창으로 나눠 채운다. | 시스템 | — |
| `F-CT-17` | 색상 한국어 표기 | 선택 색상 원문을 색상 사전으로 한국어로 바꾼다. 사전에 없으면 ⑥-2에서 AI가 보조하고, 오너가 확인하거나 고친다. | 시스템 | — |
| `F-CT-18` | 고시 사이즈 mm·cm 병기 | ③의 판매 사이즈로 국내 mm를 먼저 적고 JP cm를 괄호 안에 함께 적는다(예: 250~280mm (JP 25.0~28.0cm)). | 시스템 | — |
| `F-CT-19` | 굽높이 항목 조건부 포함 | 고시 `height`는 굽 재료를 쓰는 여성화에만 넣고, 해당하지 않으면 항목 자체를 뺀다. | 시스템 | US-15 AC3 |
| `F-CT-20` | 제조자·수입자 표기 | `manufacturer`를 '제조자: 브랜드/제조사 / 수입자: 오너 입력' 형식으로 만든다. 수입자는 기본값 없이 비워 두고 오너가 입력한다. | 시스템 | — |
| `F-CT-21` | 소재별 주의 문구 | 고시 `caution`을 소재별 주의 문구 템플릿으로 만들고, ⑥-2에서 AI가 보완한다. | 시스템 | — |
| `F-CT-22` | 고시 고정 문구 채우기 | `warrantyPolicy`('소비자분쟁해결기준에 따름'), `afterServiceDirector`(프로필의 상호·연락처), 반품·보증 관련 5개 항목('상품상세 참조')을 자동으로 채운다. 0/1 입력 형식은 M0 S3에서 확인한다. | 시스템 | — |
| `F-CT-23` | 고시 필드 확인·수정 | 상세 콘텐츠 화면에서 고시 필드를 원문 근거와 대조해 보고 고친다. 고친 값은 필드별 '오너 입력'으로 남는다. | 화면 | — |
| `F-CT-24` | 프로필 비면 ⑥-3 시작 막기 | 프로필의 `importer`·상호·A/S 정보가 비어 있으면 ⑥-3을 시작하지 않고 프로필 입력 링크를 보여 준다. | 시스템 | — |
| `F-CT-25` | 원산지 코드 조회 | 일본어 국가명을 '대륙 > 국가' 사전(예: ベトナム → 아시아 > 베트남)으로 바꾼 뒤, 커머스API 원산지 조회로 수입산 `02` 계열 코드를 받아 캐시한다. | 연동 | — |
| `F-CT-26` | 복수 원산지 코드 처리 | 제조국이 여러 곳이면 M0 S3에서 정한 조합을 쓴다(첫 국가 코드 + 복수 표시, 또는 `03` + 상세 표기). 사양 블록에는 '입고 시기에 따라 다름'을 적는다. | 시스템 | — |
| `F-CT-27` | 원산지 03·04 허용 조건 | `03`(상세설명에 표시)과 `04`(직접 입력)는 오너가 직접 고르고, 사양 블록에 실제 국가 표기가 있을 때만 허용한다. | 시스템 | — |
| `F-CT-28` | 상품 사양 블록 생성 | 원산지 추출과 같은 레코드로 제조국, 소재(겉감/안감/밑창), 굽·밑창 높이(약 n cm), 사이즈(mm와 JP cm) 블록을 만든다. 근거가 없는 소재·높이 행은 빼고, 고시에서 `height`가 빠진 신발이라도 근거가 있으면 밑창 높이를 적는다. | 시스템 | US-15 AC3, US-15 AC4 |
| `F-CT-29` | 상세 HTML 조립 | ⑥-3에서 AI 없이 고지, 카피, 사양 블록을 합쳐 HTML을 만들고, 이미지 자리에는 자리표시자를 둔다. 그래서 썸네일만 다시 골라도 ⑥을 다시 실행할 필요가 없다. | 시스템 | — |
| `F-CT-30` | HTML 위험 요소 제거 | 상세 HTML에서 script·style 같은 차단 태그, `data:` URI, 외부 링크를 뺀다. | 시스템 | — |
| `F-CT-31` | 상세 렌더링 미리보기 | 자리표시자를 지금 선택된 로컬 이미지로 채워, 상세페이지를 실제 모습처럼 렌더링해 보여 준다. | 화면 | — |
| `F-CT-32` | 상품명 자동 생성 | '브랜드 시리즈 모델명 상품유형 대표색상 성별' 템플릿으로 100자 이내 상품명을 제안한다. 라쿠텐 상품이 並行輸入品이면 '병행'을 넣는다. | 시스템 | US-17 AC2 |
| `F-CT-33` | 상품명 금지어·반복 경고 | 상품명에 금지 수식어가 있거나 같은 단어가 반복되면 경고한다. | 시스템 | US-17 AC2 |
| `F-CT-34` | 상품명 확인·수정 | 상품명 입력 칸에서 제안된 이름을 고친다. 100자를 넘으면 경고하고(최종 승인 검사에서는 막힘) 초안 저장은 허용한다. | 화면 | US-17 AC1 |

### 2.2 API ([05-2 openapi.yaml](../../dev/05_API/05-2_openapi.yaml)에서 operationId로 찾는다)

| 메서드 | 경로(`/api/v1` 뒤) | operationId | 요약 |
|---|---|---|---|
| GET | `/candidates/{candidateId}/content-assembly` | `getCandidateContentAssembly` | ⑥-3 고시·사양 블록·구매대행 고지·상품명 조회 |
| GET | `/candidates/{candidateId}/content-assembly/preview` | `getContentAssemblyPreview` | 상세페이지 미리보기(HTML) |

### 2.3 테이블 (ERD v0.4)

| Prisma 모델 | 테이블 |
|---|---|
| `ContentDraftAssembly` | `content_draft_assembly` |

### 2.4 화면

| 화면 | 시안 보드 | 경로 |
|---|---|---|
| SCR-06 ⑥ 상세 콘텐츠 | [Content.dc.html](../../design/screens/Content.dc.html) | `/candidates/:candidateId/content` |

## 3. 읽을 문서

- PRD [03-PRD초안.md](../../prd/03-PRD초안.md): §8.5 ⑥ 상세 콘텐츠·고시정보
- 기능 원문: [04_기능리스트.md](../../prd/04_기능리스트.md) (위 기능 ID로 찾는다), 유저스토리 [03-2](../../prd/03-2_유저스토리.md) (인수조건)
- API: [05-1 엔드포인트 표](../../dev/05_API/05-1_엔드포인트표.md) §2.7 content, [05-3 오류 코드·페이징](../../dev/05_API/05-3_에러코드페이징규약.md)
- ERD: [04-1 ERD](../../dev/04_데이터베이스/04-1_ERD.md) §3.8 content, 스키마 [04-3](../../dev/04_데이터베이스/04-3_schema.prisma)
- 아키텍처: [03-ADR-003](../../dev/03_아키텍처/03-ADR-003_아키텍처.md) · [03-2 C4](../../dev/03_아키텍처/03-2_C4다이어그램.md), 개발 환경 [06](../../dev/06_개발환경/)
- 화면: 위 시안 보드, [화면시안_명세](../../design/spec/화면시안_명세.md), [공통부품_마크업](../../design/spec/공통부품_마크업.md), FE 설계 [04-3 컴포넌트 계층](../../dev/FE/04_디자인토큰컴포넌트/04-3_컴포넌트계층.md) · [05-1 route맵](../../dev/FE/05_라우팅/05-1_route맵.md)

## 4. 핵심 규칙

1. ⑥-3 시작 조건은 ⑥-1 현재 버전, ⑥-2 현재 버전, 후보 성별, ③ 판매 사이즈 집합(판매가는 PR-07을 켤 때만), 프로필·템플릿 설정(`importer` 포함)이다. AI를 쓰지 않으므로 `step_run.ai_*`는 NULL이고 `AI_ENGINE_UNAVAILABLE`로 막지 않는다. G3 선택은 읽지 않는다. (PRD §5.3 ⑥-3 행, 05-1 표 A NOTICE_HTML)
2. 프로필의 `importer`·상호(`business_name`)·A/S 정보가 비어 있으면 시작하지 않는다. 409 `PROFILE_INCOMPLETE`에 `details.missingFields`를 붙이고, 화면은 설정 프로필로 가는 링크를 보인다. (F-CT-24, PRD §5.3 ⑥-3 행, 05-3, ERD `ck_cda_importer`)
3. 구매대행 고지는 설정 템플릿을 프로필·설정 값으로 채워 상세 HTML의 **첫 블록**에 넣고 기준일을 적는다. 채우는 값은 상호, 배송기간(기본 10~20영업일), 주문당 수량, 반품비, 교환 정책, A/S다. 저장은 아래와 같다. 고지 블록은 오너가 고칠 수 없다(`FIELD_NOT_EDITABLE`). (F-CT-02, F-CT-04, US-16 AC1·AC2, PRD §8.5 템플릿, ERD `content_draft_assembly`, ERD §7.2-18, 05-3 `FIELD_NOT_EDITABLE`)
   - 블록 ID 목록 → `disclosure_block_ids`, 블록별 `{block_id, sha256, conditional}` → `disclosure_blocks`
   - 템플릿 버전·기준일 → `disclosure_template_version`·`disclosure_template_date`
4. 조건부 고지 두 가지. (F-CT-03, F-CT-01, US-16 AC3, PRD §8.5 조건부 블록, §16 ②-15, 05-1 §2.6 `ai-disclosure`는 M2)
   - 소재(겉감·안감·밑창)에 천연·인조 가죽이 있거나 소재가 '정보 없음'이면 '안전관리대상제품(안전기준준수대상)' 문장을 붙인다. 가죽 판정 단어 목록과 '정보 없음'의 범위(한 칸만 비어도인지, 전부 비었을 때만인지)는 문서에 없음 → 구현 때 Proposed로 정하고 기록
   - AI 표시가 켜져 있으면 '대표이미지는 AI를 기반으로 생성된 가상인물이 포함된 이미지입니다.' 한 줄을 붙인다. M1은 설정 기본값(켬)이고 끄는 API는 없다
5. `SHOES` 고시 매핑. 0/1 입력 형식은 M0 S3에서 정한다. (F-CT-16~F-CT-22, US-15 AC3, PRD §8.5 `SHOES` 매핑, 시안 Content.dc.html)
   - `material`: 겉감 / 안감 / 밑창. 근거 없는 칸은 '정보 없음'
   - `color`: ⑥-2 색상 한국어 표기
   - `size`: 국내 mm를 먼저, JP cm를 괄호에. 예 `250~280mm (JP 25.0~28.0cm)`. 5mm 간격이 끊기면 `250~265·275mm (JP 25.0~26.5·27.5cm)`(시안)
   - `height`: 굽 재료를 쓰는 여성화만 넣고, 아니면 키 자체를 뺀다(null이 아님). '굽 재료를 쓰는 여성화' 판정 방법은 문서에 없음 → Proposed
   - `manufacturer`: `제조자: {브랜드/제조사} / 수입자: {importer}`
   - `caution`: 소재별 주의 문구 템플릿 + ⑥-2 AI 보완
   - `warrantyPolicy`: '소비자분쟁해결기준에 따름'. `afterServiceDirector`: 프로필 상호·연락처
   - `returnCostReason`, `noRefundReason`, `qualityAssuranceStandard`, `compensationProcedure`, `troubleShootingContents`: '상품상세 참조'
6. 색상 한국어 표기(⑥-2에 더함): 선택 색상 원문 → 색상 사전(설정) → 사전에 없으면 AI 보조 → 오너 확인·수정 순이다. 방법은 `DICTIONARY`·`AI`로 기록한다. 필드 키 이름은 M0 뒤 상수로 정하기로 했으니 Proposed(예: `fact.color_ko`)로 둔다. 주의 문구 AI 보완도 ⑥-2에서 한다. (F-CT-17, F-CT-21, CT-03, 05-2 `putContentFieldInput` x-decision §7.4-34)
7. 원산지 코드: 일본어 나라 이름 → '대륙 > 국가' 사전(설정, 예 `ベトナム` → `아시아 > 베트남`) → `commerce_origin_area` 캐시(P1-08)에서 수입산 `02` 계열 코드를 찾아 `origin_area_code`에 복사한다. 코드·ID를 코드에 박지 않는다. (F-CT-25, PRD §8.5 원산지 코드 규칙, F-BS-48, ERD `commerce_origin_area`)
8. 제조국이 여럿이면 M0 S3에서 정한 조합을 쓴다. 후보는 '첫 국가 코드 + `origin_area_plural=true`'와 '`03` + `origin_area_content`'다. 사양 블록에는 '입고 시기에 따라 다름'을 적는다. S3 전에는 설정 스위치로 두 안을 모두 만들 수 있게 하고 기본값은 Proposed로 둔다. (F-CT-26, PRD §8.5, ERD §7.3-8)
9. 코드 `03`(상세설명에 표시)·`04`(직접 입력)는 오너가 owner-edits로 직접 고를 때만 허용한다. 사양 블록 제조국 표기(`spec_origin_label`)에 실제 나라가 있어야 하고, 없으면 422 `ORIGIN_CODE_NOT_ALLOWED`. 이때 `origin_area_content`가 필수다. (F-CT-27, 05-1 표 B, ERD `ck_cda_origin_detail`)
10. 상품 사양 블록은 ⑥-2와 **같은 레코드**로 만든다. 사양 블록의 원산지·소재는 고시 값과 같아야 한다. 제조국 근거가 없으면 ⑥-2 입력 대기가 먼저 막으므로 ⑥-3은 시작할 수 없다. (F-CT-28, US-15 AC3·AC4, PRD §8.5 상품 사양 블록)
    - 제조국(원산지)
    - 소재 겉감/안감/밑창: 근거 없는 칸은 뺀다
    - 굽·밑창 높이 '약 {n}cm': 근거 없으면 행을 뺀다. 고시 `height`가 빠진 신발이어도 근거가 있으면 적는다
    - 사이즈 mm·JP cm
11. 상세 HTML은 고지 → 이미지 자리표시자 → 카피 → 사양 블록 순으로 AI 없이 조립한다(시안 미리보기 순서). 이미지 자리에는 자리표시자만 둔다. 자리표시자 형식은 문서에 없음 → Proposed(P4-01과 공유). 텍스트는 모두 HTML 이스케이프한다. 그 뒤 script·style 같은 차단 태그, `data:` URI, 외부 링크를 빼고 `html_sha256`을 저장한다. (F-CT-29, F-CT-30, CT-06, ERD `content_draft_assembly.html`·`html_sha256`)
12. 미리보기(`GET …/content-assembly/preview`)는 자리표시자를 현재 G3 선택 로컬 이미지(`/api/v1/image-assets/{id}/file`)로 바꿔 `text/html`로 준다. 헤더 `Content-Security-Policy: sandbox; img-src 'self'`를 건다. 썸네일만 다시 골라도 ⑥-3은 다시 실행하지 않는다. 오류는 JSON으로 준다. (F-CT-31, 05-2 `getContentAssemblyPreview`, PRD §5.3)
13. 상품명 제안은 `{브랜드} {시리즈} {모델명} {상품유형} {대표색상} {성별}` 템플릿, 100자 이내다. 라쿠텐 상품명에 並行輸入品이 있으면 '병행'을 넣는다. 금지 수식어나 같은 단어 반복이 있으면 경고한다. 경고(100자 초과·금지어·반복)는 조회 때 계산해 `productNameWarnings`로 준다. 경고 코드는 05-3에 아직 없음 → Proposed로 정하고 05-3 §5.2에 더한다. (F-CT-32, F-CT-33, US-17 AC2, PRD §8.5 상품명, 05-1 §7.4-33, 05-2 `ProductNameWarning`)
14. 상품명 수정(owner-edits EDIT `product_name`)은 100자를 넘어도 저장하고 경고만 준다. 승인은 RG-08이 막는다. 저장 칸은 최대 255자다. (F-CT-34, US-17 AC1, 05-1 표 B, ERD `product_name varchar(255)`)
15. 고시 필드 수정(owner-edits EDIT `notice.*`)은 필드별 `OWNER_INPUT`으로 남고, 다시 실행해도 지킨다. 다만 `notice.size`·`notice.material`·`notice.origin_area`의 오너 값은 근거가 바뀌면 '재확인 필요'가 붙는다(판매 사이즈 → `SALE_SIZES_CHANGED`, ⑥-2 결과 → `NOTICE_RAW_CHANGED`). 오너가 다시 확인(`recheckConfirmed`)해야 풀린다. (F-CT-23, F-CT-15, US-35 AC4, ERD `ck_cdfield_recheck_target`·`basis_sha256`)

## 5. 만들 것

### 5.1 BE (`apps/BE/src/modules/content`)

| 경로 | 내용 |
|---|---|
| `assembly/notice-html-step.runner.ts` | ⑥-3 실행기(NOTICE_HTML). P1-05 방식(StepRunner 등록)으로 step-engine에 넣는다. 시작 조건(규칙 1)을 내고, 프로필 빈칸 검사(규칙 2)를 시작 전에 한다 |
| `assembly/assembly-owner-edit.handler.ts` | NOTICE_HTML의 EDIT(`notice.*`, `product_name`, 원산지 `03`·`04`)·RESTORE_VERSION 산출물 복사. 고지 블록 키는 거부한다 |
| `assembly/disclosure/disclosure-renderer.ts` · `conditional-blocks.ts` | 템플릿 채우기, 블록 ID·SHA-256, 조건부 문장(규칙 3·4). 블록마다 다시 찾을 수 있는 표식(예 `data-block-id`, Proposed)을 단다 |
| `assembly/notice/shoes-notice.mapper.ts` · `size-format.ts` | 고시 객체와 사이즈 표기(규칙 5) |
| `assembly/notice/origin-code.resolver.ts` | 사전 → `commerce_origin_area` 조회, 여러 나라 처리, `03`·`04` 검사(규칙 7~9). 캐시 조회는 integrations를 거친다 |
| `assembly/spec-block.renderer.ts` | 상품 사양 블록과 `spec_origin_label`(규칙 10) |
| `assembly/html/detail-html.builder.ts` · `html-sanitizer.ts` · `image-placeholder.ts` | 조립·위험 요소 제거·자리표시자 상수(규칙 11). `image-placeholder.ts`는 P4-01이 import해 쓸 수 있게 export한다 |
| `assembly/product-name/product-name.builder.ts` · `product-name.warnings.ts` | 상품명 제안과 경고(규칙 13·14) |
| `assembly/content-assembly.controller.ts` · `.service.ts` | `GET /candidates/{candidateId}/content-assembly`(`previewUrl`, `productNameWarnings`, `fields`), `GET …/content-assembly/preview`(text/html + CSP) |
| `facts/color-ko.resolver.ts` · `facts/caution.supplement.ts` | P3-03 ⑥-2 실행기에 색상 한국어 표기와 주의 문구 AI 보완을 더한다(규칙 6). P3-03의 AI 추출 호출과 한 번에 묶는다 |
| `common/errors/error-codes.ts` | 아직 없는 것만 05-3 문구 그대로: `PROFILE_INCOMPLETE`, `ORIGIN_CODE_NOT_ALLOWED` 등 |

- 프로필은 settings 모듈 서비스(P1-09)로 읽는다(C4 §3: 단계 모듈 → settings 허용).
- 설정(P1-03 스키마, 키 이름 Proposed): 고지 템플릿(블록·버전·기준일), 배송기간(10~20), 교환 정책 문구, AI 표시(기본 켬), 가죽 판정 단어, 색상 사전, 소재별 주의 문구, 나라 사전(P3-03과 공유), 상품명 금지 수식어, 여러 원산지 방식. 필수 고지 블록은 앱 내장 해시와 비교한다(P1-03 F-BS-05).
- HTML 정리 라이브러리를 더하면 정확한 버전으로 고정한다(README 공통 규칙).

### 5.2 FE (`apps/FE/src`)

| 경로 | 내용 |
|---|---|
| `features/content/api/` | `useContentAssemblyQuery`. 미리보기는 fetch하지 않고 iframe `src`로 연다 |
| `pages/content/AssemblySection.tsx` | '⑥-3 고시·HTML' 구획: 버전 줄('AI 없이 규칙으로 만듦'), '프로필 확인됨: 상호·수입자·A/S' + '프로필 보기'(빈칸이면 Banner blocked + `/settings` 링크), 상품명 TextField(`33/100`)·'템플릿 제안' Chip·경고 글, 템플릿 설명, 상품 사양 블록, 고시 표 + '필드 고치기', 구매대행 고지 미리보기('고칠 수 없음', '템플릿과 일치', 기준일, '붙은 문장') |
| `pages/content/DetailPreview.tsx` | `<iframe sandbox>`로 미리보기 경로를 연다(`allow-scripts` 없음). '크게 보기' |
| `pages/content/FactTable.tsx`(P3-03) | 색상 표기 행과 '고치기'를 더한다 |

- SSE `step-run.status-changed`(NOTICE_HTML)·`content-field.recheck-flagged`·`gate.passed`(G3) → content-assembly 쿼리와 미리보기 iframe을 다시 읽는다.

### 5.3 fixtures (`apps/BE/test/fixtures/content/assembly/`)

- `profile-complete.json`, `profile-missing-importer.json`.
- `origin-areas.json`: `commerce_origin_area` 행. 실제 코드는 P1-08 동기화 결과를 따르므로 테스트용 값이라고 파일에 적는다.
- `sale-sizes-gapped.json`(`[250,255,260,265,275]`), `sale-sizes-contiguous.json`(`[250…280]`).
- `facts-leather.json`(겉감 합성가죽), `facts-textile-no-lining.json`, `facts-multi-origin.json`, `copy.json`, `rakuten-item-parallel.json`(상품명에 並行輸入品).
- `disclosure-template.json`, `expected/detail.html`(조립 결과 스냅샷).

### 5.4 문서 갱신

- 자리표시자 형식, 블록 해시 정의(무엇을 어떻게 정규화해 해시하는지), 가죽 판정 단어, '정보 없음' 범위, 여러 원산지 기본안, '병행' 위치, 브랜드·시리즈 한국어 출처, 상품명 경고 코드를 05-1 §7.4·05-3 §5.2·ERD §7에 Proposed로 적고 '오너 검토'에 올린다.

## 6. 테스트

테스트 공통: ESM Jest라 가짜는 `overrideProvider`로 넣는다. e2e는 `autostore_test`, 정리는 `TRUNCATE … RESTART IDENTITY CASCADE`. 커머스API는 부르지 않고 `commerce_origin_area`는 fixture로 채운다.

**단위**

| 대상 | 확인할 것 |
|---|---|
| `size-format` | `[250,255,260,265,275]` → `250~265·275mm (JP 25.0~26.5·27.5cm)`. `[250…280]` → `250~280mm (JP 25.0~28.0cm)`. `[255]` → `255mm (JP 25.5cm)` |
| `shoes-notice.mapper` | 남성 운동화 → 결과 객체에 `height` 키가 없다. 여성 굽 신발 + 근거 → `height`가 있다. `manufacturer`에 importer가 들어간다. 고정 문구 5개가 '상품상세 참조'다 |
| 조건부 고지 | 겉감 '합성가죽' → 안전관리 문장 있음. 소재가 전부 '정보 없음' → 있음. 섬유만 → 없음. AI 표시 켬 → AI 한 줄 있음 |
| `disclosure-renderer` | 고지가 HTML 첫 블록이다. 같은 입력이면 같은 해시다. 상호가 바뀌면 해시가 바뀐다. 상호·반품비·주문당 수량이 채워진다 |
| `origin-code.resolver` | `ベトナム` → `아시아 > 베트남` → fixture 코드. 여러 나라 → 설정한 방식(`plural` 또는 `03` + 상세). 사양 블록에 나라 표기 없이 `03` → `ORIGIN_CODE_NOT_ALLOWED` |
| `html-sanitizer` | `<script>`, `<style>`, `<img src="data:…">`, `<a href="https://…">`, `onerror=` 가 모두 빠진다. 카피에 든 `<b>`는 이스케이프된다 |
| `product-name.builder` | 화면시안 명세 §4 입력 → `아식스 젤카야노14 1201A019-108 러닝화 크림 남성`(33자). 並行輸入品 → '병행' 포함. 101자 → 100자 경고. 금지 수식어(예 '무료배송') → 경고. 같은 단어 두 번 → 경고 |

**e2e**

- importer 빈 프로필로 ⑥-3 실행 → 409 `PROFILE_INCOMPLETE`, `details.missingFields`에 `importer`.
- 정상 실행 → 202 → `COMPLETED`, `step_run.ai_engine=null`. `GET content-assembly` 200에 `productName`, `noticeFields.size`, `originAreaCode`가 있고 `disclosureBlockIds`에 필수 + 조건부 블록이 있다.
- 사양 블록 원산지·소재 = 고시 원산지·소재(US-15 AC4).
- `GET …/preview` → 200 `text/html`, 헤더 `Content-Security-Policy: sandbox; img-src 'self'`, 본문에 `/api/v1/image-assets/{대표 id}/file`. G3을 다시 고른 뒤 미리보기에 새 id가 나오고 ⑥-3 `step_run` 행 수는 그대로다.
- 오너 수정: `product_name` 120자 → 201 + 경고. `notice.origin_area=03`(사양 블록에 나라 없음) → 422 `ORIGIN_CODE_NOT_ALLOWED`. 고지 블록 키 → 422 `FIELD_NOT_EDITABLE`.
- 재확인: 오너가 `notice.size`를 고친 뒤 판매 사이즈가 다른 ③ 새 버전 → ⑥-3 다시 실행 → `SALE_SIZES_CHANGED`. 판매 사이즈가 같은 ③ 새 버전 → ⑥-3은 `COMPLETED` 그대로(PRD §5.3 규칙 4).
- DB: 닫힌 ⑥-3의 `content_draft_assembly` UPDATE가 트리거로 거부된다.

**FE**

- `AssemblySection`: 카운터 `33/100`. 100자를 넘으면 경고가 보이지만 저장은 켜져 있다. `PROFILE_INCOMPLETE`이면 `/settings`로 가는 링크가 보인다. '문구 검사'(M2)가 없다.
- `DetailPreview`: iframe에 `sandbox`가 있고 `allow-scripts`가 없다.

## 7. 완료 조건

- [ ] 2.1의 기능이 모두 동작하고, 인수조건이 있는 것은 인수조건을 만족한다
- [ ] 2.2의 API가 05-2 명세와 같다(경로·요청·응답·상태 코드·오류 코드). 명세와 다르게 해야 하면 명세를 먼저 고치고 이유를 적는다
- [ ] 4의 규칙마다 테스트가 있다(외부 연동은 fixture·가짜 서버로)
- [ ] 화면이 시안 보드와 같은 구성·문구다. 라이트 테마, 토큰 변수만 쓰고, 런타임 외부 호출이 없다
- [ ] 저장소 루트에서 `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build`가 통과한다
- [ ] DB 스키마를 바꿨다면 `docs/dev/04_데이터베이스` 원본을 먼저 고치고 새 마이그레이션을 만든 뒤 `pnpm --filter @autostore/be db:check-sync`가 통과한다
- [ ] 정한 것·바꾼 것을 해당 설계 문서에 적고, [진행표](../README.md#진행표)에 체크한다

## 8. 주의

- 공통 규칙은 [README §공통 규칙](../README.md#공통-규칙)을 따른다(실행 환경, 외부 호출 금지, 비밀정보, 커밋 안 함).

- 자리표시자 형식과 고지 블록 해시 정의는 다른 문서가 기대는 계약이다. P4-01은 자리표시자를 업로드 URL로 바꾸고, P4-02(F-AP-15)는 최종 `detailContent`에서 블록을 다시 해시해 앱 내장 템플릿 해시와 비교한다. 상수·함수 한 곳에 두고 문서에 먼저 적는다.
- 필수 고지 블록은 설정으로 빼거나 고칠 수 없다(F-BS-05). 렌더러는 설정 글을 그대로 믿지 말고 내장 해시와 맞는지 확인한다. 법률 검토(E-3·E-9) 전 초안이므로 문구는 코드에 박지 말고 기준일이 붙은 설정 템플릿으로 둔다.
- `height`는 '값 null'이 아니라 '키 없음'이어야 한다. RG-08 필수 항목 검사와 등록 요청 본문이 이 차이를 탄다.
- 상품명 템플릿이 읽는 ② 값(브랜드·시리즈·모델명·상품유형·並行輸入品)이 PRD §5.3 ⑥-3 시작 조건에 없다. 브랜드·시리즈의 한국어 출처도 없다(브랜드 사전은 M2). 읽는다면 입력 지문에 넣고 출처를 Proposed로 정한다(ERD §7.1-10과 같은 문제).
- 프로필(`importer` 등)은 시작 조건이다. 프로필을 바꾸면 ⑥-3이 '재실행 필요'가 되어야 한다. `content_draft_assembly.importer`는 그때의 사본이다.
- `content_draft_assembly`·`content_draft_field`는 `trg_output_frozen` 대상이다. 완료 뒤 고치기는 모두 새 버전(owner-edits)이다.
- 미리보기는 GET이라 Host 검사만 받는다. iframe `sandbox`와 CSP 헤더로 스크립트 실행과 외부 이미지 로드를 막는다. HTML 정리를 건너뛴 채 미리보기에서만 막으면 안 된다.
- ⑥-2에 색상·주의 문구를 더하면 ⑥-2 산출물이 바뀐다. P3-03 테스트가 계속 통과하는지 함께 돌린다.

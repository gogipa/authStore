# R04. 네이버 커머스API로 신발 해외구매대행 상품 등록하기

- 작성일: 2026-09-24
- 대상 문서 버전: 커머스API 문서 **2.89.0 (2026-09-15)**. `apicenter.commerce.naver.com/docs` 기준이며, 문서 번들에 들어 있는 OpenAPI 스펙을 풀어 필드 단위로 대조했다.
- 원천 요청: `docs/prd/원천자료/01_사용자요청_2026-09-24.md`의 "스마트 스토어에 내 승인하에 등록", "다른사람이 올려놓은 manutag를 찾아서 삽입", "원산지, 소재, 굽높이 정리"
- 표기 규칙: [공식]은 커머스API 문서·OpenAPI 스펙, [공식-FAQ]는 커머스API 공식 GitHub 답변과 스마트스토어 고객센터, [2차]는 제3자 블로그·언론이다. **미확인**은 확인하지 못한 내용이다.

---

## 1. 요약

1. 오너가 혼자 쓰는 로컬 앱이면 **'내 스토어 애플리케이션'**(type=`SELF`)으로 충분하다. 인증은 `client_id`와 `timestamp`를 bcrypt로 서명한 뒤 Base64로 인코딩해 `POST /external/v1/oauth2/token`을 호출하는 방식이다. 토큰은 3시간 유효하고, **API 호출 IP 등록(최대 3개, 2차 출처)과 연 2회 이메일 인증**이 운영상 제약이다.
2. 상품은 `POST /external/v2/products` 한 번으로 원상품과 스마트스토어 채널상품을 함께 만든다. 필수 항목은 `statusType`, `name`, `detailContent`, `images`, `salePrice`, `detailAttribute`(`afterServiceInfo`, `originAreaInfo`, `minorPurchasable`), `leafCategoryId`, `stockQuantity`, `productInfoProvidedNotice`(`SHOES`), `smartstoreChannelProduct`(`naverShoppingRegistration`, `channelProductDisplayStatusType`)다.
3. 등록할 때 `statusType`에는 **SALE만** 넣을 수 있어 '판매대기' 상태로 등록할 수는 없다. 대신 `channelProductDisplayStatusType=SUSPENSION`(전시중지)으로 등록한 뒤 오너가 확인하고 `ON`으로 바꾸는 흐름은 스펙상 가능하다.
4. 해외구매대행은 '구매대행 플래그' 필드 하나로 끝나지 않는다. **해외상품판매 권한, 해외 출고지 주소록(`shippingAddressId`), `customsTaxType`(해외 출고지면 필수), 원산지 수입산 코드와 `importer`, KC 특례 `kcExemptionType=OVERSEAS`**를 조합해 표현한다. 개인통관고유부호는 출고지가 해외이면 주문서에 자동으로 입력란이 붙는다.
5. 이미지는 반드시 `POST /v1/product-images/upload`로 올린 뒤 받은 URL만 쓴다. 한 번에 최대 10개, 합계 10MB 미만이고, 같은 스토어에서는 동시에 1건만 올릴 수 있다. 태그는 `seoInfo.sellerTags[{code?, text}]`에 **최대 10개**까지 넣는다. 금지 태그는 `GET /v2/tags/restricted-tags`로 미리 걸러낸다.

---

## 2. 상세 발견사항

### 2.1 애플리케이션 등록·인증·IP·호출 한도

| # | 항목 | 내용 | 신뢰도 | 출처 |
|---|---|---|---|---|
| A1 | 애플리케이션 유형 | 판매자가 직접 쓰는 **'내 스토어 애플리케이션'**은 스마트스토어 계정 1개와 1:1로 묶인다. 토큰 `type`은 **`SELF`만** 쓸 수 있고 `account_id`는 필요 없다. '솔루션 애플리케이션'(`SELLER` 타입, 1:N)은 커머스솔루션마켓에 입점한 개발사용이라 일반 판매자는 발급받을 수 없다. | high | [공식-FAQ] G3 |
| A2 | 등록 절차 | 커머스API센터에 가입하고 애플리케이션을 등록할 때 사용할 **API 그룹**(상품, 판매자정보 등)을 지정해 권한을 얻는다. 실무 절차는 ① 스마트스토어 **통합매니저** 권한으로 API센터 계정 생성 → ② 애플리케이션 등록(이름·설명·API 그룹) → ③ API 호출 IP 추가 → ④ 애플리케이션 ID와 시크릿 확인 순서다. | high(흐름) / medium(세부 화면) | [공식] S1, S23 · [2차] T3 |
| A3 | API 그룹 권한 | 호출하는 API가 속한 API 그룹 권한이 있어야 한다. 상품 등록에는 '상품' 그룹이 필요하고, 주소록 조회(`/v1/seller/addressbooks-for-page`)에는 '판매자정보' 그룹이 필요하다. | high | [공식] S4, S23 |
| A4 | 토큰 발급 엔드포인트 | `POST https://api.commerce.naver.com/external/v1/oauth2/token`, `Content-Type: application/x-www-form-urlencoded`. 필수 파라미터는 `client_id`, `timestamp`(ms), `grant_type=client_credentials`, `client_secret_sign`, `type`(`SELF`\|`SELLER`)이다. `account_id`는 SELLER일 때만 넣는다. 응답은 `access_token`, `expires_in`, `token_type`이고 호출할 때 `Authorization: Bearer {token}`을 붙인다. | high | [공식] S2, S3 |
| A5 | 전자서명 | `password = client_id + "_" + timestamp`, `hashed = bcrypt.hashpw(password, salt=client_secret)`, `client_secret_sign = Base64(hashed)` 순서로 만든다. 공식 문서에 Java·Python·Node.js·PHP 예제가 있다. | high | [공식] S2 |
| A6 | timestamp 규칙 | 밀리초 단위 13자리여야 하고, 호출 시각 기준 **5분 이내**만 유효하다. 현재 시각보다 미래면 오류가 나므로 NTP 동기화를 권장한다. | high | [공식] S3 · [공식-FAQ] G4 |
| A7 | 토큰 유효시간 | **3시간(10,800초)**. 같은 리소스에는 토큰이 1개만 발급된다. 남은 시간이 30분 이상이면 기존 토큰을 돌려주고, 30분 미만이면 새 토큰을 발급하며 기존 토큰은 만료 전까지 계속 쓸 수 있다. 401과 `GW.AUTHN`이 오면 토큰을 다시 발급받아 재시도하도록 권장한다. | high | [공식] S3, S2 |
| A8 | IP 화이트리스트 | **있다.** 등록하지 않은 IP에서 호출하면 `403 GW.IP_NOT_ALLOWED`("호출이 허용되지 않은 IP입니다")가 난다. 설정 경로는 [커머스API센터 > 내 정보 > 내 스토어 애플리케이션 > 수정 > API호출 IP]다. | high | [공식] S5 · [공식-FAQ] G5, G6 |
| A9 | IP 개수와 필수 여부 | **최대 3개** 등록할 수 있다. IP가 없으면 인증(휴면 해제)이 되지 않는다. **유동 IP라면 IP가 바뀔 때마다 수정해야 한다**(2차 출처 설명). | medium | [2차] T1(2025-05-13), T2(2025-04-07) |
| A10 | 연 2회 이메일 인증과 휴면 | 내 스토어 애플리케이션에는 "IP등록, **연 2회 이메일 인증 및 휴면**" 정책이 적용된다(공식 답변). 휴면을 해제하면 **애플리케이션 시크릿이 바뀐다**(2차 출처). | high(정책 존재) / medium(시크릿 변경) | [공식-FAQ] G5 · [2차] T2 |
| A11 | 초당 호출 한도 | 애플리케이션별·API별 **Token bucket** 방식이다. 구체 수치는 공개하지 않으며 응답 헤더 `GNCP-GW-RateLimit-Replenish-Rate`, `-Burst-Capacity`(제한값의 2배), `-Remaining`으로 확인한다. 초과하면 `429 GW.RATE_LIMIT`이 온다. | high | [공식] S4 · [공식-FAQ] G2 |
| A12 | 일/시간 한도 | Quota limit(`GW.QUOTA_LIMIT`)은 솔루션·API대행사 애플리케이션과 API데이터솔루션에만 적용되고 **내 스토어 애플리케이션에는 적용되지 않는다**. ⚠️정정됨(검증 결과 참조) 일 단위 호출 한도는 문서에 없다(**미확인**). | high(Quota 비적용) / low(일 한도) | [공식] S4 · [공식-FAQ] G2 |
| A13 | 기타 제약 | TLS 1.2 이상. 운영 호스트는 `https://api.commerce.naver.com/external` 하나뿐이다. **샌드박스가 없고**, "실제 운영 중인 스토어에 API를 이용한 테스트를 하여 문제가 발생한 경우 책임지지 않음"이라고 명시돼 있다. 날짜는 ISO 8601 형식에 `+09:00`을 붙인다. | high | [공식] S4, S6 |

### 2.2 상품 등록 API `POST /external/v2/products`

엔드포인트는 `POST https://api.commerce.naver.com/external/v2/products`이고 `application/json`으로 보낸다. 성공(200)하면 `originProductNo`, `smartstoreChannelProductNo`, (쇼핑윈도가 있으면) `windowChannelProductNo`를 돌려준다. 400이면 `invalidInputs[]`(name/type/message)가 오는데, 공식 문서는 "message 내용을 활용한 오류 판단을 권장"한다. 출처: [공식] S7, S8.

**최상위 필수**: `originProduct`, `smartstoreChannelProduct`. `windowChannelProduct`는 선택이다.

| 경로 | 필수 | 타입/허용값·제한 | 비고(공식 설명 요지) |
|---|---|---|---|
| `originProduct.statusType` | 필수 | enum `WAIT, SALE, OUTOFSTOCK, UNADMISSION, REJECTION, SUSPENSION, CLOSE, PROHIBITION, DELETE` | **등록할 때는 SALE만 넣을 수 있다.** SUSPENSION을 넣어도 SALE로 등록된다. 재고가 0이면 OUTOFSTOCK으로 등록된다. |
| `originProduct.saleType` | 선택 | `NEW`/`OLD` | 넣지 않으면 NEW다. |
| `originProduct.leafCategoryId` | 등록 시 필수 | string | 리프 카테고리 ID만 쓸 수 있다. |
| `originProduct.name` | 필수 | string | 스펙에 길이 제한이 적혀 있지 않다(**미확인**). |
| `originProduct.detailContent` | 필수 | string(HTML) | 수정할 때만 생략할 수 있다. 생략하면 기존 값이 유지된다. |
| `originProduct.images.representativeImage.url` | 필수 | string | 1000×1000을 권장한다. **이미지 업로드 API가 돌려준 URL만** 넣을 수 있다. |
| `originProduct.images.optionalImages[].url` | 선택 | 최대 9개 | 위와 같다. |
| `originProduct.saleStartDate`/`saleEndDate` | 선택 | date-time | 시작은 매시 00분, 종료는 매시 59분으로만 설정된다. |
| `originProduct.salePrice` | 필수 | int64 ≤ 999,999,990 | |
| `originProduct.stockQuantity` | 등록 시 필수 | int32 ≤ 99,999,999 | 조합형 옵션을 쓰면 옵션 재고 합과 같아야 한다(G17 오류 메시지). |
| `originProduct.deliveryInfo` | 선택(**넣지 않으면 '배송 없는 상품'으로 등록됨**) | object | 하위 필수는 `deliveryType`(`DELIVERY`/`DIRECT`), `deliveryAttributeType`(`NORMAL` 등), `deliveryFee`, `claimDeliveryInfo`(`returnDeliveryFee`, `exchangeDeliveryFee` 필수)다. `DELIVERY`일 때는 `deliveryCompany`도 필수다. |
| `…deliveryInfo.claimDeliveryInfo.shippingAddressId` / `returnAddressId` | 선택 | int64 | 출고지와 반품·교환지 주소록 번호다. `GET /v1/seller/addressbooks-for-page`로 조회한다. |
| `…deliveryInfo.businessCustomsClearanceSaleYn` | 선택 | boolean | 사업자 통관 판매 여부다. **출고지 주소가 해외일 때만 적용되며** 기본값은 false다. |
| `originProduct.detailAttribute` | 필수 | object | 하위 필수는 `afterServiceInfo`, `originAreaInfo`, `minorPurchasable`이다. |
| `…afterServiceInfo.afterServiceTelephoneNumber` / `afterServiceGuideContent` | 필수 | string | |
| `…originAreaInfo.originAreaCode` | 필수 | string | `00` 국산, `01` 원양산, **`02` 수입산**, `03` 기타(상세설명에 표시), `04` 기타(직접입력), `05` 표기 의무 대상 아님. 상세 코드는 원산지 조회 API로 찾는다. |
| `…originAreaInfo.importer` | 수입산이면 필수 | string | 수입사명 |
| `…originAreaInfo.content` / `plural` | 조건부 | | `04`일 때 content가 필수다. plural은 복수 원산지 여부다. |
| `…sellerCodeInfo.sellerManagementCode` 외 | 선택 | string | 판매자 관리 코드다. **고유성이 보장되지 않는다**(S24). |
| `…optionInfo` | 선택 | 단독형 `optionSimple`(≤3) / 직접입력형 `optionCustom`(≤5) / 조합형 `optionCombinationGroupNames`+`optionCombinations` / 표준형 `standardOptionGroups`+`optionStandards` | 2.6절 참고 |
| `…taxType` | 선택 | `TAX`/`DUTYFREE`/`SMALL` | 넣지 않으면 과세다. |
| `…customsTaxType` | **출고지가 해외면 필수** | `NOT_APPLICABLE`/`INCLUDED`/`EXCLUDED` | 노출 채널이 해외직구면 `INCLUDED`만 허용된다. |
| `…productCertificationInfos[]` / `certificationTargetExcludeContent` | 조건부 | | 카테고리의 예외 카테고리(KC 등)에 따라 달라진다. 2.3절 참고 |
| `…minorPurchasable` | 필수 | boolean | 성인 카테고리는 false다. |
| `…productInfoProvidedNotice` | **등록 시 필수** | `productInfoProvidedNoticeType`(필수) + 유형별 객체 1개 | 신발은 `SHOES` + `shoes`. 2.5절 참고 |
| `…productAttributes[]` | 선택 | `attributeSeq`, `attributeValueSeq`(필수), `attributeRealValue`, `attributeRealValueUnitCode` | 카테고리별 속성 API로 값을 채운다. |
| `…seoInfo.pageTitle`(≤100) / `metaDescription`(≤160) / `sellerTags[]` | 선택 | `sellerTags[].text` 필수, `code`는 추천 태그일 때만 | 2.7절 참고 |
| `…productSize` | 선택 | `sizeTypeNo`, `sizeAttributes[].sizeValues[]` | 상세 사이즈 표(`/v1/product-sizes`) |
| `originProduct.customerBenefit` | 선택 | 즉시할인·포인트 등 | |
| `smartstoreChannelProduct.channelProductName` | 선택 | string | 넣지 않으면 원상품명을 쓴다. |
| `smartstoreChannelProduct.naverShoppingRegistration` | 필수 | boolean | 네이버쇼핑 광고주가 아니면 false로 저장된다. |
| `smartstoreChannelProduct.channelProductDisplayStatusType` | 필수 | enum `WAIT, ON, SUSPENSION` 중 **ON과 SUSPENSION만 넣을 수 있음** | WAIT을 넣으면 `NotValidEnum` 오류가 난다(G10). ⚠️정정됨(검증 결과 참조) |
| `smartstoreChannelProduct.storeKeepExclusiveProduct` / `bbsSeq` | 선택 | | 알림받기 회원 전용 여부, 공지사항 |

추가 규칙은 다음과 같다.
- **상세 HTML**: 문자열 HTML을 그대로 넣는다. HTML/META/SCRIPT/STYLE/BODY/HEAD처럼 페이지 전체에 영향을 주는 태그와 속성은 걸러진다(G10). 네이버 카페·블로그, 페이스북, 텀블러, 트위터, 인스타그램을 뺀 외부 링크는 차단된다. `src="data:image…"`는 반영되지 않으므로 URL로 넣어야 한다(H8). API로 수정하면 SmartEditor ONE 형식이 **HTML 형식으로 바뀌어 저장된다**(S24).
- **수정 API의 동작**: `PUT /v2/products/origin-products/{no}`와 `PUT /v2/products/channel-products/{no}`는 **본문 전체를 통째로 교체한다.** 본문에 빠진 필드는 삭제되거나 비활성화된다. 예외는 `leafCategoryId`, `detailContent`, `productInfoProvidedNotice` 세 가지다. ⚠️정정됨(검증 결과 참조) `seoInfo`를 null이나 생략으로 보내면 **태그가 초기화된다**(S24, G13).

### 2.3 해외구매대행 관련 필드와 설정

| # | 항목 | 필드와 설정 | 신뢰도 | 출처 |
|---|---|---|---|---|
| O1 | '구매대행' 전용 플래그 | 상품 스펙에 `isOverseasPurchaseAgency` 같은 단일 필드는 **없다**. 구매대행 여부는 아래 O2~O6을 조합해 표현한다. | high(스펙 전수 검색 결과) | [공식] S7, S8 |
| O2 | 해외상품판매 권한 | 스마트스토어센터 [판매자정보 > 상품판매권한 신청]에서 '해외상품판매'에 체크하고 약관에 동의한 뒤 '해외배송 유형'을 설정해 신청한다. 이 권한이 있어야 해외 출고지를 설정할 수 있다. 한번 받은 권한은 **해제할 수 없다.** | high | [공식-FAQ] H4, H5 |
| O3 | 해외 출고지 | `claimDeliveryInfo.shippingAddressId`에 **해외 주소록 번호**를 넣는다. 주소록 API 응답의 `overseasAddress=true`, `addressType=RELEASE`인 항목이다. 출고지를 해외로 설정하면 네이버쇼핑에 **'해외' 아이콘과 '해외직배송 상품안내' 문구가 자동으로 붙는다.** | high(필드·효과) / medium(API로 해외 주소록을 새로 만드는 방법은 없음, 센터에서 등록해야 함, **미확인**) | [공식] S22 · [공식-FAQ] H5 |
| O4 | 개인통관고유부호 수집 | 상품 필드가 아니다. **출고지를 해외 주소로 설정하면 주문서에 실수령인 개인통관고유부호 입력란이 자동으로 나온다.** '사업자 통관'으로 팔 때는 `businessCustomsClearanceSaleYn=true`로 하면 입력이 필수가 아니다. | high | [공식-FAQ] H4 · [공식] S7 |
| O5 | 관부가세 포함 여부 | `detailAttribute.customsTaxType`: `INCLUDED`(포함), `EXCLUDED`(미포함), `NOT_APPLICABLE`(부과 대상 아님). **출고지가 해외 주소면 필수**다. | high | [공식] S7 |
| O6 | 원산지·수입사 | `originAreaInfo.originAreaCode`는 `02`(수입산) 계열 국가 코드를 쓰고 `importer`(수입사명)는 수입산이면 필수다. 국가 코드는 `GET /v1/product-origin-areas/query?name=아시아 > 일본` 또는 `name=베트남`처럼 조회한다. 원산지는 **구매한 국가(일본)가 아니라 제조국**으로 적어야 한다. 구매대행에서 `importer`에 무엇을 적을지는 공식 기준을 찾지 못했다(**미확인**). | high(필드) / low(importer 값) | [공식] S7, S21 · [공식-FAQ] H9 |
| O7 | KC 특례(구매대행) | 카테고리의 `exceptionalCategories`에 `KC_CERTIFICATION`이 있으면 `certificationTargetExcludeContent.kcCertifiedProductExclusionYn="KC_EXEMPTION_OBJECT"`와 `kcExemptionType="OVERSEAS"`를 넣는다. 인증 정보가 있으면 `productCertificationInfos[].certificationKindType="OVERSEAS"`로 넣고, 없으면 생략해도 등록된다. 인증 대상이 아닌 카테고리라면 이 필드를 구성하지 않는다. `productCertificationInfos`는 최대 5개다. | high | [공식-FAQ] G9 · [공식] S7 |
| O8 | 배송 기간 | 해외배송 소요일을 넣는 전용 필드는 **없다**(**미확인**, 스펙 전수 검색 결과). `expectedDeliveryPeriodType`은 '주문 제작 상품 발송 예정일'이라 용도가 다르다. 소요일은 상세페이지에 고지하는 방식이 현실적이다. | medium | [공식] S7 |
| O9 | 구매대행 판매 불가 품목 | 식품, 화장품, 의료기기, 안전인증이 없는 전기·생활용품, 의약품 등은 구매대행으로 팔 수 없거나 주의가 필요하다. 신발은 목록에 없지만 어린이 신발은 **어린이제품 인증 카테고리**일 수 있으므로 카테고리 API로 확인해야 한다. | high(목록) / medium(신발 적용) | [공식-FAQ] H7, G9 |

### 2.4 이미지 업로드 API `POST /external/v1/product-images/upload`

| 항목 | 내용 | 신뢰도 | 출처 |
|---|---|---|---|
| 형식 | `multipart/form-data`. 폼 필드 이름은 모든 파일에 동일하게 **`imageFiles`**를 쓰고 boundary가 반드시 있어야 한다. 파트마다 `Content-Type`에 **실제 포맷의 MIME**(image/jpeg·gif·png·bmp)을 넣는다. 확장자와 실제 포맷이 다르면 "올바른 이미지 파일이 아닙니다" 오류가 난다. | high | [공식] S10 · [공식-FAQ] G7, G16 |
| 개수 | 한 번에 **최대 10개** | high | [공식] S10 |
| 용량 | 한 번 호출에 담긴 파일 용량 **합계 10MB(10^7 bytes) 미만**(HTTP payload 기준). 해상도·DPI 제한은 없다. 고객센터 UI 기준으로는 이미지 1장당 최대 20MB다(API 한도는 호출당 10MB가 우선). | high | [공식-FAQ] G7(2026-03-18 갱신), H3 |
| 동시성 | 스마트스토어센터와 API를 합쳐 **스토어 계정당 한 번에 1건만** 처리한다. 앞선 업로드가 끝나기 전에 다시 요청하면 `429`("이전 요청이 진행중입니다")가 온다. 반드시 **직렬로** 호출해야 한다. | high | [공식-FAQ] G7, G8 |
| 응답 | `{"images":[{"url":"https://shop-phinf.pstatic.net/..."}]}` | high | [공식] S10 · G14 사례 |
| 외부 URL 직접 사용 | `representativeImage`와 `optionalImages`에는 **업로드 API가 돌려준 URL만** 쓸 수 있다. 외부 URL을 넣으면 오류가 난다. 외부 이미지는 내려받아 파일로 업로드하면 된다. | high | [공식] S7 · [공식-FAQ] G11 |
| 상세 HTML 속 이미지 | `detailContent`에서도 `InvalidImageUrl`("정상적으로 업로드한 이미지만 등록 가능합니다") 검증이 있다. 외부 호스팅 URL이 허용되는지는 **미확인**이라 업로드 URL만 쓰는 편이 안전하다. | medium | G14 · H8 |
| 권장 규격 | 대표·추가 이미지는 1000×1000을 권장한다. 300px 이하, 4000px 이상, 가로:세로 1:2를 넘는 비율이면 **쇼핑 검색에 연동되지 않을 수 있다.** 고객센터 원문에는 "용량4MB 이하"도 조건으로 적혀 있는데 의미가 모호하다. 움직이는 GIF는 첫 컷만 등록된다. | high | [공식-FAQ] H3, G8 |

### 2.5 상품정보제공고시 `SHOES`와 오너 요구 매핑

`productInfoProvidedNotice = { "productInfoProvidedNoticeType": "SHOES", "shoes": { … } }`. 공식 가이드에 따르면 유형 객체는 **1개만** 넣어야 한다. 출처: [공식] S7, S8, [공식-FAQ] G15.

| 필드 | 필수 | 최대 길이 | 공식 설명 | 오너 요구 매핑 / 라쿠텐 데이터 원천 |
|---|---|---|---|---|
| `returnCostReason` | 필수 | – | 하자·오배송 청약철회 조항. `0`(법정 문구) 또는 `1`(상품상세 참조). 넣지 않으면 '상품상세 참조'로 들어간다. | 고정 템플릿 |
| `noRefundReason` | 필수 | – | 단순변심 청약철회가 불가한 사유(0/1) | 고정 템플릿 |
| `qualityAssuranceStandard` | 필수 | – | 교환·반품·보증 조건(0/1) | 고정 템플릿 |
| `compensationProcedure` | 필수 | – | 환불 지연 배상 절차(0/1) | 고정 템플릿 |
| `troubleShootingContents` | 필수 | – | 분쟁 처리(0/1) | 고정 템플릿 |
| `material` | 필수 | 1500 | **제품의 주 소재. 운동화는 겉감과 안감을 구분해 표시** | **소재** ← 라쿠텐 素材/アッパー/ライニング/ソール (AI 추출) |
| `color` | 필수 | 200 | 색상 | 옵션·상품명의 カラー |
| `size` | 필수 | 200 | **발길이. 해외 사이즈를 표기하면 국내 사이즈(mm)를 함께 표기** | JP cm → mm 변환(예: 26.5cm → 265mm) |
| `height` | 선택 | 200 | **굽높이. 굽 재료를 쓰는 여성화에만 해당(cm). 해당 없으면 요소를 삭제하고 전송** | **굽높이** ← ヒール高さ/ヒール(cm). 없으면 키 자체를 뺀다. |
| `manufacturer` | 필수 | 200 | 제조자(사) | 브랜드·제조사. 고시상 수입품은 수입자를 병기한다(아래 참고). |
| `caution` | 필수 | 1500 | 취급 시 주의사항 | AI 생성 또는 고정 템플릿 |
| `warrantyPolicy` | 필수 | 1500 | 품질 보증 기준 | 고정 템플릿 |
| `afterServiceDirector` | 필수 | 200 | A/S 책임자와 전화번호 | 오너 설정값 |

- **원산지**는 `shoes` 객체에 필드가 없다. 대신 `detailAttribute.originAreaInfo`(필수)에 적는다. 따라서 오너가 말한 **"원산지"는 `originAreaInfo.originAreaCode`(+`importer`)**에 매핑한다(2.3절 O6). 라쿠텐의 生産国/原産国/製造国을 AI로 추출해 국가 코드로 바꾼다.
- 법령상 신발 고시 항목(공정위 고시)에는 **제조자와 수입자(수입품은 병기), 제조국**이 들어간다. 하지만 네이버 `shoes` 스키마에는 `importer`와 제조국 필드가 없다. 그래서 수입자는 `manufacturer` 문자열에 병기하고 제조국은 `originAreaInfo`와 상세페이지로 보완하는 방식을 **추정으로 권고**한다. 법령 원문은 직접 확인하지 못했다(medium, [2차] T8).
- 상품군별 고시 항목과 최대 길이는 `GET /v1/products-for-provided-notice/SHOES`로 런타임에 받아 검증할 수 있다(S20).

### 2.6 카테고리·속성·옵션(사이즈별 재고)

| # | API | 용도 | 출처 |
|---|---|---|---|
| C1 | `GET /v1/categories?last=true` | 전체 카테고리 중 리프만 조회한다. 응답은 `wholeCategoryName`, `id`, `name`, `last`다. | [공식] S17 |
| C2 | `GET /v1/categories/{categoryId}` | `exceptionalCategories`(KC_CERTIFICATION, CHILD_CERTIFICATION, ADULT, FREE_RETURN_INSURANCE, MANUFACTURE_DEFINE_NO 등)와 `certificationInfos[]`(id, name, kindTypes)를 준다. **인증과 필수 입력 여부를 판단하는 데 쓴다.** | [공식] S17 · G9 |
| C3 | `GET /v1/categories/{categoryId}/sub-categories` | 하위 카테고리를 lazy 트리로 조회한다. | [공식] S17 |
| C4 | `GET /v1/options/standard-options?categoryId=` | `useStandardOption`과 `standardOptionCategoryGroups[]`(attributeId, attributeName 예: '사이즈(공통)'/'사이즈(미국)', `optionSetRequired`, `standardOptionAttributes[]`)를 준다. | [공식] S18 |
| C5 | `GET /v1/product-attributes/attributes?categoryId=` / `…/attribute-values` | 카테고리 속성(PRIMARY/OPTIONAL, SINGLE/MULTI_SELECT/RANGE)과 속성값을 준다. `productAttributes[]` 구성에 쓴다. | [공식] S19 |
| C6 | `GET /v1/product-sizes`, `/v1/product-sizes/{sizeTypeId}` | 상세 사이즈 표(`productSize`)에 쓴다. | [공식] S24 |
| C7 | `GET /v2/standard-purchase-option-guides?categoryId=` | 그룹상품 전용 판매옵션 가이드다. 일반상품 흐름에는 필요 없다. | [공식] S23 |

**신발 리프 카테고리 예시**: 네이버쇼핑 카테고리 ID는 8자리 숫자다. 대분류 **패션잡화 = `50000001`**이다(G15 질문 본문, DataLab 문서의 `50000000` 패션의류와 `50000002` 화장품/미용과 같은 체계). 경로는 "패션잡화 > 여성신발 > 단화 > 로퍼"처럼 최대 4단계다. **신발 리프의 구체 ID는 미확인**이다. 게다가 **2026년 4월 20~24일 카테고리 개편**으로 부츠가 길이별로 쪼개지는 등 신발 카테고리가 바뀌었다([2차] T7). 따라서 **ID를 하드코딩하지 말고** C1으로 `wholeCategoryName`이 `패션잡화>`로 시작하고 '신발'을 포함하는 리프를 동기화해야 한다.

**옵션 조합 구조(사이즈별 재고)**:
- 조합형: `optionCombinationGroupNames.optionGroupName1="사이즈"`, `optionCombinations[] = {optionName1:"265", stockQuantity, price(옵션가, 기본 0), sellerManagerCode, usable}`. 조합형 옵션명은 최대 3개다. **원상품 `stockQuantity`는 옵션 재고 합과 같아야 한다**(G17). 옵션 재고 합이 원상품 재고로 자동 계산된다(S24).
- 표준형: `standardOptionGroups[{groupName:"사이즈", standardOptionAttributes[{attributeId, attributeValueId, attributeValueName}]}]` + `optionStandards[{optionName1, optionName2, stockQuantity}]` + `useStockManagement=true`. `useStockManagement`를 빼거나 false로 두면 재고가 9,999로 잡힌다. **표준형은 다른 옵션 유형과 함께 쓸 수 없고, 일부 카테고리에서만 쓸 수 있으며, 값은 미리 정해진 값만 허용된다.** 공식 가이드 원문도 "표준형 옵션 그룹은 색상, 사이즈를 등록해야 합니다"라고 적고 있다.
- 조합 가능 규칙: 단독형과 조합형은 둘 중 하나만 쓴다. 입력형은 표준형을 뺀 나머지와 함께 쓸 수 있다. 표준형은 단독으로만 쓴다(S24).
- 옵션 재고와 옵션가만 바꿀 때는 `PUT /v1/products/origin-products/{originProductNo}/option-stock`을 쓴다. 요청에 없는 조합은 그대로 유지된다(S24).

### 2.7 태그(`seoInfo.sellerTags`)

| 항목 | 내용 | 신뢰도 | 출처 |
|---|---|---|---|
| 구조 | `sellerTags: [{ "code": <int64, 선택>, "text": <string, 필수> }]`. `code`는 **추천 태그 조회로 얻은 태그 ID**이고, ID와 태그명이 맞지 않으면 **요청이 실패한다.** 직접 입력한 태그는 `code`를 생략한다. | high | [공식] S7, S11 |
| 최대 개수 | **10개**. 카테고리명, 브랜드명, 판매처명은 태그로 쓸 수 없다. 직접 입력한 태그 중 일부는 내부 기준에 따라 검색에 쓰이지 않을 수 있다. 스펙상 `maxLength: 4000`이라는 표기도 있으나 의미가 불명확하다. | high(10개) | [공식-FAQ] H1, H2 · [공식] S7 |
| 추천 태그 API | `GET /v2/tags/recommend-tags?keyword={kw}` → `[{code, text}]` | high | [공식] S11 |
| 제한 태그 API | `GET /v2/tags/restricted-tags?tags=a&tags=b` → `[{tag, restricted}]`. 추천 태그로 받은 것도 금지어면 등록할 때 `Restricted.sellerTags`("태그 항목에 등록불가인 단어(…)가 포함") 오류가 난다. | high | [공식] S12 · [공식-FAQ] G12 |
| 수정 시 주의 | 상품을 PUT으로 수정할 때 `seoInfo`를 빼면 **태그가 초기화된다.** | high | [공식-FAQ] G13 |
| manuTag 연계 | 오너가 말한 "manutag"(다른 판매자 상품의 태그)를 수집하는 일은 이 문서 범위 밖이다. 수집한 뒤에는 **① 중복 제거 → ② 카테고리·브랜드·스토어명 제거 → ③ restricted-tags로 금지어 제거 → ④ recommend-tags로 code 매핑(가능한 것만) → ⑤ 상위 10개 선택** 순서로 `sellerTags`에 넣는다(설계 권고). | – | 위 출처 종합 |

### 2.8 판매 상태·승인 후 판매 전환·수정/삭제

| # | 항목 | 내용 | 신뢰도 | 출처 |
|---|---|---|---|---|
| S-1 | 등록 시 상태 | `statusType`은 **SALE만** 넣을 수 있다. WAIT(판매대기)는 사용자가 직접 설정할 수 없고, **판매기간(`saleStartDate`)이 미래이면 시스템이 자동으로 SALE을 WAIT으로 바꾼다.** | high(규칙) / medium(등록 직후 WAIT 전환은 테스트하지 않음) | [공식] S7, S24 |
| S-2 | 전시 상태 | `smartstoreChannelProduct.channelProductDisplayStatusType`은 등록과 수정 때 **ON 또는 SUSPENSION(전시중지)**만 넣을 수 있다. 전시중지 상품은 구매자에게 보이지 않는다. 다만 "전시 채널에 따라 **상품 상세 페이지에 직접 접근하면** 상품 정보가 표시되거나 **구매가 가능할 수도 있음**"이라는 단서가 있다. | high | [공식] S7, S9, S24 · G10 |
| S-3 | 구매자 노출 조건 | 원상품이 판매중·품절이고, 채널상품이 전시중이며, 스토어 계정이 정상이어야 구매할 수 있다. | high | [공식] S24 |
| S-4 | 상태 변경 API | `PUT /v1/products/origin-products/{originProductNo}/change-status` body `{statusType, stockQuantity?, saleStartDate?, saleEndDate?}`. 허용 전이는 SALE→OUTOFSTOCK, SUSPENSION/OUTOFSTOCK→SALE(품절에서 복귀할 때는 재고 필수), SALE/OUTOFSTOCK/WAIT→**SUSPENSION**이다. | high | [공식] S13 |
| S-5 | 일괄 상태·가격·재고 | `PATCH /v1/products/origin-products/multi-update`(SALE_PRICE, IMMEDIATE_DISCOUNT, STOCK, PRODUCT_STATUS_SALE, PRODUCT_STATUS_SUSPENSION). `PUT /v1/products/origin-products/bulk-update`(SALE_PERIOD, DELIVERY, PURCHASE_BENEFIT 등. 가격은 상대값만). | high | [공식] S16 |
| S-6 | 전시 상태 전환 | 전시 상태만 바꾸는 전용 API는 **없다**. `PUT /v2/products/channel-products/{channelProductNo}`로 **전체 본문을 다시 보내야** 한다. 조회한 뒤 `channelProductDisplayStatusType`만 바꿔 보내는 방식이다. | high | [공식] S14, S24 |
| S-7 | 조회·수정·삭제 | 조회: `GET /v2/products/origin-products/{no}`, `GET /v2/products/channel-products/{no}`. 수정: `PUT` 같은 경로(전체 교체). 삭제: `DELETE /v2/products/origin-products/{originProductNo}`, `DELETE /v2/products/channel-products/{channelProductNo}`. 목록: `POST /v1/products/search`(`searchKeywordType=SELLER_CODE` + `sellerManagementCode`로 찾을 수 있고, 페이지당 최대 500건). | high | [공식] S14, S15 |
| S-8 | 검수 | 시스템이 SALE을 UNADMISSION(승인대기)으로 바꾸는 검수 전이가 있다. UNADMISSION·REJECTION 상태는 change-status로 바꿀 수 없다. | high | [공식] S24, S13 |

**'오너 승인 후 등록' 흐름으로 가능한 선택지**(설계 권고):
- (A) 로컬 승인 게이트만 두기: 앱 안에서 미리보기를 보고 승인해야만 `POST /v2/products`(`ON`)를 호출한다. 가장 단순하다.
- (B) 2단계 게이트: 로컬 승인 후 `SUSPENSION`으로 등록하고, 스마트스토어센터에서 실제 모습을 확인한 뒤 앱에서 'ON 전환'(GET 후 PUT)을 한다. S-2 단서처럼 직접 링크로 구매될 여지가 있으므로 필요하면 `change-status`로 SUSPENSION도 함께 건다. 이렇게 하면 원상품도 판매중지가 되고, 재개할 때 SALE로 되돌린다.
- (C) 판매기간을 미래로 두기: `saleStartDate`를 미래로 등록해 WAIT으로 만든 뒤 승인하면 `bulk-update`의 SALE_PERIOD로 시작일을 앞당긴다(medium, 테스트 필요). 판매대기 상품은 등록 한도에 포함된다(2.9절).

### 2.9 등록 한도·중복상품 정책

| 항목 | 내용 | 신뢰도 | 출처 |
|---|---|---|---|
| 등급별 등록 한도(2026-06-02 시행) | 직전 3개월 판매액 500만 원 미만 **또는** 판매건수 100건 미만이면 **등록 한도가 1,000개**로 줄어든다(기존 씨앗 등급은 1만 개). **5만 개**를 등록하려면 판매액 6,000만 원 또는 판매건수 1,000건 이상이어야 한다. 이와 별도로 **판매상품비중 3%**(최근 13개월 동안 판매된 상품 종류 수 ÷ 등록 상품 수)를 충족해야 한다. 한도를 넘으면 최근 13개월 판매 이력이 없고 수정이 오래된 상품부터 판매중지된다. 매월 2일 최근 3개월 실적으로 다시 산정한다. 판매중·판매대기·품절은 한도에 포함되고 **판매중지는 제외**된다. | medium(언론·2차, 공식 공지 원문은 확인하지 못함) | [2차] T4(서울경제 2026-04-27), T5(2026-04-13) |
| 판매자 등급 기준 개편(2025-12-02) | 집계 기간이 1개월로 바뀌었다. 씨앗은 월 80만 원 미만, 새싹은 80만 원 이상, 파워는 300만 원 이상 등이다. | medium | [2차] T6 |
| 중복상품 | 네이버쇼핑과 스마트스토어 기준으로 **단일 몰 안에서든 복수 몰 전체에서든 같은 상품은 1개만 등록**해야 한다. 복수 몰은 서로 다른 상품군을 다뤄야 한다. 위반하면 경고 뒤 몰 단위 제재(퇴점·이용정지)를 받는다. 공지 연도는 **미확인**(2018년 추정)이고 최신 공식 원문도 **미확인**이다. | low~medium | [2차] T9 |
| API 측 중복 방지 수단 | 판매자관리코드는 **고유성이 보장되지 않는다.** 따라서 앱이 로컬 DB에 `rakuten_shop:item_code → originProductNo` 매핑을 두고, 필요하면 `POST /v1/products/search`(SELLER_CODE)로 교차 확인해야 한다. | high | [공식] S24, S15 |

### 2.10 샘플 코드·문서 리소스

| 리소스 | URL | 비고 |
|---|---|---|
| 공식 문서(최신) | https://apicenter.commerce.naver.com/docs/commerce-api/current | Docusaurus 기반 OpenAPI 문서, 버전 선택 가능 |
| **LLM용 문서 인덱스** | https://apicenter.commerce.naver.com/llms/llms.txt | 엔드포인트별 `.md`(요청·응답·에러 표)를 공식 제공한다. **로컬 AI CLI(claude/agy/gemini)에 그대로 넘기기 좋다.** 본문 서술 문단 일부는 AI가 생성한 요약이라 표 내용을 우선한다. |
| 인증·전자서명 예제 | https://apicenter.commerce.naver.com/docs/auth | Java, Python(bcrypt+pybase64), Node.js(bcrypt), PHP |
| 공식 GitHub(기술지원) | https://github.com/commerce-api-naver/commerce-api | SDK는 없다. Discussions(FAQ·묻고 답하기·릴리즈 노트)와 Wiki(상품 가이드, 그룹상품 가이드)가 있다. |
| 스마트스토어 상품 가이드(Wiki, 2026-09-07 갱신) | https://apicenter.commerce.naver.com/llms/wiki-스마트스토어-상품-가이드.md | 상태 전이, 옵션 JSON 샘플, 필드별 조회 API 매핑 |
| 인증 정보 구성 FAQ | https://github.com/commerce-api-naver/commerce-api/discussions/704 | KC와 구매대행 JSON 샘플 |
| 이미지 업로드 FAQ | https://github.com/commerce-api-naver/commerce-api/discussions/117 | multipart 규격 |

### 2.11 신발 해외구매대행 상품 1건의 최소 요청 JSON 골격

> `// [추정]` 표시는 공식 스펙에서 **값**을 확인하지 못한 부분이다(오너 정책값이나 런타임 조회값). 필드 이름과 구조는 2.89.0 스펙에서 확인했다. 실제 JSON에는 주석을 넣을 수 없으므로 전송할 때 주석을 지운다(G15).

```jsonc
// POST https://api.commerce.naver.com/external/v2/products
// Authorization: Bearer {access_token}   Content-Type: application/json
{
  "originProduct": {
    "statusType": "SALE",                      // 등록 시 SALE만 허용
    "saleType": "NEW",
    "leafCategoryId": "5000XXXX",              // [추정] GET /v1/categories?last=true 에서 '패션잡화>…신발>…' 리프 ID
    "name": "[일본구매대행] 브랜드 모델명 남성 스니커즈",   // [추정] 상품명 규칙은 별도 정의
    "detailContent": "<div><img src=\"https://shop-phinf.pstatic.net/…\"/><p>AI 생성 한국어 설명…</p></div>",
    "images": {
      "representativeImage": { "url": "https://shop-phinf.pstatic.net/…" },  // 업로드 API 반환 URL만 허용(AI 썸네일)
      "optionalImages": [ { "url": "https://shop-phinf.pstatic.net/…" } ]     // 최대 9개
    },
    "salePrice": 129000,                       // [추정] 셀러라이프 계산 결과
    "stockQuantity": 6,                        // 조합형 옵션 재고 합과 같아야 함
    "deliveryInfo": {                          // 빼면 '배송 없는 상품'이 되므로 반드시 포함
      "deliveryType": "DELIVERY",
      "deliveryAttributeType": "NORMAL",
      "deliveryCompany": "XXXX",               // [추정] 발송처리 API의 deliveryCompanyCode 중 선택(해외 배송사 코드 미확인)
      "deliveryFee": { "deliveryFeeType": "FREE", "deliveryFeePayType": "PREPAID" },  // [추정] 오너 정책
      "claimDeliveryInfo": {
        "returnDeliveryFee": 30000,            // [추정] 오너 정책(해외 반품비)
        "exchangeDeliveryFee": 60000,          // [추정] 오너 정책
        "shippingAddressId": 100000001,        // 해외 출고지 주소록 번호(overseasAddress=true) ← /v1/seller/addressbooks-for-page
        "returnAddressId": 100000002           // [추정] 국내 반품/교환지 주소록 번호
      },
      "businessCustomsClearanceSaleYn": false  // 개인통관 → 주문서에 개인통관고유부호 입력란 자동 노출
    },
    "detailAttribute": {
      "afterServiceInfo": {
        "afterServiceTelephoneNumber": "010-0000-0000",           // [추정] 오너 설정값
        "afterServiceGuideContent": "해외구매대행 상품으로 판매자 고객센터를 통해 A/S 안내"  // [추정]
      },
      "originAreaInfo": {
        "originAreaCode": "02XXXXX",           // [추정] 수입산(02) 계열 국가 코드 ← /v1/product-origin-areas/query?name=베트남 등 '제조국'
        "importer": "상호명",                   // [추정] 구매대행 시 표기값 미확인
        "plural": false
      },
      "sellerCodeInfo": { "sellerManagementCode": "RKT:shopcode:itemcode" },  // [추정] 라쿠텐 원본 식별자(로컬 중복 방지 키와 동일)
      "optionInfo": {
        "optionCombinationSortType": "CREATE",
        "optionCombinationGroupNames": { "optionGroupName1": "사이즈" },
        "optionCombinations": [
          { "optionName1": "255", "stockQuantity": 2, "price": 0, "sellerManagerCode": "RKT:…:255", "usable": true },
          { "optionName1": "265", "stockQuantity": 2, "price": 0, "usable": true },
          { "optionName1": "275", "stockQuantity": 2, "price": 0, "usable": true }
        ]
        // 표준형 옵션을 지원하는 카테고리면 standardOptionGroups/optionStandards/useStockManagement=true 로 대체할 수 있음(C4로 판단)
      },
      "taxType": "TAX",
      "customsTaxType": "INCLUDED",            // 해외 출고지면 필수. [추정] 관부가세 포함가 판매 가정
      // 카테고리에 KC_CERTIFICATION 예외가 있을 때만 포함(C2로 판단):
      // "certificationTargetExcludeContent": { "kcCertifiedProductExclusionYn": "KC_EXEMPTION_OBJECT", "kcExemptionType": "OVERSEAS" },
      "minorPurchasable": true,
      "productInfoProvidedNotice": {
        "productInfoProvidedNoticeType": "SHOES",
        "shoes": {
          "returnCostReason": "1",             // [추정] "0"=법정문구 / "1"=상품상세 참조 (문자열 입력 형식은 테스트 필요)
          "noRefundReason": "1",
          "qualityAssuranceStandard": "1",
          "compensationProcedure": "1",
          "troubleShootingContents": "1",
          "material": "겉감: 천연가죽 / 안감: 합성섬유 / 밑창: 고무",   // 운동화는 겉감·안감 구분
          "color": "블랙",
          "size": "255~275mm (JP 25.5~27.5cm)", // 해외 사이즈에 국내 mm 병기
          "height": "3cm",                      // 여성화 굽 재료 사용 시에만. 해당 없으면 이 키 삭제
          "manufacturer": "제조자: ○○ Corporation / 수입자: 상호명(구매대행)",  // [추정] 수입자 병기 형식
          "caution": "천연가죽 특성상 …",
          "warrantyPolicy": "소비자분쟁해결기준에 따름",
          "afterServiceDirector": "상호명 010-0000-0000"
        }
      },
      "seoInfo": {
        "sellerTags": [
          { "code": 1234567, "text": "러닝화" },  // 추천 태그(code는 recommend-tags 결과 그대로)
          { "text": "일본한정" }                  // 직접 입력 태그는 code 생략. 최대 10개
        ]
      }
    }
  },
  "smartstoreChannelProduct": {
    "naverShoppingRegistration": true,         // 네이버쇼핑 광고주가 아니면 false로 저장됨
    "channelProductDisplayStatusType": "SUSPENSION"  // 2단계 승인 흐름(B)일 때. 즉시 판매면 "ON"
  }
}
```

### 2.12 등록 파이프라인 호출 순서(권고)

1. **토큰**: `POST /v1/oauth2/token`(form, `type=SELF`). 만료 30분 전에 재발급하고 401 `GW.AUTHN`이 오면 재발급 후 재시도한다.
2. **메타 캐시**(일 단위): `/v1/categories?last=true`, `/v1/categories/{id}`, `/v1/options/standard-options`, `/v1/product-attributes/*`, `/v1/product-origin-areas/*`, `/v1/seller/addressbooks-for-page`, `/v2/product-delivery-info/return-delivery-companies`, `/v1/products-for-provided-notice/SHOES`.
3. **태그 정제**: restricted-tags → recommend-tags.
4. **이미지 업로드**(직렬, 10장·10MB 미만 단위로 나눔): 대표(AI 썸네일)와 추가 이미지, 상세 이미지 → URL 매핑.
5. **중복 확인**: 로컬 DB + `POST /v1/products/search`(SELLER_CODE).
6. **로컬 사전 검증**: 필수 필드, 길이 제한, 옵션 재고 합, 태그 10개 이하.
7. **오너 승인**(로컬 UI) → `POST /v2/products` → `originProductNo`와 `smartstoreChannelProductNo`를 저장한다.
8. (B 흐름) 스마트스토어센터에서 확인 → `GET /v2/products/channel-products/{no}` → 표시 상태를 ON으로 바꿔 `PUT`한다.
9. **운영**: 재고·가격 동기화는 `PUT …/option-stock`, `PATCH …/multi-update`로 한다. 판매를 멈출 때는 `change-status`(SUSPENSION)를 쓰고, 삭제는 `DELETE /v2/products/origin-products/{no}`로 한다.

---

## 3. PRD에 반영할 도출 요구사항

| ID | 구분 | 요구사항 | 근거 |
|---|---|---|---|
| R04-FR-01 | 기능 | 설정 화면에서 `client_id`, `client_secret`을 입력받아 로컬에 **암호화 저장**하고, 전자서명(bcrypt→Base64)으로 `type=SELF` 토큰을 발급·캐시·자동 갱신한다. 만료 30분 전 재발급과 401 `GW.AUTHN` 재시도를 구현한다. | A4~A7 |
| R04-FR-02 | 기능 | 앱을 시작할 때 **현재 공인 IP**를 확인하고, API센터에 등록한 IP(최대 3개)와 다르거나 `GW.IP_NOT_ALLOWED`가 오면 등록 경로와 함께 경고를 띄운다. | A8, A9 |
| R04-FR-03 | 기능 | 카테고리(리프), 카테고리 상세(예외·인증), 표준옵션, 속성, 원산지 코드, 주소록, 상품정보고시(SHOES) 메타를 **일 단위로 동기화하고 캐시**한다. 신발 리프 ID는 하드코딩하지 않는다. | C1~C6, 2026-04 개편 |
| R04-FR-04 | 기능 | 이미지 파이프라인은 실제 포맷 판별 → MIME 설정 → 1000×1000 기준 리사이즈·압축(JPEG) → **호출당 10장·합계 10MB 미만으로 분할** → **직렬 업로드** → 받은 `shop-phinf` URL 저장 순서로 처리한다. 대표·추가·상세 이미지 모두 업로드 URL만 쓴다. | 2.4 |
| R04-FR-05 | 기능 | 라쿠텐 데이터와 AI 추출 결과를 `SHOES` 고시 객체로 매핑한다. 소재→`material`(겉감·안감 구분), 굽높이→`height`(없으면 키 삭제), 발길이→`size`(JP cm→mm 병기), 제조국→`originAreaInfo.originAreaCode`(수입산 국가 코드), 제조자와 수입자→`manufacturer`로 보낸다. | 2.5, O6 |
| R04-FR-06 | 기능 | 사이즈 옵션은 기본적으로 **조합형**(`optionGroupName1="사이즈"`)으로 구성하고, 원상품 `stockQuantity`를 옵션 재고 합으로 자동 계산한다. 카테고리가 표준형 옵션을 지원하면(`useStandardOption=true`) 표준형으로 바꿀 수 있게 한다. | 2.6 |
| R04-FR-07 | 기능 | 수집한 manuTag는 중복 제거, 카테고리·브랜드·스토어명 제거, `restricted-tags` 금지어 제거, `recommend-tags` code 매핑을 거쳐 **최대 10개**를 `sellerTags`로 만든다. 오너가 승인 화면에서 편집할 수 있게 한다. | 2.7 |
| R04-FR-08 | 기능 | 해외구매대행 프로필(해외 출고지 주소록 ID, 국내 반품지 ID, 택배사 코드, 배송비·반품비, `customsTaxType`, `businessCustomsClearanceSaleYn`, A/S 정보, importer 표기, 고시 고정 문구)을 **한 번 설정하고 재사용**한다. | 2.3 |
| R04-FR-09 | 기능 | 카테고리 상세의 `exceptionalCategories`에 KC나 어린이제품 인증이 있으면 등록을 막고 오너에게 판단을 요청한다. 구매대행 특례를 선택하면 `KC_EXEMPTION_OBJECT`+`OVERSEAS`를 구성한다. | O7, O9 |
| R04-FR-10 | 기능 | **승인 게이트**: 요청 JSON 미리보기, 상세페이지 렌더링 미리보기, 필드 검증 결과를 보여준다. 오너가 '승인'을 누르기 전에는 등록 API를 호출하지 않는다. 등록 모드는 즉시 전시(ON)와 전시중지 후 확인(SUSPENSION→ON) 중에서 고른다. | 2.8 |
| R04-FR-11 | 기능 | 등록한 상품에 대해 **전시 ON 전환**(GET 후 PUT 전체 본문), 판매중지·재개(change-status), 재고·가격 수정(option-stock, multi-update), 삭제(DELETE origin) 기능을 제공한다. 모든 PUT은 **직전에 GET한 최신 본문을 바탕으로** 만든다. | S-4~S-7, 2.2 수정 API의 동작 |
| R04-FR-12 | 기능 | 라쿠텐 원본 식별자를 `sellerManagementCode`와 로컬 DB 고유 키로 저장해 **같은 라쿠텐 상품이 중복 등록되지 않게** 막는다. | 2.9 |
| R04-FR-13 | 기능 | 400 응답의 `invalidInputs[]`와 `message`를 사람이 읽을 수 있는 한국어 오류로 보여주고, `GNCP-GW-Trace-ID`를 등록 로그에 남긴다. | 2.2, S5 |
| R04-NFR-01 | 비기능 | 모든 API 호출은 응답 헤더의 RateLimit 값을 읽어 **적응형 스로틀링**을 하고, 429(`GW.RATE_LIMIT`)가 오면 지수 백오프로 재시도한다. 이미지 업로드 429는 **직렬 재시도**만 한다. | A11, 2.4 |
| R04-NFR-02 | 비기능 | `client_secret`과 토큰은 평문 로그나 AI CLI 프롬프트에 **절대 넣지 않는다.** 공식 GitHub도 공개 게시를 금지한다. | G1 README |
| R04-NFR-03 | 비기능 | 샌드박스가 없으므로 **드라이런 모드**(검증까지만 하고 호출하지 않음)와 첫 등록의 기본값 SUSPENSION 옵션을 둔다. | A13 |
| R04-NFR-04 | 비기능 | 요청 날짜는 `yyyy-MM-dd'T'HH:mm:ss.SSS+09:00` 형식을 쓰고, 로컬 시계를 NTP와 동기화했는지 점검한다(timestamp 5분 유효). | A6, S6 |
| R04-C-01 | 제약 | 내 스토어 애플리케이션은 **SELF 토큰, 스토어 1개**만 다룬다. 여러 스토어나 SaaS로 확장하려면 솔루션 등록이 따로 필요하다(범위 밖). | A1 |
| R04-C-02 | 제약 | 등록할 때 `statusType`은 SALE로 고정하고, `channelProductDisplayStatusType`은 ON 또는 SUSPENSION만 쓴다. | S-1, S-2 |
| R04-C-03 | 제약 | 해외 출고지를 쓰려면 스마트스토어센터에서 **해외상품판매 권한**을 받고 **해외 주소록을 미리 등록**해야 한다(API 밖의 사전 조건). | O2, O3 |
| R04-C-04 | 제약 | 연 2회 이메일 인증을 하지 않으면 휴면된다. 휴면을 풀면 시크릿이 바뀌므로 앱에 **시크릿 재입력 흐름**이 있어야 한다. | A10 |
| R04-C-05 | 제약 | 2026-06 이후 등록 한도(저실적은 1,000개)와 판매상품비중 3% 정책에 맞춰 **등록 수와 판매 비중을 대시보드에 표시**한다. 판매되지 않는 상품을 정리하는 기능도 검토한다. | 2.9 |

---

## 4. 리스크

| 리스크 | 심각도 | 완화책 |
|---|---|---|
| 가정용 **유동 IP**가 바뀌면 `GW.IP_NOT_ALLOWED`로 모든 호출이 실패한다. IP는 최대 3개만 등록할 수 있다. | 상 | 시작할 때 공인 IP를 점검하고 안내한다(R04-FR-02). 오너 회선이 고정 IP인지 확인한다. 필요하면 고정 IP 회선을 쓴다. |
| 샌드박스가 없어 **실제 스토어에 잘못된 상품이 노출**되거나 법정 고지가 누락될 수 있다. | 상 | 드라이런, 로컬 승인 게이트, SUSPENSION 선등록, 필수 필드 사전 검증 |
| 해외구매대행 표현(해외 출고지, 관부가세, 원산지·수입사, KC 특례)을 잘못 설정하면 **구매자 분쟁**이나 법 위반(전자상거래법 고시, 전안법)이 생긴다. | 상 | 프로필을 한 번 검증하고 재사용한다(R04-FR-08). 카테고리 인증 예외는 자동 차단한다(R04-FR-09). `importer` 표기는 오너와 확정한다. |
| **2026-06 등록 한도 축소**(저실적 1,000개)와 판매상품비중 3%에 걸려 자동 등록한 상품이 판매중지될 수 있다. | 상 | 등록 수 상한 설정, 판매 비중 모니터링, 미판매 상품 정리(R04-C-05) |
| PUT 수정이 **전체 교체**라서 태그, 배송 정보 등이 지워질 수 있다. | 중 | GET→수정→PUT 패턴을 강제한다. 필드 차이를 비교한 뒤 전송한다. |
| 이미지 업로드는 동시에 1건만 되고 10MB 한도가 있어 **대량 등록이 느리다.** | 중 | 직렬 큐, 사전 압축, 진행률 UI |
| 카테고리 개편(2026-04 사례) 때문에 저장해 둔 **리프 ID가 무효화**된다. | 중 | 일 단위 동기화, 무효 ID 감지 후 재매핑 요청 |
| 전시중지 상태에서도 **직접 링크로 구매될 수 있다**(공식 단서). | 중 | 필요하면 change-status SUSPENSION을 함께 건다. 또는 즉시 ON 흐름(A)을 쓴다. |
| 휴면이나 시크릿 변경으로 **인증이 갑자기 끊긴다.** | 중 | 인증 실패 원인을 분류해 안내하고, 시크릿 재입력 UI를 제공한다. |
| manuTag 중 금지어가 섞이거나 code와 text가 맞지 않으면 **등록 400 실패**가 난다. | 하 | restricted-tags 사전 검증, recommend-tags 쌍을 그대로 유지 |
| 호출 한도 수치를 공개하지 않아 **429가 간헐적으로** 난다. | 하 | 헤더 기반 스로틀링과 백오프(R04-NFR-01) |
| 중복상품 정책을 위반하면(같은 상품을 여러 번 등록) **몰 단위 제재**를 받는다. | 중 | 라쿠텐 ID 고유 키, 등록 전 검색(R04-FR-12) |

---

## 5. 오너에게 물어야 할 질문

1. **해외상품판매 권한**을 이미 신청했는가? 스마트스토어 계정이 **통합매니저** 권한인가?
2. 배송 모델은 무엇인가? ① 라쿠텐에서 일본 출고지(배대지 포함)를 거쳐 구매자에게 **해외 직배송**하는가(해외 출고지, 개인통관고유부호 자동, 해외 아이콘), ② 국내로 들여온 뒤 국내에서 발송하는가? 이 답에 따라 `shippingAddressId`, `customsTaxType`, 통관 방식이 정해진다.
3. 판매가에 **관부가세를 포함**하는가(`INCLUDED`)? 사업자 통관(`businessCustomsClearanceSaleYn`)을 쓸 계획이 있는가?
4. 인터넷 회선이 **고정 IP**인가? 유동 IP라면 IP가 바뀔 때마다 API센터에서 수정할 의향이 있는가?
5. 국내 **반품/교환지 주소**와 해외 반품·교환 배송비는 얼마로 정할 것인가? 쓸 **택배사**(해외 배송사)는 무엇인가?
6. 승인 흐름은 (A) 로컬 승인 후 즉시 전시, (B) 전시중지로 올린 뒤 스마트스토어에서 확인하고 전환, (C) 판매기간을 미래로 둔 판매대기 중 무엇이 좋은가?
7. 사이즈별 재고를 몇 개로 표기할 것인가(라쿠텐 재고가 있으면 사이즈당 N개 등)? 라쿠텐 재고·가격 **동기화 주기**는 얼마로 할 것인가?
8. `originAreaInfo.importer`(수입사명)와 고시의 수입자 표기에 **상호명**을 쓸 것인가?
9. **네이버쇼핑 노출**(`naverShoppingRegistration=true`)을 원하는가? 네이버쇼핑 입점(광고주) 상태인가?
10. 현재 **판매자 등급과 최근 3개월 실적**은 어떤가? 등록 한도 1,000개 구간일 가능성을 감안해 월 등록 목표 수를 얼마로 잡을 것인가?
11. A/S 전화번호, A/S 책임자, 고시 고정 문구(청약철회·품질보증)는 무엇으로 할 것인가?
12. 어린이 신발(어린이제품 인증 대상 카테고리)을 **제외**할 것인가?

---

## 6. 출처 목록

**[공식] 커머스API 문서(2.89.0, 2026-09-15)**
- S1 커머스API 소개: https://apicenter.commerce.naver.com/docs/introduction
- S2 인증(전자서명·재시도): https://apicenter.commerce.naver.com/docs/auth
- S3 인증 토큰 발급 요청 `POST /v1/oauth2/token`: https://apicenter.commerce.naver.com/docs/commerce-api/current/exchange-sellers-auth
- S4 제약 사항(TLS, 권한 그룹, Rate/Quota limit): https://apicenter.commerce.naver.com/docs/restriction
- S5 문제 해결(GW 오류 코드, `GW.IP_NOT_ALLOWED`): https://apicenter.commerce.naver.com/docs/trouble-shooting
- S6 RESTful API(호스트, 날짜 형식, 운영 스토어 테스트 면책): https://apicenter.commerce.naver.com/docs/restful-api
- S7 (v2) 상품 등록 `POST /v2/products`: https://apicenter.commerce.naver.com/docs/commerce-api/current/create-product-product · LLM용: https://apicenter.commerce.naver.com/llms/post-v2-products.md
- S8 원상품 정보 구조체: https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/원상품-정보-구조체
- S9 스마트스토어 채널상품 정보 구조체: https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/스마트스토어-채널상품-정보-구조체
- S10 상품 이미지 다건 등록 `POST /v1/product-images/upload`: https://apicenter.commerce.naver.com/docs/commerce-api/current/upload-product · https://apicenter.commerce.naver.com/llms/post-v1-product-images-upload.md
- S11 (v2) 추천 태그 `GET /v2/tags/recommend-tags`: https://apicenter.commerce.naver.com/docs/commerce-api/current/get-recommend-tags-product
- S12 (v2) 제한 태그 `GET /v2/tags/restricted-tags`: https://apicenter.commerce.naver.com/docs/commerce-api/current/is-restrict-tags-product
- S13 판매 상태 변경 `PUT /v1/products/origin-products/{no}/change-status`: https://apicenter.commerce.naver.com/llms/put-v1-products-origin-products-originProductNo-change-status.md
- S14 채널/원상품 수정·삭제: https://apicenter.commerce.naver.com/docs/commerce-api/current/update-channel-product-product · https://apicenter.commerce.naver.com/docs/commerce-api/current/update-origin-product-product · https://apicenter.commerce.naver.com/docs/commerce-api/current/delete-origin-product-product · https://apicenter.commerce.naver.com/docs/commerce-api/current/delete-channel-product-product
- S15 상품 목록 조회 `POST /v1/products/search`: https://apicenter.commerce.naver.com/docs/commerce-api/current/search-product
- S16 멀티 상품 변경·벌크 업데이트: https://apicenter.commerce.naver.com/docs/commerce-api/current/update-multi-products-product · https://apicenter.commerce.naver.com/docs/commerce-api/current/bulk-update-origin-product-product
- S17 카테고리 조회: https://apicenter.commerce.naver.com/docs/commerce-api/current/get-category-list-product · https://apicenter.commerce.naver.com/llms/get-v1-categories-categoryId.md
- S18 카테고리별 표준형 옵션: https://apicenter.commerce.naver.com/docs/commerce-api/current/get-standard-option-by-category-product
- S19 카테고리별 속성·속성값: https://apicenter.commerce.naver.com/docs/commerce-api/current/get-attribute-list-product · https://apicenter.commerce.naver.com/docs/commerce-api/current/get-attribute-value-list-product
- S20 상품정보제공고시 상품군 단건: https://apicenter.commerce.naver.com/docs/commerce-api/current/get-product-info-provided-notice-type-vo-product
- S21 원산지 코드 조회: https://apicenter.commerce.naver.com/docs/commerce-api/current/get-origin-area-list-product · https://apicenter.commerce.naver.com/docs/commerce-api/current/get-sub-origin-area-list-product
- S22 주소록 목록 조회(`overseasAddress`): https://apicenter.commerce.naver.com/docs/commerce-api/current/get-page-addresses-sellers
- S23 LLM용 문서 인덱스: https://apicenter.commerce.naver.com/llms/llms.txt · AI 활용 가이드: https://apicenter.commerce.naver.com/docs/ai-use-guide
- S24 스마트스토어 상품 가이드(Wiki, 2026-09-07): https://apicenter.commerce.naver.com/llms/wiki-스마트스토어-상품-가이드.md

**[공식-FAQ] 커머스API 공식 GitHub**
- G1 저장소 README: https://github.com/commerce-api-naver/commerce-api
- G2 #6 사용량·호출량 제한: https://github.com/commerce-api-naver/commerce-api/discussions/6
- G3 #780 SELF vs SELLER: https://github.com/commerce-api-naver/commerce-api/discussions/780
- G4 #357 timestamp 오류: https://github.com/commerce-api-naver/commerce-api/discussions/357
- G5 #2252 내 스토어 애플리케이션 IP 등록(2025-01-20): https://github.com/commerce-api-naver/commerce-api/discussions/2252
- G6 #2291 호출이 허용되지 않은 IP: https://github.com/commerce-api-naver/commerce-api/discussions/2291
- G7 #117 이미지 업로드 실패 확인사항(2026-03-18): https://github.com/commerce-api-naver/commerce-api/discussions/117
- G8 #486 "이전 요청이 진행중입니다": https://github.com/commerce-api-naver/commerce-api/discussions/486
- G9 #704 인증 정보 수록 방법(KC·구매대행): https://github.com/commerce-api-naver/commerce-api/discussions/704
- G10 #2216 전시상태 enum, 상세 HTML, 이미지: https://github.com/commerce-api-naver/commerce-api/discussions/2216
- G11 #1964 외부 이미지 URL: https://github.com/commerce-api-naver/commerce-api/discussions/1964
- G12 #1330 등록불가 태그: https://github.com/commerce-api-naver/commerce-api/discussions/1330
- G13 #1650 채널상품 수정 시 seoInfo 초기화: https://github.com/commerce-api-naver/commerce-api/discussions/1650
- G14 #1882 detailContent InvalidImageUrl: https://github.com/commerce-api-naver/commerce-api/discussions/1882
- G15 #241 / #246 요청 구성(고시 1개 유형, JSON 주석 불가, 패션잡화 50000001): https://github.com/commerce-api-naver/commerce-api/discussions/241 · https://github.com/commerce-api-naver/commerce-api/discussions/246
- G16 #3212 이미지 형식 오류(2026-02-05): https://github.com/commerce-api-naver/commerce-api/discussions/3212
- G17 #1194 조합형 옵션 재고 합: https://github.com/commerce-api-naver/commerce-api/discussions/1194
- 릴리즈 노트 카테고리: https://github.com/commerce-api-naver/commerce-api/discussions/categories/%EB%A6%B4%EB%A6%AC%EC%A6%88-%EB%85%B8%ED%8A%B8

**[공식-FAQ] 스마트스토어 고객센터**
- H1 태그 몇 개까지: https://help.sell.smartstore.naver.com/faq/content.help?faqId=3954
- H2 검색설정 유의사항: https://help.sell.smartstore.naver.com/faq/content.help?faqId=4192
- H3 이미지 권장 사이즈·확장자: https://help.sell.smartstore.naver.com/faq/content.help?faqId=3378
- H4 개인통관고유부호 설정: https://help.sell.smartstore.naver.com/faq/content.help?faqId=4721
- H5 '해외' 아이콘·해외상품판매 권한: https://help.sell.smartstore.naver.com/faq/content.help?faqId=4022
- H6 구매대행 KC 기재: https://help.sell.smartstore.naver.com/faq/content.help?faqId=4736
- H7 해외구매대행 판매 불가 상품: https://help.sell.smartstore.naver.com/faq/content.help?faqId=3407
- H8 상세페이지 HTML 차단 태그·외부링크: https://help.sell.smartstore.naver.com/faq/content.help?faqId=4414
- H9 원산지 등록 기준: https://help.sell.smartstore.naver.com/faq/content.help?faqId=6410
- H10 병행수입/구매대행 KC 수정: https://help.sell.smartstore.naver.com/faq/content.help?faqId=4745

**[2차] 제3자 자료**
- T1 사이드사람, 스토어 애플리케이션 인증·API호출 IP(2025-05-13): https://sidesaram.com/entry/%EB%84%A4%EC%9D%B4%EB%B2%84-%EC%BB%A4%EB%A8%B8%EC%8A%A4API%EC%84%BC%ED%84%B0-%E2%80%93-%EC%8A%A4%ED%86%A0%EC%96%B4-%EC%95%A0%ED%94%8C%EB%A6%AC%EC%BC%80%EC%9D%B4%EC%85%98-%EC%9D%B8%EC%A6%9D-%EB%B0%8F-API%ED%98%B8%EC%B6%9C-IP-%EC%B6%94%EA%B0%80-%EA%B0%80%EC%9D%B4%EB%93%9C
- T2 이셀러스, 커머스 API 휴면 해제(2025-04-07): https://www.esellers.co.kr/cms/faq/detail/25283
- T3 헤이셀러, 스마트스토어 'API 방식' 연동: https://heyseller.oopy.io/1458b36b-156e-80c1-8ff8-c5cfa4707a17
- T4 서울경제, 네이버 좀비상품 정리(2026-04-27): https://m.sedaily.com/amparticle/20037664
- T5 온채널, 스마트스토어 등록 한도 변경 총정리(2026-04-13): https://www2.onch3.co.kr/bbs_view.php?num=13&vnum=15987
- T6 장사왕, 판매자 등급 기준 개편(2025-11-05): https://www.sellerking.io/blog/smartstore-seller-grade-criteria-update
- T7 윈들리, 네이버쇼핑 카테고리 개편(2026-04-30): https://www.windly.cc/blog/naver-shopping-2026-ads-benefit
- T8 고도몰 가이드, 상품정보제공고시(신발): http://guide.godo.co.kr/guide/php/information.by.goods/information.by.goods.htm
- T9 디애드, 네이버 쇼핑 중복 몰 집중모니터링(연도 미확인): https://m.diad.co.kr/Customer/NoticeView?idx=528
- 네이버 DataLab 쇼핑인사이트 API 문서(대분류 코드 예시): https://developers.naver.com/docs/serviceapi/datalab/shopping/shopping.md

> 조사 방법 메모: apicenter 문서 페이지의 Request Body는 클라이언트에서 렌더링된다. 그래서 문서 번들(JS chunk)에 들어 있는 OpenAPI(`api` frontmatter, deflate+base64)를 풀어 필드, required, enum, 설명을 직접 대조했다. 로그인, 가입, 게시, 주문은 하지 않았다.

---

## 검증 결과 (적대적 재검증)

- 검증일: 2026-09-24
- 검증 방법: 조사자가 붙인 출처를 그대로 믿지 않고 1차 출처를 직접 내려받아 다시 대조했다. 대조한 자료는 ① 커머스API 문서 2.89.0의 OpenAPI 번들(`exchange-sellers-auth`, `create-product-product`, `update-channel-product-product`, 원산지·주소록 청크를 직접 디코딩), ② `apicenter.commerce.naver.com/llms/*.md` 공식 LLM 문서, ③ 공식 GitHub Discussions 원문(#780, #357, #2291, #2252, #6, #2216, #1650, #704), ④ 커머스API센터 공지 원문(`notice.naver.com/notices/cac/*`), ⑤ 스마트스토어 고객센터 FAQ(4022, 4721)다. 로그인, 등록, 주문, 과금 호출은 하지 않았다.
- 요약: 12건 중 **CONFIRMED 9건, CORRECTED 3건(F05, F07, F10)**이고 REFUTED와 UNVERIFIABLE은 없다. 다만 조사자가 빠뜨린 **최근 공지 두 건(해외구매대행 전자상거래업자부호 의무화, 토큰 발급 규격 위반 시 시간당 1회 제한)**은 PRD에 바로 반영해야 할 만큼 중요하다.

### 판정 표

| 항목 | 주장 | 판정 | 정정 내용 | 근거 URL |
|---|---|---|---|---|
| F01 | 내 스토어 앱은 `type=SELF`만 가능하고 `account_id`는 필요 없다. 솔루션 앱(SELLER)은 입점 개발사 전용이다. 스토어와 1:1로 연결된다. | CONFIRMED | 본문은 맞다. 보충할 점이 두 가지 있다. ① 솔루션 앱은 SELLER 전용이 아니라 SELF와 SELLER를 **둘 다** 발급한다. ② 2025-05-23 공지와 2026-08-21 재공지 이후로는 `account_id`가 "필요 없다" 수준이 아니다. **SELF 요청에는 `account_id`를 넣으면 안 된다.** 이 규격을 어기면 호출이 시간당 1회로 제한된다(누락 주제 M2). | https://github.com/commerce-api-naver/commerce-api/discussions/780 · https://notice.naver.com/notices/cac/33676 |
| F02 | 토큰은 `POST /external/v1/oauth2/token`(x-www-form-urlencoded)으로 발급한다. 필수 파라미터는 5개(`client_id`, `timestamp`(13자리 ms, 5분 유효), `grant_type`, `client_secret_sign`, `type`)이고, 서명은 Base64(bcrypt(`id_timestamp`, secret))다. | CONFIRMED | OpenAPI의 requestBody가 `application/x-www-form-urlencoded`이고 required 5개가 일치한다. 13자리 규칙은 #357 공식 답변에 있다. 참고로 llms `.md`의 curl 예시에는 `Content-Type: application/json`과 Bearer 헤더가 들어 있는데, 이는 자동 생성된 템플릿 오류다. 따라서 **llms 예시를 그대로 AI CLI에 넘기면 안 된다.** | https://apicenter.commerce.naver.com/docs/commerce-api/current/exchange-sellers-auth · https://apicenter.commerce.naver.com/llms/intro-인증.md · https://github.com/commerce-api-naver/commerce-api/discussions/357 · https://notice.naver.com/notices/cac/22081 |
| F03 | 토큰은 3시간(10,800초) 유효하다. 남은 시간이 30분 이상이면 기존 토큰을, 30분 미만이면 새 토큰을 준다. 401 `GW.AUTHN`이 오면 재발급한다. | CONFIRMED | 문서 원문과 일치한다. 새 토큰이 발급돼도 기존 토큰은 만료 전까지 쓸 수 있다는 문구도 확인했다. | https://apicenter.commerce.naver.com/docs/commerce-api/current/exchange-sellers-auth · https://apicenter.commerce.naver.com/docs/auth |
| F04 | IP 화이트리스트가 있다. 등록하지 않은 IP에서는 403 `GW.IP_NOT_ALLOWED`가 나고, 최대 3개까지 등록하며, IP가 없으면 인증이 되지 않는다. | CONFIRMED | 2차 출처로만 잡혀 있던 **"최대 3개"를 공식 공지에서 확인했으므로 신뢰도를 high로 올린다**("등록 개수: 3개", **IPv4 형식만** 허용). 같은 공지에 "IP가 등록되지 않은 내 스토어 애플리케이션은 인증을 진행할 수 없습니다"라는 문구가 있다. 연 2회 인증의 정식 명칭은 "통합매니저 인증"이며, 기한 안에 인증하지 않으면 휴면 처리된다. 내 스토어 앱은 **스토어당 1개**로 제한된다. | https://apicenter.commerce.naver.com/docs/trouble-shooting · https://notice.naver.com/notices/cac/15894 · https://github.com/commerce-api-naver/commerce-api/discussions/2291 · https://github.com/commerce-api-naver/commerce-api/discussions/2252 |
| F05 | Rate limit은 Token bucket 방식이고 수치는 공개하지 않는다. 헤더 3종으로 확인하며 초과하면 429 `GW.RATE_LIMIT`이 온다. Quota limit은 내 스토어 앱에 적용되지 않고 일 한도는 문서에 없다. | CORRECTED | Rate limit 부분(헤더, 버스트 2배, 429)은 맞다. 그러나 "Quota는 내 스토어 앱에 적용되지 않는다"는 단정은 정확하지 않다. 공식 '제약 사항' 문서의 Quota 적용 대상에는 **"API데이터솔루션을 구독 후 API를 호출하는 판매자"(단위: 구독 회차)**가 들어 있다. 따라서 판매자가 API데이터솔루션을 구독하면 해당 API에는 Quota가 걸린다(상품 등록 API와는 무관하다). #6이 말한 "커머스솔루션·API대행사만 해당"은 2022년 기준 서술이다. 여기에 더해 2026-08-21부터는 **토큰 발급 규격을 위반한 내 스토어 앱이 시간당 1회로 제한**된다(Quota와 별개인 운영 제재). #6에는 "API 수용량"이라는 상위 계층도 있어서, 내 Rate limit이 남아 있어도 429가 날 수 있다. | https://apicenter.commerce.naver.com/docs/restriction · https://apicenter.commerce.naver.com/llms/intro-제약사항.md · https://github.com/commerce-api-naver/commerce-api/discussions/6 · https://notice.naver.com/notices/cac/33676 |
| F06 | `POST /v2/products`의 최상위 필수, `originProduct` 필수, `detailAttribute` 필수, 등록 시 필수(`leafCategoryId`, `stockQuantity`, `productInfoProvidedNotice`), `smartstoreChannelProduct` 필수. `deliveryInfo`를 빼면 배송 없는 상품이 된다. | CONFIRMED | OpenAPI 2.89.0의 required 배열과 설명이 모두 일치한다. 응답에는 `windowChannelProductNo`도 있다. 보충: `optionInfo`를 넣을 때는 단독형, 조합형, 직접입력형 중 최소 1개가 있어야 한다. | https://apicenter.commerce.naver.com/docs/commerce-api/current/create-product-product · https://apicenter.commerce.naver.com/llms/post-v2-products.md |
| F07 | 등록할 때 `statusType`은 SALE만 가능하다(SUSPENSION을 넣어도 SALE로 등록된다). 전시상태는 ON과 SUSPENSION만 허용되고 **WAIT을 넣으면 `NotValidEnum` 오류**가 난다. | CORRECTED | SALE 고정, SUSPENSION→SALE 처리, ON/SUSPENSION만 허용된다는 것은 스펙과 공식 답변으로 확인했다. 그러나 **#2216에서 `NotValidEnum`이 난 입력값은 WAIT가 아니라 `"SELL"`(enum에 없는 값)이었다.** WAIT은 enum 안에 있는 값이므로, 넣었을 때 어떤 오류 코드와 메시지가 나는지는 1차 출처로 확인되지 않는다. 올바른 서술은 "WAIT은 사용자가 설정할 수 없다(시스템·검수용 전시대기). 등록·수정 때는 ON/SUSPENSION만 넣는다"이다. | https://github.com/commerce-api-naver/commerce-api/discussions/2216 · https://apicenter.commerce.naver.com/llms/wiki-스마트스토어-상품-가이드.md |
| F09 | `PUT /v1/products/origin-products/{no}/change-status`의 전이 규칙. | CONFIRMED | 원문과 일치한다. 보충: SALE→OUTOFSTOCK으로 바꾸면 재고가 0이 된다. 재고가 0이면 전달값과 관계없이 OUTOFSTOCK이 유지되지만, 현재 상태가 SUSPENSION이면 SUSPENSION이 유지된다. UNADMISSION·REJECTION·CLOSE·PROHIBITION·DELETE는 전이할 수 없다. | https://apicenter.commerce.naver.com/llms/put-v1-products-origin-products-originProductNo-change-status.md |
| F10 | 원상품·채널상품 PUT은 전체 교체다. 예외는 `leafCategoryId`, `detailContent`, `productInfoProvidedNotice` 셋이다. `seoInfo`를 빼면 태그가 초기화된다. 전시상태만 바꾸는 전용 API는 없다. DELETE 두 종류와 search(SELLER_CODE, 500건)가 있다. | CORRECTED | 전체 교체 원칙, `seoInfo` 초기화, 전시 전용 API 부재, DELETE, search(500건, SELLER_CODE)는 맞다. **예외 목록은 불완전하다.** 스펙 설명상 생략하면 기존 값이 유지되는 필드는 `detailContent`, `productInfoProvidedNotice`(기존 값이 있을 때), **`stockQuantity`("입력하지 않으면 현재 재고 값이 변하지 않습니다")**, **`skuYn`**, **`optionDeliveryAttributes`**다. 반대로 `leafCategoryId`는 "수정 시 modelId를 입력한 경우 필수"라고만 되어 있고 '유지된다'는 문구는 없다. 추가로 **`superDangolYn`은 생략하거나 null이면 기존 설정이 초기화**된다. 공식 답변도 "설명이 없는 필드는 값이 유지되지 않는다"는 입장이다. 따라서 GET→수정→PUT 원칙은 그대로 유효하다. | https://apicenter.commerce.naver.com/llms/wiki-스마트스토어-상품-가이드.md · https://apicenter.commerce.naver.com/docs/commerce-api/current/update-channel-product-product · https://github.com/commerce-api-naver/commerce-api/discussions/1650 · https://apicenter.commerce.naver.com/llms/post-v1-products-search.md |
| F11 | 구매대행 단일 플래그는 없다. 해외상품판매 권한, 해외 출고지, `customsTaxType`, 원산지 02+`importer`, KC 특례 `KC_EXEMPTION_OBJECT`+`OVERSEAS`를 조합한다. 해외 아이콘은 자동으로 붙고, 권한은 해제할 수 없다. | CONFIRMED | 필드 정의(`customsTaxType`은 해외 출고지면 필수, `kcExemptionType` enum, `overseasAddress`), FAQ 4022(해외 아이콘 자동 노출, 권한 해제 불가), #704(구매대행은 인증 정보가 없어도 등록 가능, 2026-09-07 갱신)를 모두 확인했다. **다만 조합 요소가 하나 빠졌다.** 2026-08-19부터 해외상품판매 권한을 신청할 때 **전자상거래업자부호**가 필수이고, 2026-10-12부터는 부호를 등록하지 않으면 권한을 회수하고 기존 해외배송 상품의 판매를 중지한다(누락 주제 M1). | https://apicenter.commerce.naver.com/docs/commerce-api/current/create-product-product · https://help.sell.smartstore.naver.com/faq/content.help?faqId=4022 · https://github.com/commerce-api-naver/commerce-api/discussions/704 · https://notice.naver.com/notices/cac/32908 |
| F12 | 개인통관고유부호는 상품 필드가 아니다. 출고지가 해외면 주문서에 입력란이 자동으로 나온다. 사업자 통관이면 `businessCustomsClearanceSaleYn=true`로 하고 입력은 필수가 아니다. | CONFIRMED | FAQ 4721 원문과 일치한다. 보충: 설정한 시점 이후 주문부터 적용되며, 개인통관 상품과 사업자통관 상품을 함께 주문하면 개인통관고유부호가 필수다. `businessCustomsClearanceSaleYn`은 출고지가 해외일 때만 적용된다. 2026-10-14부터 해외배송 주문이 관세청과 연동되므로 통관 흐름이 바뀔 수 있다. | https://help.sell.smartstore.naver.com/faq/content.help?faqId=4721 · https://notice.naver.com/notices/cac/32908 |
| F13 | 원산지 코드 00~05, `GET /v1/product-origin-areas/query?name=(대륙 > 국가명)`, sub-origin-areas. 구매대행 `importer` 기준은 찾지 못했다. | CONFIRMED | 코드 체계와 조회 형식(수입산 "대륙 > 국가명", 마지막 항목은 LIKE 검색)이 원문과 일치한다. `importer`는 스펙상 "수입산인 경우 필수"라고만 되어 있고, 구매대행 표기 기준은 이번 검증에서도 1차 출처로 찾지 못했다(미확인 유지). 보충: 2026-07-22 행정체계 개편으로 국내 원산지 코드가 바뀌었으므로 원산지 코드는 **하드코딩하지 말고 캐시를 주기적으로 갱신**해야 한다. | https://apicenter.commerce.naver.com/llms/get-v1-product-origin-areas-query.md · https://apicenter.commerce.naver.com/llms/get-v1-product-origin-areas-sub-origin-areas.md · https://notice.naver.com/notices/cac/32899 |

### 누락 주제 (PRD 반영 필요)

| # | 주제 | 내용 | 근거 |
|---|---|---|---|
| M1 | **전자상거래업자부호(관세청 통관 플랫폼) 의무화** | 2026-08-19부터 해외상품판매 권한을 새로 신청할 때 부호 입력이 필수다. **2026-10-12**부터는 부호를 등록하지 않으면 해외상품판매 권한을 회수하고 기존 해외배송 상품의 판매를 중지하며, API로 등록·수정하는 것도 막힐 수 있다. 2026-10-14부터 해외배송 주문이 관세청과 연동된다. 오너 사전 조건과 앱 시작 점검 항목에 넣어야 한다. | https://notice.naver.com/notices/cac/32908 |
| M2 | **토큰 발급 규격 강제(시간당 1회 제재)** | body는 반드시 x-www-form-urlencoded로 보내고, SELF 요청에는 `account_id`를 넣지 않으며, `grant_type`을 반드시 포함해야 한다. 한 건이라도 어기면 내 스토어 앱의 API 호출이 **시간당 1회로 제한**된다. 제한 여부는 전날 요청을 기준으로 판정한다. 인증 모듈 단위 테스트에 넣어야 한다. | https://notice.naver.com/notices/cac/33676 · https://notice.naver.com/notices/cac/22081 |
| M3 | 판매가+옵션가 하한 검증 | 2026-09-16부터 `salePrice`와 조합형 옵션 `price`의 합이 10원 미만이면 등록·수정이 실패한다. 음수 옵션가를 쓸 때 주의해야 한다. | https://notice.naver.com/notices/cac/33997 |
| M4 | `customsTaxType` 도입 경위 | 2026-03-09에 추가됐다. 기존 해외 출고 상품의 초기값은 `NOT_APPLICABLE`이므로 실제 조건으로 갱신해야 한다. 해외직구 쇼핑윈도 연동이면 `INCLUDED`만 허용된다. | https://notice.naver.com/notices/cac/29294 |
| M5 | 등록 한도 공식 공지와 삭제 정책 | 커머스API센터 공지(2026-05-26)로 공식 확인했다. 판매 이력이 없는 상품은 판매중지되고, **판매중지 상품 중 수정 이력이 없는 상품은 삭제**된다. 따라서 'SUSPENSION으로 등록한 뒤 방치'하면 삭제될 위험이 있다. 본문 2.9의 신뢰도(medium)를 이 공지로 보강한다. | https://notice.naver.com/notices/cac/31786 |
| M6 | 내 스토어 앱 운영 제약 | 스토어당 1개, **통합매니저** 권한 필요, IPv4만 등록 가능, 연 2회 통합매니저 인증. 이 밖에 API센터 로그인 2단계 인증(2025-10-29), 장애 안내 메일을 커머스ID 이메일로 통합(2026-09-30), 스토어가 이용정지 상태이면 토큰 발급이 거부된다. | https://notice.naver.com/notices/cac/15894 · https://notice.naver.com/notices/cac/26806 · https://notice.naver.com/notices/cac/33748 · https://notice.naver.com/notices/cac/21555 |
| M7 | 전시중지 상태에서의 구매 가능성 | 공식 가이드에 "전시 채널에 따라 상세 페이지에 직접 접근하면 구매가 가능할 수도 있음"이라는 각주가 있다. 2단계 승인 흐름(B)에서 원상품 `change-status`(SUSPENSION)를 함께 쓸지 결정해야 한다. | https://apicenter.commerce.naver.com/llms/wiki-스마트스토어-상품-가이드.md |
| M8 | 등록 후 검수 모니터링 | 검수 전이(UNADMISSION, 전시 WAIT)와 수정 요청 상품은 `GET /v1/product-inspections/channel-products`로 추적해야 한다. 등록 결과 화면과 알림에 반영한다. | https://apicenter.commerce.naver.com/llms/llms.txt |
| M9 | 공지 구독 운영 | 커머스API 스펙이 거의 매주 바뀐다(v2.81→2.89, 2026-06~09). 공지 목록(`notice.naver.com/notices/cac`)과 문서 버전을 주기적으로 확인하는 운영 절차가 필요하다. | https://notice.naver.com/notices/cac/34262 |
| M10 | llms `.md` 신뢰 범위 | llms 문서의 서술 문단과 curl 예시는 자동 생성된 것이라 오류가 있다(토큰 API 예시의 JSON Content-Type 등). AI CLI에 넘길 때는 **표(요청·응답 스키마)만 신뢰**하라고 프롬프트에 명시해야 한다. | https://apicenter.commerce.naver.com/llms/post-v1-oauth2-token.md |

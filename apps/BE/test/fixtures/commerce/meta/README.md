# 커머스API 메타데이터 fixture (P1-08)

가짜 커머스 메타 서버(`test/support/fake-commerce-meta.ts`)가 돌려줄 응답이다. 실제 커머스API를 부르지 않고 손으로 만들었다.
커머스API 앱 등록(PRD §0 5번)·M0 S3 전이라 **실제로 받은 응답은 하나도 없다.** 모든 파일이 R04 표(C1~C5, A3, A11, O3, F13)를 보고 만든
**M0 S3 전 추정**이다(ERD §7.3-9). 카테고리 ID·원산지 코드·주소록 번호는 모두 지어낸 값이고, 주소는 `[배대지 창고]` 같은 자리표시자만 쓴다.

파일 모양은 인증 fixture와 같다: `{ "status": <HTTP 상태>, "headers": { … }, "body": <응답 본문> }`.

| 파일                                                    | 대상                    | 근거·추정                                                                                                                                                                  | 쓰는 곳                          |
| ------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `categories-last.json`                                  | CATEGORY                | R04 C1(`id`·`name`·`wholeCategoryName`·`last`), 최상위 배열은 **추정**. 남성신발 리프 4(그중 `50000794`는 상세가 CHILD_CERTIFICATION), 여성신발 리프 3, 신발 밖 리프 1 = 8 | 첫 동기화, 성별 필터             |
| `categories-last-v2.json`                               | CATEGORY                | 위에서 `50000793`(로퍼)을 빼고 `50000795`(보트슈즈)를 더함, `50000802` 이름 변경                                                                                           | `removed_at`·다시 나타남·값 변경 |
| `category-detail-50000791.json`                         | CATEGORY_DETAIL         | R04 C2(`exceptionalCategories`·`certificationInfos`). 예외 `KC_CERTIFICATION` 1                                                                                            | 예외 유형 저장                   |
| `category-detail-50000794.json`                         | CATEGORY_DETAIL         | 예외 `CHILD_CERTIFICATION`(+KC)                                                                                                                                            | 아동 인증 리프 빼기              |
| `category-detail-50000801.json`                         | CATEGORY_DETAIL         | 예외 없음                                                                                                                                                                  | 빈 배열                          |
| `standard-options-50000791.json`                        | STANDARD_OPTIONS        | R04 C4(`useStandardOption`·`standardOptionCategoryGroups`)                                                                                                                 | 문서 저장                        |
| `product-attributes-50000791.json`                      | PRODUCT_ATTRIBUTES      | R04 C5 `…/attributes`. 필드 이름은 **추정**                                                                                                                                | 문서 저장(`attributes`)          |
| `product-attribute-values-50000791.json`                | PRODUCT_ATTRIBUTES      | R04 C5 `…/attribute-values`. 필드 이름은 **추정**                                                                                                                          | 문서 저장(`attributeValues`)     |
| `provided-notice-shoes.json`                            | PROVIDED_NOTICE         | R04(S20) 상품군 `SHOES`. 항목 모양은 **추정**                                                                                                                              | 문서 저장(scope `SHOES`)         |
| `origin-areas.json`                                     | ORIGIN_AREA             | R04 F13(코드 00~05). `{ originAreaCodeNames: [{ code, name }] }`는 **추정**                                                                                                | 맨 위 코드 4개                   |
| `origin-areas-sub-02.json`                              | ORIGIN_AREA             | `sub-origin-areas?code=02`(하위 계층 1개). 국가 코드는 지어낸 값                                                                                                           | `parentCode`=`02`                |
| `origin-areas-sub-empty.json`                           | ORIGIN_AREA             | 하위가 없는 코드의 빈 목록(**추정**)                                                                                                                                       | 기본 응답                        |
| `addressbooks-page-1.json` · `addressbooks-page-2.json` | ADDRESSBOOK             | R04 A3·O3(`overseasAddress`·`addressType=RELEASE`). 페이지 칸(`totalPages`)·목록 키(`addressBooks`)는 **추정**. 해외 2·국내 2                                              | 페이지 넘김, `is_overseas`       |
| `return-delivery-companies.json`                        | RETURN_DELIVERY_COMPANY | 최상위 배열 `deliveryCompanyCode`·`deliveryCompanyName`은 **추정**                                                                                                         | 3개                              |
| `error-500.json`                                        | (공통)                  | 게이트웨이 오류 본문 모양(R04 §2.2). 코드는 **추정**                                                                                                                       | 실패 격리                        |
| `error-429-rate-limit.json`                             | (공통)                  | R04 A11(`GW.RATE_LIMIT`, `GNCP-GW-RateLimit-*` 헤더). 헤더 값은 **추정**                                                                                                   | 늦추기·다시 보내기               |
| `error-403-api-group.json`                              | ADDRESSBOOK             | R04 A3('판매자정보' 그룹 없음). 코드·문구는 **형식 추정**                                                                                                                  | 권한 안내 문구                   |

- fixture가 없는 카테고리의 상세·표준옵션·속성은 가짜 서버가 목록 값으로 빈 기본 응답을 만든다(예외 없음, 옵션 없음, 속성 없음).
- 실제 앱을 등록한 뒤(M0 S3) 받은 응답으로 이 파일들과 `apps/BE/src/modules/integrations/commerce-meta/mappers/*.ts`,
  `commerce-meta.constants.ts`의 경로·쿼리 이름을 함께 고친다. 변환 함수만 고치면 되게 원문(`raw`·문서 payload)을 그대로 둔다.

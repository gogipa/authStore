# ⑨ 등록 fixture (P4-03)

커머스API 상품 등록(`POST /v2/products`)과 판매자관리코드 조회(`POST /v1/products/search`)의 **가짜 응답**이다. 실제 커머스API를
부르지 않는다(실제 스토어 — 샌드박스 없음). 값은 모두 합성이고 실제 상품 번호가 아니다.

| 파일                                    | 쓰는 곳                        | 내용                                                                                                                                                        |
| --------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `products.200.json`                     | 등록 성공                      | `{ originProductNo, smartstoreChannelProductNo }`(숫자) + `GNCP-GW-Trace-ID`                                                                                |
| `products.400-invalid-inputs.json`      | 4xx 종결                       | `code`·`message`·`invalidInputs` 2건(아는 칸·종류 1건 — 태그 Restricted, 모르는 칸·종류 1건) + Trace-ID 헤더                                                |
| `products.500.json`·`products.503.json` | 결과확인필요                   | 5xx 오류 본문                                                                                                                                               |
| `products-search.found.json`            | 결과 확인(찾음)·중복 교차 확인 | `contents[0].originProductNo`·`channelProducts[0].channelProductNo`·`sellerManagementCode` — `{sellerManagementCode}` 자리는 가짜 서버가 받은 코드로 바꾼다 |
| `products-search.empty.json`            | 결과 확인(없음)                | `contents: []`                                                                                                                                              |

타임아웃(응답을 보내지 않음)·연결 끊김(ECONNRESET)·붙잡기(재시작 시험)는 파일이 아니라 가짜 서버 모드다
(`test/support/fake-commerce-products.ts` — `createMode = 'TIMEOUT' | 'RESET' | 'HOLD'`).

**M0 S3 전 가정**(실측 뒤 이 파일들과 `commerce-products.http-adapter.ts`의 `createdProductNumbersOf`·`sellerCodeProductOf`, 05-1 §7.5
'P4-03 구현 결정'을 함께 고친다):

- 등록 2xx 본문의 상품 번호 칸 이름(`originProductNo`·`smartstoreChannelProductNo`)과 숫자 모양(int64)
- 4xx 본문 `invalidInputs[] = { name, type, message }`의 `name`(요청 본문 경로)·`type`(검증 규칙) 값
- 검색 요청 본문 `{ searchKeywordType: 'SELLER_CODE', sellerManagementCode, page, size }`와 응답 `contents[].channelProducts[]` 모양,
  SELLER_CODE 검색으로 채널 상품 번호를 얻는지(ERD §7.3-6)
- 판매자관리코드 길이·문자 제한(ERD §7.3-5) — 지금은 `RKT:{itemCode}:{colorCode}` 그대로 보낸다

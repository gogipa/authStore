# ⑧ 이미지 업로드 fixture (P4-01)

합성 값(실제 상품·실제 응답이 아니다). 커머스API를 부르지 않는다. 업로드 응답 모양(`{images:[{url}]}`, URL 배열 순서 = multipart
`imageFiles` 부분 순서)은 **M0 S3 전 가정**이다 — 실측 뒤 이 fixture와 `commerce-images.http-adapter.ts`의 `uploadUrlsOf`만
고친다.

| 파일                             | 내용                                                                                                                         | 쓰임                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `product-images-upload.200.json` | `{status, headers(GNCP-GW-Trace-ID), body:{images:[{url}×2]}}` — 가짜 shop-phinf 주소 2개                                    | 어댑터 단위 테스트, 가짜 서버 응답 모양·Trace-ID                |
| `product-images-upload.400.json` | 400 오류 본문(`code`·`message`·`traceId`·`invalidInputs`)                                                                    | 어댑터 단위 테스트(`HTTP_400`)                                  |
| `product-images-upload.500.json` | 500 오류 본문                                                                                                                | 어댑터 단위 테스트·e2e(⑧ FAILED `EXTERNAL_API`)                 |
| `gen-1024.png`                   | PNG 1024×1024(단색 블록)                                                                                                     | 정규화(PNG → 1000×1000 JPEG), e2e 대표 이미지                   |
| `gen-webp-named.jpg`             | 이름은 `.jpg`, 내용은 WebP 1024×1024                                                                                         | 정규화(판별 결과 `image/webp`), e2e 추가 이미지                 |
| `gen-portrait.png`               | PNG 600×900(정사각 아님)                                                                                                     | 정규화(흰색 채우기 — Proposed), e2e 원본(참조 전용) 억지 넣기   |
| `big-4mb.jpg`                    | JPEG 2048×2048 고정 시드 잡음(약 4MB)                                                                                        | 정규화(10MB 미만), 서비스 묶음 나누기(상한을 줄여 여러 번 보냄) |
| `html-with-placeholders.html`    | P3-04 ⑥-3 상세 HTML 스냅숏 그대로(자리표시자 10칸·고지 블록)                                                                 | `detail-content` 단위 테스트, e2e ⑥-3 HTML                      |
| `seed-upload-ready.ts`           | `seedUploadReady`(후보 + ⑤ 완료·G3 통과·선택본 2장 + ⑥-3 완료), `insertNoticeHtmlVersion`, `truncateUpload`, `UPLOAD_TABLES` | e2e                                                             |

- 이미지는 sharp로 만들었다(사람·상품 사진 아님). 다시 만들 일이 있으면 같은 크기·형식으로 만든다(테스트는 크기·형식만 본다).
- 가짜 커머스 서버·fixture 포트는 `test/support/fake-commerce-images.ts`(`FakeCommerceImagesServer` — 요청 수·부분 수·바이트 합
  기록, `FixtureCommerceImagesPort` — 단위 테스트용 포트).

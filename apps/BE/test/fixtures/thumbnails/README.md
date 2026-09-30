# ⑤ 썸네일 fixture (P3-01)

합성 값이다(실제 상품·실제 인물 아님). 라쿠텐·이미지 CDN을 부르지 않는다 — e2e는 가짜 fetch가 아래 파일로 답해 실제 어댑터와
외부 호출 관문(허용 목록·`call_log` `RAKUTEN_IMAGE`)을 지난다. P3-02가 같은 도우미를 다시 쓴다.

| 파일                               | 내용                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rakuten-item-asics-1201A019.json` | 화면시안\_명세 §4 후보 A(아식스 젤카야노 14 · 크림/블랙, `shop-a:10000123`)의 ② 산출물: `rakuten_item`·SKU 2개(색상 108)·앵커, `image_urls` 6개와 파일 짝, `_ex` 대체용 Item Search 항목 |
| `images/original-1.jpg` ~ `-6.jpg` | sharp로 만든 작은 실제 JPEG(단색 240×240, 6번만 320×240). 파일마다 SHA-256이 다르다                                                                                                      |
| `images/png-named.jpg`             | 확장자는 jpg, 내용은 PNG(200×200) — 형식을 내용으로 판별하는지 본다                                                                                                                      |
| `settings-thumbnail.json`          | `thumbnail` 섹션(기본 템플릿과 같은 PRD §8.4 골격) + 테스트용 가상 차단어 추가분 2개(`personBlockWordsExtra` — 실존 인물 아님)                                                           |
| `seed-thumbnail-waiting.ts`        | `seedThumbnailSourcing`(후보 + ② 완료) · `seedThumbnailWaiting(t)`(실제 ⑤ 실행기로 입력 대기까지) · `thumbnailFetchHandler` · `settingsWithThumbnail` · `truncateThumbnails`             |

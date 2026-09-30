# 라쿠텐 fixture (P2-02·P2-03)

**합성 fixture다.** 실제 라쿠텐(Item Search·IchibaGenre API, 상품 페이지)을 부르지 않고 PRD §8.2 RK-01·RK-04의 응답 모양을
흉내 내 손으로 만들었다. M0 S2에서 받은 실측 응답·페이지로 바꾼다. 페이지 JSON 경로가 다르면
`src/modules/sourcing/page-json.constants.ts`(경로 상수 한 곳)만 고치고, API 응답 모양이 다르면
`src/modules/integrations/rakuten/rakuten-search.request.ts`·`rakuten-genre.http-adapter.ts`의 읽기 함수만 고친다.

## search/ — Item Search `20260701`(formatVersion=2 평탄형)

| 파일                                | 내용                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asics-1201a019-p1.json`            | 'アシックス ゲルカヤノ14' 1페이지 30건(count 60). 상품명에 キッズ가 든 2건 → 비교표 28행                                                                                                                                  |
| `asics-1201a019-p2.json`            | 같은 검색 2페이지 30건                                                                                                                                                                                                    |
| `by-itemcode-genre.json`            | `itemCode=` 조회 1건(장르 보완, F-SO-07 — 페이지 JSON에 장르가 없을 때)                                                                                                                                                   |
| `by-shop-itemurl.json`              | `shopCode=` + 型番 조회 3건 — `itemUrl`이 같은 항목의 itemCode를 쓴다(식별자 보완, F-BS-37)                                                                                                                               |
| `err-400-missing-key.json`          | 400 'must be present' → `RAKUTEN_KEY_MISSING`(키 누락)                                                                                                                                                                    |
| `err-403-invalid-access-key.json`   | 403 'Invalid Access Key' → `RAKUTEN_INVALID_ACCESS_KEY`(키 오류)                                                                                                                                                          |
| `err-403-client-ip.json`            | 403 `CLIENT_IP_NOT_ALLOWED` → 허용 IP 아님                                                                                                                                                                                |
| `status-429.json`·`status-503.json` | 429 한도 초과·503 점검 → 지수 백오프로 최대 3회 다시 보낸 뒤 `RAKUTEN_RATE_LIMITED`·`RAKUTEN_UNAVAILABLE`                                                                                                                 |
| `anchor-match12-p1.json`            | P2-03 앵커 분류: 앵커 1201A019·108 기준 `MATCH` 12 + `NEEDS_REVIEW`(색상 코드 없음, 샵 C) 1 + `NO_MATCH` 16 + 아동 단어 1(저장 안 함) → 29행. 샵 A·B·C·재고 부족·JAN 불일치·폭·hidden·여성 사이즈 페이지와 `itemUrl`이 짝 |
| `anchor-match12-p2.json`            | `MATCH` < 20일 때 부르는 page 2(`MATCH` 2 더함)                                                                                                                                                                           |
| `anchor-match20-p1.json`            | `MATCH` 22건인 page 1 → page 2를 부르지 않는다                                                                                                                                                                            |

## genre/ — IchibaGenre Search(호출 경로 M0 S2)

`shoes-558885.json`의 `responses[genreId]`가 그 장르를 물었을 때의 응답(`current`·`parents`·`children`)이다.
558885 靴 아래 110983 メンズ靴(208025 スニーカー)·100480 レディース靴와, 대상 밖 장르 101070 하나. 없는 장르는 404.

## pages/ — 상품 페이지(EUC-JP)

`src/*.utf8.html`(손으로 쓴 UTF-8 원본) → `build-pages.sh`(`iconv -f UTF-8 -t EUC-JP`) → `*.eucjp.html`(실제 페이지처럼
EUC-JP 바이트). 원본을 고치면 스크립트를 다시 돌려 두 파일을 함께 둔다. `.eucjp.html`은 prettier가 건드리지 않게
`.prettierignore`에 넣었다. 한글처럼 EUC-JP에 없는 글자는 원본에 쓰지 않는다.

| 이름                  | 경우                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normal`              | 9사이즈: 재고·품절·取り寄せ·hidden·짝 없는 고아 재고 행·cm가 아닌 라벨(S/M/L) 1개. itemCode `shop-a:10000123`                                                          |
| `fallback-root`       | `newApi.itemInfoSku`가 없고 `api.data.itemInfoSku`만 있다(대체 루트)                                                                                                   |
| `maintenance`         | HTTP 200 + 'ページが表示できません'(점검·삭제 페이지 → 실패)                                                                                                           |
| `missing-keys`        | 필수 키 몇 개가 빠졌다 → 읽은 것만 저장 + `manual_check_required`·빠진 키 이름                                                                                         |
| `child-max-235`       | 전체 사이즈 최댓값 235mm → 아동화 의심(성인용 상품 확인)                                                                                                               |
| `out-of-genre`        | 장르가 靴 558885 아래가 아니다 → `OUT_OF_SCOPE`                                                                                                                        |
| `no-genre`            | 페이지 JSON에 장르 ID가 없다 → itemCode로 Item Search(`genre_source=ITEM_SEARCH`)                                                                                      |
| `excluded-word-chuko` | 상품명에 中古 → 후보·행을 만들지 않는다(422 `RAKUTEN_ITEM_EXCLUDED_WORD`)                                                                                              |
| `no-item-code`        | 페이지 JSON에 상품 관리 번호가 없다 → 샵 코드 + 型番 Item Search로 itemCode 보완(F-BS-37)                                                                              |
| `shop-a`              | P2-03 샵 A ¥12,000 · pointRate 10 · 송료 무료 · 앵커 색상 108: 250·255·260·265·275 재고, 270·285 품절, 280 取り寄せ, 290 없음 → 남성 5/9(여성 220~260이면 3). JAN 기준 |
| `shop-b`              | 샵 B ¥11,800 · `postageFlag` 1(송료 추정 800) · pointRate 5 · 재고 3/9 → 536pt · 실질가 12,332                                                                         |
| `shop-c`              | 색상 코드를 얻을 수 없는 상품(시안 샵 C — 고를 수 없다)                                                                                                                |
| `shop-low-stock`      | 재고 2/9 → 재고 부족                                                                                                                                                   |
| `women-sizes`         | 여성 사이즈(22.0~26.0cm, '24.5cm' → 245)                                                                                                                               |
| `width-variants`      | 폭 2E(標準)·4E — 기본 폭만 센다                                                                                                                                        |
| `hidden-sku`          | hidden SKU 포함, 성별 신호 없음(성별 입력 대기)                                                                                                                        |
| `jan-mismatch`        | 앵커와 JAN이 다르다 → `janMatch=false`(고를 수 없다)                                                                                                                   |

## 가짜 라쿠텐

`test/support/rakuten-fixture.adapters.ts`의 `RakutenFixtureServer`가 이 파일들로 답한다(호출·요청 시각 기록).

- 단위 테스트: 포트 가짜(`searchPort`·`pagePort`·`genrePort`)를 서비스에 바로 넣는다.
- e2e: `fetchHandler`를 가짜 fetch(`HTTP_FETCH`) 뒤에 둔다 → 실제 어댑터·외부 호출 관문(허용 목록·앱 UA·1.5초/3초 간격·
  call_log·하루 상한·24시간 쉼)을 지난다(P2-01 데이터랩·P1-07 커머스와 같은 방식). 포트를 통째로 바꾸려면
  `overrideProvider(RAKUTEN_*_PORT)`.
- ③ 가격 판정(P2-05 전)은 `test/support/fake-pricing-runner.ts`의 가짜 PRICING 실행기로 재조회 뒤 이어 실행을 확인한다.
- 가짜 AI(P2-03 F-BS-38 동일 상품 판정 보조)는 `test/support/fake-ai-engine.adapter.ts`(`useFakeAiMatch(t.ai)` — 고정 `{match:true, confidence:0.8, reason}`)다. 실제 AI CLI는 부르지 않는다.

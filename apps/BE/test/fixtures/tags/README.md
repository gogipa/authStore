# ⑦ 태그 fixture (P3-05)

합성 값(실제 상품·실제 응답이 아니다, 화면시안_명세 §4 후보 A '아식스 젤카야노 14 · 크림/블랙'). 커머스API·네이버쇼핑을
부르지 않는다. 응답 모양은 M0 S3(커머스API)·S5(셀라파인더·manuTag) 전 가정이다 — 실측 뒤 고친다.

| 파일                               | 내용                                                                                                                                                                           | 쓰임                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `recommend-tags/*.json`            | `{keyword, status, body}` — recommend-tags 응답(`[{code, text}]`, code는 숫자). 시드 키워드 '아식스 젤카야노14'·型番 '1201A019-108'(빈 목록)·상품유형 '러닝화'·용도어 '데일리' | 가짜 커머스 태그 서버(`test/support/fake-commerce-tags.ts`)가 키워드로 고른다 |
| `restricted-tags/response.json`    | 제한 태그 목록(`정품운동화` restricted=true)                                                                                                                                   | 가짜 서버가 요청한 태그마다 `{tag, restricted}`로 답한다                      |
| `sellerfinder/manutag-freq.xlsx`   | 머리행 `manu태그·빈도` + 13줄(시안 '13개 읽음 · 빈도순')                                                                                                                       | xlsx 파서·multipart e2e(`has_frequency=true`)                                 |
| `sellerfinder/manutag-nofreq.csv`  | 머리행 `순위,manu태그` + 5줄(빈도 없음)                                                                                                                                        | CSV 파서                                                                      |
| `sellerfinder/manutag-broken.xlsx` | 빈도 열에 글자 '많음'(3행)                                                                                                                                                     | `IMPORT_PARSE_FAILED`(`row3.빈도`)                                            |
| `browser/search-response.json`     | 검색 응답 JSON — 상품 3개의 `manuTag`(쉼표·`                                                                                                                                   | `·배열), `rank`·`id`, 판매자 상호·연락처(가짜)                                | 브라우저 응답 파서(연락처가 결과에 없다) |
| `browser/search.har`               | HAR — 요청 Cookie·Authorization·응답 Set-Cookie(가짜 값 `HAR-*-VALUE`), 응답 본문에 `manuTag`·`nvMid`·연락처                                                                   | HAR 파서·e2e(머리·연락처가 DB·로그에 없다)                                    |
| `free-text.txt`                    | 자유 텍스트(쉼표·`#`·줄바꿈, 연락처 한 줄)                                                                                                                                     | 자유 텍스트 파서·e2e                                                          |
| `category-leaf.json`               | ④ 리프 `50000830` · 패션잡화>남성신발>운동화>러닝화                                                                                                                            | `seed-tags.ts`(④ 완료 후보)                                                   |
| `seed-tags.ts`                     | `seedTagsCandidate`(후보 + ② 완료 버전, ① 키워드·④ 완료 선택), `tagsSettingsText`, `truncateTags`, `TAGS_TABLES`                                                               | e2e                                                                           |

- xlsx 두 개는 openpyxl로 만들었다(파일 이름·원본은 앱이 저장하지 않는다).
- 쿠키·토큰 모양 값은 모두 누가 봐도 가짜인 글자다(비밀값 아님).

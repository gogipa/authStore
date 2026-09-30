# 데이터랩 fixture (P2-01)

**합성 fixture다.** 실제 데이터랩을 부르지 않고 PRD §8.1의 응답 모양(`{ returnCode, range, ranks: [{ rank, keyword, linkId }] }`,
Content-Type `text/html`)을 흉내 내 손으로 만들었다. M0 S4에서 받은 실측 응답·화면 복사 텍스트로 바꾼다
(바꿀 때 `keywords/datalab-response.ts` 판정 규칙과 `paste-parser.ts` 줄 형식도 함께 본다).

## rank/

| 파일                         | 내용                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `50000173-p1.json`~`p5.json` | 여성신발 1~100위(페이지마다 20개). 아동 단어 키워드 2개(16위 '키즈 운동화', 51위 'キッズ スニーカー') |
| `50000174-p1.json`~`p5.json` | 남성신발 1~100위. 아동 단어 키워드 1개(41위 '주니어 축구화')                                          |
| `empty-ranks.json`           | `ranks: []` — 그 cid의 정상 종료                                                                      |
| `no-ranks-key.json`          | `ranks` 키 없음 → `NO_RANKS_KEY`(구조 변경 의심)                                                      |
| `return-code-1.json`         | `returnCode: 1` → `RETURN_CODE`                                                                       |
| `not-json.html`              | HTML 본문 → `NOT_JSON`                                                                                |
| `count-mismatch.json`        | 한 페이지에 21개(요청 20) → `COUNT_MISMATCH`                                                          |
| `status-cases.json`          | 404·403·418·429 응답(상태별 Content-Type·본문)                                                        |

모든 순위 파일의 `range`는 `2026.08.23. ~ 2026.09.23.`이다(지금 = 2026-09-24 00:30 KST일 때의 요청 기간과 같다).

## paste/

| 파일                   | 내용                                                    |
| ---------------------- | ------------------------------------------------------- |
| `ok.txt`               | '순위 키워드' 10줄(공백 구분)                           |
| `tab-separated.txt`    | 탭 구분 5줄 + 빈 줄 하나                                |
| `duplicate-rank.txt`   | 3번째 줄이 2번째 줄과 같은 순위 → `IMPORT_PARSE_FAILED` |
| `blank-only.txt`       | 빈 줄·공백만 → `IMPORT_EMPTY`                           |
| `with-child-terms.txt` | 아동 단어 키워드 3개(키즈·주니어·ベビー) 포함 7줄       |

100,001자 글은 테스트 안에서 만든다.

## 가짜 데이터랩

`test/support/datalab-fixture.adapter.ts`의 `DatalabFixtureServer`가 (cid, page) → 이 파일들로 답한다.

- 단위 테스트: `port`(포트 `DATALAB_RANK_PORT`를 흉내, 호출 기록 포함)를 서비스에 바로 넣는다.
- e2e: `fetchHandler`를 가짜 fetch(`HTTP_FETCH`) 뒤에 둔다 → 실제 어댑터·외부 호출 관문(허용 목록·앱 UA·2초 간격·call_log·24시간 쉼)을
  지난다(P1-07 커머스 e2e와 같은 방식, 06-2 §9 P2-01). 포트를 통째로 바꾸고 싶으면 `overrideProvider(DATALAB_RANK_PORT)`에 `port`를 넣는다.

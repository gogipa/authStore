# 환율 출처 fixture (P2-04, 합성)

실제 한국수출입은행·관세청(공공데이터포털)을 부르지 않고 만든 **합성 응답**이다. 응답 모양은 공개 문서를 보고 추정한 것이라
실제 키로 한 번 받아 본 뒤 파서(`src/modules/integrations/fx/kexim.response.ts`·`customs-service.response.ts`의
`CUSTOMS_ITEM_FIELDS`)와 이 파일을 함께 고친다. 키·인증 값은 넣지 않는다.

| 파일                    | 쓰임                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `kexim-jpy100.json`     | 원가 환율 정상. 엔화 `cur_unit` `JPY(100)`, `deal_bas_r` `876.00` → 원값 876 · 단위 100 · 계산값 8.76원/엔. 달러·유로 줄도 있다 |
| `kexim-empty.json`      | 휴일·11시 전 빈 응답(`[]`) → 새 행 없음, 실패 아님                                                                              |
| `kexim-http500.json`    | 실패. `{ status, contentType, body }` — e2e 가짜 fetch가 이 상태 코드로 답한다                                                  |
| `kexim-result3.json`    | 200인데 `result` 3(인증 코드 오류) → 실패(`KEXIM_RESULT_3`)                                                                     |
| `customs-week.xml`      | 과세환율 정상. 적용 시작 2026-09-27(일), 엔 `100엔` `876.00`, 달러 `1,358.72`, 유로(무시)                                       |
| `customs-empty.xml`     | 항목 없음 → 새 행 없음, 실패 아님                                                                                               |
| `customs-broken.xml`    | 형식 깨짐(닫히지 않음) → 실패(`FX_RESPONSE_INVALID`)                                                                            |
| `customs-key-error.xml` | 포털 게이트웨이 키 오류(`returnReasonCode` 30) → 실패(`CUSTOMS_RESULT_30`)                                                      |

- 원가 환율 요청(가정): `GET oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=…&searchdate=YYYYMMDD&data=AP01`
- 과세환율 요청(가정): `GET apis.data.go.kr/1220000/retrieveTrifFxrtInfo/getRetrieveTrifFxrtInfo?serviceKey=…&aplyBgnDt=YYYYMMDD&weekFxrtTpcd=2`
  (키체인 `CUSTOMS_SERVICE_KEY`에는 공공데이터포털의 '일반 인증키(Decoding)'를 넣는다 — 앱이 URL 인코딩한다)

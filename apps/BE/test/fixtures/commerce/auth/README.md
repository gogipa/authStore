# 커머스API 인증 fixture (P1-07)

가짜 커머스 서버(`test/support/fake-commerce-transport.ts`)가 돌려줄 응답이다. 실제 커머스API를 부르지 않고 손으로 만들었다.
커머스API 앱 등록(PRD §0 5번)·M0 S3 전이라 **실제로 받은 응답은 하나도 없다.** 토큰·salt·client_id는 모두 누가 봐도 가짜인 값이다.

파일 모양: `{ "status": <HTTP 상태>, "headers": { "GNCP-GW-Trace-ID": "…" }, "body": <응답 본문> }`.
`signature-vector.json`만 서명 고정 벡터다.

| 파일                             | 상태 | 근거                                                                              | 쓰는 곳                                     |
| -------------------------------- | ---- | --------------------------------------------------------------------------------- | ------------------------------------------- |
| `token-200.json`                 | 200  | 공식 문서 기준(R04 A4: `access_token`·`expires_in`·`token_type`)                  | 발급 성공, 3시간 캐시                       |
| `token-401-authn.json`           | 401  | 공식 문서 기준(R04 A7 `GW.AUTHN`). 문구는 추정                                    | 발급 거절 → `SECRET_CHANGED`(Proposed 분류) |
| `token-403-ip-not-allowed.json`  | 403  | 공식 문서 기준(R04 A8 `GW.IP_NOT_ALLOWED`, 문구 그대로)                           | `IP_NOT_ALLOWED`                            |
| `token-403-dormant.json`         | 403  | **M0 S3 전 추정**(코드 이름 `GW.APPLICATION_DORMANT`)                             | `DORMANT_AUTH`(Proposed 분류)               |
| `token-403-store-suspended.json` | 403  | **M0 S3 전 추정**(코드 이름 `GW.SELLER_SUSPENDED`)                                | `STORE_SUSPENDED`(Proposed 분류)            |
| `token-400-invalid-client.json`  | 400  | **M0 S3 전 추정**(코드 이름 `GW.INVALID_CLIENT`, `invalidInputs` 모양은 R04 §2.2) | `SECRET_CHANGED`(Proposed 분류)             |
| `token-400-bad-timestamp.json`   | 400  | **M0 S3 전 추정**(5분 지난 timestamp, R04 A6)                                     | 모르는 코드 → `UNKNOWN`                     |
| `token-503-unavailable.json`     | 503  | **M0 S3 전 추정**                                                                 | 5xx → 502 `EXTERNAL_API_ERROR`(Proposed)    |
| `api-200-ok.json`                | 200  | 손으로 만든 일반 API 응답                                                         | `CommerceApiClient` 정상                    |
| `api-401-authn.json`             | 401  | 공식 문서 기준(R04 A7 `GW.AUTHN`)                                                 | 토큰 무효 → 재발급 1회 + 다시 보내기        |
| `api-400-invalid-inputs.json`    | 400  | 공식 문서 기준(R04 §2.2 `invalidInputs[]` name·type·message)                      | 오류 본문 해석(예외 없이 돌려줌)            |
| `signature-vector.json`          | —    | Python `bcrypt.hashpw`로 따로 계산(`source`에 적음)                               | 서명 고정 벡터                              |

- 원인 분류 코드(휴면·이용정지·시크릿 변경)는 공식 문서에 없다. 실제 앱을 등록한 뒤(M0 S3) 받은 응답으로 이 파일과
  `commerce-auth-cause.ts`의 표, 05-3 `COMMERCE_AUTH_FAILED` 행을 함께 고친다.
- `clientSecret`은 bcrypt salt 모양(`$2a$04$` + 22자)의 가짜 값이다. 22번째 글자는 bcrypt가 아래 4비트를 버리는 글자(`e`)라
  구현마다 salt를 다르게 다시 쓰지 않는다.

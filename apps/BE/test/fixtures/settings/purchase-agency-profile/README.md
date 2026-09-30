# 구매대행 프로필 fixture (P1-09)

프로필 검증·저장(단위)과 `GET·PUT /purchase-agency-profile`·`GET /dispatch-delivery-companies`(e2e)가 쓴다.
캐시(주소록·반품 택배사)는 P1-08 동기화를 돌리지 않고 `profile-fixtures.ts`의 `seedProfileCaches`로 직접 넣는다.
비밀값·개인 값은 없다. 상호·연락처·수입자는 자리표시자(`[내 상호]` 등)다.

| 파일                                  | 내용                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `valid-input.json`                    | PUT 본문 12개 키. 해외 출고지 id 1, 반품지 id 2, 발송 택배사 `FAKE_DISPATCH_A`, 반품 택배사 id 1, 반품비·교환비는 R04 §2.11 예시 값 |
| `addressbooks-seed.json`              | 주소록 3행: 해외(`100000001`) · 국내(`100000002`) · 최신 동기화에서 사라진 해외(`100000003`, `removedAt` 있음)                      |
| `return-delivery-companies-seed.json` | 반품 택배사 3행: 살아 있는 둘(P1-08 fixture 코드) · 사라진 하나(`FAKE_RETIRED`)                                                     |
| `settings-dispatch-companies.json`    | 설정 파일 `delivery.dispatchCompanies`에 끼울 가짜 코드 2개(`FAKE_DISPATCH_A`·`B`)와 출처                                           |

- 빈 표(`TRUNCATE … RESTART IDENTITY`)에 순서대로 넣으면 id가 1·2·3이다(`PROFILE_SEED_IDS`).
- 발송 택배사 코드는 가짜다. 해외 출고에 쓸 실제 코드는 M0 S3에서 확인하고, 출처가 있는 값만 설정 파일에 넣는다.

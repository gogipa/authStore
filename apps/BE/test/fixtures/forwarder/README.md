# 배대지 요금표 CSV fixture (P2-04, 합성)

형식(Proposed, ERD §7.1-13): UTF-8, 머리행 `weight_max_kg,fee,currency,volumetric_divisor,volumetric_applies_when`.
`volumetric_applies_when`은 비움·`ALWAYS`·`NEVER`·`SUM_CM>{n}`(세 변 합 cm). 요금은 통화 그대로 저장한다(엔화는 판정 때 원가 환율로).

| 파일                          | 쓰임                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `rate-table-v2026-09.csv`     | 정상 5구간(원화, 1.2kg 15,000원 포함). 줄 순서를 일부러 섞었다 → 구간은 무게 오름차순 |
| `rate-table-v2026-10.csv`     | 정상 3구간(엔화) — '다른 파일' 가져오기·활성 교체                                     |
| `rate-table-bad-currency.csv` | 2줄 통화 `USD` → `IMPORT_PARSE_FAILED` `row2.currency`                                |
| `rate-table-dup-weight.csv`   | 1.2와 1.200(같은 구간) → `IMPORT_PARSE_FAILED` `row4.weight_max_kg`                   |
| `rate-table-bad-numbers.csv`  | `fee` −1 · `volumetric_divisor` 0 → `IMPORT_PARSE_FAILED`                             |
| `rate-table-header-only.csv`  | 머리행만 → `IMPORT_EMPTY`                                                             |
| `rate-table.txt`              | CSV가 아님(확장자) → `UNSUPPORTED_FILE_TYPE`                                          |

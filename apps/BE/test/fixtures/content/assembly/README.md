# ⑥-3 고시·HTML fixture (P3-04)

모두 **합성 값**이다(실제 상품·상호·연락처가 아니다 — 자리표시자). 화면시안_명세 §4 후보 A(아식스 젤카야노 14 · 크림/블랙)를 바탕으로 했다.
단위 테스트(`src/modules/content/assembly/*.spec.ts`)는 순수 조립에, e2e(`test/content/content-assembly.e2e-spec.ts`)는 `seed-assembly.ts`로
DB에 직접 넣는다. 커머스API·라쿠텐·이미지 모델을 부르지 않는다.

| 파일                            | 쓰임                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `profile-complete.json`         | 구매대행 프로필 — ⑥-3이 보는 값(상호·A/S·수입자·반품비)이 모두 있다. 주소록·택배사 FK는 비운다                            |
| `profile-missing-importer.json` | 수입자만 비었다 → 409 `PROFILE_INCOMPLETE`(`missingFields = ['importer']`)                                                |
| `origin-areas.json`             | `commerce_origin_area` 행 — **테스트용 코드**다. 실제 코드는 P1-08 동기화 결과(M0 S3)를 따른다                            |
| `sale-sizes-gapped.json`        | ③ 판매 사이즈 `[250,255,260,265,275]` → `250~265·275mm (JP 25.0~26.5·27.5cm)`                                             |
| `sale-sizes-contiguous.json`    | `[250…280]` → `250~280mm (JP 25.0~28.0cm)`                                                                                |
| `facts-leather.json`            | ⑥-2 결과: 겉감 합성가죽(안전관리대상 문장), 남성 + 굽높이 근거(고시 `height` 없음, 사양 블록 높이 있음)                   |
| `facts-textile-no-lining.json`  | 섬유 겉감·안감 없음·높이 근거 없음(안전관리 문장 없음, 사양 블록 소재는 근거 있는 칸만)                                   |
| `facts-multi-origin.json`       | 제조국 셋·여성 굽 신발(ヒール高さ) — 여러 원산지 방식, 고시 `height` 있음                                                 |
| `copy.json`                     | ⑥-1 유효 카피 — 셀링포인트에 `<b>`(글로 이스케이프돼야 한다)                                                              |
| `rakuten-item-parallel.json`    | 상품명에 並行輸入品·속성 ブランド → 상품명 제안 맨 뒤 '병행', 키워드 없는 브랜드                                          |
| `disclosure-template.json`      | 설정 `notice` 섹션(기본 템플릿 사본 — 필수 블록은 앱 내장 해시와 같다) + 배송기간 10~20영업일                             |
| `expected/detail.html`          | `facts-leather` + `sale-sizes-gapped` + `copy` 조립 스냅샷(`UPDATE_ASSEMBLY_SNAPSHOT=1`로 다시 만든다, `.prettierignore`) |

- 설정 템플릿의 고지 문장을 바꾸면(법률 검토 E-3) `disclosure-template.json`과 `expected/detail.html`을 다시 만든다.
- M0 S3 뒤 실제 원산지 코드·고시 0/1 형식으로 `origin-areas.json`과 고시 기대값을 고친다.

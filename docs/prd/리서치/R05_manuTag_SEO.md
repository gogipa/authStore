# R05. manuTag(검색태그) 수집·삽입과 네이버쇼핑 SEO 규칙

- 작성일: 2026-09-24
- 담당 주제: 오너 요청 "다른사람이 올려놓은 manutag를 찾아서 삽입"의 정확한 의미·구현 방법 + 네이버쇼핑 SEO 규칙
- 원천: `docs/prd/원천자료/01_사용자요청_2026-09-24.md`
- 표기: **[공식]** 네이버 1차 문서, **[관찰]** 이번 조사 중 직접 확인, **[커뮤니티]** 셀러 커뮤니티/서드파티, **[추정]** 근거가 약한 해석(미확인)

---

## 1. 요약

1. "manuTag"는 네이버 공식 문서에는 없는 이름이다. 셀러 커뮤니티에서는 네이버쇼핑 검색 페이지가 내부적으로 받아오는 JSON(`all?query=…` 요청) 속 상품별 태그 필드를 이렇게 부른다 [커뮤니티]. 오너가 말한 "다른 사람이 올린 manuTag"는 **경쟁 상품의 검색태그(판매자 태그)** 를 뜻하는 것으로 보인다.
2. 공식 규칙은 다음과 같다. 태그는 네이버 **태그 사전**에 있는 것만 검색에 쓰인다. 카테고리명·브랜드명·판매처명과 할인·배송 같은 문구는 태그로 쓸 수 없다. 개수는 **최대 10개**다(EP 가이드 공식, 스마트스토어는 연동사 문서로 교차 확인). 커머스API에 `GET /v2/tags/recommend-tags`(사전 태그 + code)와 `GET /v2/tags/restricted-tags`(제한 태그 여부)가 있다 [공식].
3. 경쟁 태그를 **공식 API로 얻을 방법은 없다.** 네이버 쇼핑 검색 Open API(`shop.json`)에는 태그 필드가 없다. 커머스API로는 남의 상품을 조회할 수 없다 [공식]. 네이버 약관은 자동화 수단으로 검색하거나 수집하는 것을 금지한다. 조사 중 `curl`로 딱 한 번 요청했는데도 **HTTP 418 접속 제한**이 돌아왔다 [공식·관찰].
4. 권장 구현은 두 갈래다. 태그 후보는 공식 API로 모으고(`recommend-tags` + 검색광고 키워드도구), 경쟁 태그는 **오너가 평소 쓰는 브라우저에서 사람이 한 번 검색한 결과만 가져오는 반자동 방식**으로 모은다. 이후 빈도 집계 → 금지어 필터 → `restricted-tags` 검증 → 최대 10개 추천 → 오너 승인 순으로 처리한다.
5. SEO 핵심은 이렇다. 상품명은 "브랜드+모델+상품유형+대표옵션"으로 간결하게, 최대 100자로 쓴다. 가장 하위 카테고리를 쓰고 속성은 정확히 넣는다. 대표이미지에는 가격·배송·홍보 문구를 넣지 않는다. 중복상품, 카테고리 오매칭, 해외상품 표기 누락은 클린프로그램 제재 대상이다 [공식].

---

## 2. 상세 발견사항

### 2.1 "manuTag"의 정체와 노출 위치

| # | 발견 | 근거 | 신뢰도 |
|---|---|---|---|
| M1 | manuTag는 네이버쇼핑 검색 페이지가 불러오는 **`all?query=`로 시작하는 네트워크 요청의 응답 JSON 안 필드**로 소개된다. 확인 방법: F12 → Network → `all?query=` 요청 → 응답에서 "manutag" 검색 | [커뮤니티] Threads @how._.zero | 중 |
| M2 | 커뮤니티 설명: "상품 등록할 때 우리가 넣는 키워드 말고 네이버가 진짜로 노출시키는 태그". 상품은 상품명 외에 카테고리·속성값·manuTag로도 검색된다는 주장 | [커뮤니티] Threads @how._.zero 2건 | 중(설명은 비공식) |
| M3 | 공식 가이드: 네이버는 **내부 태그 사전**을 기준으로 태그를 검색에 쓴다. **사전에 없거나 기준에 안 맞는 태그는 노출되지 않는다.** 판매자 태그가 적거나 검색에 쓰이는 태그가 적으면 **상품 정보에서 뽑은 자동 태그를 추가로 노출**한다 | [공식] 쇼핑파트너 SEO 가이드(H00051) | 상 |
| M4 | [추정·미확인] `manu`는 manual(판매자가 직접 넣은 태그)의 약자로 보인다. 즉 manuTag는 "판매자 입력 태그 가운데 사전 필터를 통과해 검색 색인에 들어간 값"일 가능성이 높고, 공식 문서의 '자동 태그'와 짝을 이룬다. 공식 설명은 찾지 못했다 | M3에서 추론 | 하 |
| M5 | 스마트스토어 **상품 상세 페이지 HTML 소스**에는 판매자가 입력한 `sellerTags`(code·text)가 들어 있다. 이를 파싱해 주는 서드파티 도구가 있다("셀러태그/메뉴태그와 메타키워드 추출") | [커뮤니티] 300won.com/tag (검색 스니펫, 원문 사이트 504로 미열람) | 하~중 |
| M6 | 네이버 쇼핑 검색 **Open API(`openapi.naver.com/v1/search/shop.json`)의 응답 필드**는 title, link, image, lprice, hprice, mallName, productId, productType, maker, brand, category1~4뿐이다. **태그 필드는 없다.** 한도: 하루 25,000회, `display` 최대 100, `start` 최대 1000, `exclude=used:rental:cbshop` 지원 | [공식] developers.naver.com 쇼핑 검색 문서 | 상 |
| M7 | 커머스API는 **본인 스토어 상품만** 다룬다. 다른 스마트스토어 상품 정보(상세페이지 등)를 뽑는 API는 없다 | [공식] commerce-api Discussion #1900 | 상 |
| M8 | 2026-09-24에 `search.shopping.naver.com/ns/search?query=…`를 **`curl`로 1회 GET**했더니 **HTTP 418**과 "쇼핑 서비스 접속이 일시적으로 제한되었습니다"가 반환됐다. 제한 사유로 "짧은 시간 내 과다 요청 IP", "VPN", "특정 확장 프로그램" 등이 안내됐다. 같은 호스트의 `robots.txt`도 418이었다. 차단을 우회하는 시도는 하지 않았다 | [관찰] | 상 |
| M9 | 2025년 이후 네이버쇼핑 검색은 **가격비교**와 **N+스토어(네이버플러스 스토어)** 두 면으로 운영된다. 서드파티 스크래퍼 문서에 N+스토어 검색 내부 엔드포인트로 `search.shopping.naver.com/ns/v1/search/paged-products`가 적혀 있다. 이 응답에 manuTag가 있는지는 **미확인**이다 | [공식] SEO 가이드 "가격비교와 N+스토어 공통 가이드" / [커뮤니티] Apify actor 문서 | 중 / 하 |

**해석.** "다른 사람이 올려놓은 manuTag를 찾아서 삽입"은 **"같은 키워드나 같은 모델로 상위에 노출된 경쟁 상품들이 실제로 쓰는 검색태그를 모아, 내 상품의 `sellerTags`(최대 10개)에 넣는다"** 로 정의하는 것이 가장 합리적이다. 다만 오너가 가리키는 데이터가 (a) 검색 JSON의 manuTag, (b) 상품 페이지의 sellerTags, (c) 셀러라이프 확장 프로그램이 보여 주는 태그 중 무엇인지는 **오너 확인이 필요하다**(6장 Q1).

### 2.2 스마트스토어 검색태그 공식 규칙

| # | 규칙 | 근거 | 신뢰도 |
|---|---|---|---|
| T1 | 태그는 **네이버 태그 사전** 기준으로 검색에 반영된다. 사전에 없는 태그는 적합 여부를 검토한 뒤 사전에 추가되거나 추가되지 않을 수 있다 | [공식] SEO 가이드 태그 이미지("검색 적용 태그 확인") | 상 |
| T2 | 태그로 **쓸 수 없는 것**: 상품 정보와 겹치는 **카테고리명·브랜드명·판매자명**. **할인·배송 등 홍보 문구**처럼 사전에 없는 키워드(예: `#이불커버`는 카테고리 필드로, `#JAJU`는 브랜드 필드로, `#무료배송`·`#반짝할인`은 구매/혜택 조건 필드로) | [공식] SEO 가이드 태그 "나쁜 예시" | 상 |
| T3 | **권장 태그 유형**: 사용 용도(#홈인테리어), 사용자 특성(#신생아용품), 시즌성 키워드(#겨울용품), 감성 표현(#레트로스타일). "속성 등 다른 필드에 넣기 어렵지만 상품을 잘 나타내는 정보", "꼭 필요한 정보만" 넣는다. **태그가 과도하게 많으면 적합도에 영향을 줄 수 있다** | [공식] SEO 가이드 태그 | 상 |
| T4 | **최대 10개**. EP(가격비교 연동)의 `search_tag`는 10개를 넘으면 앞 10개만 처리하고, 전체 100자 초과분은 처리하지 않는다. 구분자는 `|`이고, 검색 결과 노출을 보장하지 않으며, 별도 클렌징을 거쳐 반영된다. 무관한 상품명·유명상품 유사문구·스팸 키워드는 노출 중단/삭제 대상이다 | [공식] 네이버 가격비교 EP 3.0 가이드 p.36(`search_tag`) | 상 |
| T5 | 스마트스토어도 "검색어(태그)는 **최대 10개**까지 반영되며, 입력 불가 태그는 제외 후 등록"된다. "카테고리/브랜드/판매처명이 포함된 키워드는 등록 불가"이고, 실패 메시지에 문제 단어가 표시된다 | [커뮤니티] 이셀러스 FAQ, 플레이오토 도움말(연동사 문서) | 중~상 |
| T6 | 판매자센터에는 **"검색 적용 태그 확인"** 버튼이 있다. 누르면 "태그 사전에 등록되어 있습니다 O" 또는 "태그로 등록할 수 없는 단어가 포함 / 태그 사전에 없음 X"가 표시된다 | [공식] SEO 가이드 태그 이미지 | 상 |
| T7 | 반영 여부를 사후 확인하는 방법으로 "상품명+태그로 검색했을 때 '상품명 + 태그 로만 검색하기'가 뜨면 유효하다"는 팁이 돈다 | [커뮤니티] 검색 스니펫(원문 미열람) | 하 |

### 2.3 커머스API의 태그 관련 스펙

| # | 내용 | 근거 | 신뢰도 |
|---|---|---|---|
| A1 | **`GET /v2/tags/recommend-tags?keyword={keyword}`** (Base `https://api.commerce.naver.com/external`). 응답은 `code`(int64, 태그 ID)와 `text`(태그명) 목록이다. keyword는 필수이며 없으면 400이다. 결과가 비어 있을 수 있고, 짧은 TTL 캐시를 권장한다 | [공식] llms/get-v2-tags-recommend-tags.md | 상 |
| A2 | **`GET /v2/tags/restricted-tags?tags={tags}`**. 여러 태그를 한 번에 넣으면 태그마다 `tag`와 `restricted`(boolean)를 돌려준다. "제한 태그 정책은 정기적으로 갱신될 수 있으므로 **상품 등록 시점에 매번 본 API로 검증**"을 권장한다. 빈 배열이면 400. 배열을 쿼리에 넣는 형식(반복 파라미터인지 콤마인지)과 1회 최대 개수는 **미확인**이다 | [공식] llms/get-v2-tags-restricted-tags.md | 상(형식은 하) |
| A3 | 등록 페이로드 경로는 **`originProduct.detailAttribute.seoInfo.sellerTags[]`**({`code`, `text`})이다. 추천 태그를 쓸 때는 `code`와 `text`가 반드시 짝이 맞아야 하며, 다르면 등록이 실패한다. **직접 입력 태그는 `code` 없이 `text`만** 보낸다. 같은 `seoInfo` 안에 `pageTitle`, `metaDescription`도 있다 | [공식] recommend-tags 문서, Discussion #1867·#1857, 스마트스토어 상품 가이드 필드 표 | 상 |
| A4 | recommend-tags가 돌려준 태그라도 **카테고리에 따라 쓸 수 없을 수 있다**(에러 예: `Restricted.sellerTags`, `NotValid.recommendTags.text`). 허용 태그 전체 목록을 주는 API는 없다 | [공식] Discussion #1610 | 상 |
| A5 | 2023년 무렵 답변에서는 "등록 불가 태그 확인 API는 제공하지 않는다"고 했다(#1330). **현재 문서에는 `restricted-tags`가 있으므로 이후에 추가된 것으로 보인다** [추정] | [공식] Discussion #1330 vs llms.txt | 중 |
| A6 | 요청량 제한은 Token bucket 방식이다. 초과하면 429 `GW.RATE_LIMIT`, 시간당 쿼터를 넘으면 429 `GW.QUOTA_LIMIT`. 헤더 `GNCP-GW-RateLimit-*`, `GNCP-GW-Quota-*`로 상태를 알 수 있다. 수치는 유동적이며 문서에 명시돼 있지 않다 | [공식] llms/intro-제약사항.md | 상 |

### 2.4 셀러 태그 도구 사례(방식 비교)

| 도구 | 방식(공개 설명 기준) | 근거 |
|---|---|---|
| 셀러라이프(Chrome 확장 v1.2.1.88, 2026-09-21 업데이트) | 스마트스토어 상품을 분석해 "상품 가격, 카테고리, 리뷰수, 일주일 구매건수, 매출, **태그**, 옵션"을 보여 준다. 연관 키워드·태그 추천도 한다 | Chrome 웹스토어 |
| 아이템스카우트(확장 v5.4.4, 2026-09-15) | "스마트스토어에서 **상품명/태그 분석** 데이터를 제공" | Chrome 웹스토어 |
| Sellomon(확장 v5.9.14, 2026-09-10) | "상위 노출 상품들이 공통으로 쓰는 **'검색 인식 태그'** 를 분석해 **태그 빈도수 순위표**를 제공" → 이번 설계(빈도 집계)의 선례 | Chrome 웹스토어 |
| 네이버쇼핑 상품명 조합기(확장) | 검색 결과 상품명 키워드를 사용 빈도순으로 보여 주고 조합한다 | Chrome 웹스토어 |
| 마켓랩 태그 추출기 | 네이버/쿠팡 **자동완성·연관검색어**를 태그 후보로 제공한다(manuTag 아님). 쿠팡은 "서버 IP 차단으로 이용 중지"라고 공지 | marketlab.co.kr |

공통점: 대부분 **사용자 브라우저에서 이미 열린 페이지를 확장 프로그램이 읽는 방식**이다. 서버에서 대량 크롤링하는 도구는 IP 차단을 겪는다(마켓랩 쿠팡 사례).

### 2.5 manuTag 선별 로직 설계(제안)

근거: T1~T4(사전·금지·10개·과다 금지), A1~A4(API 검증), Sellomon식 빈도표, 적합도 FAQ("주요 키워드 1~2개", "동의어는 자동 처리되니 중복 기재 불필요").

```
입력: 대상 상품(브랜드, 모델명, leaf 카테고리, 성별, 색상, 소재, 용도), 시드 키워드(데이터랩)
1) 후보 수집
   S1 경쟁 태그: 동일 모델/동일 시드 키워드 상위 N개(기본 N=20~40) 상품의 manuTag/sellerTags
       - 수집 경로: 오너 브라우저의 반자동 캡처(2.7 참조), 또는 셀러라이프 등 도구 결과 붙여넣기
   S2 공식 사전 태그: recommend-tags(keyword=시드 키워드, 모델명, 상품유형, 용도어 …) → code 포함
   S3 (선택) 검색광고 keywordstool 연관키워드 + 월간 검색량(monthlyPcQcCnt+monthlyMobileQcCnt)
2) 정규화: trim, 영문 소문자화, 내부 공백 정규화, '#' 제거, 완전 중복 제거, 동의어 묶기(선택)
3) 점수화(예시 가중치, 설정 가능):
   score = 0.5*빈도비율(S1에서 해당 태그를 쓴 상품 수 / N, 순위 가중 1/log2(rank+1))
         + 0.3*정규화 검색량(S3)
         + 0.2*사전 등재(S2에 exact match면 1)
4) 규칙 필터(하드):
   - 카테고리명(경로 전체 토큰), 자사/타사 브랜드명, 스토어명·판매처명 포함 태그 제거
   - 가격/혜택/배송/홍보 수식어 사전(최저가, 특가, 할인, 무료배송, 당일발송, 사은품, 정품, 공식, MD추천, 신상품 등) 포함 제거
   - 상품과 무관한 태그(상품 속성과 불일치: 성별·용도·시즌 모순) 제거 — 규칙 + LLM 판정(근거 문장 필수)
   - 상품명에 이미 쓴 토큰과 동일/동의어 태그 감점(중복 기재 불필요)
5) API 검증: restricted-tags로 일괄 확인 → restricted=true 제거
   사전 매칭: recommend-tags 결과와 exact match → code 부착 / 미매칭 → '직접입력(사전 미등록 가능)' 플래그
6) 선택: 점수 상위부터 최대 10개, 최소 점수 임계치 미만은 제외(10개를 억지로 채우지 않음)
7) 오너 승인 화면: 태그별 출처(S1 빈도·S2 code·S3 검색량), 필터 사유, 교체 후보 표시 → 승인/수정
8) 등록 후 확인: 원상품 조회 API로 sellerTags 저장 여부 확인, 실패 시 에러 invalidInputs의 단어 제거 후 재시도
```

### 2.6 네이버쇼핑 SEO 공식 가이드(요약)

**검색 랭킹 구조** [공식 H00015·H00017~H00020]
- 랭킹은 **적합도·인기도·신뢰도** 점수에 그룹상품·카탈로그를 합쳐 정해진다. N+스토어는 여기에 **선호도(개인화)** 가 더해진다. 이 SEO 가이드는 가격비교와 N+스토어 공통이다.
- 적합도: 검색어와 **상품명·브랜드/제조사·카테고리·속성·태그**의 연관도, 그리고 카테고리 선호도로 계산된다.
- 인기도: 클릭(최근 7일), 판매(최근 2·7·30일 주문수와 매출), 리뷰 수(카테고리 상대값), **최신성(신상품 초기 보정)**. 최신성을 다시 받으려고 재등록하거나 상품ID를 재사용하면 모니터링 대상이며, **전체 상품 랭킹 페널티나 점수 리셋**이 적용될 수 있다.
- 신뢰도: 상품명 SEO, 이미지 SEO, 네이버쇼핑 페널티(가이드 위배, 가품, 리뷰·판매 어뷰징, 슬롯형 트래픽, 리워드 유입, 상품정보 어뷰징), 몰 신뢰도(굿서비스). 페널티는 **해당 상품뿐 아니라 쇼핑몰 전체**에 부과될 수 있다. 수정 후 랭킹 반영에는 약 1일이 걸린다.

**상품명** [공식 SEO 가이드 이미지 + EP 가이드]
- 브랜드와 카테고리를 넣어 주요 정보로 간결하게 쓴다. 대표 옵션(색상·사이즈)을 포함하고, 성별이 분명한 상품은 '남성/여성'을 붙인다.
- **신발 공식 예시**: 좋은 예 `뉴발란스 530 스틸그레이 운동화 MR530KA`. 나쁜 예는 타 브랜드(나이키·아디다스·아식스), 다른 모델번호(574·740), 여러 색상(블랙·화이트·베이지)을 나열한 경우다.
- 브랜드·제조사·모델명은 **공식 명칭 그대로** 쓴다. 약어나 비공식 명칭은 노출에 불리하다.
- 금지·지양 목록
  - 배송·가격 혜택 문구(→ 별도 필드)
  - 동의어 반복(시스템이 자동 처리)
  - 수식어·홍보문구
  - 특수문자 과다와 지나치게 긴 상품명
  - 사회적 이슈 키워드(사용 불가)
  - 가격(가성비·최저가·특가)·혜택(사은품·품절)·홍보(MD추천·신상품)·기타(A급, st, 공식, 모음, 정품) 수식어
  - 전화번호(불가)
  - 명품·고급(예외적으로만 허용)
  - 셀러 고유 식별코드(IP01, _ES 등)
  - **상품과 무관한 옵션 기재**. 적발되면 **상품 서비스가 중지**된다.
- 길이는 **최대 100자**다(판매자센터 입력창 `n/100`, EP `title` 100자). "50자 내외 권장"은 업계 자료가 과거 네이버 가이드를 인용한 것으로, 현행 FAQ에는 명시되어 있지 않다 [커뮤니티, 중].
- 판매자센터에서 상품명을 입력하면 **'검색 최적화 수정 제안사항'**(품질 체크)이 뜬다. 가이드에 맞춰 고치라는 안내다. 동일 단어 "3회 이상 반복 시 경고"라는 구체적 임계값은 커뮤니티 설이다 [하].
- EP 가이드(가격비교): 타 브랜드 표기, 홍보·혜택 문구 일괄 표기, 번역기 일괄 번역, 검색 노출을 노린 전화번호·지역명 추가는 **노출 중단이나 상품 삭제** 대상이다. "검색 노출 목적 키워드는 검색태그 컬럼을 활용"하라고 안내한다.

**카테고리 / 브랜드·제조사 / 속성** [공식 SEO 가이드 이미지]
- 카테고리는 **가장 하위(leaf)** 로만 등록할 수 있다. 상위 카테고리로는 등록이 안 된다. 카테고리명은 상품명에 없어도 검색 키워드로 쓰인다.
- 브랜드·제조사는 자동완성 목록에 있는 값을 고른다(없을 때만 직접 입력). 검색어의 브랜드 키워드는 브랜드 필드에 매칭될 때 우선 노출된다.
- 속성: 카테고리별 속성을 빠짐없이 정확하게 넣으면 필터 노출이 늘어난다. 무관한 속성은 재매칭되고, 악의적이면 **서비스가 중지**된다. API: `GET /v1/product-attributes/attributes`, `/attribute-values`.

**이미지** [공식]
- SEO 가이드: 500×500 권장(최소 300, 최대 4000px), JPG. 하나 이상은 정면·흰색/단색 배경을 권장한다. **피팅 모델 사진은 허용되지만 상품이 주인공이어야 하고 색상·형태를 판단할 수 있어야 한다.**
- 저품질 사례
  - 텍스트·워터마크·도형 과다
  - 흐림
  - 어지러운 배경
  - 매장 디스플레이 또는 소품·상황 연출
  - **실제와 다르게 과도하게 보정된 이미지나 상품과 무관한 이미지**
  - **상품 2개 이상 또는 모델 2명 이상**
  - 앞·뒤·옆을 한 이미지에 넣은 경우
  - 색상만 다른 제품을 한 이미지에 넣은 경우
- 커머스API: 대표이미지는 **1000×1000 권장**, 추가이미지는 최대 9개. URL은 반드시 `POST /v1/product-images/upload`가 돌려준 값을 써야 한다.
- 2024-10-28 시행 "대표이미지 등록 기준": 상품명과 일치하는 이미지여야 한다. 가격·할인율, 배송 정보, 홍보 문구, 무관한 상품·옵션, 저품질 이미지는 금지된다. 위반하면 노출 제외와 클린프로그램 제재를 받는다 [커뮤니티 2건, 네이버 공지 원문 미열람 → 중].

**카탈로그(가격비교)·그룹상품** [공식 H00050·H00049, 스마트스토어 상품 가이드]
- 기본 정보가 같은 상품은 카탈로그로 묶인다. **판매자가 매칭 여부를 고를 수 없다.**
- N+스토어 카탈로그에서는 대표·최저가·공식/인증몰 상품만 검색에 개별 노출되고, 나머지는 필터를 걸어야 단독으로 보인다.
- 카탈로그 연결은 `naverShoppingSearchInfo.modelId`(`GET /v1/product-models`)와 `brandId`(`GET /v1/product-brands`)로 한다. 카탈로그 정보는 직접 수정할 수 없고 수정 요청만 가능하다.
- 그룹상품은 옵션별로 개별 상품을 등록한 뒤 하나로 묶는 방식이다. 인기도는 '검색 노출 그룹' 단위로 합산된다.

**클린프로그램·어뷰징 제재(가격비교 쇼핑파트너 FAQ)** [공식 H00012]
- **중복상품**: 같은 사업자가 동일 상품을 2개 이상 노출하면 상품 삭제와 클린 제재를 받는다. **카테고리가 달라도 중복**으로 본다. 삭제된 중복상품은 **복구할 수 없다.** 옵션별로 따로 등록하려면 상품명에 구분 표기가 필요하다.
- **상품명 표기기준**: 해외배송 상품은 해외 여부를 설정해 '해외' 아이콘이 떠야 한다. 스마트스토어는 **해외상품 등록 시 출고지를 해외 사업장 주소로** 넣고, **병행수입 상품은 상품명에 '병행'** 을 표기한다.
- **원부·카테고리 오매칭**: 예로 "남성신발인데 여성신발 카테고리에 매칭"이 명시돼 있다.
- **정보상이**: 네이버쇼핑과 상품페이지의 가격·스펙이 다른 경우.
- **가격/배송비 기준 위반**, **상품ID 재사용**, **품절상품 판매**, **부정클릭**.
- 주의·경고 이력은 **24주간 유지**된다.

### 2.7 스크래핑 관점(차단·약관·권장 방식)

| # | 내용 | 근거 | 신뢰도 |
|---|---|---|---|
| S1 | 네이버 이용약관(시행 2025-07-10)은 "사전 허락 없이 **자동화된 수단**(매크로, 봇, 스파이더, **스크래퍼** 등)으로 … 게시물 등을 **수집**하거나, **네이버 검색 서비스에서 특정 질의어로 검색**하거나 … 이용자(사람)의 실제 이용을 전제로 하는 제공 취지에 부합하지 않는 방식으로 이용"하는 것과 "**IP를 계속 바꿔 가며 접속**, **Captcha 우회**" 같은 기술적 조치 무력화를 금지한다 | [공식] policy.naver.com/rules/service.html | 상 |
| S2 | 「검색결과 수집에 대한 정책」: robots.txt로 보호되는 네이버 DB를 네이버 로봇이 아닌 수집기가 가져가는 것을 불허한다. 경우에 따라 저작권법이나 정보통신망법 위반이 될 수 있으며 "법적 절차를 포함하여 엄중한 책임"을 묻겠다고 명시한다 | [공식] policy.naver.com/policy/search_policy.html | 상 |
| S3 | `smartstore.naver.com/robots.txt`는 `User-agent: *` → `Disallow: /`(전체 금지)이고, GPTBot·ClaudeBot 등 AI 봇도 명시적으로 차단한다(2026-09-24 조회) | [관찰] | 상 |
| S4 | 네이버쇼핑 검색은 `curl` 1회만으로 418 접속 제한이 걸렸다(M8). 서드파티 분석으로는 IP당 레이트리밋, JS 렌더링 의존, 캡차(특히 스마트스토어) 등 다층 차단이 있다 | [관찰] / [커뮤니티] hashscraper 블로그 | 상 / 중 |
| S5 | 쇼핑 SEO 신뢰도 항목은 "외부 이벤트 등을 통해 특정 상품을 검색·클릭하여 검색결과에 영향을 미치는 행위", 슬롯형 트래픽 유입을 페널티 대상으로 본다. 수집 자동화가 **상품 클릭**을 일으키면 트래픽 어뷰징으로 오인될 수 있다 | [공식] H00019 | 상(적용 여부는 추정) |

**개인용 저빈도 수집 시 권장 방식(우선순위)**
1. **공식 API 우선**: 태그 후보는 `recommend-tags`와 `restricted-tags`, 검색량은 검색광고 `keywordstool`, 경쟁 상품 목록·가격은 `shop.json`으로 얻는다. 이 조합으로 태그 사전에 있는 합법 태그를 충분히 확보할 수 있다.
2. **경쟁 태그(manuTag)는 반자동**: 오너가 평소 쓰는 브라우저에서 **직접 검색**한다(사람의 실제 이용). 그 뒤 (a) 로컬 전용 브라우저 확장이나 북마클릿이 **이미 로드된 응답이나 DOM만** 읽어 로컬 웹앱(`localhost`)으로 보내거나, (b) DevTools 응답이나 HAR을 붙여넣게 한다. **추가 요청은 만들지 않는다.** 셀러라이프 확장 결과를 붙여넣는 경로도 둔다.
3. 오너가 리스크를 받아들이고 **완전 자동화**를 고르는 경우의 최소 안전장치(권고 수준이며 약관 위반 가능성은 남는다)
   - 로그인하지 않는다.
   - 실제 브라우저(headful)를 쓴다.
   - 질의 간격을 수 분 이상 둔다.
   - 일일 질의 상한을 둔다(예: 10회 이하).
   - 결과를 7일 캐시한다.
   - 상품 클릭과 상세 진입을 하지 않는다.
   - **418·캡차가 나오면 즉시 중단하고 24시간 쿨다운한다.**
   - IP 로테이션·프록시·캡차 우회는 **금지**한다.

---

## 3. PRD에 반영할 도출 요구사항

| ID | 구분 | 요구사항 | 근거 |
|---|---|---|---|
| R05-F01 | 기능 | 태그 후보 수집기: (1) 커머스API `GET /v2/tags/recommend-tags`로 시드 키워드별 사전 태그(code, text) 수집, (2) 경쟁 태그 입력(반자동 캡처/붙여넣기), (3) 선택적으로 검색광고 keywordstool 검색량 수집 | A1, M6, M7, 2.7 |
| R05-F02 | 기능 | 경쟁 태그 파서: 오너가 제공한 네이버쇼핑 검색 응답(JSON/HAR)에서 상품별 manuTag를, 스마트스토어 상품 페이지 소스에서 `sellerTags`를 추출해 상품 ID·순위와 함께 저장 | M1, M5 |
| R05-F03 | 기능 | 태그 점수화(경쟁 빈도·순위 가중, 검색량, 사전 등재)와 가중치 설정 UI | 2.5 |
| R05-F04 | 기능 | 하드 필터: 카테고리명, 자사/타사 브랜드명, 판매처명, 가격·혜택·배송·홍보 수식어, 사회 이슈어, 무관 태그 제거. 필터 사유를 기록 | T2, 2.6 상품명 금지 목록 |
| R05-F05 | 기능 | `GET /v2/tags/restricted-tags`로 **등록 직전에 매번** 일괄 검증하고, `restricted=true`는 제외 | A2 |
| R05-F06 | 기능 | recommend-tags exact match면 `code`와 `text`를 쌍으로 유지해 전송하고, 미매칭이면 `text`만 전송하면서 '사전 미등록 가능' 경고 표시 | A3, T1 |
| R05-F07 | 기능 | 최대 10개 선택, 최소 점수 임계치 적용(10개를 억지로 채우지 않음), 오너 승인·편집 화면(출처·점수·필터 사유 표시) | T3, T4, 오너 "내 승인하에" |
| R05-F08 | 기능 | 등록 실패 응답의 `invalidInputs`(예: `Restricted.sellerTags`)를 파싱해 문제 태그를 자동 제거하고 재시도하는 후보를 오너에게 제시 | A4 |
| R05-F09 | 기능 | 상품명 생성기: 템플릿 `브랜드 + (시리즈) + 모델명 + 상품유형 + 대표색상 + (성별)`, 최대 100자, 금지어 사전 검사, 동일 단어·동의어 반복 경고 | 2.6 상품명 |
| R05-F10 | 기능 | 카테고리 매칭은 leaf 카테고리만 허용. 성별(남/여/공용)과 카테고리 일치를 검사(남성신발→여성신발 오매칭 차단) | 2.6 카테고리, 클린 오매칭 |
| R05-F11 | 기능 | 브랜드·카탈로그 매칭: `GET /v1/product-brands`, `GET /v1/product-models`로 brandId·modelId 후보를 조회해 오너가 선택. 속성은 `/v1/product-attributes/*`로 자동 채움 후 오너 확인 | 2.6 카탈로그·속성 |
| R05-F12 | 기능 | 중복상품 방지: 등록 전 본인 스토어 상품을 `POST /v1/products/search`로 조회하고 라쿠텐 상품ID·모델명·색상 기준으로 중복 여부 확인. 중복이면 등록 차단 | 클린 중복상품 |
| R05-F13 | 기능 | 해외구매대행 표기: 해외상품 설정과 출고지 해외 주소 입력을 강제하고, 병행수입이면 상품명에 '병행' 표기 | 클린 상품명 표기기준 |
| R05-F14 | 기능 | 대표이미지 검사: 1000×1000 권장 규격, 텍스트·가격·배송·홍보 문구 유무(LLM 비전 검사), 상품 1개·모델 1명 여부 체크리스트를 오너 승인 화면에 표시 | 2.6 이미지 |
| R05-N01 | 비기능 | 네이버쇼핑 페이지를 자동으로 요청하는 기능은 **기본 비활성화**. 켜면 일일 상한, 질의 간 최소 간격, 418·캡차 감지 시 즉시 중단과 24시간 쿨다운, 캐시 7일 적용 | S1~S4, M8 |
| R05-N02 | 비기능 | 커머스API 호출은 429 `GW.RATE_LIMIT`/`GW.QUOTA_LIMIT` 헤더 기반 백오프, recommend-tags 결과는 짧은 TTL 캐시 | A1, A6 |
| R05-N03 | 비기능 | 태그·상품명 선택 근거(출처 URL/데이터, 빈도, 점수, 필터 사유)를 상품별 감사 로그로 저장 | 2.5, 승인 흐름 |
| R05-C01 | 제약 | IP 로테이션, 프록시 풀, 캡차 우회, 자동 로그인, 경쟁 상품 자동 클릭을 구현하지 않는다 | S1, S5 |
| R05-C02 | 제약 | 경쟁 태그 수집에 네이버 공식 API를 쓸 수 없다(shop.json 태그 없음, 커머스API 타 스토어 조회 불가). 경쟁 태그 기능은 반자동 입력을 전제로 한다 | M6, M7 |
| R05-C03 | 제약 | 상품명·태그·이미지에서 타 브랜드명과 홍보·가격·배송 문구 사용 금지(검증 실패 시 등록 버튼 비활성) | T2, 2.6 |

---

## 4. 리스크

| 리스크 | 심각도 | 대응 |
|---|---|---|
| 네이버쇼핑 자동 수집이 약관(자동화 수단 검색·수집 금지)을 위반하고 IP 차단(418)을 부른다. 오너의 일반 쇼핑·판매자센터 이용까지 막힐 수 있다 | 상 | 자동 수집 기본 OFF, 반자동 캡처 채택(R05-N01, C01) |
| manuTag 필드는 비공식 내부 JSON이라 **이름·구조가 예고 없이 바뀔 수 있다**. 2025년 N+스토어 개편 이후 필드가 남아 있는지도 미확인이다 | 상 | 파서를 어댑터로 분리하고 필드가 없으면 recommend-tags만으로 동작하도록 폴백. 도입 전 오너 브라우저에서 필드 존재 확인 |
| 경쟁사 태그에 **타 브랜드명·상표**가 섞이면 제한 태그, 노출 중단, 상표권 문제로 이어진다 | 중 | 브랜드 사전 필터와 restricted-tags 검증(R05-F04, F05) |
| 태그를 10개 가득 넣거나 무관 태그를 넣으면 **적합도가 떨어진다**(공식) | 중 | 점수 임계치와 무관 태그 판정(R05-F07) |
| 중복상품(같은 라쿠텐 상품 재등록)은 **복구 불가 삭제와 몰 전체 클린 제재**를 받는다 | 상 | 등록 전 중복 검사(R05-F12) |
| 해외 표기 누락이나 카테고리 오매칭은 상품명 표기기준 위반으로 삭제된다 | 중 | R05-F10, F13 |
| AI 썸네일(아이돌이 신발을 든 연출 사진)이 이미지 SEO 저품질 기준(소품·상황 연출, 과도 보정, 실제와 다름)이나 대표이미지 등록 기준에 걸릴 수 있다. AI가 신발 디테일을 바꾸면 **정보상이**가 된다 | 중 | 대표이미지는 원본 단독 컷, AI 이미지는 추가이미지로 두는 옵션 제공(Q7). 실존 인물과 닮은 얼굴을 쓸 때의 퍼블리시티권·초상권 문제는 **별도 리서치 필요(미확인)** |
| restricted-tags의 배열 쿼리 형식과 1회 최대 개수가 미확인이라 구현 초기에 오류가 날 수 있다 | 하 | 스파이크 테스트(1개·10개·반복 파라미터·콤마 방식) |
| 셀러 도구(셀러라이프 등) 화면 구조나 약관이 바뀌면 붙여넣기 파서가 깨진다 | 하 | 자유 텍스트 붙여넣기(태그 목록만)도 받기 |

---

## 5. 오너에게 물어야 할 질문

1. **"manutag"를 어디서 보셨나요?** (a) 네이버쇼핑 검색 F12의 `manuTag`, (b) 스마트스토어 상품 페이지의 태그(`sellerTags`), (c) 셀러라이프 확장이 보여 주는 태그 중 무엇인가요? 지금 쓰는 도구가 있나요?
2. 경쟁 상품의 범위는? "라쿠텐에서 고른 **같은 모델**"의 국내 판매 상품인가요, 아니면 데이터랩 키워드 검색 상위 N개(몇 개)인가요?
3. 경쟁 태그 수집을 **반자동**(오너가 브라우저에서 직접 검색 → 앱이 결과만 가져감)으로 해도 되나요? 아니면 약관 위반·차단 리스크를 감수하고 자동 수집을 원하시나요?
4. 네이버 **커머스API 애플리케이션**(판매자 본인용)은 발급하셨나요? (recommend-tags·restricted-tags·상품등록 모두 필요)
5. **네이버 검색광고 API**(검색량 가중치용) 계정이 있나요? 없으면 데이터랩 수치만으로 가중치를 줄까요?
6. 사전에 없는 **직접입력 태그**도 허용할까요? 아니면 사전 등재 태그만 쓸까요?
7. 대표이미지로 **AI 아이돌 이미지**를 쓸까요, 아니면 **원본 상품 단독 이미지**를 대표로 하고 AI 이미지는 추가이미지로 쓸까요?
8. 판매 상품이 **정품 구매대행**인가요, **병행수입**인가요? ('병행' 표기와 해외상품 설정에 영향)
9. 태그를 **항상 10개** 채울까요, 아니면 **점수 기준을 넘는 것만** 넣을까요?

---

## 6. 출처 목록

**공식(네이버)**
- 네이버 가격비교 FAQ – 상품검색SEO 가이드(검색 알고리즘): https://join.shopping.naver.com/faq/list.nhn?catgCd=H00015
- 같은 가이드 – 적합도: https://join.shopping.naver.com/faq/list.nhn?catgCd=H00015&dtlCatgCd=H00017
- 같은 가이드 – 인기도: https://join.shopping.naver.com/faq/list.nhn?catgCd=H00015&dtlCatgCd=H00018
- 같은 가이드 – 신뢰도: https://join.shopping.naver.com/faq/list.nhn?catgCd=H00015&dtlCatgCd=H00019
- 같은 가이드 – 선호도: https://join.shopping.naver.com/faq/list.nhn?catgCd=H00015&dtlCatgCd=H00020
- 같은 가이드 – 그룹상품: https://join.shopping.naver.com/faq/list.nhn?catgCd=H00015&dtlCatgCd=H00049
- 같은 가이드 – 카탈로그: https://join.shopping.naver.com/faq/list.nhn?catgCd=H00015&dtlCatgCd=H00050
- 같은 가이드 – SEO 가이드(카테고리·상품명·이미지·브랜드·속성·태그, 본문 이미지 포함): https://join.shopping.naver.com/faq/list.nhn?catgCd=H00015&dtlCatgCd=H00051
  - 상품명 가이드 이미지: https://csmail.help.nmp.naver.com/nmp/download.help?seq=80160
  - 태그 가이드 이미지: https://csmail.help.nmp.naver.com/nmp/download.help?seq=80165
  - 카테고리/브랜드/속성 이미지: https://csmail.help.nmp.naver.com/nmp/download.help?seq=80159 , ?seq=80163 , ?seq=80164
- 네이버 가격비교 FAQ – 클린프로그램(중복상품·상품명 표기기준·위반사유): https://join.shopping.naver.com/faq/list.nhn?catgCd=H00012
- 네이버 가격비교 EP 3.0 가이드(PDF, `search_tag`·`title`): https://join.shopping.naver.com/misc/download/ep_guide.nhn
- 네이버 커머스API llms 인덱스: https://apicenter.commerce.naver.com/llms/llms.txt
- (v2) 추천 태그 검색 목록 조회: https://apicenter.commerce.naver.com/llms/get-v2-tags-recommend-tags.md
- (v2) 제한 태그 여부 조회: https://apicenter.commerce.naver.com/llms/get-v2-tags-restricted-tags.md
- (v2) 상품 등록: https://apicenter.commerce.naver.com/llms/post-v2-products.md
- 스마트스토어 상품 가이드(필드–참조 API 표, 카탈로그): https://apicenter.commerce.naver.com/llms/wiki-스마트스토어-상품-가이드.md
- 커머스API 제약 사항(요청량 제한): https://apicenter.commerce.naver.com/llms/intro-제약사항.md
- commerce-api Discussion #1330(태그 등록 불가 확인 API 미제공, 당시): https://github.com/commerce-api-naver/commerce-api/discussions/1330
- commerce-api Discussion #1867(직접입력 태그는 text만): https://github.com/commerce-api-naver/commerce-api/discussions/1867
- commerce-api Discussion #1610(추천 태그도 카테고리별 사용 불가 가능): https://github.com/commerce-api-naver/commerce-api/discussions/1610
- commerce-api Discussion #1857(seoInfo 구조, code 불일치 오류): https://github.com/commerce-api-naver/commerce-api/discussions/1857
- commerce-api Discussion #1900(타 스토어 상세 추출 API 없음): https://github.com/commerce-api-naver/commerce-api/discussions/1900
- 네이버 쇼핑 검색 Open API 문서: https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md
- 네이버 이용약관(시행 2025-07-10): https://policy.naver.com/rules/service.html
- 네이버 검색결과 수집에 대한 정책: https://policy.naver.com/policy/search_policy.html
- 스마트스토어 robots.txt(관찰 2026-09-24): https://smartstore.naver.com/robots.txt
- 네이버쇼핑 검색(418 관찰 2026-09-24): https://search.shopping.naver.com/ns/search

**커뮤니티·서드파티**
- Threads @how._.zero – manuTag 확인 방법: https://www.threads.com/@how._.zero/post/DI276ZgxHWj
- Threads @how._.zero – manuTag로도 노출: https://www.threads.com/@how._.zero/post/DI39nrYv3x-
- Threads @sell.info – 태그사전 사용: https://www.threads.com/@sell.info/post/DBnteYvyVb0
- 이셀러스 FAQ(태그 최대 10개): https://www.esellers.co.kr/cms/faq/detail/22512?category_name=%EC%A3%BC%EB%A8%B8%EB%8B%88+%EC%83%81%ED%92%88%EA%B4%80%EB%A6%AC
- 플레이오토 도움말(태그 불가 단어): https://www.plto.com/customer/HelpDesc/gmp/13892/
- 300won 셀러태그 파서(원문 504, 스니펫만): https://300won.com/tag/
- 아이템스쿨 – 상품명 짓기: https://school.itemscout.io/article/seo-strategy-2
- 셀러라이프 Chrome 확장: https://chromewebstore.google.com/detail/%EC%85%80%EB%9F%AC%EB%9D%BC%EC%9D%B4%ED%94%84/cgococegfcmmfcjggpgelfbjkkncclkf
- 아이템스카우트 Chrome 확장: https://chromewebstore.google.com/detail/%EC%95%84%EC%9D%B4%ED%85%9C%EC%8A%A4%EC%B9%B4%EC%9A%B0%ED%8A%B8/ecmeogcbcoalojmkfkmancobmiahaigg
- Sellomon Chrome 확장: https://chromewebstore.google.com/detail/sellomon-smart-keyword-an/nmiondnlemngnmgfkckcflnhnibolood
- 네이버쇼핑 상품명 조합기: https://chromewebstore.google.com/detail/%EB%84%A4%EC%9D%B4%EB%B2%84%EC%87%BC%ED%95%91-%EC%83%81%ED%92%88%EB%AA%85-%EC%A1%B0%ED%95%A9%EA%B8%B0/fpichjpphphfcahgfldhlpdlbbmgfjde
- 마켓랩 태그 추출기: https://www.marketlab.co.kr/maketag/
- 장사왕 – 대표이미지 등록 기준 변경(2024-10-28): https://www.sellerking.io/blog/%EC%8A%A4%EB%A7%88%ED%8A%B8%EC%8A%A4%ED%86%A0%EC%96%B4-%EC%83%81%ED%92%88-%EB%8C%80%ED%91%9C%EC%9D%B4%EB%AF%B8%EC%A7%80-%EB%93%B1%EB%A1%9D-%EA%B8%B0%EC%A4%80-%EB%B3%80%EA%B2%BD-%EA%B0%80%EC%9D%B4%EB%93%9C-30410
- 킴스도매 – 대표이미지 등록 기준 안내: https://kimsdome.com/article/%EA%B3%B5%EC%A7%80%EC%82%AC%ED%95%AD/1/642/
- 해시스크래퍼 – 네이버 크롤링 차단 방식: https://blog.hashscraper.com/posts/reasons-why-naver-crawling-is-blocked-and-solutions?locale=ko
- Apify – Naver Plus Store Product Search(내부 엔드포인트 언급): https://apify.com/battery/naver-plusstore-product-search
- 검색광고 keywordstool 사용 가이드: https://placewizard.kr/guide/naver-keyword-search-ad-api-guide.php

---

## 검증 결과 (적대적 재검증)

- 검증일: 2026-09-24
- 방법: 조사자가 붙인 출처를 그대로 믿지 않고 1차 출처 원문을 직접 받아 대조했다. WebFetch가 막힌 도메인(apicenter.commerce.naver.com, developers.naver.com)은 `curl`로 원문을 받았다. 쇼핑파트너 SEO 가이드 본문 이미지(seq=80159~80165)는 내려받아 눈으로 읽었다. EP 가이드 PDF는 텍스트를 뽑아 확인했다. GitHub Discussion은 페이지 원문에서 공식 답변(커머스API 담당자)을 확인했다. 네이버쇼핑 검색 페이지와 robots.txt는 1회씩만 GET했고 차단 우회는 하지 않았다.
- 결과: 11개 주장 모두 **CONFIRMED**다. REFUTED나 CORRECTED로 판정한 항목이 없어서 본문에 "⚠️정정됨" 표시는 붙이지 않았다. 다만 출처를 잘못 가리키거나 범위를 넓게 쓴 부분이 있어 아래 '보충' 칸에 적었다.

### 판정 표

| 항목 | 주장 | 판정 | 정정 내용(보충) | 근거 URL |
|---|---|---|---|---|
| F01 (M1·M2) | manuTag는 검색 페이지의 `all?query=` 응답 JSON 필드로 커뮤니티에 알려져 있고 F12 Network에서 확인한다. 공식 문서에는 이 이름이 없다 | CONFIRMED | 커뮤니티 주장이라는 점은 원문으로 확인했다. Threads 게시물 날짜는 2025-04-24과 2025-04-25다. 내용은 "F12 → network → `all?query=`로 시작하는 요청 → manutag 검색"과 "진짜태그(manuTag)로도 노출"이다. 이번에 확인한 공식 문서(SEO 가이드 H00051, EP 가이드 PDF, 커머스API llms 인덱스·태그·상품등록 문서)에는 `manuTag`라는 문자열이 없다. **이 필드가 지금도 응답에 있는지는 확인하지 못했다(UNVERIFIABLE).** 네이버쇼핑이 비브라우저 요청에 418을 돌려주기 때문이다. 게시물 시점은 N+스토어 개편 시기와 겹친다 | https://www.threads.com/@how._.zero/post/DI276ZgxHWj , https://www.threads.com/@how._.zero/post/DI39nrYv3x- , https://join.shopping.naver.com/faq/list.nhn?catgCd=H00015&dtlCatgCd=H00051 |
| F02 (M3·T1) | 태그는 내부 태그 사전 기준으로 검색에 쓰인다. 사전에 없거나 기준에 안 맞는 태그는 노출되지 않는다. 태그가 적으면 자동 태그를 추가 노출한다 | CONFIRMED | 원문: "내부적으로 구축된 태그 사전을 기반으로… 미등록된 태그나 등록 기준에 맞지 않는 태그는 노출되지 않습니다", "…상품 정보를 기반으로 추출한 자동 태그를 추가로 노출… (상품과 관련없는 태그일 경우 미사용 조치 가능)". 태그 이미지에도 "사전에 없는 태그의 경우 적합 여부 검토 후 사전에 등록되거나 등록되지 않을 수 있습니다"가 있다 | https://join.shopping.naver.com/faq/list.nhn?catgCd=H00015&dtlCatgCd=H00051 , https://csmail.help.nmp.naver.com/nmp/download.help?seq=80165 |
| F03 (T2·T3) | 카테고리명·브랜드명·판매자명은 태그로 쓸 수 없다. 할인·배송 등 사전에 없는 홍보 키워드도 쓸 수 없다. 권장 유형은 4가지다. 태그가 너무 많으면 적합도에 영향을 준다 | CONFIRMED | 태그 가이드 이미지 문구와 일치한다. 나쁜 예(#이불커버→카테고리, #JAJU→브랜드, #무료배송·#반짝할인→구매/혜택 조건)와 좋은 예(#홈인테리어·#신생아용품·#겨울용품·#레트로스타일)도 같다 | https://csmail.help.nmp.naver.com/nmp/download.help?seq=80165 |
| F04 (T4·T5) | 검색태그는 최대 10개다. EP `search_tag`는 `\|`로 구분하고 10개 초과분과 100자 초과분은 처리하지 않는다. 노출은 보장되지 않고 클렌징 후 반영된다. 스마트스토어도 연동사 문서로 10개가 확인된다 | CONFIRMED | EP PDF 36쪽(인쇄 쪽번호 40)의 `search_tag` 원문과 일치한다. 이셀러스 문서의 "검색어(태그)는 최대 10개까지 반영되며, 입력불가 태그의 경우 제외 후 등록"과 플레이오토 문서의 "카테고리/브랜드/판매처명이 포함된 키워드는 등록이 불가"도 원문으로 확인했다. **스마트스토어의 10개 제한을 적은 네이버 1차 문서(커머스API 스키마 포함)는 찾지 못했다.** 연동사 문서로만 확인된다 | https://join.shopping.naver.com/misc/download/ep_guide.nhn , https://www.esellers.co.kr/cms/faq/detail/22512?category_name=%EC%A3%BC%EB%A8%B8%EB%8B%88+%EC%83%81%ED%92%88%EA%B4%80%EB%A6%AC , https://www.plto.com/customer/HelpDesc/gmp/13892/ |
| F05 (A1) | `GET /v2/tags/recommend-tags?keyword=`는 code(int64)와 text를 돌려준다. keyword는 필수이고 결과가 비어 있을 수 있다 | CONFIRMED | 원문 일치. keyword를 빼면 400이다. 짧은 TTL 캐시를 권장한다. 에러 코드에는 404 NOT_FOUND도 있다 | https://apicenter.commerce.naver.com/llms/get-v2-tags-recommend-tags.md |
| F06 (A2·A5) | `GET /v2/tags/restricted-tags?tags=`는 태그별 {tag, restricted}를 돌려준다. 등록할 때마다 검증하라고 권장한다. #1330 당시에는 이런 API가 없었다 | CONFIRMED | 원문 일치. `tags`는 query `array`이고 필수이며, 빈 배열이면 400이다. 배열 직렬화 형식과 최대 개수는 문서에 없다("적정 수준으로 제한"이라고만 쓰여 있다). **카테고리 파라미터가 없다.** 그래서 #1610에서 말한 "카테고리에 따라 불가"한 태그는 이 API로 미리 걸러지지 않을 수 있다(추정). #1330 공식 답변 날짜는 2023-12-18이고 내용은 "등록 불가한 태그 확인 API는 제공하고 있지 않습니다"다 | https://apicenter.commerce.naver.com/llms/get-v2-tags-restricted-tags.md , https://github.com/commerce-api-naver/commerce-api/discussions/1330 , https://github.com/commerce-api-naver/commerce-api/discussions/1610 |
| F07 (A3) | 태그 경로는 `originProduct.detailAttribute.seoInfo.sellerTags[]`({code,text})다. code와 text가 다르면 실패하고, 직접 입력 태그는 text만 보낸다. seoInfo에는 pageTitle과 metaDescription도 있다 | CONFIRMED | #1867 공식 답변은 "code를 제외하여 호출하면 직접 입력 태그"다. #1857의 에러 예시는 `NotValid.recommendTags.code`("유효하지 않는 판매자 입력 태그 코드")이고, 올바른 경로가 `detailAttribute.seoInfo.sellerTags`임도 확인된다. #1867 질문 페이로드에 `pageTitle`과 `metaDescription`이 있다. 상품 가이드의 필드-참조 표에는 "`seoInfo.sellerTags` / code → recommend-tags"가 있다 | https://apicenter.commerce.naver.com/llms/get-v2-tags-recommend-tags.md , https://github.com/commerce-api-naver/commerce-api/discussions/1867 , https://github.com/commerce-api-naver/commerce-api/discussions/1857 , https://apicenter.commerce.naver.com/llms/wiki-스마트스토어-상품-가이드.md |
| F09 (M6) | shop.json 응답 필드는 title부터 category1~4까지뿐이고 태그 필드는 없다. 한도는 하루 25,000회, display 최대 100, start 최대 1000이고 exclude=used:rental:cbshop을 지원한다 | CONFIRMED | item 필드 목록이 원문과 정확히 같다. 보충할 점이 셋 있다. (1) 25,000회는 쇼핑 전용 한도가 아니다. 원문은 "검색 API의 하루 호출 한도"다. (2) `filter=naverpay` 파라미터도 있다. (3) `cbshop`은 "해외직구, 구매대행"을 뜻하므로 구매대행 경쟁군을 분리할 때 쓸 수 있다 | https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md |
| F10 (M7) | 커머스API는 본인 스토어 상품만 다룬다. 타 스토어 상세페이지를 추출하는 API는 없다 | CONFIRMED | #1900 공식 답변: "타 스마트스토어 상품의 상세페이지만 추출하는 API는 제공되고 있지않습니다… '내스토어 애플리케이션'은 본인의 상품, 주문 등만 처리". 범위를 정확히 쓰면 이렇다. 토큰 발급 `type=SELLER`(솔루션)를 쓰면 **위임한 판매자**의 리소스도 다룰 수 있다. 다만 임의의 타 스토어는 조회할 수 없다는 결론은 같다 | https://github.com/commerce-api-naver/commerce-api/discussions/1900 , https://apicenter.commerce.naver.com/llms/post-v1-oauth2-token.md |
| F11 (M8·S3) | ns/search에 curl GET 1회 → 418 "쇼핑 서비스 접속이 일시적으로 제한". 같은 호스트의 robots.txt도 418. smartstore robots.txt는 `User-agent: * Disallow: /` | CONFIRMED | 2026-09-24에 재현했다. `ns/search?query=운동화` GET 1회와 `search.shopping.naver.com/robots.txt`가 모두 418이었다. smartstore robots.txt는 `User-agent: *` → `Disallow: /`이고 GPTBot·ClaudeBot·CCBot 등도 명시적으로 막는다(`facebookexternalhit`만 Allow). 차단 페이지가 든 사유에는 **"특정 확장 프로그램 이용 시"** 가 들어 있다. 첫 요청부터 418이 나왔으므로 요청량보다 비브라우저 클라이언트를 판별해 막는 것으로 보인다(추정) | https://search.shopping.naver.com/ns/search , https://smartstore.naver.com/robots.txt |
| F12 (S1·S2) | 이용약관(시행 2025-07-10)은 자동화 수단 수집, 특정 질의어 검색, IP 로테이션, 캡차 우회를 금지한다. 검색결과 수집 정책은 robots.txt DB 수집을 불허하고 법적 책임을 명시한다 | CONFIRMED | 약관 원문의 시행일자는 2025년 7월 10일이다. "자동화된 수단(예: 매크로 프로그램, 로봇(봇), 스파이더, 스크래퍼 등)을 이용하여… 게시물 등을 수집하거나, 네이버 검색 서비스에서 특정 질의어로 검색하거나 혹은… 특정 검색결과를 선택(이른바 '클릭')…", "(예: IP를 지속적으로 바꿔가며 접속하는 행위, Captcha를 외부 솔루션 등을 통해 우회…)". 정책 원문: "robots.txt로 보호되고 있는 데이터 베이스를 네이버의 로봇이 아닌 타 검색 로봇이 수집하는 것을 불허", "법적 절차를 포함하여 엄중한 책임을 물을 것" | https://policy.naver.com/rules/service.html , https://policy.naver.com/policy/search_policy.html |
| F15 (2.6 상품명) | 상품명 공식 가이드 전체(신발 예시, 금지·지양 목록, 무관 옵션 적발 시 서비스 중지, 100자) | CONFIRMED | 상품명 가이드 이미지(seq=80160)에서 신발 예시, 동의어 반복·수식어·특수문자·사회 이슈어·전화번호·셀러 식별코드(IP01, Y01, ST, _ES)·무관 옵션("적발 시 상품 서비스가 중지")을 모두 확인했다. 입력창 표시는 `n/100`이고 EP `title`은 100자다. **출처 보충:** "대표 옵션 포함, 성별이 명확한 상품은 '남성/여성' 추가"는 상품명 이미지(80160)가 아니라 **적합도 FAQ(H00017)** 의 "[적합도 TIP] 상품명에 대표 옵션 포함하기"에 있다. 같은 FAQ에 "주요 키워드 1,2개"와 "동의어 중복 사용 시 어뷰징 판정 불이익"도 있다. "A급, st, 공식, 모음, 정품" 같은 수식어에 대한 원문 표현은 금지가 아니라 "입력을 주의"다. "50자 권장"과 "3회 반복 경고"는 1차 문서에서 찾지 못했다(EP의 '모바일 50자 노출'은 `event_words` 컬럼 이야기로, 상품명과는 무관하다) | https://csmail.help.nmp.naver.com/nmp/download.help?seq=80160 , https://join.shopping.naver.com/faq/list.nhn?catgCd=H00015&dtlCatgCd=H00017 , https://join.shopping.naver.com/misc/download/ep_guide.nhn |

### 누락 주제 (PRD에 반영 검토)

1. **반자동 확장 방식도 차단 사유에 해당할 수 있다.** 418 차단 페이지가 "특정 확장 프로그램 이용 시"를 명시한다. 2.7의 권장안(로컬 확장이나 북마클릿이 응답을 읽음)과 셀러라이프 같은 확장 사용이 오너의 일반 쇼핑 접속 차단으로 이어질 수 있다는 리스크가 리스크 표에 없다.
2. **manuTag의 현행 존재와 위치가 확인되지 않았다.** 근거 게시물은 2025-04 시점이다. N+스토어 개편 이후 `all?query=`(가격비교)와 `ns/v1/search/paged-products`(N+스토어) 중 어디에 필드가 남았는지 오너 브라우저로 먼저 확인해야 한다(PoC 게이트).
3. **경쟁 manuTag에는 네이버 자동 태그가 섞여 있을 수 있다.** 공식 가이드에 따르면 태그가 적으면 자동 태그를 추가로 노출한다. 그래서 경쟁 상품에서 보이는 태그를 그대로 복사하면 판매자가 입력할 수 없는 태그(카테고리성 단어 등)가 들어갈 수 있다. 수집 태그를 "판매자 입력분"과 "자동 태그"로 구분할 수 있는지는 미확인이다.
4. **sellerTags의 공식 개수·길이 한도가 확인되지 않았다.** 커머스API 문서 본문에 maxItems와 글자 수가 없다(OAS 참조로 생략돼 있다). 10개 제한은 EP와 연동사 문서 기준이다. 구현 전에 OAS나 실제 호출로 확인해야 한다.
5. **카테고리별 태그 제한은 사전에 막을 수 없다.** `restricted-tags`에 카테고리 입력이 없어서 "추천 태그인데 카테고리 때문에 거절"(#1610)되는 경우는 등록 실패 응답으로만 알 수 있다. 실패→제거→재시도 루프를 필수 흐름으로 명시해야 한다.
6. **스마트스토어 상품 페이지의 sellerTags 파싱(M5, R05-F02)은 robots.txt 전면 Disallow 대상이다.** 약관의 자동 수집 금지와도 정면으로 충돌한다. 이 경로는 "오너가 연 페이지"로 한정한다는 제약을 명시해야 한다.
7. **네이버 공식 키워드 대안이 빠져 있다.** 데이터랩 쇼핑인사이트 오픈API(키워드·카테고리 클릭 추이)를 태그 가중치의 공식 데이터 소스로 넣을지 검토해야 한다. keywordstool(검색광고 API)의 약관과 호출 한도는 1차 출처로 검증되지 않았다.
8. **태그와 상품명 수정의 반영 주기가 빠져 있다.** 공식 FAQ(H00019)에 따르면 랭킹 반영에 약 1일이 걸리고 수정 자체에는 페널티가 없다. 이를 근거로 태그를 등록 후 조정하는 운영 흐름을 넣을 수 있다.
9. **`seoInfo.pageTitle`·`metaDescription`의 작성 규칙과 길이 제한을 조사하지 않았다.**
10. **`shop.json`의 `exclude=cbshop` 활용 방안이 없다.** 이 값은 해외직구·구매대행을 뜻한다. 구매대행으로 올릴 오너 상품이 어느 검색 면과 필터에서 어떻게 분류되는지는 경쟁군 선정과 노출 전략에 영향을 준다.

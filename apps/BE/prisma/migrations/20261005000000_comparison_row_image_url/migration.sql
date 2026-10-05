-- 04-8. 네 번째 마이그레이션(V4) — ERD v0.7 (D-47 Proposed, 2026-10-05)
-- sourcing_comparison_row에 상품 사진 주소 image_url(varchar(2048), NULL 허용)을 더한다.
--   ② '상품 고르기' 목록(화면시안 명세 §13)이 행마다 사진을 보이려고 Item Search 응답 mediumImageUrls의 첫 값을 둔다.
--   수동 행·이 마이그레이션 전에 만든 행은 NULL이다(추가형 — 기존 값은 바뀌지 않는다).
-- 문서 원본: docs/dev/04_데이터베이스/04-8_V4__comparison_row_image_url.sql(바이트 그대로 — db:check-sync가 본다).
ALTER TABLE sourcing_comparison_row ADD COLUMN image_url VARCHAR(2048);

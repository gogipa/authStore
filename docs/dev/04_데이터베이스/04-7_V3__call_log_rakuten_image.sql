-- 04-7. 세 번째 마이그레이션(V3) — ERD v0.6 (P3-01 Proposed, 2026-10-01)
-- call_log.target에 라쿠텐 상품 이미지 CDN 호출 대상 RAKUTEN_IMAGE를 더한다(ck_call_log_target).
--   ⑤ 썸네일 원본 이미지 받기(F-TH-01)가 외부 호출 관문을 지나 call_log에 남기는 대상이다.
--   RAKUTEN_PAGE로 남기면 하루 페이지 조회 상한(110)을 이미지가 써 버린다 — 이 대상은 하루 상한에 넣지 않는다(열린질문 P1-01·P3-01).
-- Prisma 스키마(열·타입)는 바뀌지 않는다. CHECK는 Prisma 밖 SQL이라 이 파일에만 있다(04-3 맨 아래 주석도 같은 값으로 고쳤다).
-- 문서 원본: docs/dev/04_데이터베이스/04-7_V3__call_log_rakuten_image.sql(바이트 그대로 — db:check-sync가 본다).
ALTER TABLE call_log DROP CONSTRAINT ck_call_log_target;
ALTER TABLE call_log
  ADD CONSTRAINT ck_call_log_target CHECK (target IN ('COMMERCE_API','RAKUTEN_API','RAKUTEN_PAGE','RAKUTEN_IMAGE','DATALAB','FX_KOREAEXIM','FX_CUSTOMS','NOTICE_MONITOR','UPDATE_CHECK','AI_CLAUDE_CLI','AI_AGY_CLI','AI_CODEX_CLI','AI_GEMINI_API','AI_OPENAI_API'));

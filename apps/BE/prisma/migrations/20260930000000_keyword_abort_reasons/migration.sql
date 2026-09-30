-- 04-6. 두 번째 마이그레이션(V2) — ERD v0.5 (P2-01 Proposed, 2026-09-30)
-- keyword_snapshot.abort_reason에 이상 응답이 아닌 중단 사유 3개를 더한다(ck_kws_abort_reason).
--   NETWORK_ERROR: 데이터랩 응답을 받지 못함(시간 초과·연결 실패)
--   APP_RESTART:   수집 중 앱이 꺼져 재시작 때 RUNNING 묶음을 닫음(없으면 RUNNING이 남아 ALREADY_IN_PROGRESS로 계속 막힌다)
--   INTERRUPTED:   그 밖에 도중에 멈춤(하루 상한·쉼에 막힘, 앱 내부 오류)
-- Prisma 스키마(열·타입)는 바뀌지 않는다. CHECK는 Prisma 밖 SQL이라 이 파일에만 있다(04-3 맨 아래 주석도 같은 값으로 고쳤다).
-- 문서 원본: docs/dev/04_데이터베이스/04-6_V2__keyword_abort_reasons.sql(바이트 그대로 — db:check-sync가 본다).
ALTER TABLE keyword_snapshot DROP CONSTRAINT ck_kws_abort_reason;
ALTER TABLE keyword_snapshot
  ADD CONSTRAINT ck_kws_abort_reason CHECK (abort_reason IN ('NO_RANKS_KEY','HTTP_404','NOT_JSON','RETURN_CODE','COUNT_MISMATCH','HTTP_403','HTTP_418','HTTP_429','NETWORK_ERROR','APP_RESTART','INTERRUPTED'));

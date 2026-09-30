// 각 e2e 테스트 파일 전에: autostore_test를 쓰게 환경변수를 맞추고,
// 앱 데이터 폴더(APP_DATA_DIR)를 os.tmpdir() 아래 임시 폴더로 잡는다(저장소의 .data는 쓰지 않는다).
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

require('../scripts/test-db-env.cjs').applyTestDbEnv();
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), 'autostore-e2e-'));
// 앱 시작 AI 엔진 점검을 끈다(P1-10 — createTestApp은 DI로도 끄고 어댑터를 가짜로 바꾼다. 진짜 CLI·구독 쿼터를 쓰지 않게)
process.env.AI_ENGINE_STARTUP_CHECK = 'off';

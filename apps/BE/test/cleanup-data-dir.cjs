// 각 e2e 테스트 파일이 끝나면 setup-env.cjs가 만든 임시 데이터 폴더를 지운다.
const { rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { relative, isAbsolute } = require('node:path');

afterAll(() => {
  const dir = process.env.APP_DATA_DIR;
  if (!dir) return;
  const rel = relative(tmpdir(), dir);
  // 임시 폴더 아래 autostore-e2e-* 만 지운다
  if (rel.startsWith('autostore-e2e-') && !isAbsolute(rel)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

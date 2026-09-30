import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { locateCliBinary } from './cli-locator.js';

describe('locateCliBinary(P1-10, 셸 없이 PATH 훑기)', () => {
  let a: string;
  let b: string;

  beforeEach(() => {
    a = mkdtempSync(join(tmpdir(), 'autostore-locator-'));
    b = mkdtempSync(join(tmpdir(), 'autostore-locator-'));
  });

  afterEach(() => {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  });

  it('PATH 앞 폴더의 실행 파일을 고르고, 실행 권한 없는 파일·폴더·상대 경로 항목은 건너뛴다', () => {
    writeFileSync(join(a, 'claude'), 'x');
    chmodSync(join(a, 'claude'), 0o644);
    writeFileSync(join(b, 'claude'), '#!/bin/sh\n');
    chmodSync(join(b, 'claude'), 0o755);
    expect(locateCliBinary('claude', { PATH: `.:${a}:${b}` }, 'darwin')).toBe(join(b, 'claude'));
    expect(locateCliBinary('codex', { PATH: `${a}:${b}` }, 'darwin')).toBeNull();
    expect(locateCliBinary('claude', {}, 'darwin')).toBeNull();
  });
});

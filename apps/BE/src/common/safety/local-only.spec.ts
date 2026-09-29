import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BE_ROOT } from '../config/paths.js';
import { validateEnv } from '../config/env.validation.js';
import { findPersonalValues } from './safety-rules.js';

describe('로컬 전용 서버(F-BS-01)', () => {
  const main = readFileSync(join(BE_ROOT, 'src', 'main.ts'), 'utf8');

  it("BIND_HOST는 '127.0.0.1' 상수이고 listen이 그것만 쓴다", () => {
    expect(main).toMatch(/export const BIND_HOST = '127\.0\.0\.1';/);
    expect(main).toMatch(/app\.listen\(port, BIND_HOST\)/);
  });

  it('바인딩 주소를 바꾸는 환경변수가 없다', () => {
    const keys = Object.keys(
      validateEnv({ DATABASE_URL: 'postgresql://u@localhost:5432/autostore_dev' }),
    );
    expect(keys.filter((k) => /(HOST|BIND|LISTEN|ADDRESS|INTERFACE)/i.test(k))).toEqual([]);
  });

  it('스토어를 바꿔 쓰는 설정이 없다(설치본 하나 = 스토어 하나)', () => {
    const keys = Object.keys(
      validateEnv({ DATABASE_URL: 'postgresql://u@localhost:5432/autostore_dev' }),
    );
    expect(keys.filter((k) => /(STORE|SELLER|ACCOUNT|TENANT)/i.test(k))).toEqual([]);
  });
});

describe('개인 값 자리표시자(F-BS-03)', () => {
  function listFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'generated' || name === 'node_modules') continue;
        listFiles(p, out);
      } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
        out.push(p);
      }
    }
    return out;
  }

  it('검사기가 개인 값 모양을 잡는다', () => {
    expect(findPersonalValues('연락처 010-1234-5678').map((f) => f.kind)).toEqual(['휴대전화']);
    expect(findPersonalValues('help@shop.example').map((f) => f.kind)).toEqual(['이메일']);
    expect(findPersonalValues('사업자 123-45-67890').map((f) => f.kind)).toEqual([
      '사업자등록번호',
    ]);
    expect(findPersonalValues('/Users/owner/Library').map((f) => f.kind)).toEqual([
      '사용자 홈 경로',
    ]);
    expect(findPersonalValues('상호 {상호} · 연락처 {연락처}')).toEqual([]);
    expect(findPersonalValues('postgresql://<사용자>@localhost:5432/autostore_dev')).toEqual([]);
  });

  it('앱 코드(src)와 .env.example에 개인 값이 없다', () => {
    const files = [...listFiles(join(BE_ROOT, 'src')), join(BE_ROOT, '.env.example')];
    const found = files.flatMap((f) =>
      findPersonalValues(readFileSync(f, 'utf8')).map(
        (x) => `${relative(BE_ROOT, f)}:${x.line} ${x.kind}`,
      ),
    );
    expect(found).toEqual([]);
  });
});

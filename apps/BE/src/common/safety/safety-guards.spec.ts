import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BE_ROOT } from '../config/paths.js';
import { validateEnv } from '../config/env.validation.js';
import { findSafetyGuardSwitches, isSafetyGuardSwitchName } from './safety-rules.js';

/**
 * F-BS-04·US-36 AC4: 안전장치 5개(G4 최종 승인, 아동화 차단, 실존 인물 차단, 중복 등록 방지, 원본 업로드 거부)를
 * 끄는 환경변수·설정 키·요청 파라미터가 없다. P1-03이 설정 스키마 키를 이 검사에 더한다.
 */
describe('안전장치 끄기 설정 없음(F-BS-04)', () => {
  it.each([
    'SKIP_G4',
    'G4_AUTO_APPROVE',
    'AUTO_APPROVE',
    'DISABLE_KIDS_FILTER',
    'ALLOW_CHILD_SHOES',
    'BYPASS_PERSON_CHECK',
    'ALLOW_CELEBRITY_IMAGES',
    'FORCE_DUPLICATE_REGISTRATION',
    'SKIP_DEDUP',
    'ALLOW_ORIGINAL_UPLOAD',
    'disableSafetyGuards',
    'noGateCheck',
  ])('%s는 금지 이름으로 잡힌다', (name) => {
    expect(isSafetyGuardSwitchName(name)).toBe(true);
  });

  it.each(['NODE_ENV', 'PORT', 'DATABASE_URL', 'APP_DATA_DIR', 'LOG_LEVEL', 'DEV_FE_ORIGINS'])(
    '%s는 금지 이름이 아니다',
    (name) => {
      expect(isSafetyGuardSwitchName(name)).toBe(false);
    },
  );

  it('EnvironmentVariables 키에 안전장치를 끄는 키가 없다', () => {
    const env = validateEnv({ DATABASE_URL: 'postgresql://u@localhost:5432/autostore_dev' });
    const keys = Object.keys(env);
    expect(keys.length).toBeGreaterThan(0);
    expect(findSafetyGuardSwitches(keys)).toEqual([]);
  });

  it('.env.example 키에 안전장치를 끄는 키가 없다', () => {
    const text = readFileSync(join(BE_ROOT, '.env.example'), 'utf8');
    const keys = text
      .split('\n')
      .map((l) => /^\s*([A-Z0-9_]+)\s*=/.exec(l)?.[1])
      .filter((k): k is string => Boolean(k));
    expect(keys).toContain('APP_DATA_DIR');
    expect(findSafetyGuardSwitches(keys)).toEqual([]);
  });
});

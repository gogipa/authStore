import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BE_ROOT } from '../config/paths.js';
import { validateEnv } from '../config/env.validation.js';
import { SETTINGS_JSON_SCHEMA } from '../../modules/settings/schema/settings.schema.js';
import { findSafetyGuardSwitches, isSafetyGuardSwitchName } from './safety-rules.js';

interface SchemaNode {
  type?: unknown;
  additionalProperties?: unknown;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
}

/** 스키마를 돌며 객체·배열 항목마다 부른다(path: 점 경로, 배열 항목은 `[]`) */
function walkSchema(
  schema: unknown,
  path: string,
  visit: (node: SchemaNode, path: string) => void,
): void {
  const node = schema as SchemaNode;
  visit(node, path);
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    walkSchema(child, path === '' ? key : `${path}.${key}`, visit);
  }
  if (node.items) walkSchema(node.items, `${path}[]`, visit);
}

/** 설정 스키마의 모든 키 경로 */
function settingsSchemaKeys(schema: unknown): string[] {
  const keys: string[] = [];
  walkSchema(schema, '', (_node, path) => {
    if (path !== '' && !path.endsWith('[]')) keys.push(path);
  });
  return keys;
}

/**
 * F-BS-04·US-36 AC4: 안전장치 5개(G4 최종 승인, 아동화 차단, 실존 인물 차단, 중복 등록 방지, 원본 업로드 거부)를
 * 끄는 환경변수·설정 키·요청 파라미터가 없다. 설정 JSON Schema 키(P1-03)도 같은 검사기로 본다.
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

  it('설정 JSON Schema(P1-03)의 키에 안전장치를 끄는 키가 없다', () => {
    const keys = settingsSchemaKeys(SETTINGS_JSON_SCHEMA);
    // 키를 제대로 모았는지(섹션·안쪽 키가 다 있다)
    expect(keys).toEqual(
      expect.arrayContaining([
        'costs',
        'costs.cardSurchargePct',
        'safety.childShoeMaxSizeMm',
        'safety.personBlockWords',
        'notice.blocks[].when',
        'ai.models.CLAUDE.text',
      ]),
    );
    const names = keys.flatMap((k) => k.split(/\.|\[\]\.?/).filter(Boolean));
    expect(findSafetyGuardSwitches(names)).toEqual([]);
    expect(findSafetyGuardSwitches(keys)).toEqual([]);
  });

  it('설정 JSON Schema는 모든 객체가 모르는 키를 막는다(additionalProperties: false)', () => {
    const open: string[] = [];
    walkSchema(SETTINGS_JSON_SCHEMA, '', (node, path) => {
      if (node.type === 'object' && node.additionalProperties !== false)
        open.push(path || '(뿌리)');
    });
    expect(open).toEqual([]);
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

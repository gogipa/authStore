import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_FIXTURE_ROOT } from '../../../../../test/support/fake-ai-cli.js';
import { AI_SMOKE_SCHEMA } from '../ai-engine.constants.js';
import { AiSchemaRuleError } from '../ai-engine.errors.js';
import { assertAiSchemaRules, checkAiSchemaRules } from './ai-schema-rules.js';

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(AI_FIXTURE_ROOT, 'schemas', name), 'utf8')) as Record<
    string,
    unknown
  >;

describe('assertAiSchemaRules(P1-10 규칙 7, AI-02)', () => {
  it('규칙을 지킨 스키마(fixture·연결 테스트 스키마)는 통과한다', () => {
    expect(checkAiSchemaRules(fixture('valid.schema.json'))).toEqual([]);
    expect(() => assertAiSchemaRules(AI_SMOKE_SCHEMA)).not.toThrow();
  });

  it.each([
    ['additional-properties.schema.json', /additionalProperties는 false/],
    ['missing-required.schema.json', /note가 required에 없다/],
    ['format.schema.json', /format 키워드/],
  ])('%s는 거부한다', (name, message) => {
    expect(() => assertAiSchemaRules(fixture(name))).toThrow(AiSchemaRuleError);
    expect(checkAiSchemaRules(fixture(name)).join('\n')).toMatch(message);
  });

  it('안쪽 object·배열 items도 같은 규칙을 본다', () => {
    const nested = {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: { value: { type: ['string', 'null'] }, evidence: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
        },
      },
      required: ['fields'],
      additionalProperties: false,
    };
    expect(checkAiSchemaRules(nested)).toEqual([
      expect.stringMatching(/properties\/fields\/items: evidence가 required에 없다/),
    ]);
  });

  it('맨 위가 object가 아니거나 공통 부분집합 밖 키워드($ref·oneOf·튜플 items)는 거부한다', () => {
    expect(checkAiSchemaRules({ type: 'string' })).toEqual(
      expect.arrayContaining([expect.stringMatching(/맨 위는 type: object/)]),
    );
    const odd = {
      type: 'object',
      properties: {
        a: { $ref: '#/definitions/x' },
        b: { oneOf: [{ type: 'string' }] },
        c: { type: 'array', items: [{ type: 'string' }] },
      },
      required: ['a', 'b', 'c'],
      additionalProperties: false,
    };
    const v = checkAiSchemaRules(odd).join('\n');
    expect(v).toMatch(/\$ref/);
    expect(v).toMatch(/oneOf/);
    expect(v).toMatch(/튜플 items/);
  });
});

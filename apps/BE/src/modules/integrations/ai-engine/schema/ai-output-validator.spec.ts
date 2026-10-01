import { AI_RUN_ERROR_CODES, AiOutputInvalidError } from '../ai-engine.errors.js';
import { stripImagesSeen, validateAiOutput, withImagesSeen } from './ai-output-validator.js';

const SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, note: { type: ['string', 'null'] } },
  required: ['title', 'note'],
  additionalProperties: false,
};

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof AiOutputInvalidError ? error.errorCode : 'OTHER';
  }
}

describe('validateAiOutput(P1-10 규칙 8·9, F-BS-32)', () => {
  it('스키마에 맞으면 그대로 돌려준다', () => {
    expect(validateAiOutput(SCHEMA, { title: 'a', note: null })).toEqual({
      title: 'a',
      note: null,
    });
  });

  it.each([
    ['null', null],
    ['빈 객체', {}],
    ['빈 글', ''],
    ['배열', [1]],
    ['추가 필드', { title: 'a', note: null, price: 1 }],
    ['필수 필드 없음', { title: 'a' }],
    ['타입 다름', { title: 1, note: null }],
  ])('%s → AI_OUTPUT_INVALID', (_name, value) => {
    expect(codeOf(() => validateAiOutput(SCHEMA, value))).toBe(AI_RUN_ERROR_CODES.OUTPUT_INVALID);
  });

  describe('결과 모양 깨짐(M0 S7 §4.5: claude 카피 4/10)', () => {
    const COPY_LIKE = {
      type: 'object',
      properties: {
        headline: { type: 'string' },
        selling_points: { type: 'array', items: { type: 'string' } },
        body: { type: 'string' },
      },
      required: ['headline', 'selling_points', 'body'],
      additionalProperties: false,
    };
    const ok = { headline: '헤드라인', selling_points: ['하나', '둘'], body: '본문입니다.' };

    it('본문 칸에 결과 JSON 전체(스키마 키 포함)가 들어가면 AI_OUTPUT_INVALID — 잘려 파싱되지 않아도', () => {
      const whole = JSON.stringify(ok);
      for (const body of [whole, ` ${whole}`, whole.slice(0, 30)]) {
        expect(() => validateAiOutput(COPY_LIKE, { ...ok, body })).toThrow(
          '모양 깨짐: /body에 결과 JSON이 들어감',
        );
      }
    });

    it("값이 'placeholder'(배열 칸 포함)면 AI_OUTPUT_INVALID", () => {
      expect(() => validateAiOutput(COPY_LIKE, { ...ok, headline: 'placeholder' })).toThrow(
        '모양 깨짐: /headline가 자리 표시 글',
      );
      expect(() =>
        validateAiOutput(COPY_LIKE, { ...ok, selling_points: ['하나', ' <PLACEHOLDER> '] }),
      ).toThrow('모양 깨짐: /selling_points/1가 자리 표시 글');
    });

    it('스키마 키가 없는 중괄호·placeholder라는 낱말이 섞인 글은 통과한다', () => {
      for (const body of [
        '{신상} 러닝화입니다.',
        '{"color": "red"}',
        'placeholder 문구를 쓰지 않았습니다.',
      ]) {
        expect(validateAiOutput(COPY_LIKE, { ...ok, body })).toEqual({ ...ok, body });
      }
    });
  });

  it('오류 문구에 값·출력 본문을 넣지 않는다(필드 경로만)', () => {
    try {
      validateAiOutput(SCHEMA, { title: '비밀스러운 본문', note: null, extra: '본문2' });
      throw new Error('통과하면 안 된다');
    } catch (error) {
      expect((error as Error).message).not.toMatch(/비밀스러운|본문2/);
    }
  });

  it('비전: images_seen이 없거나 넘긴 이미지와 다르면 AI_IMAGES_NOT_SEEN, 같으면 통과(경로가 붙어도 파일 이름으로 비교)', () => {
    const schema = withImagesSeen(SCHEMA);
    const expected = ['image-1.jpg', 'image-2.png'];
    const base = { title: 'a', note: null };
    expect(codeOf(() => validateAiOutput(schema, base, { expectedImages: expected }))).toBe(
      AI_RUN_ERROR_CODES.IMAGES_NOT_SEEN,
    );
    expect(
      codeOf(() =>
        validateAiOutput(
          schema,
          { ...base, images_seen: ['image-1.jpg'] },
          { expectedImages: expected },
        ),
      ),
    ).toBe(AI_RUN_ERROR_CODES.IMAGES_NOT_SEEN);
    expect(
      codeOf(() =>
        validateAiOutput(
          schema,
          { ...base, images_seen: ['image-1.jpg', 'image-2.png', 'image-3.jpg'] },
          { expectedImages: expected },
        ),
      ),
    ).toBe(AI_RUN_ERROR_CODES.IMAGES_NOT_SEEN);
    const ok = validateAiOutput(
      schema,
      { ...base, images_seen: ['/tmp/x/image-2.png', 'image-1.jpg'] },
      { expectedImages: expected },
    );
    expect(stripImagesSeen(ok)).toEqual({
      output: base,
      imagesSeen: ['/tmp/x/image-2.png', 'image-1.jpg'],
    });
  });

  it('withImagesSeen은 required에 images_seen을 더하고 원래 스키마를 바꾸지 않는다', () => {
    const vision = withImagesSeen(SCHEMA);
    expect(vision.required).toEqual(['title', 'note', 'images_seen']);
    expect(SCHEMA.required).toEqual(['title', 'note']);
    expect(Object.keys(vision.properties as object)).toContain('images_seen');
  });
});

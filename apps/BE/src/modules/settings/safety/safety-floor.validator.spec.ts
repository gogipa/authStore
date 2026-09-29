import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BE_ROOT } from '../../../common/config/paths.js';
import { DEFAULT_SETTINGS } from '../defaults/default-settings.js';
import type { AppSettings } from '../schema/settings.types.js';
import { checkSettingsText } from '../settings-file.loader.js';
import {
  BUILTIN_CHILD_KEYWORDS,
  BUILTIN_NG_KEYWORD_CHILD_WORDS,
  BUILTIN_PERSON_BLOCK_WORDS,
  CHILD_SHOE_MAX_MM_FLOOR,
  JUDGEMENT_VALIDITY_HOURS_CEIL,
  REQUIRED_NOTICE_BLOCKS,
} from './builtin-safety-lists.js';
import {
  describeSafetyItems,
  noticeBlockSha256,
  type SafetyItem,
  validateSafetyFloor,
} from './safety-floor.validator.js';

const FIXTURES = join(BE_ROOT, 'test', 'fixtures', 'settings');

function withChange(change: (s: AppSettings) => void): AppSettings {
  const copy = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  change(copy);
  return copy;
}

const items = (s: AppSettings): SafetyItem[] => validateSafetyFloor(s).map((v) => v.item);

describe('안전 기준 하한(F-BS-05, 규칙 7)', () => {
  it('상수: 아동화 기준 하한 235mm, 판정 유효 시간 상한 6시간', () => {
    expect(CHILD_SHOE_MAX_MM_FLOOR).toBe(235);
    expect(JUDGEMENT_VALIDITY_HOURS_CEIL).toBe(6);
  });

  it('내장 아동 단어: KW-01 여섯 개, NGKeyword 세 개(문서의 최소 목록)', () => {
    expect(BUILTIN_CHILD_KEYWORDS).toEqual([
      '키즈',
      '주니어',
      '아동',
      'キッズ',
      'ジュニア',
      'ベビー',
    ]);
    expect(BUILTIN_NG_KEYWORD_CHILD_WORDS).toEqual(['キッズ', 'ジュニア', 'ベビー']);
    expect(BUILTIN_PERSON_BLOCK_WORDS.length).toBeGreaterThan(0);
  });

  it('기본 템플릿은 위반이 없고, 내장 목록·필수 블록 해시가 템플릿과 맞다', () => {
    expect(validateSafetyFloor(DEFAULT_SETTINGS as AppSettings)).toEqual([]);
    expect(DEFAULT_SETTINGS.safety.personBlockWords).toEqual(BUILTIN_PERSON_BLOCK_WORDS);
    for (const required of REQUIRED_NOTICE_BLOCKS) {
      const block = DEFAULT_SETTINGS.notice.blocks.find((b) => b.id === required.id);
      expect(block && noticeBlockSha256(block.text)).toBe(required.sha256);
      expect(block?.when).toBe(required.when);
    }
  });

  describe('거부', () => {
    it('キッズ 빼기(아동 키워드·NGKeyword 둘 다)', () => {
      const s = withChange((c) => {
        c.safety.childKeywords = c.safety.childKeywords.filter((w) => w !== 'キッズ');
        c.sourcing.ngKeywords = c.sourcing.ngKeywords.filter((w) => w !== 'キッズ');
      });
      const violations = validateSafetyFloor(s);
      expect(violations).toEqual([
        {
          item: 'CHILD_KEYWORD_REMOVED',
          field: '/safety/childKeywords',
          message: "내장 아동 키워드 'キッズ'는 뺄 수 없습니다. 더하기만 됩니다.",
        },
        {
          item: 'NG_KEYWORD_CHILD_WORD_REMOVED',
          field: '/sourcing/ngKeywords',
          message: "제외어(NGKeyword)의 내장 아동 단어 'キッズ'는 뺄 수 없습니다. 더하기만 됩니다.",
        },
      ]);
    });

    it('NGKeyword에서만 ベビー 빼기', () => {
      expect(
        items(
          withChange(
            (c) => (c.sourcing.ngKeywords = c.sourcing.ngKeywords.filter((w) => w !== 'ベビー')),
          ),
        ),
      ).toEqual(['NG_KEYWORD_CHILD_WORD_REMOVED']);
    });

    it('실존 인물 차단어 1개 빼기', () => {
      expect(
        items(withChange((c) => (c.safety.personBlockWords = c.safety.personBlockWords.slice(1)))),
      ).toEqual(['PERSON_BLOCK_WORD_REMOVED']);
    });

    it('필수 블록 한 글자 수정', () => {
      const s = withChange((c) => {
        const block = c.notice.blocks.find((b) => b.id === 'CUSTOMS_DUTY')!;
        block.text = block.text.replace('판매자', '구매자');
      });
      const violations = validateSafetyFloor(s);
      const index = s.notice.blocks.findIndex((b) => b.id === 'CUSTOMS_DUTY');
      expect(violations).toEqual([
        {
          item: 'NOTICE_REQUIRED_BLOCK_EDITED',
          field: `/notice/blocks/${index}/text`,
          message: "구매대행 고지 필수 블록 'CUSTOMS_DUTY'의 문장은 고칠 수 없습니다.",
        },
      ]);
    });

    it('필수 블록 빼기·넣는 조건 바꾸기', () => {
      expect(
        items(
          withChange((c) => (c.notice.blocks = c.notice.blocks.filter((b) => b.id !== 'ORIGIN'))),
        ),
      ).toEqual(['NOTICE_REQUIRED_BLOCK_REMOVED']);
      expect(
        items(
          withChange((c) => {
            c.notice.blocks.find((b) => b.id === 'AI_IMAGE')!.when = 'MODE_A_PRICE_BREAKDOWN';
          }),
        ),
      ).toEqual(['NOTICE_REQUIRED_BLOCK_EDITED']);
    });

    it('같은 ID로 고친 필수 블록을 하나 더 넣어도 거부한다', () => {
      expect(
        items(
          withChange((c) =>
            c.notice.blocks.push({ id: 'WITHDRAWAL', when: null, text: '반품 불가' }),
          ),
        ),
      ).toEqual(['NOTICE_REQUIRED_BLOCK_EDITED']);
    });

    it('아동화 기준 230mm', () => {
      expect(items(withChange((c) => (c.safety.childShoeMaxSizeMm = 230)))).toEqual([
        'CHILD_SHOE_SIZE_LOWERED',
      ]);
    });

    it('판정 유효 시간 7시간(6.5도)', () => {
      expect(items(withChange((c) => (c.safety.judgementValidityHours = 7)))).toEqual([
        'JUDGEMENT_VALIDITY_EXTENDED',
      ]);
      expect(items(withChange((c) => (c.safety.judgementValidityHours = 6.5)))).toEqual([
        'JUDGEMENT_VALIDITY_EXTENDED',
      ]);
    });
  });

  describe('통과', () => {
    it.each<[string, (c: AppSettings) => void]>([
      ['子供 더하기', (c) => c.safety.childKeywords.push('子供')],
      ['NGKeyword에 キッズシューズ 더하기', (c) => c.sourcing.ngKeywords.push('キッズシューズ')],
      ['실존 인물 차단어 더하기', (c) => c.safety.personBlockWords.push('새 그룹')],
      [
        '아동 아닌 NGKeyword(中古) 빼기',
        (c) => (c.sourcing.ngKeywords = c.sourcing.ngKeywords.filter((w) => w !== '中古')),
      ],
      ['아동화 기준 235mm', (c) => (c.safety.childShoeMaxSizeMm = 235)],
      ['아동화 기준 240mm', (c) => (c.safety.childShoeMaxSizeMm = 240)],
      ['판정 유효 시간 6시간', (c) => (c.safety.judgementValidityHours = 6)],
      ['판정 유효 시간 5시간', (c) => (c.safety.judgementValidityHours = 5)],
      [
        '필수 아닌 블록(HEADER) 고치기·블록 더하기',
        (c) => {
          c.notice.blocks[0]!.text = '[해외구매대행 안내]';
          c.notice.blocks.push({ id: 'OWNER_NOTE', when: null, text: '· 문의는 톡톡으로 주세요.' });
        },
      ],
      ['목록 순서 바꾸기', (c) => c.safety.childKeywords.reverse()],
    ])('%s', (_name, change) => {
      expect(validateSafetyFloor(withChange(change))).toEqual([]);
    });

    it('NFD로 저장된 단어·앞뒤 공백도 같은 단어로 본다', () => {
      const s = withChange((c) => {
        c.safety.childKeywords = c.safety.childKeywords.map((w) => ` ${w.normalize('NFD')} `);
      });
      expect(validateSafetyFloor(s)).toEqual([]);
    });
  });

  it('fixture 네 개는 SAFETY로 거부된다(스키마는 통과)', () => {
    const expected: Record<string, SafetyItem[]> = {
      'relax-child-word.json': ['CHILD_KEYWORD_REMOVED', 'NG_KEYWORD_CHILD_WORD_REMOVED'],
      'relax-size-230.json': ['CHILD_SHOE_SIZE_LOWERED'],
      'relax-validity-7h.json': ['JUDGEMENT_VALIDITY_EXTENDED'],
      'notice-block-edited.json': ['NOTICE_REQUIRED_BLOCK_EDITED'],
    };
    for (const [file, want] of Object.entries(expected)) {
      const result = checkSettingsText(readFileSync(join(FIXTURES, file), 'utf8'));
      expect(result.ok).toBe(false);
      if (result.ok || result.kind !== 'SAFETY')
        throw new Error(`${file}: ${JSON.stringify(result)}`);
      expect(result.violations.map((v) => v.item)).toEqual(want);
      expect(result.errors).toEqual(
        result.violations.map(({ field, message }) => ({ field, message })),
      );
    }
  });

  it('describeSafetyItems는 종류를 겹치지 않게 잇는다', () => {
    expect(
      describeSafetyItems([
        { item: 'CHILD_KEYWORD_REMOVED', field: 'a', message: '' },
        { item: 'CHILD_KEYWORD_REMOVED', field: 'b', message: '' },
        { item: 'JUDGEMENT_VALIDITY_EXTENDED', field: 'c', message: '' },
      ]),
    ).toBe('아동 키워드 빼기, 판정 유효 시간 늘리기');
  });
});

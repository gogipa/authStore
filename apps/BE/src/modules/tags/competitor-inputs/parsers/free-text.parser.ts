import { tagKeyOf } from '../../pipeline/normalize.js';
import {
  CompetitorParseError,
  isDroppedTag,
  MAX_PARSE_ERRORS,
  type ParsedCompetitorInput,
  type ParsedCompetitorTag,
  type ParseFieldError,
  TAG_TEXT_MAX,
  tagRow,
} from './parsed-input.js';

/**
 * 자유 텍스트 경쟁 태그(F-TG-04, PRD §8.6 2 ③). 오너가 아는 태그를 글로 붙여 넣는다. 줄바꿈·쉼표·`#`·탭·세미콜론·`|`·
 * 전각 쉼표·`、`로 나눈다(공백은 태그 안 글자로 둔다 — '젤 카야노'). 같은 입력 안에서 정규화 키가 같은 태그는 한 번만 남긴다
 * (Proposed). 순위·상품 ID·빈도는 없다(입력 순서로 고른다). 100자를 넘는 조각은 IMPORT_PARSE_FAILED(`text[줄]`), 0개면
 * IMPORT_EMPTY. 개인 값 모양(이메일·전화)은 버린다.
 */
const SPLIT = /[,#\t;|，、]+/;

export function parseFreeText(text: string): ParsedCompetitorInput {
  const tags: ParsedCompetitorTag[] = [];
  const errors: ParseFieldError[] = [];
  const seen = new Set<string>();
  text.split(/\r\n|\r|\n/).forEach((line, index) => {
    for (const piece of line.split(SPLIT)) {
      const tag = piece.trim();
      if (isDroppedTag(tag)) continue;
      if (tag.length > TAG_TEXT_MAX) {
        if (errors.length < MAX_PARSE_ERRORS) {
          errors.push({
            field: `text[${index + 1}]`,
            message: `태그는 ${TAG_TEXT_MAX}자까지입니다.`,
          });
        }
        continue;
      }
      const key = tagKeyOf(tag);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      tags.push(tagRow(tag, null, null, null));
    }
  });
  if (errors.length > 0) throw new CompetitorParseError('IMPORT_PARSE_FAILED', errors);
  if (tags.length === 0) throw new CompetitorParseError('IMPORT_EMPTY');
  return { hasFrequency: false, tags };
}

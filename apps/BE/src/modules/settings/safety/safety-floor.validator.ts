import { createHash } from 'node:crypto';
import type { AppSettings } from '../schema/settings.types.js';
import {
  BUILTIN_CHILD_CATEGORY_WORDS,
  BUILTIN_CHILD_KEYWORDS,
  BUILTIN_EXCLUDED_CATEGORY_WORDS,
  BUILTIN_EXTRA_CHARGE_WORDS,
  BUILTIN_MIN_BLOCK_WORDS,
  BUILTIN_NG_KEYWORD_CHILD_WORDS,
  BUILTIN_ORIGIN_CONFUSION_WORDS,
  BUILTIN_PERSON_BLOCK_WORDS,
  BUILTIN_SENIOR_SHOE_WORDS,
  BUILTIN_WHEELED_SHOE_WORDS,
  CHILD_SHOE_MAX_MM_FLOOR,
  JUDGEMENT_VALIDITY_HOURS_CEIL,
  REQUIRED_NOTICE_BLOCKS,
} from './builtin-safety-lists.js';

/**
 * 어긴 안전 기준의 종류(Proposed 코드, 05-3 SAFETY_SETTING_RELAXATION_REJECTED의 details.violations[].item).
 */
export const SAFETY_ITEMS = {
  CHILD_KEYWORD_REMOVED: '아동 키워드 빼기',
  WHEELED_SHOE_WORD_REMOVED: '바퀴 신발 단어 빼기',
  SENIOR_SHOE_WORD_REMOVED: '고령자 신발 단어 빼기',
  NG_KEYWORD_CHILD_WORD_REMOVED: '제외어(NGKeyword) 아동 단어 빼기',
  PERSON_BLOCK_WORD_REMOVED: '실존 인물 차단어 빼기',
  CHILD_CATEGORY_WORD_REMOVED: '아동 카테고리 말 빼기',
  EXCLUDED_CATEGORY_WORD_REMOVED: '판매 제외 품목 카테고리 말 빼기',
  MIN_BLOCK_WORD_REMOVED: '최소 차단어 빼기',
  ORIGIN_CONFUSION_WORD_REMOVED: '판매국·제조국 혼동 표현 빼기',
  EXTRA_CHARGE_WORD_REMOVED: '추가 청구 표현 빼기',
  NOTICE_REQUIRED_BLOCK_REMOVED: '고지 필수 블록 빼기',
  NOTICE_REQUIRED_BLOCK_EDITED: '고지 필수 블록 고치기',
  CHILD_SHOE_SIZE_LOWERED: '아동화 의심 기준 낮추기',
  JUDGEMENT_VALIDITY_EXTENDED: '판정 유효 시간 늘리기',
} as const;
export type SafetyItem = keyof typeof SAFETY_ITEMS;

/** 안전 기준 위반 한 건. field는 JSON 경로(JSON Pointer) */
export interface SafetyViolation {
  item: SafetyItem;
  field: string;
  message: string;
}

/** 비교용 정규화: NFC + 앞뒤 공백 제거(편집기가 NFD로 저장해도 같은 단어로 본다) */
export function normalizeListWord(word: string): string {
  return word.normalize('NFC').trim();
}

/** 고지 블록 문장의 해시(NFC + 앞뒤 공백 제거 → UTF-8 SHA-256) */
export function noticeBlockSha256(text: string): string {
  return createHash('sha256').update(normalizeListWord(text), 'utf8').digest('hex');
}

function missingWords(builtin: readonly string[], actual: readonly string[]): string[] {
  const have = new Set(actual.map(normalizeListWord));
  return builtin.filter((w) => !have.has(normalizeListWord(w)));
}

/**
 * 안전 기준 하한 검사(F-BS-05, P1-03 규칙 7). 스키마 검사를 통과한 설정만 받는다.
 * 시작할 때와 다시 읽을 때 같은 함수를 쓴다. 어긴 것이 하나라도 있으면 그 파일은 스냅샷이 되지 않는다.
 */
export function validateSafetyFloor(settings: AppSettings): SafetyViolation[] {
  const out: SafetyViolation[] = [];

  for (const word of missingWords(BUILTIN_CHILD_KEYWORDS, settings.safety.childKeywords)) {
    out.push({
      item: 'CHILD_KEYWORD_REMOVED',
      field: '/safety/childKeywords',
      message: `내장 아동 키워드 '${word}'는 뺄 수 없습니다. 더하기만 됩니다.`,
    });
  }
  for (const word of missingWords(BUILTIN_WHEELED_SHOE_WORDS, settings.safety.wheeledShoeWords)) {
    out.push({
      item: 'WHEELED_SHOE_WORD_REMOVED',
      field: '/safety/wheeledShoeWords',
      message: `내장 바퀴 신발 단어 '${word}'는 뺄 수 없습니다. 더하기만 됩니다.`,
    });
  }
  for (const word of missingWords(BUILTIN_SENIOR_SHOE_WORDS, settings.safety.seniorShoeWords)) {
    out.push({
      item: 'SENIOR_SHOE_WORD_REMOVED',
      field: '/safety/seniorShoeWords',
      message: `내장 고령자 신발 단어 '${word}'는 뺄 수 없습니다. 더하기만 됩니다.`,
    });
  }
  for (const word of missingWords(BUILTIN_NG_KEYWORD_CHILD_WORDS, settings.sourcing.ngKeywords)) {
    out.push({
      item: 'NG_KEYWORD_CHILD_WORD_REMOVED',
      field: '/sourcing/ngKeywords',
      message: `제외어(NGKeyword)의 내장 아동 단어 '${word}'는 뺄 수 없습니다. 더하기만 됩니다.`,
    });
  }
  for (const word of missingWords(BUILTIN_PERSON_BLOCK_WORDS, settings.safety.personBlockWords)) {
    out.push({
      item: 'PERSON_BLOCK_WORD_REMOVED',
      field: '/safety/personBlockWords',
      message: `내장 실존 인물 차단어 '${word}'는 뺄 수 없습니다. 더하기만 됩니다.`,
    });
  }
  for (const word of missingWords(
    BUILTIN_CHILD_CATEGORY_WORDS,
    settings.safety.childCategoryWords,
  )) {
    out.push({
      item: 'CHILD_CATEGORY_WORD_REMOVED',
      field: '/safety/childCategoryWords',
      message: `내장 아동 카테고리 말 '${word}'는 뺄 수 없습니다. 더하기만 됩니다.`,
    });
  }
  for (const word of missingWords(
    BUILTIN_EXCLUDED_CATEGORY_WORDS,
    settings.safety.excludedCategoryWords,
  )) {
    out.push({
      item: 'EXCLUDED_CATEGORY_WORD_REMOVED',
      field: '/safety/excludedCategoryWords',
      message: `내장 판매 제외 품목 카테고리 말 '${word}'는 뺄 수 없습니다. 더하기만 됩니다.`,
    });
  }

  for (const word of missingWords(BUILTIN_MIN_BLOCK_WORDS, settings.safety.minBlockWords)) {
    out.push({
      item: 'MIN_BLOCK_WORD_REMOVED',
      field: '/safety/minBlockWords',
      message: `내장 최소 차단어 '${word}'는 뺄 수 없습니다. 더하기만 됩니다.`,
    });
  }
  for (const word of missingWords(
    BUILTIN_ORIGIN_CONFUSION_WORDS,
    settings.safety.originConfusionWords,
  )) {
    out.push({
      item: 'ORIGIN_CONFUSION_WORD_REMOVED',
      field: '/safety/originConfusionWords',
      message: `내장 판매국·제조국 혼동 표현 '${word}'는 뺄 수 없습니다. 더하기만 됩니다.`,
    });
  }
  for (const word of missingWords(BUILTIN_EXTRA_CHARGE_WORDS, settings.safety.extraChargeWords)) {
    out.push({
      item: 'EXTRA_CHARGE_WORD_REMOVED',
      field: '/safety/extraChargeWords',
      message: `내장 추가 청구 표현 '${word}'는 뺄 수 없습니다. 더하기만 됩니다.`,
    });
  }

  const blocks = settings.notice.blocks;
  for (const required of REQUIRED_NOTICE_BLOCKS) {
    const found = blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.id === required.id);
    if (found.length === 0) {
      out.push({
        item: 'NOTICE_REQUIRED_BLOCK_REMOVED',
        field: '/notice/blocks',
        message: `구매대행 고지 필수 블록 '${required.id}'를 뺄 수 없습니다.`,
      });
      continue;
    }
    for (const { block, index } of found) {
      if (block.when !== required.when) {
        out.push({
          item: 'NOTICE_REQUIRED_BLOCK_EDITED',
          field: `/notice/blocks/${index}/when`,
          message: `구매대행 고지 필수 블록 '${required.id}'의 넣는 조건은 바꿀 수 없습니다.`,
        });
      }
      if (noticeBlockSha256(block.text) !== required.sha256) {
        out.push({
          item: 'NOTICE_REQUIRED_BLOCK_EDITED',
          field: `/notice/blocks/${index}/text`,
          message: `구매대행 고지 필수 블록 '${required.id}'의 문장은 고칠 수 없습니다.`,
        });
      }
    }
  }

  if (settings.safety.childShoeMaxSizeMm < CHILD_SHOE_MAX_MM_FLOOR) {
    out.push({
      item: 'CHILD_SHOE_SIZE_LOWERED',
      field: '/safety/childShoeMaxSizeMm',
      message: `아동화 의심 기준은 ${CHILD_SHOE_MAX_MM_FLOOR}mm보다 낮출 수 없습니다.`,
    });
  }
  if (settings.safety.judgementValidityHours > JUDGEMENT_VALIDITY_HOURS_CEIL) {
    out.push({
      item: 'JUDGEMENT_VALIDITY_EXTENDED',
      field: '/safety/judgementValidityHours',
      message: `판정 유효 시간은 ${JUDGEMENT_VALIDITY_HOURS_CEIL}시간보다 길게 할 수 없습니다.`,
    });
  }
  return out;
}

/** 오류 문구의 `{항목}`: 어긴 종류를 겹치지 않게 이어 쓴다 */
export function describeSafetyItems(violations: readonly SafetyViolation[]): string {
  return [...new Set(violations.map((v) => SAFETY_ITEMS[v.item]))].join(', ');
}

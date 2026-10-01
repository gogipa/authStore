import type { PreValidationCheckCode, PreValidationCheckFn } from '../pre-validation.types.js';
import { categoryCheck } from './category.check.js';
import { duplicateCheck } from './duplicate.check.js';
import { extraChargeWordingCheck } from './extra-charge-wording.check.js';
import { imagesCheck } from './images.check.js';
import { japanWordingCheck } from './japan-wording.check.js';
import { judgementFreshnessCheck } from './judgement-freshness.check.js';
import { minBlockWordsCheck } from './min-block-words.check.js';
import { negativeMarginCheck } from './negative-margin.check.js';
import { noticeBlockCheck } from './notice-block.check.js';
import { optionsCheck } from './options.check.js';
import { originCheck } from './origin.check.js';
import { representativeImageSourceCheck } from './representative-image-source.check.js';
import { requiredFieldsCheck } from './required-fields.check.js';
import { stepFreshnessCheck } from './step-freshness.check.js';
import { tagsCheck } from './tags.check.js';

/** 검사 15개(05-3 §5.3 순서) — 항목 하나 = 파일 하나 = 순수 함수 하나 */
export const PRE_VALIDATION_CHECKS: Readonly<Record<PreValidationCheckCode, PreValidationCheckFn>> =
  {
    REQUIRED_FIELDS: requiredFieldsCheck,
    IMAGES: imagesCheck,
    OPTIONS: optionsCheck,
    TAGS: tagsCheck,
    NOTICE_BLOCK: noticeBlockCheck,
    ORIGIN: originCheck,
    JAPAN_WORDING: japanWordingCheck,
    MIN_BLOCK_WORDS: minBlockWordsCheck,
    NEGATIVE_MARGIN: negativeMarginCheck,
    EXTRA_CHARGE_WORDING: extraChargeWordingCheck,
    JUDGEMENT_FRESHNESS: judgementFreshnessCheck,
    REPRESENTATIVE_IMAGE_SOURCE: representativeImageSourceCheck,
    STEP_FRESHNESS: stepFreshnessCheck,
    CATEGORY: categoryCheck,
    DUPLICATE: duplicateCheck,
  };

export {
  categoryCheck,
  duplicateCheck,
  extraChargeWordingCheck,
  imagesCheck,
  japanWordingCheck,
  judgementFreshnessCheck,
  minBlockWordsCheck,
  negativeMarginCheck,
  noticeBlockCheck,
  optionsCheck,
  originCheck,
  representativeImageSourceCheck,
  requiredFieldsCheck,
  stepFreshnessCheck,
  tagsCheck,
};

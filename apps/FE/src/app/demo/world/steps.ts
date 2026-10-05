import type { StepCode } from '@/shared/lib/steps';

export type { StepCode };

/** 흐름 순서 단계 10개 */
export const STEP_FLOW: readonly StepCode[] = [
  'SOURCING',
  'PRICING',
  'CATEGORY',
  'THUMBNAIL',
  'COPY',
  'NOTICE_RAW',
  'NOTICE_HTML',
  'TAGS',
  'UPLOAD',
  'REGISTER',
];

/** 승인 전에 끝나야 하는 필수 9단계(⑨ 제외) */
export const REQUIRED_STEPS: readonly StepCode[] = STEP_FLOW.filter((code) => code !== 'REGISTER');

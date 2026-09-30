import { describe, expect, it } from 'vitest';
import { railItem } from '@/test/fixtures/stepEngine';
import { inputKeyLabel, inputKeyLabels } from './inputLabels';
import {
  contentGroupStatus,
  groupLastRunAt,
  inputSourceText,
  lastRunAt,
  runButtonLabel,
  sourcingSourceText,
  STEP_TABLE_CODES,
  STEP_TABLE_ROWS,
} from './stepTable';

describe('단계 표 모델(P1-05)', () => {
  it('표에 나오는 단계는 10개(⑥ 하위 포함)이고 흐름 순서다. 게이트 줄은 ③ 뒤 G2, ⑦ 뒤 G3, ⑧ 뒤 G4', () => {
    expect(STEP_TABLE_CODES).toEqual([
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
    ]);
    const order = STEP_TABLE_ROWS.map((row) =>
      row.kind === 'gate' ? row.gate : row.kind === 'group' ? '⑥' : row.code,
    );
    expect(order).toEqual([
      'SOURCING',
      'PRICING',
      'G2',
      'CATEGORY',
      'THUMBNAIL',
      '⑥',
      'TAGS',
      'G3',
      'UPLOAD',
      'G4',
      'REGISTER',
    ]);
  });

  it('실행 버튼 글·② 입력 출처·직접 입력 표시', () => {
    expect(runButtonLabel('NOT_RUN')).toBe('실행');
    expect(runButtonLabel('FAILED')).toBe('다시 실행');
    expect(sourcingSourceText('KEYWORD')).toBe('키워드 검색어');
    expect(sourcingSourceText('RAKUTEN_URL')).toBe('라쿠텐 URL');
    const item = railItem({
      stepCode: 'PRICING',
      status: 'COMPLETED',
      inputs: [
        {
          inputKey: 'owner.coupon',
          sourceType: 'OWNER_INPUT',
          sourceStepRunId: null,
          isStartCondition: true,
          valueHash: 'a'.repeat(64),
        },
      ],
    });
    expect(inputSourceText('② 소싱 산출물', item)).toBe('② 소싱 산출물 · 직접 입력');
    expect(inputSourceText('② 소싱 산출물', railItem({ stepCode: 'PRICING' }))).toBe(
      '② 소싱 산출물',
    );
  });

  it('⑥ 묶음 상태·마지막 실행', () => {
    const copy = railItem(
      { stepCode: 'COPY', status: 'COMPLETED' },
      { endedAt: '2026-09-28T05:00:00.000Z' },
    );
    const raw = railItem(
      { stepCode: 'NOTICE_RAW', status: 'FAILED' },
      { endedAt: '2026-09-28T05:10:00.000Z' },
    );
    const html = railItem({ stepCode: 'NOTICE_HTML' });
    expect(contentGroupStatus([copy, raw, html])).toBe('FAILED');
    expect(contentGroupStatus([copy, undefined])).toBe('NOT_RUN');
    expect(groupLastRunAt([copy, raw, html])).toBe('2026-09-28T05:10:00.000Z');
    expect(groupLastRunAt([html])).toBeNull();
    expect(lastRunAt(html)).toBeNull();
  });

  it('입력 키 화면 이름(BE domain/input-keys와 같은 표)', () => {
    expect(inputKeyLabel('owner.referenceSelection')).toBe('레퍼런스 선택');
    expect(inputKeyLabel('candidate.gender')).toBe('성별');
    expect(inputKeyLabel('settings.safety.childShoeMaxSizeMm')).toBe(
      '설정 safety.childShoeMaxSizeMm',
    );
    expect(inputKeyLabel('mystery.key')).toBe('mystery.key');
    expect(inputKeyLabels(['owner.domesticPrice', 'pricing.saleSizes'])).toBe(
      '국내 기준가, ③ 판매 사이즈',
    );
  });
});

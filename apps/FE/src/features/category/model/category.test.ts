import { describe, expect, it } from 'vitest';
import { categoryOption } from '@/test/fixtures/category';
import {
  blockReasonText,
  categoryChecks,
  categoryPathGender,
  formatCategoryPath,
  KC_CONFIRM_REASON,
  NOT_WAITING_REASON,
  PICK_LEAF_REASON,
  selectDisabledReason,
} from './category';

describe('④ 카테고리 표시 규칙(P2-06)', () => {
  it('경로는 ` > `로 잇는다(보드 표기)', () => {
    expect(formatCategoryPath('패션잡화>남성신발>운동화>러닝화')).toBe(
      '패션잡화 > 남성신발 > 운동화 > 러닝화',
    );
    expect(formatCategoryPath('패션잡화 > 여성신발>운동화')).toBe('패션잡화 > 여성신발 > 운동화');
  });

  it('경로의 성별: 남성신발·여성신발만, 그 밖은 null', () => {
    expect(categoryPathGender('패션잡화>남성신발>운동화>러닝화')).toBe('MALE');
    expect(categoryPathGender('패션잡화 > 여성신발 > 운동화')).toBe('FEMALE');
    expect(categoryPathGender('패션잡화>여성가방>숄더백')).toBeNull();
  });

  it('확인 줄: 고른 리프가 없으면 null, 성별·아동·KC를 계산한다', () => {
    expect(categoryChecks('MALE', null)).toEqual({
      genderMatch: null,
      notChild: null,
      kcRequired: false,
    });
    expect(categoryChecks('MALE', categoryOption({ kcExemptionRequired: true }))).toEqual({
      genderMatch: true,
      notChild: true,
      kcRequired: true,
    });
    expect(
      categoryChecks('FEMALE', categoryOption({ blocked: true, blockReason: 'CHILD_CATEGORY' })),
    ).toEqual({ genderMatch: false, notChild: false, kcRequired: false });
  });

  it('고르기 단추 꺼진 이유 순서: 입력 대기 아님 → 밖의 이유 → 고른 리프 없음 → 막힘 → KC 확인', () => {
    const kc = categoryOption({ kcExemptionRequired: true });
    expect(selectDisabledReason({ waiting: false, option: kc, kcConfirmed: true })).toBe(
      NOT_WAITING_REASON,
    );
    expect(
      selectDisabledReason({
        waiting: true,
        option: kc,
        kcConfirmed: true,
        blockedReason: '잠긴 후보',
      }),
    ).toBe('잠긴 후보');
    expect(selectDisabledReason({ waiting: true, option: null, kcConfirmed: false })).toBe(
      PICK_LEAF_REASON,
    );
    expect(
      selectDisabledReason({
        waiting: true,
        option: categoryOption({ blocked: true, blockReason: 'REMOVED' }),
        kcConfirmed: false,
      }),
    ).toBe(blockReasonText('REMOVED'));
    expect(selectDisabledReason({ waiting: true, option: kc, kcConfirmed: false })).toBe(
      KC_CONFIRM_REASON,
    );
    expect(selectDisabledReason({ waiting: true, option: kc, kcConfirmed: true })).toBeNull();
  });
});

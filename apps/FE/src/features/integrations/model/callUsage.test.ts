import { describe, expect, it } from 'vitest';
import { rakutenPageUsage } from '@/test/fixtures/callUsage';
import { pageReadBlockedReason } from './callUsage';

describe('페이지를 읽는 버튼의 꺼진 이유(F-SO-16, P2-02)', () => {
  it('상한 전이면 null, 상한이면 05-3 DAILY_LIMIT_REACHED 문구, 쉼이면 끝나는 시각', () => {
    expect(pageReadBlockedReason(undefined)).toBeNull();
    expect(pageReadBlockedReason(rakutenPageUsage(38))).toBeNull();
    expect(pageReadBlockedReason(rakutenPageUsage(110))).toBe(
      '오늘 페이지 조회 한도(110건)를 다 썼습니다. 내일 0시(한국 시간)에 다시 됩니다.',
    );
    expect(
      pageReadBlockedReason({ ...rakutenPageUsage(40), blockedUntil: '2026-09-28T05:02:00.000Z' }),
    ).toBe('라쿠텐 상품 페이지가 요청을 막아 09-28 14:02까지 쉽니다.');
  });
});

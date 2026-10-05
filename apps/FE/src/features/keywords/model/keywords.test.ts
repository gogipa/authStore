import { describe, expect, it } from 'vitest';
import { collectionStatus } from '@/test/fixtures/keywords';
import {
  abortMessage,
  cidLabel,
  collectDisabledReason,
  collectionStatusLine,
  expectedCollectionPeriod,
  isStructureChangeReason,
  pagesPerCidFor,
  snapshotOrigin,
} from './keywords';

/** 수집 상태 fixture(2026-09-24 13:30 KST) 기준의 같은 날 */
const SAME_DAY = new Date('2026-09-24T07:00:00.000Z');

describe('키워드 화면 모델(P2-01)', () => {
  it('기간: 종료일 = 어제(KST), 시작일 = 1개월 전(월말은 그 달 마지막 날) — 서버 규칙과 같다', () => {
    expect(expectedCollectionPeriod(new Date('2026-09-24T00:30:00+09:00'))).toEqual({
      startDate: '2026-08-23',
      endDate: '2026-09-23',
    });
    expect(expectedCollectionPeriod(new Date('2026-04-01T09:00:00+09:00'))).toEqual({
      startDate: '2026-02-28',
      endDate: '2026-03-31',
    });
    expect(expectedCollectionPeriod(new Date('2026-01-10T12:00:00+09:00'))).toEqual({
      startDate: '2025-12-09',
      endDate: '2026-01-09',
    });
  });

  it('분야 이름·페이지 수', () => {
    expect(cidLabel('50000173')).toBe('여성신발');
    expect(cidLabel('50000174')).toBe('남성신발');
    expect(cidLabel(null)).toBe('분야 모름');
    expect(pagesPerCidFor(100)).toBe(5);
    expect(pagesPerCidFor(500)).toBe(25);
  });

  it("머리 줄: '마지막 수집 13:30 · 출처 데이터랩 · 2초 간격 · 이상 없음'(보드), 중단·수집 중·처음", () => {
    expect(collectionStatusLine(collectionStatus(), SAME_DAY)).toBe(
      '마지막 수집 13:30 · 출처 데이터랩 · 2초 간격 · 이상 없음',
    );
    expect(
      collectionStatusLine(
        collectionStatus({ lastStatus: 'ABORTED', lastAbortReason: 'HTTP_429' }),
        SAME_DAY,
      ),
    ).toBe('마지막 수집 13:30 · 출처 데이터랩 · 2초 간격 · 중단: 요청 과다(429)');
    // 오늘이 아니면 날짜를 붙인다(며칠 전 수집이 방금 것처럼 보이지 않게)
    expect(collectionStatusLine(collectionStatus(), new Date('2026-09-26T03:00:00.000Z'))).toBe(
      '마지막 수집 09-24 13:30 · 출처 데이터랩 · 2초 간격 · 이상 없음',
    );
    expect(collectionStatusLine(collectionStatus({ collecting: true }))).toBe(
      '수집 중 · 출처 데이터랩 · 2초 간격',
    );
    expect(collectionStatusLine(collectionStatus({ lastCollectedAt: null }))).toBe(
      '아직 수집하지 않았습니다 · 출처 데이터랩 · 2초 간격',
    );
  });

  it("'수집'이 꺼진 이유: 수집 중·24시간 쉼(끝나는 시각)", () => {
    expect(collectDisabledReason(collectionStatus())).toBeNull();
    expect(
      collectDisabledReason(collectionStatus({ disabledReasonCode: 'ALREADY_IN_PROGRESS' })),
    ).toBe('수집 중입니다. 끝나면 다시 누를 수 있습니다.');
    expect(
      collectDisabledReason(
        collectionStatus({
          disabledReasonCode: 'EXTERNAL_CALL_COOLDOWN',
          blockedUntil: '2026-09-25T00:30:00.000Z',
        }),
      ),
    ).toBe('데이터랩이 요청을 막아 09-25 09:30까지 쉽니다. 그동안은 순위 붙여넣기를 써 주세요.');
  });

  it("중단 문구: 구조 변경 의심 5종은 '데이터랩 구조 변경 의심', 403·418·429는 쉼 시각, 그 밖은 사유별", () => {
    for (const reason of [
      'NO_RANKS_KEY',
      'HTTP_404',
      'NOT_JSON',
      'RETURN_CODE',
      'COUNT_MISMATCH',
    ]) {
      expect(isStructureChangeReason(reason)).toBe(true);
      expect(abortMessage(reason)).toMatch(/^데이터랩 구조 변경 의심/);
    }
    expect(isStructureChangeReason('HTTP_429')).toBe(false);
    expect(abortMessage('HTTP_429', '2026-09-25T00:30:00.000Z')).toBe(
      '데이터랩이 요청을 막아 수집을 멈췄습니다(요청 과다(429)). 09-25 09:30까지 쉽니다. 그동안은 순위 붙여넣기를 써 주세요.',
    );
    expect(abortMessage('NETWORK_ERROR')).toMatch(/응답을 받지 못해/);
    expect(abortMessage('APP_RESTART')).toMatch(/앱이 다시 시작되어/);
    expect(abortMessage('INTERRUPTED')).toMatch(/도중에 멈췄습니다/);
  });

  it('표 출처 줄: 처음 연 표는 지난번에 받아 둔 순위, 이 화면에서 만든 묶음만 방금 받은 순위', () => {
    const base = {
      collectedAt: '2026-09-24T04:30:00.000Z',
      method: 'BUTTON',
      status: 'COMPLETED',
    } as const;
    expect(snapshotOrigin(base, false, SAME_DAY)).toEqual({
      label: '지난번에 받아 둔 순위',
      detail: '오늘 13:30에 데이터랩에서 받음 · 새 순위가 필요하면 위 [수집]을 누르세요',
      tone: 'outline',
    });
    expect(snapshotOrigin(base, false, new Date('2026-09-26T03:00:00.000Z'))).toMatchObject({
      label: '지난번에 받아 둔 순위',
      detail: '09-24 13:30에 데이터랩에서 받음 · 새 순위가 필요하면 위 [수집]을 누르세요',
    });
    expect(snapshotOrigin(base, true, SAME_DAY)).toEqual({
      label: '방금 새로 받은 순위',
      detail: '오늘 13:30에 데이터랩에서 받음',
      tone: 'accent',
    });
    expect(snapshotOrigin({ ...base, method: 'PASTE' }, true, SAME_DAY).label).toBe(
      '방금 붙여넣은 순위',
    );
    expect(snapshotOrigin({ ...base, method: 'PASTE' }, false, SAME_DAY).label).toBe(
      '지난번에 붙여넣은 순위',
    );
    expect(snapshotOrigin({ ...base, status: 'RUNNING' }, true, SAME_DAY).label).toBe(
      '지금 받는 중',
    );
    expect(snapshotOrigin({ ...base, status: 'ABORTED' }, false, SAME_DAY).label).toBe(
      '중간에 멈춘 수집',
    );
  });
});

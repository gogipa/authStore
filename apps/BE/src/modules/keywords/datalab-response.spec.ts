import {
  datalabRankFixture,
  datalabStatusCase,
} from '../../../test/support/datalab-fixture.adapter.js';
import type { DatalabRankPageResponse } from '../integrations/datalab/datalab-rank.port.js';
import { classifyDatalabResponse, describeDatalabResponse } from './datalab-response.js';

const ctx = { page: 1, pageSize: 20 };

function html(bodyText: string, httpStatus = 200): DatalabRankPageResponse {
  return { httpStatus, contentType: 'text/html;charset=UTF-8', bodyText };
}

function json(body: unknown): DatalabRankPageResponse {
  return html(JSON.stringify(body));
}

describe('데이터랩 응답 분류(F-KW-04, P2-01 규칙 6)', () => {
  it('text/html + JSON 본문 → OK(순위 20개, range, 마지막 페이지 아님)', () => {
    const verdict = classifyDatalabResponse(html(datalabRankFixture('50000173-p1.json')), ctx);
    expect(verdict.kind).toBe('OK');
    if (verdict.kind !== 'OK') return;
    expect(verdict.entries).toHaveLength(20);
    expect(verdict.entries[0]).toEqual({ rank: 1, keyword: '뉴발란스 530' });
    expect(verdict.range).toBe('2026.08.23. ~ 2026.09.23.');
    expect(verdict.lastPage).toBe(false);
  });

  it('{returnCode:0, ranks:[]} → END(정상 종료)', () => {
    expect(classifyDatalabResponse(html(datalabRankFixture('empty-ranks.json')), ctx)).toEqual({
      kind: 'END',
      range: '2026.08.23. ~ 2026.09.23.',
    });
  });

  it('ranks 키 없음 → NO_RANKS_KEY', () => {
    expect(classifyDatalabResponse(html(datalabRankFixture('no-ranks-key.json')), ctx)).toEqual({
      kind: 'ABORT',
      reason: 'NO_RANKS_KEY',
      httpStatus: null,
    });
    expect(classifyDatalabResponse(json([]), ctx)).toMatchObject({ reason: 'NO_RANKS_KEY' });
    expect(classifyDatalabResponse(json({ returnCode: 0, ranks: null }), ctx)).toMatchObject({
      reason: 'NO_RANKS_KEY',
    });
  });

  it('HTML 본문 → NOT_JSON', () => {
    expect(classifyDatalabResponse(html(datalabRankFixture('not-json.html')), ctx)).toEqual({
      kind: 'ABORT',
      reason: 'NOT_JSON',
      httpStatus: null,
    });
  });

  it('returnCode:1 → RETURN_CODE(없어도 RETURN_CODE — Proposed)', () => {
    expect(classifyDatalabResponse(html(datalabRankFixture('return-code-1.json')), ctx)).toEqual({
      kind: 'ABORT',
      reason: 'RETURN_CODE',
      httpStatus: null,
    });
    expect(classifyDatalabResponse(json({ ranks: [] }), ctx)).toMatchObject({
      reason: 'RETURN_CODE',
    });
    expect(classifyDatalabResponse(json({ returnCode: '0', ranks: [] }), ctx).kind).toBe('END');
  });

  it.each([404, 403, 418, 429] as const)('%s → HTTP_%s(상태 코드를 남긴다)', (status) => {
    expect(classifyDatalabResponse(datalabStatusCase(status), ctx)).toEqual({
      kind: 'ABORT',
      reason: `HTTP_${status}`,
      httpStatus: status,
    });
  });

  it('그 밖의 2xx 아닌 응답(500 등)은 NOT_JSON + 상태 코드(Proposed)', () => {
    expect(classifyDatalabResponse(html('{"returnCode":0,"ranks":[]}', 500), ctx)).toEqual({
      kind: 'ABORT',
      reason: 'NOT_JSON',
      httpStatus: 500,
    });
  });

  describe('건수 불일치(COUNT_MISMATCH, Proposed 기준)', () => {
    it('요청 크기(20)보다 많이 옴', () => {
      expect(
        classifyDatalabResponse(html(datalabRankFixture('count-mismatch.json')), ctx),
      ).toMatchObject({ kind: 'ABORT', reason: 'COUNT_MISMATCH' });
    });

    it('순위가 그 페이지 구간 밖·같은 순위 두 번·항목 모양이 다름', () => {
      const page2 = { page: 2, pageSize: 20 };
      const outOfPage = json({ returnCode: 0, ranks: [{ rank: 5, keyword: 'a' }] });
      expect(classifyDatalabResponse(outOfPage, page2)).toMatchObject({ reason: 'COUNT_MISMATCH' });
      const dup = json({
        returnCode: 0,
        ranks: [
          { rank: 1, keyword: 'a' },
          { rank: 1, keyword: 'b' },
        ],
      });
      expect(classifyDatalabResponse(dup, ctx)).toMatchObject({ reason: 'COUNT_MISMATCH' });
      const noKeyword = json({ returnCode: 0, ranks: [{ rank: 1 }] });
      expect(classifyDatalabResponse(noKeyword, ctx)).toMatchObject({ reason: 'COUNT_MISMATCH' });
      const longKeyword = json({ returnCode: 0, ranks: [{ rank: 1, keyword: 'x'.repeat(101) }] });
      expect(classifyDatalabResponse(longKeyword, ctx)).toMatchObject({
        reason: 'COUNT_MISMATCH',
      });
    });
  });

  it('요청 크기보다 적게 오면 그 cid의 마지막 페이지(lastPage)', () => {
    const verdict = classifyDatalabResponse(
      json({ returnCode: 0, ranks: [{ rank: '21', keyword: ' 뉴발란스 530 ' }] }),
      { page: 2, pageSize: 20 },
    );
    expect(verdict).toEqual({
      kind: 'OK',
      entries: [{ rank: 21, keyword: '뉴발란스 530' }],
      range: null,
      lastPage: true,
    });
  });

  it('call_log 요약: 순위 수를 item_count, 이상이면 사유를 error_code', () => {
    expect(describeDatalabResponse(html(datalabRankFixture('50000174-p2.json')), ctx)).toEqual({
      errorCode: 'COUNT_MISMATCH',
      itemCount: 20,
    });
    expect(
      describeDatalabResponse(html(datalabRankFixture('50000174-p2.json')), {
        page: 2,
        pageSize: 20,
      }),
    ).toEqual({ errorCode: null, itemCount: 20 });
    expect(describeDatalabResponse(html(datalabRankFixture('empty-ranks.json')), ctx)).toEqual({
      errorCode: null,
      itemCount: 0,
    });
    expect(describeDatalabResponse(datalabStatusCase(429), ctx)).toEqual({
      errorCode: 'HTTP_429',
      itemCount: null,
    });
  });
});

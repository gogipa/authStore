import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BE_ROOT } from '../../../common/config/paths.js';
import { createDailyLimitProvider, DEFAULT_DAILY_LIMITS } from './daily-limit.provider.js';
import {
  allAllowedHosts,
  CALL_LOG_TARGETS,
  COOLDOWN_HTTP_STATUSES,
  DATALAB_REFERER,
  EXTERNAL_TARGETS,
} from './external-targets.js';

/** V1 마이그레이션의 ck_call_log_target 목록 */
function checkListFromMigration(): string[] {
  const sql = readFileSync(
    join(BE_ROOT, 'prisma', 'migrations', '20260927000000_v1_init', 'migration.sql'),
    'utf8',
  );
  const m = /ck_call_log_target CHECK \(target IN \(([^)]*)\)\)/.exec(sql);
  if (!m) throw new Error('ck_call_log_target을 찾지 못했습니다');
  return m[1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}

describe('EXTERNAL_TARGETS', () => {
  it('13개 대상이 ERD CHECK(ck_call_log_target) 목록과 같다', () => {
    expect([...CALL_LOG_TARGETS]).toEqual(checkListFromMigration());
    expect(Object.keys(EXTERNAL_TARGETS).sort()).toEqual([...CALL_LOG_TARGETS].sort());
  });

  it('문서에 있는 호스트만 둔다', () => {
    expect(EXTERNAL_TARGETS.COMMERCE_API.hosts).toEqual(['api.commerce.naver.com']);
    expect(EXTERNAL_TARGETS.RAKUTEN_API.hosts).toEqual(['openapi.rakuten.co.jp']);
    expect(EXTERNAL_TARGETS.RAKUTEN_PAGE.hosts).toEqual(['item.rakuten.co.jp']);
    expect(EXTERNAL_TARGETS.DATALAB.hosts).toEqual(['datalab.naver.com']);
    // P2-04(Proposed): 환율 두 곳
    expect(EXTERNAL_TARGETS.FX_KOREAEXIM.hosts).toEqual(['oapi.koreaexim.go.kr']);
    expect(EXTERNAL_TARGETS.FX_CUSTOMS.hosts).toEqual(['apis.data.go.kr']);
    for (const t of [
      'NOTICE_MONITOR',
      'UPDATE_CHECK',
      'AI_CLAUDE_CLI',
      'AI_AGY_CLI',
      'AI_CODEX_CLI',
      'AI_GEMINI_API',
      'AI_OPENAI_API',
    ] as const) {
      expect(EXTERNAL_TARGETS[t].hosts).toEqual([]);
    }
  });

  it('구 도메인 app.rakuten.co.jp는 어느 대상에도 없다', () => {
    expect(allAllowedHosts().has('app.rakuten.co.jp')).toBe(false);
  });

  it('간격: DATALAB 2000·RAKUTEN_PAGE 3000·RAKUTEN_API 1500ms', () => {
    expect(EXTERNAL_TARGETS.DATALAB.minIntervalMs).toBe(2000);
    expect(EXTERNAL_TARGETS.RAKUTEN_PAGE.minIntervalMs).toBe(3000);
    expect(EXTERNAL_TARGETS.RAKUTEN_API.minIntervalMs).toBe(1500);
  });

  it('비공식 수집은 DATALAB·RAKUTEN_PAGE 둘뿐이다', () => {
    const unofficial = CALL_LOG_TARGETS.filter((t) => EXTERNAL_TARGETS[t].unofficial);
    expect(unofficial).toEqual(['RAKUTEN_PAGE', 'DATALAB']);
    expect(COOLDOWN_HTTP_STATUSES).toEqual([403, 418, 429]);
  });

  it('Referer는 DATALAB만, PRD §8.1 값으로 허용한다', () => {
    expect(DATALAB_REFERER).toBe('https://datalab.naver.com/shoppingInsight/sCategory.naver');
    const withReferer = CALL_LOG_TARGETS.filter((t) => EXTERNAL_TARGETS[t].allowedReferer);
    expect(withReferer).toEqual(['DATALAB']);
  });

  it('기본 하루 상한: RAKUTEN_PAGE 110, DATALAB 100(Proposed), 나머지 없음', () => {
    const limit = createDailyLimitProvider();
    expect(limit('RAKUTEN_PAGE')).toBe(DEFAULT_DAILY_LIMITS.RAKUTEN_PAGE_PER_DAY);
    expect(DEFAULT_DAILY_LIMITS.RAKUTEN_PAGE_PER_DAY).toBe(110);
    expect(limit('DATALAB')).toBe(100);
    expect(limit('RAKUTEN_API')).toBeNull();
    expect(limit('COMMERCE_API')).toBeNull();
  });
});

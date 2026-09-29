import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import {
  createSettingsDailyLimitProvider,
  DEFAULT_DAILY_LIMITS,
  type DailyLimitSettingsSource,
} from './daily-limit.provider.js';

describe('하루 상한(DAILY_LIMIT_PROVIDER, P1-03부터 설정 파일)', () => {
  const source = (
    value: { page: number; datalab: number } | null,
  ): DailyLimitSettingsSource & { value: typeof value } => ({
    value,
    currentOrNull() {
      return this.value
        ? {
            sourcing: { pageFetchDailyLimit: this.value.page },
            keywords: { datalabDailyLimit: this.value.datalab },
          }
        : null;
    },
  });

  it('RAKUTEN_PAGE는 sourcing.pageFetchDailyLimit, DATALAB은 keywords.datalabDailyLimit를 읽는다', () => {
    const provider = createSettingsDailyLimitProvider(source({ page: 90, datalab: 40 }));
    expect(provider('RAKUTEN_PAGE')).toBe(90);
    expect(provider('DATALAB')).toBe(40);
    expect(provider('RAKUTEN_API')).toBeNull();
    expect(provider('COMMERCE_API')).toBeNull();
  });

  it('요청마다 읽으므로 다시 읽기로 바뀐 값이 바로 적용된다', () => {
    const s = source({ page: 110, datalab: 100 });
    const provider = createSettingsDailyLimitProvider(s);
    expect(provider('RAKUTEN_PAGE')).toBe(110);
    s.value = { page: 50, datalab: 100 };
    expect(provider('RAKUTEN_PAGE')).toBe(50);
  });

  it('쓸 수 있는 설정이 없으면 기본값 표(110·100)', () => {
    const provider = createSettingsDailyLimitProvider(source(null));
    expect(provider('RAKUTEN_PAGE')).toBe(DEFAULT_DAILY_LIMITS.RAKUTEN_PAGE_PER_DAY);
    expect(provider('DATALAB')).toBe(DEFAULT_DAILY_LIMITS.DATALAB_PER_DAY);
    expect(DEFAULT_DAILY_LIMITS).toEqual({ RAKUTEN_PAGE_PER_DAY: 110, DATALAB_PER_DAY: 100 });
    // 기본값 표는 설정 기본 템플릿과 같은 값이다
    expect(DEFAULT_DAILY_LIMITS.RAKUTEN_PAGE_PER_DAY).toBe(
      DEFAULT_SETTINGS.sourcing.pageFetchDailyLimit,
    );
    expect(DEFAULT_DAILY_LIMITS.DATALAB_PER_DAY).toBe(DEFAULT_SETTINGS.keywords.datalabDailyLimit);
  });
});

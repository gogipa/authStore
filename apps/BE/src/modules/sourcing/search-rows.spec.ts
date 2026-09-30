import { rakutenSearchFixture } from '../../../test/support/rakuten-fixture.adapters.js';
import {
  parseSearchResponse,
  toSearchItem,
} from '../integrations/rakuten/rakuten-search.request.js';
import type { RakutenSearchItem } from '../integrations/rakuten/rakuten-search.port.js';
import { DEFAULT_SETTINGS } from '../settings/defaults/default-settings.js';
import { filterSearchRows, sourcingFailureOf, toRowDraft } from './sourcing.step-runner.js';
import { RakutenApiError } from '../integrations/rakuten/rakuten-api-error.mapper.js';
import { ApiException } from '../../common/errors/api.exception.js';

function fixtureItems(name: string): RakutenSearchItem[] {
  const parsed = parseSearchResponse(rakutenSearchFixture(name))!;
  return parsed.items.map(toSearchItem).filter((i): i is RakutenSearchItem => i !== null);
}

const fetchedAt = new Date('2026-09-28T05:00:00Z');

describe('검색 결과 아동화 거르기(F-SO-04, P2-02 규칙 5)', () => {
  it('상품명에 キッズ가 든 2건은 비교표 행으로 두지 않는다(30 → 28행)', () => {
    const items = fixtureItems('asics-1201a019-p1.json');
    expect(items).toHaveLength(30);
    expect(items.filter((i) => i.itemName.includes('キッズ'))).toHaveLength(2);
    const { rows, excluded } = filterSearchRows(items, DEFAULT_SETTINGS, fetchedAt);
    expect(rows).toHaveLength(28);
    expect(excluded).toBe(2);
    expect(rows.some((r) => r.itemName.includes('キッズ'))).toBe(false);
  });

  it('검색 순위는 원래 자리(뺀 행 자리는 비운다), 같은 itemCode는 한 번만', () => {
    const items = fixtureItems('asics-1201a019-p1.json');
    const { rows } = filterSearchRows([...items, items[0]!], DEFAULT_SETTINGS, fetchedAt);
    expect(rows).toHaveLength(28);
    expect(rows.map((r) => r.searchRank).slice(0, 4)).toEqual([1, 2, 4, 5]);
  });

  it('설정에 더한 아동 단어도 뺀다(P2-01 공통 규칙)', () => {
    const items = fixtureItems('asics-1201a019-p1.json');
    const settings = {
      ...DEFAULT_SETTINGS,
      safety: {
        ...DEFAULT_SETTINGS.safety,
        childKeywords: [...DEFAULT_SETTINGS.safety.childKeywords, 'GS'],
      },
    };
    expect(filterSearchRows(items, settings, fetchedAt).rows).toHaveLength(28);
    const withWomen = {
      ...DEFAULT_SETTINGS,
      safety: {
        ...DEFAULT_SETTINGS.safety,
        childKeywords: [...DEFAULT_SETTINGS.safety.childKeywords, 'ウィメンズ'],
      },
    };
    expect(filterSearchRows(items, withWomen, fetchedAt).rows).toHaveLength(27);
  });

  it('행 초안: API 값과 수집 시각(검색 캐시 fetched_at)', () => {
    const shopA = fixtureItems('asics-1201a019-p1.json').find(
      (i) => i.itemCode === 'shop-a:10000123',
    )!;
    expect(toRowDraft(shopA, 12, fetchedAt)).toEqual({
      searchRank: 12,
      itemCode: 'shop-a:10000123',
      shopCode: 'shop-a',
      shopName: 'ショップA',
      itemName: shopA.itemName,
      itemUrl: 'https://item.rakuten.co.jp/shop-a/asics-1201a019-108/',
      apiItemPriceYen: 12000,
      apiItemPriceMin3Yen: 12000,
      apiPointRate: 10,
      apiPostageFlag: 0,
      reviewCount: 128,
      reviewAverage: 4.7,
      shipOverseas: false,
      apiCollectedAt: fetchedAt.toISOString(),
    });
  });
});

describe('② 실행 중 실패 → step_run FAILED(규칙 3: HTTP 오류가 아니다)', () => {
  it('라쿠텐 API 오류 → EXTERNAL_API + 원래 코드 + 한국어 문구', () => {
    expect(
      sourcingFailureOf(
        new RakutenApiError({
          errorCode: 'CLIENT_IP_NOT_ALLOWED',
          message: '허용 IP 아님',
          httpStatus: 403,
        }),
      ),
    ).toEqual({
      kind: 'FAILED',
      failureKind: 'EXTERNAL_API',
      errorCode: 'CLIENT_IP_NOT_ALLOWED',
      errorMessage: '허용 IP 아님',
    });
  });

  it('관문 409·502는 EXTERNAL_API, 그 밖 ApiException은 INPUT_VALIDATION', () => {
    expect(sourcingFailureOf(new ApiException('DAILY_LIMIT_REACHED')).failureKind).toBe(
      'EXTERNAL_API',
    );
    expect(sourcingFailureOf(new ApiException('EXTERNAL_CALL_COOLDOWN')).failureKind).toBe(
      'EXTERNAL_API',
    );
    expect(sourcingFailureOf(new ApiException('SECRET_NOT_CONFIGURED'))).toMatchObject({
      failureKind: 'INPUT_VALIDATION',
      errorCode: 'SECRET_NOT_CONFIGURED',
    });
    expect(() => sourcingFailureOf(new Error('bug'))).toThrow('bug');
  });
});

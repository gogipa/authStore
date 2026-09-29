import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { BE_ROOT } from '../../common/config/paths.js';
import { findPersonalValues } from '../../common/safety/safety-rules.js';
import { DEFAULT_SETTINGS, readDefaultSettingsText } from './defaults/default-settings.js';
import type { AppSettings } from './schema/settings.types.js';
import {
  canonicalJson,
  checkSettingsText,
  checkSettingsValue,
  formatSettingsJson,
  ROOT_FIELD,
  SETTINGS_FILE_NAME,
  type SettingsCheckResult,
  SettingsFileLoader,
  settingsFilePath,
  writeSettingsFileAtomically,
} from './settings-file.loader.js';

const FIXTURES = join(BE_ROOT, 'test', 'fixtures', 'settings');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/** 기본 템플릿 사본을 고쳐 JSON 글자로 */
function edited(change: (s: AppSettings & Record<string, unknown>) => void): string {
  const copy = structuredClone(DEFAULT_SETTINGS) as AppSettings & Record<string, unknown>;
  change(copy);
  return JSON.stringify(copy);
}

function schemaErrors(result: SettingsCheckResult) {
  if (result.ok || result.kind !== 'SCHEMA')
    throw new Error(`스키마 오류가 아님: ${JSON.stringify(result)}`);
  return result.errors;
}

describe('기본 템플릿(settings.default.json)', () => {
  const result = checkSettingsText(readDefaultSettingsText());

  it('스키마와 안전 기준을 통과한다(valid=true)', () => {
    expect(result.ok).toBe(true);
  });

  it('비용 기본값이 PRD §8.3 표와 같다(퍼센트 수)', () => {
    const { costs, pricing } = DEFAULT_SETTINGS;
    expect(costs.cardSurchargePct).toBe(2.5);
    expect(costs.saleFeePct).toBe(3.0);
    expect(costs.saleFeeAdInflowPct).toBe(1.0);
    expect(costs.saleFeeIncludesShipping).toBe(true);
    expect(costs.npayFeePctByGrade[costs.npayFeeGrade]).toBe(3.63);
    expect(costs.npayFeePctByGrade).toEqual({
      MICRO: 1.947,
      SMALL_1: 2.563,
      SMALL_2: 2.728,
      SMALL_3: 3.003,
      GENERAL: 3.63,
    });
    expect(costs.miscCostKrw).toBe(3000);
    expect(costs.targetMarginPct).toBe(10);
    expect(costs.minProfitKrw).toBe(5000);
    expect(costs.judgementMarginPct).toBe(1);
    expect(costs.roundingUnitKrw).toBe(100);
    expect(costs.pointValueFactorForMargin).toBe(0);
    expect(costs.vatMode).toBe('A');
    expect(pricing).toMatchObject({
      dutyFreeLimitUsd: 150,
      dutyFreeBufferUsd: 5,
      defaultForwarderFeeKrw: 15000,
      shoeBox: { lengthCm: 33, widthCm: 22, heightCm: 12, weightKg: 1.2 },
      dutyRatePctByHsHeading: { '6401': 8, '6402': 13, '6403': 13, '6404': 13, '6405': 13 },
      applyFtaRates: false,
      simplifiedDuty: { enabled: false, ratePct: 18 },
      priceRule: { method: 'REF_DISCOUNT', refDiscountPct: 1 },
    });
  });

  it('과세 사이즈 판매·셀러라이프 쿠폰은 꺼짐(쿠폰당 2,000원)', () => {
    expect(DEFAULT_SETTINGS.pricing.sellTaxableSizes).toBe(false);
    expect(DEFAULT_SETTINGS.costs.sellerlifeCoupon).toEqual({
      enabled: false,
      amountKrw: 2000,
      monthlyLimit: 0,
    });
  });

  it('소싱 기본값이 규칙 11과 같다', () => {
    const { sourcing, safety, keywords } = DEFAULT_SETTINGS;
    expect(sourcing).toMatchObject({
      genreId: 558885,
      minPriceYen: 3000,
      pageFetchTargetCandidates: 3,
      pageFetchMaxPages: 10,
      targetSizeMm: { MALE: { min: 250, max: 290 }, FEMALE: { min: 220, max: 260 } },
      minSizeCount: 3,
      defaultWidth: '2E (標準)',
      excludeBackOrder: true,
      defaultShippingYen: 800,
      pageFetchDailyLimit: 110,
    });
    expect(sourcing.ngKeywords.join(' ')).toBe(
      '中古 インソール 靴紐 シューレース 箱のみ キッズ ジュニア ベビー',
    );
    expect(keywords.datalabDailyLimit).toBe(100);
    expect(safety.childShoeMaxSizeMm).toBe(235);
    expect(safety.judgementValidityHours).toBe(6);
    expect(safety.childKeywords).toEqual([
      '키즈',
      '주니어',
      '아동',
      'キッズ',
      'ジュニア',
      'ベビー',
    ]);
  });

  it('ai 섹션: CLAUDE, sonnet·sonnet. AGY(M0 S7 전)·CODEX는 null', () => {
    expect(DEFAULT_SETTINGS.ai).toEqual({
      engine: 'CLAUDE',
      models: {
        CLAUDE: { text: 'sonnet', vision: 'sonnet' },
        AGY: { text: null, vision: null },
        CODEX: { text: null, vision: null },
      },
    });
  });

  it('개인 값 없이 자리표시자만 둔다(F-BS-03, 규칙 13)', () => {
    const text = readDefaultSettingsText();
    expect(findPersonalValues(text)).toEqual([]);
    for (const placeholder of [
      '{상호}',
      '{배송기간_최소}',
      '{배송기간_최대}',
      '{반품비}',
      '{A/S 안내}',
    ]) {
      expect(text).toContain(placeholder);
    }
    expect(DEFAULT_SETTINGS.notice.values.deliveryDaysMin).toBeNull();
    expect(DEFAULT_SETTINGS.notice.values.deliveryDaysMax).toBeNull();
    // importer·상호·A/S·배대지 주소·파일 경로 같은 키가 없다(프로필은 P1-09 DB 행)
    expect(text).not.toMatch(/"(importer|shopName|afterService\w*|address\w*|\w*Path)"\s*:/i);
  });

  it('valid.json fixture는 템플릿 그대로다', () => {
    expect(fixture('valid.json')).toBe(readDefaultSettingsText());
  });
});

describe('스키마 검사(Ajv allErrors)', () => {
  it('비율에 문자열 "2.5" → 그 JSON 경로에 오류(값은 문구에 넣지 않는다)', () => {
    const errors = schemaErrors(
      checkSettingsText(
        edited((s) => ((s.costs as unknown as Record<string, unknown>).cardSurchargePct = '2.5')),
      ),
    );
    expect(errors).toEqual([{ field: '/costs/cardSurchargePct', message: '숫자여야 합니다.' }]);
  });

  it('모르는 키 commerceClientSecret → 오류(비밀 값 안내), 값은 응답에 없다', () => {
    const errors = schemaErrors(checkSettingsText(fixture('invalid-schema.json')));
    const secret = errors.find((e) => e.field === '/commerceClientSecret');
    expect(secret?.message).toMatch(/비밀 값/);
    expect(JSON.stringify(errors)).not.toContain('fixture-not-a-real-secret');
  });

  it('오류는 모두 모아서 준다(invalid-schema.json: 2건)', () => {
    const errors = schemaErrors(checkSettingsText(fixture('invalid-schema.json')));
    expect(errors.map((e) => e.field).sort()).toEqual([
      '/commerceClientSecret',
      '/costs/cardSurchargePct',
    ]);
  });

  it('모든 객체가 모르는 키를 막는다(안쪽 객체도)', () => {
    const errors = schemaErrors(
      checkSettingsText(
        edited((s) => {
          (s.costs as unknown as Record<string, unknown>).extra = 1;
          (s.ai.models.CLAUDE as unknown as Record<string, unknown>).apiKey = 'x';
        }),
      ),
    );
    expect(errors.map((e) => e.field).sort()).toEqual(['/ai/models/CLAUDE/apiKey', '/costs/extra']);
    expect(errors.find((e) => e.field === '/costs/extra')?.message).toMatch(/알 수 없는 설정 키/);
  });

  it('broken.json → 오류 1건, 위치(줄·칸) 포함', () => {
    const errors = schemaErrors(checkSettingsText(fixture('broken.json')));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      field: ROOT_FIELD,
      message: expect.stringMatching(/^JSON 문법 오류: 6번째 줄 \d+번째 칸 근처/) as string,
    });
  });

  it('빈 파일·배열 뿌리도 오류다', () => {
    expect(schemaErrors(checkSettingsText('')).length).toBe(1);
    expect(schemaErrors(checkSettingsText('[]'))).toEqual([
      { field: ROOT_FIELD, message: '묶음({ })여야 합니다.' },
    ]);
  });

  it('범위·소수 자리·enum·날짜 모양', () => {
    const errors = schemaErrors(
      checkSettingsText(
        edited((s) => {
          s.costs.saleFeePct = 101;
          s.costs.cardSurchargePct = 2.5555;
          (s.costs as unknown as Record<string, unknown>).vatMode = 'D';
          s.notice.basisDate = '2026/09/24';
          s.sourcing.minSizeCount = 0;
        }),
      ),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        { field: '/costs/saleFeePct', message: '100 이하여야 합니다.' },
        { field: '/costs/cardSurchargePct', message: '소수는 셋째 자리까지만 쓸 수 있습니다.' },
        { field: '/costs/vatMode', message: '다음 값 중 하나여야 합니다: A, B, C.' },
        { field: '/notice/basisDate', message: '날짜는 YYYY-MM-DD 모양이어야 합니다.' },
        { field: '/sourcing/minSizeCount', message: '1 이상이어야 합니다.' },
      ]),
    );
  });

  it('소수 셋째 자리(3.63·1.947)는 부동소수 오차 없이 통과한다', () => {
    const result = checkSettingsText(edited((s) => (s.costs.npayFeePctByGrade.SMALL_1 = 2.563)));
    expect(result.ok).toBe(true);
  });

  it('null이 되는 칸: null은 통과, 문자열·0은 오류', () => {
    expect(checkSettingsText(edited((s) => (s.notice.values.deliveryDaysMin = 10))).ok).toBe(true);
    const errors = schemaErrors(
      checkSettingsText(
        edited((s) => {
          (s.notice.values as unknown as Record<string, unknown>).deliveryDaysMin = '10';
          s.notice.values.deliveryDaysMax = 0;
          (s.ai.models.AGY as unknown as Record<string, unknown>).text = 5;
          (s.notice.blocks[0] as unknown as Record<string, unknown>).when = 'SOMETIMES';
        }),
      ),
    );
    expect(errors.map((e) => e.field).sort()).toEqual([
      '/ai/models/AGY/text',
      '/notice/blocks/0/when',
      '/notice/values/deliveryDaysMax',
      '/notice/values/deliveryDaysMin',
    ]);
  });

  it('값끼리의 관계: 목표 사이즈 최소>최대, 배송기간 최소>최대, 블록 ID 중복', () => {
    const errors = schemaErrors(
      checkSettingsText(
        edited((s) => {
          s.sourcing.targetSizeMm.MALE = { min: 290, max: 250 };
          s.notice.values.deliveryDaysMin = 20;
          s.notice.values.deliveryDaysMax = 10;
          s.notice.blocks.push({ id: 'HEADER', when: null, text: '추가' });
        }),
      ),
    );
    expect(errors.map((e) => e.field)).toEqual([
      '/sourcing/targetSizeMm/MALE/min',
      '/notice/values/deliveryDaysMin',
      `/notice/blocks/${DEFAULT_SETTINGS.notice.blocks.length}/id`,
    ]);
  });

  it('빠진 키는 기본 템플릿 값으로 채운다(useDefaults)', () => {
    const partial = { schemaVersion: '1', costs: { targetMarginPct: 12 } };
    const result = checkSettingsValue(partial);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.settings.costs.targetMarginPct).toBe(12);
    expect(result.settings.costs.cardSurchargePct).toBe(2.5);
    expect(result.settings.ai).toEqual(DEFAULT_SETTINGS.ai);
    expect(result.settings.notice.blocks).toEqual(DEFAULT_SETTINGS.notice.blocks);
    // 원본은 바꾸지 않는다
    expect(partial).toEqual({ schemaVersion: '1', costs: { targetMarginPct: 12 } });
  });

  it('같은 모양을 나눠 쓰는 칸도 제 기본값으로 채운다(MALE·FEMALE 사이즈, 엔진별 모델)', () => {
    const value = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    const sourcing = value.sourcing as Record<string, unknown>;
    sourcing.targetSizeMm = { MALE: {}, FEMALE: {} };
    (value.ai as Record<string, unknown>).models = { CLAUDE: {}, AGY: {}, CODEX: {} };
    const result = checkSettingsValue(value);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.settings.sourcing.targetSizeMm).toEqual({
      MALE: { min: 250, max: 290 },
      FEMALE: { min: 220, max: 260 },
    });
    expect(result.settings.ai.models).toEqual(DEFAULT_SETTINGS.ai.models);
  });

  it('schemaVersion은 "1"만 받는다', () => {
    const errors = schemaErrors(
      checkSettingsText(edited((s) => ((s as Record<string, unknown>).schemaVersion = '2'))),
    );
    expect(errors).toEqual([{ field: '/schemaVersion', message: "'1'여야 합니다." }]);
  });
});

describe('내용 해시(content_sha256)', () => {
  const hashOf = (text: string): string => {
    const result = checkSettingsText(text);
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result.contentSha256;
  };

  it('키 순서만 다르거나 공백만 다른 두 파일은 같은 해시다', () => {
    const a = readDefaultSettingsText();
    const reversed = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reversed);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([k, v]) => [k, reversed(v)]),
        );
      }
      return value;
    };
    const b = JSON.stringify(reversed(JSON.parse(a)));
    const c = JSON.stringify(JSON.parse(a), null, 8);
    expect(b).not.toBe(a);
    expect(hashOf(b)).toBe(hashOf(a));
    expect(hashOf(c)).toBe(hashOf(a));
    expect(hashOf(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('값 하나가 다르면 다른 해시다', () => {
    const a = readDefaultSettingsText();
    const b = edited((s) => (s.costs.targetMarginPct = 12));
    expect(hashOf(b)).not.toBe(hashOf(a));
  });

  it('canonicalJson은 키를 정렬하고 배열 순서는 지킨다', () => {
    expect(canonicalJson({ b: 1, a: [3, { d: 1, c: 2 }] })).toBe('{"a":[3,{"c":2,"d":1}],"b":1}');
  });
});

describe('SettingsFileLoader(파일)', () => {
  let dir: string;
  const loaderFor = (appDataDir: string) =>
    new SettingsFileLoader({ appDataDir } as unknown as AppConfigService);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'autostore-settings-unit-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('파일이 없으면 기본 템플릿을 그대로 복사해 만들고 읽는다', async () => {
    const result = await loaderFor(dir).load();
    expect(result.ok).toBe(true);
    expect(result.createdFromTemplate).toBe(true);
    expect(readFileSync(settingsFilePath(dir), 'utf8')).toBe(readDefaultSettingsText());
    const again = await loaderFor(dir).load();
    expect(again.createdFromTemplate).toBe(false);
  });

  it('file_manifest는 파일 이름·SHA-256·크기만 담고 경로가 없다', async () => {
    const result = await loaderFor(dir).load();
    expect(result.fileManifest).toEqual([
      {
        name: SETTINGS_FILE_NAME,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        sizeBytes: Buffer.byteLength(readDefaultSettingsText()),
      },
    ]);
    const json = JSON.stringify(result.fileManifest);
    expect(json).not.toContain(dir);
    for (const entry of result.fileManifest) {
      expect(entry.name.startsWith('/')).toBe(false);
      expect(entry.name).not.toContain('/');
    }
  });

  it('읽은 파일이 틀리면 오류를 돌려준다(파일은 그대로)', async () => {
    await writeSettingsFileAtomically(dir, fixture('relax-size-230.json'));
    const result = await loaderFor(dir).load();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.kind).toBe('SAFETY');
    expect(result.createdFromTemplate).toBe(false);
  });

  it('원자 쓰기: 임시 파일을 남기지 않고, 2칸 들여쓰기 JSON으로 쓴다', async () => {
    const next = structuredClone(DEFAULT_SETTINGS) as AppSettings;
    next.ai.engine = 'CODEX';
    await loaderFor(dir).write(next);
    await writeSettingsFileAtomically(dir, next);
    expect(readdirSync(join(dir, 'settings'))).toEqual([SETTINGS_FILE_NAME]);
    expect(readFileSync(settingsFilePath(dir), 'utf8')).toBe(formatSettingsJson(next));
  });

  it('BOM이 붙은 파일도 읽는다', async () => {
    await writeSettingsFileAtomically(dir, readDefaultSettingsText());
    writeFileSync(settingsFilePath(dir), `\uFEFF${readDefaultSettingsText()}`);
    expect((await loaderFor(dir).load()).ok).toBe(true);
  });
});

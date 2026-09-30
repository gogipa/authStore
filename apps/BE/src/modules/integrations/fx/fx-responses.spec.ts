import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BE_ROOT } from '../../../common/config/paths.js';
import { maskUrl } from '../http/url-mask.js';
import { buildCustomsUrl } from './customs-service.adapter.js';
import { parseCustomsResponse } from './customs-service.response.js';
import { FxFixtureAdapter } from './fx-fixture.adapter.js';
import { compactKstDate } from './fx-source.port.js';
import { buildKeximUrl } from './kexim.adapter.js';
import { parseKeximResponse } from './kexim.response.js';

const FIXTURES = join(BE_ROOT, 'test', 'fixtures', 'fx');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

describe('수출입은행 응답 해석(parseKeximResponse, 규칙 1)', () => {
  it('정상 fixture → 엔화 한 줄의 원값·통화 표기 그대로(JPY(100), 876.00)', () => {
    const r = parseKeximResponse(fixture('kexim-jpy100.json'));
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    expect(r.rate.currencyUnit).toBe('JPY(100)');
    expect(r.rate.dealBasR).toBe('876.00');
    expect(r.rate.raw.cur_nm).toBe('일본 옌');
  });

  it('빈 배열·null·빈 본문 → EMPTY(휴일·11시 전)', () => {
    expect(parseKeximResponse(fixture('kexim-empty.json'))).toEqual({ kind: 'EMPTY' });
    expect(parseKeximResponse('null')).toEqual({ kind: 'EMPTY' });
    expect(parseKeximResponse('  ')).toEqual({ kind: 'EMPTY' });
  });

  it('result 3(인증 오류) → KEXIM_RESULT_3', () => {
    expect(parseKeximResponse(fixture('kexim-result3.json'))).toMatchObject({
      kind: 'ERROR',
      errorCode: 'KEXIM_RESULT_3',
    });
  });

  it('JSON 아님·배열 아님·엔화 없음·숫자 아닌 값 → 실패', () => {
    expect(parseKeximResponse('<html>')).toMatchObject({ errorCode: 'FX_RESPONSE_INVALID' });
    expect(parseKeximResponse('{"a":1}')).toMatchObject({ errorCode: 'FX_RESPONSE_INVALID' });
    expect(
      parseKeximResponse('[{"result":1,"cur_unit":"USD","deal_bas_r":"1,358.72"}]'),
    ).toMatchObject({ errorCode: 'KEXIM_JPY_MISSING' });
    expect(
      parseKeximResponse('[{"result":1,"cur_unit":"JPY(100)","deal_bas_r":"-"}]'),
    ).toMatchObject({ errorCode: 'FX_RESPONSE_INVALID' });
  });
});

describe('관세청 응답 해석(parseCustomsResponse, 규칙 2)', () => {
  it('정상 fixture → JPY·USD 두 통화(유로는 버린다), 화폐단위명·적용 시작일 원문', () => {
    const r = parseCustomsResponse(fixture('customs-week.xml'));
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    expect(r.rates.map((x) => [x.currency, x.rate, x.unitName, x.applyStartDate])).toEqual([
      ['JPY', '876.00', '100엔', '20260927'],
      ['USD', '1,358.72', '달러', '20260927'],
    ]);
  });

  it('항목 없음 → EMPTY', () => {
    expect(parseCustomsResponse(fixture('customs-empty.xml'))).toEqual({ kind: 'EMPTY' });
  });

  it('형식 깨짐 → FX_RESPONSE_INVALID, 포털 키 오류 → CUSTOMS_RESULT_30', () => {
    expect(parseCustomsResponse(fixture('customs-broken.xml'))).toMatchObject({
      kind: 'ERROR',
      errorCode: 'FX_RESPONSE_INVALID',
    });
    expect(parseCustomsResponse(fixture('customs-key-error.xml'))).toMatchObject({
      kind: 'ERROR',
      errorCode: 'CUSTOMS_RESULT_30',
      message: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR',
    });
  });

  it('결과 코드가 00이 아니면 CUSTOMS_RESULT_{코드}, 달러가 빠지면 CUSTOMS_RATE_MISSING', () => {
    const bad =
      '<response><header><resultCode>03</resultCode><resultMsg>NO DATA</resultMsg></header></response>';
    expect(parseCustomsResponse(bad)).toMatchObject({ errorCode: 'CUSTOMS_RESULT_03' });
    const onlyJpy = fixture('customs-week.xml').replace(
      /<currSgn>USD<\/currSgn>/,
      '<currSgn>GBP</currSgn>',
    );
    expect(parseCustomsResponse(onlyJpy)).toMatchObject({ errorCode: 'CUSTOMS_RATE_MISSING' });
  });
});

describe('요청 주소와 키 가리기(규칙 3)', () => {
  it('authkey·serviceKey는 쿼리에 실리지만 call_log 주소(maskUrl)에는 남지 않는다', () => {
    const kexim = buildKeximUrl('SECRET-KEXIM-KEY-123', '2026-09-28');
    expect(kexim).toContain('searchdate=20260928');
    expect(kexim).toContain('data=AP01');
    expect(maskUrl(kexim)).not.toContain('SECRET-KEXIM-KEY-123');
    expect(maskUrl(kexim)).toContain('authkey=***');
    const customs = buildCustomsUrl('SECRET/CUSTOMS+KEY==', '2026-09-28');
    expect(customs).toContain('aplyBgnDt=20260928');
    expect(maskUrl(customs)).toContain('serviceKey=***');
    expect(maskUrl(customs)).not.toContain('SECRET');
  });

  it("compactKstDate: 'YYYY-MM-DD'만 받는다", () => {
    expect(compactKstDate('2026-09-28')).toBe('20260928');
    expect(() => compactKstDate('20260928')).toThrow();
  });
});

describe('FxFixtureAdapter(테스트·개발용)', () => {
  it('정해 둔 결과를 돌려주고 부른 날짜를 남긴다', async () => {
    const adapter = new FxFixtureAdapter()
      .answerCost(FxFixtureAdapter.costFromBody(fixture('kexim-jpy100.json')))
      .answerCustoms(FxFixtureAdapter.customsFromBody(fixture('customs-broken.xml')));
    await expect(adapter.fetchCostJpy('2026-09-28')).resolves.toMatchObject({ kind: 'OK' });
    await expect(adapter.fetchCustomsRates('2026-09-28')).resolves.toMatchObject({
      kind: 'FAILED',
      errorCode: 'FX_RESPONSE_INVALID',
    });
    expect(adapter.callsOf('fetchCostJpy')).toEqual(['2026-09-28']);
    adapter.reset();
    await expect(adapter.fetchCostJpy('2026-09-29')).resolves.toEqual({
      kind: 'EMPTY',
      callLogId: null,
    });
  });
});

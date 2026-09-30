import { describe, expect, it } from 'vitest';
import { contentAssemblyOutput } from '@/test/fixtures/content';
import {
  disclosureFootText,
  missingAssemblyProfile,
  noticeEditFields,
  noticeFormOf,
  originText,
  productNameCheckText,
  productNameCounter,
  productNameSaveDisabledReason,
  productNameTooLong,
  specBlockLines,
} from './assembly';

describe('⑥-3 표시 규칙(P3-04)', () => {
  it('상품명 카운터·100자 경고·저장 꺼짐 이유(100자 초과는 막지 않는다)', () => {
    const name = '아식스 젤카야노14 1201A019-108 러닝화 크림 남성';
    expect(productNameCounter(name)).toBe('33/100');
    expect(productNameTooLong('가'.repeat(101))).toBe(true);
    expect(productNameSaveDisabledReason('가'.repeat(120), name)).toBeNull();
    expect(productNameSaveDisabledReason(name, name)).toBe('고친 내용이 없습니다.');
    expect(productNameSaveDisabledReason('  ', name)).toBe('상품명을 비울 수 없습니다.');
    expect(productNameSaveDisabledReason('x'.repeat(256), name)).toMatch(/255자/);
  });

  it('경고 줄: 없으면 없음 글, 있으면 서버 문구. 병행 글', () => {
    expect(productNameCheckText(contentAssemblyOutput())).toEqual({
      ok: true,
      text: '금지 수식어 없음 · 반복 단어 없음',
      parallel: '· 병행수입품 아님',
    });
    const warned = productNameCheckText(
      contentAssemblyOutput({
        parallelImport: true,
        productNameWarnings: [
          { code: 'PRODUCT_NAME_BANNED_WORD', message: "금지 수식어 '무료배송'가 들어 있습니다." },
        ],
      }),
    );
    expect(warned.ok).toBe(false);
    expect(warned.text).toBe("금지 수식어 '무료배송'가 들어 있습니다. · 반복 단어 없음");
    expect(warned.parallel).toBe('· 병행수입품(병행 표기)');
  });

  it('원산지 글: 수입산 단일·여러 나라, 03 상세설명 표시', () => {
    expect(originText(contentAssemblyOutput())).toBe('수입산 · 아시아 > 베트남 · 단일 국가');
    expect(originText(contentAssemblyOutput({ originAreaPlural: true }))).toBe(
      '수입산 · 아시아 > 베트남 · 여러 나라(복수 표시)',
    );
    expect(
      originText(
        contentAssemblyOutput({
          originAreaCode: '03',
          originAreaName: null,
          originAreaContent: '베트남',
        }),
      ),
    ).toBe('상세설명에 표시(03) · 베트남');
  });

  it('사양 블록 줄(DOMParser로 글만), 고지 끝 줄(붙은 문장)', () => {
    expect(specBlockLines(contentAssemblyOutput().specBlockHtml)).toEqual([
      '· 제조국(원산지): 베트남',
      '· 소재: 겉감 합성섬유·합성가죽 / 밑창 고무',
      '· 굽·밑창 높이: 약 3cm',
      '· 사이즈: 250~265·275mm (JP 25.0~26.5·27.5cm)',
    ]);
    expect(disclosureFootText(contentAssemblyOutput())).toBe(
      '기준일 2026-09-24 · 붙은 문장: 가죽 소재 · AI 이미지',
    );
    expect(
      disclosureFootText(
        contentAssemblyOutput({
          disclosureBlocks: contentAssemblyOutput().disclosureBlocks.filter((b) => !b.conditional),
        }),
      ),
    ).toBe('기준일 2026-09-24 · 붙은 문장 없음');
  });

  it('고시 고치기는 바뀐 칸만, 굽높이를 비우면 null(항목 빼기)', () => {
    const fields = { ...contentAssemblyOutput().noticeFields, height: '약 3cm' } as Record<
      string,
      unknown
    >;
    const form = { ...noticeFormOf(fields), color: '크림', height: '' };
    expect(noticeEditFields(form, fields)).toEqual([
      { fieldKey: 'notice.color', value: '크림' },
      { fieldKey: 'notice.height', value: null },
    ]);
    expect(noticeEditFields(noticeFormOf(fields), fields)).toEqual([]);
  });

  it('⑥-3이 막히는 프로필 빈칸(상호·A/S·수입자·반품비)', () => {
    expect(
      missingAssemblyProfile(['importer', 'overseasShippingCommerceAddressbookId', 'returnFeeKrw']),
    ).toEqual(['수입자', '반품비']);
  });
});

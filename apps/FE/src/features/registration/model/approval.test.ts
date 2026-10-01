import { describe, expect, it } from 'vitest';
import { approvalPreview, CHECK_CODES, preValidationResult } from '@/test/fixtures/registration';
import {
  approveState,
  localizeDetailContent,
  optionStockText,
  PRE_VALIDATION_LINES,
  preValidationLines,
  preValidationSummary,
  productNameLength,
  sourcingMethodText,
} from './approval';

describe('승인 화면 표시 규칙(P4-02)', () => {
  it('시안 13줄이 검사 코드 15개를 빠짐없이·겹치지 않게 덮는다', () => {
    expect(PRE_VALIDATION_LINES).toHaveLength(13);
    const codes = PRE_VALIDATION_LINES.flatMap((line) => line.codes);
    expect([...codes].sort()).toEqual([...CHECK_CODES].sort());
    expect(new Set(codes).size).toBe(15);
  });

  it('묶은 줄은 둘 중 하나라도 실패면 실패이고 사유를 모두 보인다. 게이트 실패면 근거 단계로 잇는다', () => {
    const result = preValidationResult(12, {
      EXTRA_CHARGE_WORDING: {
        reason: "추가 청구 표현이 있습니다: '관부가세 별도'",
        stepCode: 'COPY',
      },
      REPRESENTATIVE_IMAGE_SOURCE: { reason: "'같은 상품·색상' 확인이 없습니다", gateCode: 'G3' },
    });
    const lines = preValidationLines(result, approvalPreview(12));
    const wording = lines.find((line) => line.id === 'WORDING')!;
    expect(wording.passed).toBe(false);
    expect(wording.reasons).toEqual(["추가 청구 표현이 있습니다: '관부가세 별도'"]);
    expect(wording.linkStep).toBe('COPY');
    expect(lines.find((line) => line.id === 'REPRESENTATIVE_IMAGE')!.linkStep).toBe('THUMBNAIL');
    expect(preValidationSummary(lines)).toEqual({ allPassed: false, text: '13개 중 2개 실패' });
  });

  it('통과 줄은 시안 문구(동적 값)와 시안 링크를 쓴다', () => {
    const lines = preValidationLines(preValidationResult(12), approvalPreview(12));
    const byId = Object.fromEntries(lines.map((line) => [line.id, line]));
    expect(byId.PRODUCT_NAME).toMatchObject({
      label: '상품명 100자 이내',
      detail: '· 33자',
      linkStep: 'NOTICE_HTML',
    });
    expect(byId.MARGIN).toMatchObject({ detail: '153,100원', linkStep: 'PRICING' });
    expect(byId.OPTIONS!.label).toBe('사이즈 옵션 5개가 재고와 일치');
    expect(byId.ORIGIN!.detail).toBe("· 베트남, '일본산' 표현 없음");
    expect(byId.DUPLICATE!.detail).toBe('RKT:shop-a:10000123:108');
    expect(byId.JUDGEMENT_FRESHNESS!.label).toBe('라쿠텐 페이지 14:02 받음 · 20:02까지 유효');
    expect(preValidationSummary(lines)).toEqual({ allPassed: true, text: '13개 모두 통과' });
  });

  it('상세 렌더링: 업로드 URL은 로컬 파일로 바꾸고 모르는 이미지는 지운다', () => {
    const html =
      '<p><img src="shop-phinf.pstatic.net/a.jpg" srcset="x 2x" alt="대표"></p><p><img alt="모름" src="other.example/b.jpg"></p>';
    const out = localizeDetailContent(
      html,
      new Map([['shop-phinf.pstatic.net/a.jpg', 31]]),
      'http://127.0.0.1:5173',
    );
    expect(out).toBe(
      '<p><img src="http://127.0.0.1:5173/api/v1/image-assets/31/file" alt="대표"></p><p></p>',
    );
  });

  it('승인 버튼: 미리보기 꺼짐 → 사전 검증 실패 → 검사 중 순으로 이유를 보인다', () => {
    const preview = approvalPreview(12);
    const passing = preValidationResult(12);
    const lines = preValidationLines(passing, preview);
    expect(
      approveState({ preview, previewError: null, result: passing, resultError: null, lines }),
    ).toEqual({
      enabled: true,
      reason: null,
    });
    const off = approvalPreview(12, {
      approveEnabled: false,
      approveDisabledReason: {
        code: 'GATE_NOT_PASSED',
        message: 'G2 판정 확정을 먼저 통과해 주세요.',
      },
    });
    expect(
      approveState({ preview: off, previewError: null, result: passing, resultError: null, lines })
        .reason,
    ).toBe('G2 판정 확정을 먼저 통과해 주세요.');
    expect(
      approveState({ preview, previewError: null, result: undefined, resultError: null, lines })
        .reason,
    ).toBe('사전 검증 중입니다.');
  });

  it('글자 수·옵션·소싱 방식 글', () => {
    expect(productNameLength('가'.repeat(100))).toBe(100);
    expect(optionStockText(approvalPreview(12))).toBe('조합형 · 각 2개, 합 10개');
    expect(
      sourcingMethodText({
        method: 'NO_COMPARISON_CONFIRMED',
        creationPath: 'RAKUTEN_URL',
        noComparisonConfirmedAt: '2026-09-28T05:11:00.000Z',
        itemCode: 'shop-a:1',
      }),
    ).toBe('비교 없이 확정 · shop-a:1');
  });
});

import { describe, expect, it } from 'vitest';
import { COPY_DOC, contentField } from '@/test/fixtures/content';
import {
  copyDocOf,
  copyEditFields,
  copyFormErrors,
  copyFormOf,
  factMethodText,
  factSourceText,
  factValueText,
  headlineCounter,
  originSaveDisabledReason,
  ORIGIN_URL_REQUIRED_REASON,
  sellingPointsOf,
} from './content';

describe('⑥-1 카피 편집 규칙(P3-03 규칙 2·6)', () => {
  it('헤드라인 카운터 25/40, 41자면 오류', () => {
    expect(headlineCounter(COPY_DOC.headline)).toBe('25/40');
    const form = copyFormOf(copyDocOf(COPY_DOC));
    expect(copyFormErrors(form)).toEqual({});
    expect(copyFormErrors({ ...form, headline: '가'.repeat(41) }).headline).toBe(
      '헤드라인은 40자 이하여야 합니다(지금 41자).',
    );
    expect(copyFormErrors({ ...form, headline: '가'.repeat(40) }).headline).toBeUndefined();
  });

  it('셀링포인트는 한 줄에 하나(머리표 떼기), 3~5개가 아니면 오류', () => {
    expect(sellingPointsOf('· 하나\n- 둘\n\n• 셋 ')).toEqual(['하나', '둘', '셋']);
    const form = copyFormOf(copyDocOf(COPY_DOC));
    expect(copyFormErrors({ ...form, sellingPoints: '· 하나\n· 둘' }).sellingPoints).toContain(
      '3~5개',
    );
  });

  it('고친 항목만 오너 수정 필드로 보낸다', () => {
    const doc = copyDocOf(COPY_DOC);
    const form = copyFormOf(doc);
    expect(copyEditFields(form, doc)).toEqual([]);
    expect(copyEditFields({ ...form, headline: ' 새 헤드라인 ' }, doc)).toEqual([
      { fieldKey: 'copy.headline', value: '새 헤드라인' },
    ]);
  });
});

describe('⑥-2 표 글(F-CT-13)', () => {
  it('방법 글 네 가지: 상품 속성에서 찾음·설명문에서 찾음·AI로 찾음·정보 없음, 오너 입력은 직접 입력', () => {
    const texts = (['SKU_ATTRIBUTE', 'DESCRIPTION_PATTERN', 'AI', 'NONE'] as const).map((m) =>
      factMethodText(contentField({ fieldKey: 'fact.origin', extractionMethod: m })),
    );
    expect(texts).toEqual(['상품 속성에서 찾음', '설명문에서 찾음', 'AI로 찾음', '정보 없음']);
    expect(
      factMethodText(
        contentField({ fieldKey: 'fact.origin', extractionMethod: 'AI', evidenceImageAssetId: 3 }),
      ),
    ).toBe('AI로 찾음 · 스펙 이미지');
    expect(
      factMethodText(contentField({ fieldKey: 'fact.origin', valueSource: 'OWNER_INPUT' })),
    ).toBe('직접 입력');
    expect(
      factSourceText(contentField({ fieldKey: 'fact.origin', extractionMethod: 'NONE' })),
    ).toBe('—');
  });

  it('값 글: 나라 목록·높이·정보 없음', () => {
    expect(factValueText(['베트남', '인도네시아', '중국'])).toBe('베트남·인도네시아·중국');
    expect(factValueText({ value: 3.5, unit: 'cm' })).toBe('약 3.5cm');
    expect(factValueText(null)).toBe('정보 없음');
    expect(factValueText('합성섬유·합성가죽')).toBe('합성섬유·합성가죽');
  });

  it('원산지 직접 넣기: 근거 URL이 없으면 저장이 꺼진다', () => {
    expect(originSaveDisabledReason('베트남', '')).toBe(ORIGIN_URL_REQUIRED_REASON);
    expect(originSaveDisabledReason('', 'item.rakuten.co.jp/x/1/')).not.toBeNull();
    expect(originSaveDisabledReason('베트남', 'item.rakuten.co.jp/x/1/')).toBeNull();
  });
});

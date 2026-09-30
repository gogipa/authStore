import { describe, expect, it } from 'vitest';
import { promptPreview, referencesResult, sourceImage } from '@/test/fixtures/thumbnails';
import {
  blockedTermsText,
  DEFAULT_FACE_OPTION,
  FACE_OPTION_LABEL,
  FACE_OPTIONS,
  GENERATE_NEEDS_REFERENCES_REASON,
  GENERATE_NO_RUN_REASON,
  GENERATE_NOT_ALLOWED_REASON,
  GENERATE_NOT_WAITING_REASON,
  GENERATE_PREVIEW_PENDING_REASON,
  generateDisabledReason,
  imageCaption,
  referencesRequest,
  sameSelection,
  SOURCE_IMAGES_NOTE,
  sourceLineText,
  toggleReference,
} from './thumbnails';

describe('thumbnails 표시 규칙(SCR-05, P3-01)', () => {
  it('얼굴 노출: 보드 순서·문구, 기본 전체', () => {
    expect(FACE_OPTIONS.map((o) => FACE_OPTION_LABEL[o])).toEqual([
      '전체',
      '턱 아래 크롭',
      '손·상반신만',
    ]);
    expect(DEFAULT_FACE_OPTION).toBe('FULL_FACE');
  });

  it('레퍼런스는 3장까지 고른 순서대로 — 4번째는 더해지지 않고, 고른 것을 누르면 빠진다', () => {
    let selection: number[] = [];
    for (const id of [1, 2, 3, 4]) selection = toggleReference(selection, id);
    expect(selection).toEqual([1, 2, 3]);
    expect(toggleReference(selection, 2)).toEqual([1, 3]);
    expect(referencesRequest([5, 2], true)).toEqual({
      references: [
        { imageAssetId: 5, sortOrder: 1 },
        { imageAssetId: 2, sortOrder: 2 },
      ],
      noPersonConfirmed: true,
    });
    expect(sameSelection(referencesResult(9, [5, 2]), [5, 2])).toBe(true);
    expect(sameSelection(referencesResult(9, [5, 2]), [2, 5])).toBe(false);
    expect(sameSelection(null, [])).toBe(false);
  });

  it('출처 줄·카드 줄(보드 모양)과 안내 문구', () => {
    const images = [1, 2, 3, 4, 5, 6].map((id) => sourceImage({ imageAssetId: id }));
    expect(sourceLineText(images)).toBe('라쿠텐 shop-a 상품 페이지 · 14:02 받음 · 6장');
    expect(sourceLineText([])).toBe('');
    expect(imageCaption(0, { width: 1200, height: 1200 })).toBe('1 · 1200×1200');
    expect(SOURCE_IMAGES_NOTE).toContain('레퍼런스를 바꾸면 ⑤를 다시 실행해야 합니다');
  });

  it('생성 버튼 꺼진 이유: 실행 없음 → 입력 대기 아님 → 차단어 → 레퍼런스 확인 → 미리보기 → 서버 허용', () => {
    const base = { hasRun: true, waiting: true, referencesConfirmed: true };
    expect(generateDisabledReason({ ...base, hasRun: false, preview: undefined })).toBe(
      GENERATE_NO_RUN_REASON,
    );
    expect(generateDisabledReason({ ...base, waiting: false, preview: undefined })).toBe(
      GENERATE_NOT_WAITING_REASON,
    );
    expect(
      generateDisabledReason({
        ...base,
        preview: promptPreview({ realPersonNameDetected: true, blockedTerms: ['BTS'] }),
      }),
    ).toBe(blockedTermsText(['BTS']));
    expect(
      generateDisabledReason({ ...base, referencesConfirmed: false, preview: promptPreview() }),
    ).toBe(GENERATE_NEEDS_REFERENCES_REASON);
    expect(generateDisabledReason({ ...base, preview: undefined })).toBe(
      GENERATE_PREVIEW_PENDING_REASON,
    );
    expect(generateDisabledReason({ ...base, preview: promptPreview() })).toBe(
      GENERATE_NOT_ALLOWED_REASON,
    );
    expect(
      generateDisabledReason({ ...base, preview: promptPreview({ generationAllowed: true }) }),
    ).toBeNull();
    expect(blockedTermsText(['BTS', '카리나'])).toBe(
      '프롬프트에 실존 인물 이름(BTS, 카리나)이 있어 만들 수 없습니다.',
    );
  });
});

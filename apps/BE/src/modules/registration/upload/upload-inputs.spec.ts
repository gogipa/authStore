import { NULL_VALUE_HASH } from '../../step-engine/domain/fingerprint.js';
import { selectionInputValue, uploadInputFingerprint, uploadStepInputs } from './upload-inputs.js';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const HTML_1 = '1'.repeat(64);
const HTML_2 = '2'.repeat(64);

describe('⑧ 입력 지문(규칙 3 — 선택본 sha256 + ⑥-3 html_sha256만)', () => {
  const inputs = (
    selection: { sortOrder: number; sha256: string; collectedAt?: string; uploadedAt?: string }[],
    htmlSha256: string | null,
  ) =>
    uploadStepInputs({
      thumbnailStepRunId: 7,
      selection,
      noticeHtmlStepRunId: 9,
      htmlSha256,
    });

  it('수집 시각·업로드 시각만 다름 → 지문 같음', () => {
    const a = inputs(
      [
        { sortOrder: 0, sha256: SHA_A, collectedAt: '2026-09-28T00:00:00Z' },
        { sortOrder: 1, sha256: SHA_B, uploadedAt: '2026-09-28T00:00:00Z' },
      ],
      HTML_1,
    );
    const b = inputs(
      [
        { sortOrder: 1, sha256: SHA_B, uploadedAt: '2026-10-01T09:00:00Z' },
        { sortOrder: 0, sha256: SHA_A, collectedAt: '2026-10-01T09:00:00Z' },
      ],
      HTML_1,
    );
    expect(uploadInputFingerprint(a)).toBe(uploadInputFingerprint(b));
  });

  it('html_sha256 다름 → 지문 다름. 선택본 순서가 바뀌어도 다름', () => {
    const base = inputs([{ sortOrder: 0, sha256: SHA_A }], HTML_1);
    expect(uploadInputFingerprint(inputs([{ sortOrder: 0, sha256: SHA_A }], HTML_2))).not.toBe(
      uploadInputFingerprint(base),
    );
    const two = inputs(
      [
        { sortOrder: 0, sha256: SHA_A },
        { sortOrder: 1, sha256: SHA_B },
      ],
      HTML_1,
    );
    const swapped = inputs(
      [
        { sortOrder: 0, sha256: SHA_B },
        { sortOrder: 1, sha256: SHA_A },
      ],
      HTML_1,
    );
    expect(uploadInputFingerprint(two)).not.toBe(uploadInputFingerprint(swapped));
  });

  it('입력 두 개 모두 PREV_STEP·필수·시작 조건(재실행 필요 전파가 ⑧을 찾는다). 값은 {sortOrder, sha256}만', () => {
    const rows = inputs([{ sortOrder: 0, sha256: SHA_A, collectedAt: 'x' }], HTML_1);
    expect(rows).toEqual([
      {
        inputKey: 'thumbnail.selection',
        sourceType: 'PREV_STEP',
        sourceStepRunId: 7,
        isStartCondition: true,
        required: true,
        value: [{ sortOrder: 0, sha256: SHA_A }],
      },
      {
        inputKey: 'noticeHtml.html',
        sourceType: 'PREV_STEP',
        sourceStepRunId: 9,
        isStartCondition: true,
        required: true,
        value: HTML_1,
      },
    ]);
    expect(selectionInputValue([])).toEqual([]);
    // 없으면 null(엔진이 409 STEP_START_CONDITION_UNMET)
    const empty = uploadStepInputs({
      thumbnailStepRunId: null,
      selection: null,
      noticeHtmlStepRunId: null,
      htmlSha256: null,
    });
    expect(empty.map((i) => i.value)).toEqual([null, null]);
    expect(uploadInputFingerprint(empty)).toMatch(/^[0-9a-f]{64}$/);
    expect(NULL_VALUE_HASH).toMatch(/^[0-9a-f]{64}$/);
  });
});

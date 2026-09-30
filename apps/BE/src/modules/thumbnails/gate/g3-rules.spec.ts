import { ApiException } from '../../../common/errors/api.exception.js';
import {
  checklistSnapshot,
  G3_CHECKLIST_KEYS,
  G3_CHECKLIST_VERSION,
  selectionImagesOf,
  selectionSetSha256,
} from '../selection/thumbnail-selection.js';
import {
  assertChecklistShape,
  checkG3Selection,
  type G3CheckInput,
  type G3PassBody,
} from './g3-rules.js';

const allTrue = () =>
  Object.fromEntries(G3_CHECKLIST_KEYS.map((key) => [key, true])) as Record<string, unknown>;

function body(patch: Partial<G3PassBody> = {}): G3PassBody {
  return {
    basisStepRunId: 5,
    representativeImageAssetId: 101,
    additionalImageAssetIds: [],
    checklist: allTrue(),
    sameProductColorConfirmed: false,
    ...patch,
  };
}

function input(patch: Partial<G3CheckInput> = {}): G3CheckInput {
  const b = patch.body ?? body();
  return {
    body: b,
    images: [b.representativeImageAssetId, ...b.additionalImageAssetIds].map((imageAssetId) => ({
      imageAssetId,
      kind: 'GENERATED',
      fromThisRun: true,
    })),
    sameProductColorRequired: false,
    runningGenerations: 0,
    ...patch,
  };
}

const codes = (i: G3CheckInput) => checkG3Selection(i).map((b) => b.code);

describe('G3 검사기(P3-02 규칙 9~11, 표 C)', () => {
  it('7개 모두 true + 이 실행의 생성본 대표 1장 → 막힌 이유 없음', () => {
    expect(checkG3Selection(input())).toEqual([]);
  });

  it.each(G3_CHECKLIST_KEYS)('%s 하나만 false → CHECKLIST_INCOMPLETE(uncheckedKeys)', (key) => {
    const checklist = { ...allTrue(), [key]: false };
    const blockers = checkG3Selection(input({ body: body({ checklist }) }));
    expect(blockers[0]).toEqual({
      code: 'CHECKLIST_INCOMPLETE',
      details: { uncheckedKeys: [key] },
    });
  });

  it('키가 빠져도 CHECKLIST_INCOMPLETE', () => {
    const checklist = allTrue();
    delete checklist.noTextOrPrice;
    expect(codes(input({ body: body({ checklist }) }))).toEqual(['CHECKLIST_INCOMPLETE']);
  });

  it('체크리스트 모양: 모르는 키·boolean 아닌 값은 422 VALIDATION_FAILED', () => {
    expect(() => assertChecklistShape(allTrue())).not.toThrow();
    for (const bad of [
      { ...allTrue(), aiLabel: true },
      { ...allTrue(), detailMatch: 'yes' },
    ]) {
      try {
        assertChecklistShape(bad);
        throw new Error('던지지 않았습니다');
      } catch (error) {
        expect((error as ApiException).code).toBe('VALIDATION_FAILED');
      }
    }
  });

  it('型番이 다른 레퍼런스 + 확인 없음 → SAME_PRODUCT_COLOR_CONFIRMATION_REQUIRED, 확인하면 통과', () => {
    expect(codes(input({ sameProductColorRequired: true }))).toEqual([
      'SAME_PRODUCT_COLOR_CONFIRMATION_REQUIRED',
    ]);
    expect(
      codes(
        input({ sameProductColorRequired: true, body: body({ sameProductColorConfirmed: true }) }),
      ),
    ).toEqual([]);
  });

  it('원본(ORIGINAL)을 대표로 → IMAGE_NOT_ALLOWED(NOT_GENERATED)', () => {
    const blockers = checkG3Selection(
      input({ images: [{ imageAssetId: 101, kind: 'ORIGINAL', fromThisRun: false }] }),
    );
    expect(blockers).toEqual([
      expect.objectContaining({
        code: 'IMAGE_NOT_ALLOWED',
        details: { imageAssetId: 101, reason: 'NOT_GENERATED' },
      }),
    ]);
    expect(blockers[0]!.message).toBe(
      '이 이미지는 여기에 쓸 수 없습니다(라쿠텐 원본·참조 전용 이미지는 대표·추가이미지로 고를 수 없습니다).',
    );
  });

  it('다른 ⑤ 버전의 생성본 → IMAGE_NOT_ALLOWED(OTHER_RUN)', () => {
    expect(
      checkG3Selection(
        input({ images: [{ imageAssetId: 101, kind: 'GENERATED', fromThisRun: false }] }),
      ),
    ).toEqual([
      expect.objectContaining({
        code: 'IMAGE_NOT_ALLOWED',
        details: { imageAssetId: 101, reason: 'OTHER_RUN' },
      }),
    ]);
  });

  it('없는 이미지 → IMAGE_ASSET_NOT_FOUND', () => {
    expect(
      codes(input({ images: [{ imageAssetId: 101, kind: null, fromThisRun: false }] })),
    ).toEqual(['IMAGE_ASSET_NOT_FOUND']);
  });

  it('추가 10장 → IMAGE_COUNT_INVALID(9장까지)', () => {
    const b = body({ additionalImageAssetIds: Array.from({ length: 10 }, (_, i) => 200 + i) });
    expect(codes(input({ body: b }))).toEqual(['IMAGE_COUNT_INVALID']);
    const nine = body({ additionalImageAssetIds: Array.from({ length: 9 }, (_, i) => 200 + i) });
    expect(codes(input({ body: nine }))).toEqual([]);
  });

  it('생성 중 → ALREADY_IN_PROGRESS(details.job=GENERATION)', () => {
    expect(checkG3Selection(input({ runningGenerations: 1 }))).toEqual([
      expect.objectContaining({
        code: 'ALREADY_IN_PROGRESS',
        details: { job: 'GENERATION', runningCount: 1 },
      }),
    ]);
  });

  it('순서: 체크리스트 → 장수 → 없는 이미지 → 쓸 수 없는 이미지 → 같은 상품·색상 → 생성 중', () => {
    const b = body({
      checklist: {},
      additionalImageAssetIds: Array.from({ length: 10 }, (_, i) => 200 + i),
    });
    expect(
      codes({
        body: b,
        images: [
          { imageAssetId: 101, kind: null, fromThisRun: false },
          { imageAssetId: 200, kind: 'ORIGINAL', fromThisRun: false },
        ],
        sameProductColorRequired: true,
        runningGenerations: 2,
      }),
    ).toEqual([
      'CHECKLIST_INCOMPLETE',
      'IMAGE_COUNT_INVALID',
      'IMAGE_ASSET_NOT_FOUND',
      'IMAGE_NOT_ALLOWED',
      'SAME_PRODUCT_COLOR_CONFIRMATION_REQUIRED',
      'ALREADY_IN_PROGRESS',
    ]);
  });
});

describe('선택본 값(P3-02 규칙 9·11·12)', () => {
  it('체크리스트 스냅샷 = 7개 true + version', () => {
    const snapshot = checklistSnapshot();
    expect(snapshot.version).toBe(G3_CHECKLIST_VERSION);
    for (const key of G3_CHECKLIST_KEYS) expect(snapshot[key]).toBe(true);
  });

  it('대표 REPRESENTATIVE·0, 추가 ADDITIONAL·1~', () => {
    expect(selectionImagesOf(5, [7, 6])).toEqual([
      { imageAssetId: 5, role: 'REPRESENTATIVE', sortOrder: 0 },
      { imageAssetId: 7, role: 'ADDITIONAL', sortOrder: 1 },
      { imageAssetId: 6, role: 'ADDITIONAL', sortOrder: 2 },
    ]);
  });

  it('선택본 해시: 대표·추가·순서가 바뀌면 달라지고, 없으면 null', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const base = selectionSetSha256([
      { sortOrder: 0, sha256: a },
      { sortOrder: 1, sha256: b },
    ]);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    // 입력 순서는 상관없다(sort_order로 정렬)
    expect(
      selectionSetSha256([
        { sortOrder: 1, sha256: b },
        { sortOrder: 0, sha256: a },
      ]),
    ).toBe(base);
    expect(
      selectionSetSha256([
        { sortOrder: 0, sha256: b },
        { sortOrder: 1, sha256: a },
      ]),
    ).not.toBe(base);
    expect(selectionSetSha256([{ sortOrder: 0, sha256: a }])).not.toBe(base);
    expect(selectionSetSha256([])).toBeNull();
  });
});

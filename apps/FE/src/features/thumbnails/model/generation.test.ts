import { describe, expect, it } from 'vitest';
import { generationSummary } from '@/test/fixtures/thumbnails';
import {
  candidateSummaryText,
  chooseRepresentative,
  EMPTY_PICK,
  emptyChecklist,
  G3_CHECKLIST_KEYS,
  G3_CHECKLIST_REASON,
  G3_GENERATING_REASON,
  G3_NOT_WAITING_REASON,
  G3_PICK_REASON,
  G3_SAME_PRODUCT_REASON,
  g3ChecklistItems,
  g3DisabledReason,
  g3PassBody,
  lowerFaceLabel,
  lowerFaceOption,
  pickFromSelection,
  resolutionLabel,
  samePick,
  slotCells,
  toggleAdditional,
  withAndParticle,
  type G3State,
  type ThumbnailPick,
} from './generation';

const allChecked = () =>
  Object.fromEntries(G3_CHECKLIST_KEYS.map((k) => [k, true])) as ReturnType<typeof emptyChecklist>;

describe('후보 칸(P3-02 CandidateGrid)', () => {
  it('번호마다 최신 회차를 보이고, 시도가 없는 번호도 N칸까지 만든다', () => {
    const runs = [
      generationSummary({ slotNo: 1, status: 'REFUSED' }),
      generationSummary({ slotNo: 1, attemptNo: 2, generationRunId: 711 }),
    ];
    const cells = slotCells(runs, 2);
    expect(cells.map((c) => [c.slotNo, c.latest?.generationRunId ?? null, c.attempts])).toEqual([
      [1, 711, 2],
      [2, null, 0],
    ]);
  });

  it("요약 줄: '14:20 생성 · 1:1 · 2K · 생성 거부 없음'(KST), 거부가 있으면 건수. 시도가 없으면 빈 글", () => {
    expect(candidateSummaryText([])).toBe('');
    expect(candidateSummaryText([generationSummary({ slotNo: 1 })])).toBe(
      '14:20 생성 · 1:1 · 2K · 생성 거부 없음',
    );
    expect(
      candidateSummaryText([
        generationSummary({ slotNo: 1, status: 'REFUSED' }),
        generationSummary({ slotNo: 2, startedAt: '2026-09-28T05:25:00.000Z' }),
      ]),
    ).toBe('14:25 생성 · 1:1 · 2K · 생성 거부 1건');
    expect(resolutionLabel(1024)).toBe('1K');
    expect(resolutionLabel(1500)).toBe('1500px');
  });

  it('얼굴 노출 낮추기: 전체 → 턱 아래 크롭 → 손·상반신만 → 없음, 버튼 글에 다음 단계 이름', () => {
    expect(lowerFaceOption('FULL_FACE')).toBe('CHIN_CROP');
    expect(lowerFaceOption('CHIN_CROP')).toBe('HANDS_UPPER_BODY');
    expect(lowerFaceOption('HANDS_UPPER_BODY')).toBeNull();
    expect(lowerFaceLabel('CHIN_CROP')).toBe('얼굴 노출을 낮춰 다시 만들기 · 턱 아래 크롭');
  });
});

describe('대표·추가 고르기(F-TH-16·17)', () => {
  it('대표를 고르면 추가에서 빠지고, 대표는 추가가 될 수 없다. 추가는 9장까지(고른 순서)', () => {
    let pick = toggleAdditional(EMPTY_PICK, 5);
    pick = toggleAdditional(pick, 6);
    expect(pick.additional).toEqual([5, 6]);
    pick = chooseRepresentative(pick, 5);
    expect(pick).toEqual({ representative: 5, additional: [6] });
    expect(toggleAdditional(pick, 5)).toBe(pick);
    expect(toggleAdditional(pick, 6).additional).toEqual([]);
    let many: ThumbnailPick = { representative: 1, additional: [] };
    for (let id = 10; id < 25; id += 1) many = toggleAdditional(many, id);
    expect(many.additional).toHaveLength(9);
  });

  it('저장된 선택으로 시작하고, 같은지 순서까지 본다', () => {
    const saved = pickFromSelection({
      thumbnailSelectionId: 1,
      checklist: { version: 'M1-1', ...allChecked() },
      sameProductColorConfirmedAt: null,
      selectedAt: '2026-09-28T05:24:00.000Z',
      images: [
        { imageAssetId: 8, role: 'ADDITIONAL', sortOrder: 1, fileUrl: '', generationRunId: 2 },
        { imageAssetId: 7, role: 'REPRESENTATIVE', sortOrder: 0, fileUrl: '', generationRunId: 1 },
      ],
    });
    expect(saved).toEqual({ representative: 7, additional: [8] });
    expect(samePick(saved, { representative: 7, additional: [8] })).toBe(true);
    expect(samePick(saved, { representative: 8, additional: [7] })).toBe(false);
    expect(pickFromSelection(null)).toEqual(EMPTY_PICK);
  });
});

describe('G3 체크리스트(F-TH-14·15)', () => {
  it("7개 문구는 보드 그대로 — '색상이 크림/블랙과 같음'(받침에 맞춘 조사)", () => {
    expect(g3ChecklistItems('크림/블랙').map((i) => i.label)).toEqual([
      '신발 비중 70% 이상',
      '디테일 일치',
      '색상이 크림/블랙과 같음',
      '레퍼런스에 사람 없음',
      '실존 인물 연상 없음',
      '이미지 속 문구·가격 없음',
      '상품 1개 · 모델 1명',
    ]);
    expect(withAndParticle('화이트')).toBe('화이트와');
    expect(withAndParticle('108')).toBe('108과');
    expect(g3ChecklistItems(null)[2]!.label).toBe('색상이 선택 색상과 같음');
  });

  const state = (patch: Partial<G3State> = {}): G3State => ({
    stepRunStatus: 'WAITING_INPUT',
    running: false,
    pick: { representative: 901, additional: [] },
    checklist: allChecked(),
    sameProductColorRequired: false,
    sameProductConfirmed: false,
    passedSame: false,
    ...patch,
  });

  it('꺼진 이유 순서: ⑤ 상태 → 생성 중 → 대표 → 체크리스트 → 같은 상품·색상, 모두 되면 null', () => {
    expect(g3DisabledReason(state())).toBeNull();
    expect(g3DisabledReason(state({ stepRunStatus: 'RUNNING' }))).toBe(G3_NOT_WAITING_REASON);
    expect(g3DisabledReason(state({ running: true }))).toBe(G3_GENERATING_REASON);
    expect(g3DisabledReason(state({ pick: EMPTY_PICK }))).toBe(G3_PICK_REASON);
    for (const key of G3_CHECKLIST_KEYS) {
      expect(g3DisabledReason(state({ checklist: { ...allChecked(), [key]: false } }))).toBe(
        G3_CHECKLIST_REASON,
      );
    }
    expect(g3DisabledReason(state({ sameProductColorRequired: true }))).toBe(
      G3_SAME_PRODUCT_REASON,
    );
    expect(
      g3DisabledReason(state({ sameProductColorRequired: true, sameProductConfirmed: true })),
    ).toBeNull();
  });

  it('통과 본문: 대표·추가·체크리스트, 같은 상품·색상은 확인했을 때만', () => {
    expect(
      g3PassBody(103, { representative: 901, additional: [902] }, allChecked(), false),
    ).toEqual({
      basisStepRunId: 103,
      representativeImageAssetId: 901,
      additionalImageAssetIds: [902],
      checklist: allChecked(),
    });
    expect(
      g3PassBody(103, { representative: 901, additional: [] }, allChecked(), true)
        .sameProductColorConfirmed,
    ).toBe(true);
  });
});

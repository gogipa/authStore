import type { components } from '@/shared/api/schema';
import { formatKstTime } from '@/shared/lib/format';
import { FACE_OPTION_LABEL, type ThumbnailFaceOption } from './thumbnails';

export type ThumbnailOutput = components['schemas']['ThumbnailOutput'];
export type ThumbnailGenerationSummary = components['schemas']['ThumbnailGenerationSummary'];
export type GenerationRunDetail = components['schemas']['GenerationRunDetail'];
export type GenerationRunCreateRequest = components['schemas']['GenerationRunCreateRequest'];
export type GenerationRunAccepted = components['schemas']['GenerationRunAccepted'];
export type GateThumbnailChecklist = components['schemas']['GateThumbnailChecklist'];
export type G3ChecklistKey = keyof GateThumbnailChecklist;

/**
 * ⑤ 썸네일 생성·비교·선택(G3) 표시 규칙(P3-02, SCR-05 Thumbnail.dc.html). 생성·G3 규칙은 서버가 본다 — 여기서는 보드 문구,
 * 후보 칸, 대표·추가 고르기, 버튼 켜짐을 정한다. 신발 비중·디테일 검사·'AI 생성' 칩은 M2라 그리지 않는다.
 */

/** 보드 문구 */
export const CANDIDATE_GRID_TITLE = '썸네일 후보';
export const REGENERATE_LABEL = '다시 만들기';
export const REPRESENTATIVE_LABEL = '대표';
export const ADDITIONAL_LABEL = '추가';
export const SIDE_BY_SIDE_TITLE = '레퍼런스와 나란히 보기';
export const G3_CHECKLIST_TITLE = '선택 전 확인';
export const G3_PASS_LABEL = '썸네일 선택(G3)';
export const G3_REPICK_NOTE = '레퍼런스·선택본·앵커 키가 바뀌면 다시 골라야 합니다.';
export const NEXT_CONTENT_LABEL = '다음: ⑥ 상세 콘텐츠';
export const SAME_PRODUCT_NOTE =
  "레퍼런스가 이 후보의 라쿠텐 상품(같은 앵커 키) 이미지라서 '같은 상품·색상' 확인은 따로 받지 않습니다.";
export const SAME_PRODUCT_LABEL = '같은 상품·색상 확인';
export const SAME_PRODUCT_DESCRIPTION =
  '레퍼런스 가운데 이 후보의 앵커 키(型番·색상)와 다르거나 색상을 알 수 없는 원본이 있습니다. 같은 상품·색상인지 확인해 주세요.';

/** 보드에 없는 문구(P3-02 Proposed) */
export const SLOT_EMPTY_TEXT = '아직 만들지 않았습니다';
export const SLOT_RUNNING_TEXT = '생성 중';
export const SLOT_FAILED_TITLE = '생성 실패';
export const SLOT_REFUSED_TITLE = '생성 거부';
export const GRID_EMPTY_TEXT = "레퍼런스를 확인한 뒤 '만들기'를 누르면 후보가 여기에 나옵니다.";
export const LOWEST_FACE_TEXT =
  '얼굴 노출을 더 낮출 수 없습니다. 프롬프트를 고쳐 다시 만들어 주세요.';
export const SIDE_BY_SIDE_EMPTY_TEXT = '대표로 고른 후보가 여기에 레퍼런스와 나란히 보입니다.';
export const G3_NOT_WAITING_REASON = '⑤가 입력 대기이거나 완료일 때 고를 수 있습니다.';
export const G3_GENERATING_REASON = '생성 중인 후보가 끝난 뒤 고를 수 있습니다.';
export const G3_PICK_REASON = '대표이미지로 쓸 후보를 골라 주세요.';
export const G3_CHECKLIST_REASON = '7개를 모두 확인해 주세요.';
export const G3_SAME_PRODUCT_REASON = "'같은 상품·색상'을 확인해 주세요.";
export const G3_SAME_AS_PASSED_REASON = '지금 선택으로 G3을 통과했습니다.';
export const G3_REPICK_CAPTION = '다시 고르면 ⑤의 새 버전이 생기고 ⑧ 업로드를 다시 해야 합니다.';
export const G3_INVALID_TEXT = '레퍼런스·선택본·앵커 키가 바뀌어 G3을 다시 통과해야 합니다.';

/** 추가이미지 최대 장수(RG-08) */
export const ADDITIONAL_MAX = 9;

/** 받침이 있으면 '과', 없으면 '와'(한글이 아니면 '과') */
export function withAndParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}과`;
  return `${word}${(last - 0xac00) % 28 === 0 ? '와' : '과'}`;
}

/** G3 체크리스트 7개(보드 순서·문구 그대로 — '색상이 {선택 색상}과 같음') */
export function g3ChecklistItems(
  selectedColor: string | null | undefined,
): { key: G3ChecklistKey; label: string }[] {
  const color = selectedColor?.trim() || '선택 색상';
  return [
    { key: 'shoeRatioOver70', label: '신발 비중 70% 이상' },
    { key: 'detailMatch', label: '디테일 일치' },
    { key: 'colorMatchesSelectedColor', label: `색상이 ${withAndParticle(color)} 같음` },
    { key: 'referenceNoPerson', label: '레퍼런스에 사람 없음' },
    { key: 'noRealPersonResemblance', label: '실존 인물 연상 없음' },
    { key: 'noTextOrPrice', label: '이미지 속 문구·가격 없음' },
    { key: 'singleProductSingleModel', label: '상품 1개 · 모델 1명' },
  ];
}

export const G3_CHECKLIST_KEYS: readonly G3ChecklistKey[] = g3ChecklistItems(null).map(
  (item) => item.key,
);

export type G3ChecklistState = Record<G3ChecklistKey, boolean>;

export function emptyChecklist(): G3ChecklistState {
  return Object.fromEntries(G3_CHECKLIST_KEYS.map((key) => [key, false])) as G3ChecklistState;
}

export function checklistComplete(state: G3ChecklistState): boolean {
  return G3_CHECKLIST_KEYS.every((key) => state[key]);
}

/** 해상도 글('1K' — 1024의 배수면 K, 아니면 px. 기본 1024 — D-21) */
export function resolutionLabel(px: number): string {
  return px % 1024 === 0 ? `${px / 1024}K` : `${px}px`;
}

/** 얼굴 노출 한 단계 낮추기(F-TH-09): 전체 → 턱 아래 크롭 → 손·상반신만 → 없음 */
export function lowerFaceOption(face: ThumbnailFaceOption): ThumbnailFaceOption | null {
  if (face === 'FULL_FACE') return 'CHIN_CROP';
  if (face === 'CHIN_CROP') return 'HANDS_UPPER_BODY';
  return null;
}

/** '얼굴 노출을 낮춰 다시 만들기 · 턱 아래 크롭'(다음 단계 이름) */
export function lowerFaceLabel(next: ThumbnailFaceOption): string {
  return `얼굴 노출을 낮춰 다시 만들기 · ${FACE_OPTION_LABEL[next]}`;
}

/** 후보 칸 하나: 번호의 최신 시도(회차 최대) */
export interface SlotCell {
  slotNo: number;
  latest: ThumbnailGenerationSummary | null;
  attempts: number;
}

/** 후보 칸 N개(1..N, N = 설정 후보 수 — 시도가 N보다 큰 번호에 있으면 그 번호까지) */
export function slotCells(
  runs: readonly ThumbnailGenerationSummary[],
  candidateCount: number,
): SlotCell[] {
  const maxSlot = runs.reduce((acc, run) => Math.max(acc, run.slotNo), candidateCount);
  return Array.from({ length: maxSlot }, (_, i) => {
    const slotNo = i + 1;
    const mine = runs.filter((run) => run.slotNo === slotNo);
    const latest = mine.reduce<ThumbnailGenerationSummary | null>(
      (acc, run) => (acc === null || run.attemptNo > acc.attemptNo ? run : acc),
      null,
    );
    return { slotNo, latest, attempts: mine.length };
  });
}

/** 생성 중인 번호가 있는가 */
export function hasRunning(runs: readonly ThumbnailGenerationSummary[]): boolean {
  return runs.some((run) => run.status === 'RUNNING');
}

/**
 * 후보 패널 요약 줄('14:20 생성 · 1:1 · 1K · 생성 거부 없음' — 보드의 '2K'는 D-21로 기본 1K, M2 '비중·디테일 자동 검사'는 뺀다).
 * 해상도는 최신 시도의 요청값이다(업로드 크기 1000×1000은 ⑧이 맞춘다). 시도가 없으면 ''
 */
export function candidateSummaryText(runs: readonly ThumbnailGenerationSummary[]): string {
  if (runs.length === 0) return '';
  const latest = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)!;
  const refused = runs.filter((run) => run.status === 'REFUSED').length;
  return [
    `${formatKstTime(latest.startedAt)} 생성`,
    '1:1',
    resolutionLabel(latest.requestedSizePx),
    refused === 0 ? '생성 거부 없음' : `생성 거부 ${refused}건`,
  ].join(' · ');
}

/** 대표·추가 고르기 */
export interface ThumbnailPick {
  representative: number | null;
  additional: number[];
}

export const EMPTY_PICK: ThumbnailPick = { representative: null, additional: [] };

/** 저장된 G3 선택(있으면)으로 시작한다 */
export function pickFromSelection(
  selection: ThumbnailOutput['selection'] | undefined,
): ThumbnailPick {
  if (!selection) return EMPTY_PICK;
  const images = [...selection.images].sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    representative: images.find((image) => image.role === 'REPRESENTATIVE')?.imageAssetId ?? null,
    additional: images.filter((i) => i.role === 'ADDITIONAL').map((i) => i.imageAssetId),
  };
}

/** 대표 고르기: 추가에 있던 것이면 추가에서 뺀다 */
export function chooseRepresentative(pick: ThumbnailPick, imageAssetId: number): ThumbnailPick {
  return {
    representative: imageAssetId,
    additional: pick.additional.filter((id) => id !== imageAssetId),
  };
}

/** 추가 넣고 빼기(대표는 추가가 될 수 없다, 9장까지 — 고른 순서가 추가 순서) */
export function toggleAdditional(pick: ThumbnailPick, imageAssetId: number): ThumbnailPick {
  if (pick.representative === imageAssetId) return pick;
  if (pick.additional.includes(imageAssetId)) {
    return { ...pick, additional: pick.additional.filter((id) => id !== imageAssetId) };
  }
  if (pick.additional.length >= ADDITIONAL_MAX) return pick;
  return { ...pick, additional: [...pick.additional, imageAssetId] };
}

/** 고른 것이 저장된 선택과 같은가(순서 포함) */
export function samePick(a: ThumbnailPick, b: ThumbnailPick): boolean {
  return (
    a.representative === b.representative &&
    a.additional.length === b.additional.length &&
    a.additional.every((id, i) => id === b.additional[i])
  );
}

export interface G3State {
  /** ⑤ 현재 버전 상태(없으면 null) */
  stepRunStatus: ThumbnailOutput['stepRunStatus'] | null;
  running: boolean;
  pick: ThumbnailPick;
  checklist: G3ChecklistState;
  sameProductColorRequired: boolean;
  sameProductConfirmed: boolean;
  /** 지금 고른 것이 유효한 G3 통과의 선택과 같은가(다시 보낼 필요 없음) */
  passedSame: boolean;
}

/** 'G3 통과' 버튼 꺼진 이유(순서: ⑤ 상태 → 생성 중 → 대표 → 이미 통과 → 체크리스트 → 같은 상품·색상). 켜지면 null */
export function g3DisabledReason(state: G3State): string | null {
  if (state.stepRunStatus !== 'WAITING_INPUT' && state.stepRunStatus !== 'COMPLETED') {
    return G3_NOT_WAITING_REASON;
  }
  if (state.running) return G3_GENERATING_REASON;
  if (state.pick.representative === null) return G3_PICK_REASON;
  if (state.passedSame) return G3_SAME_AS_PASSED_REASON;
  if (!checklistComplete(state.checklist)) return G3_CHECKLIST_REASON;
  if (state.sameProductColorRequired && !state.sameProductConfirmed) return G3_SAME_PRODUCT_REASON;
  return null;
}

/** G3 통과 본문(05-2 GatePassG3Request) */
export function g3PassBody(
  basisStepRunId: number,
  pick: ThumbnailPick,
  checklist: G3ChecklistState,
  sameProductConfirmed: boolean,
): components['schemas']['GatePassG3Request'] {
  return {
    basisStepRunId,
    representativeImageAssetId: pick.representative ?? 0,
    additionalImageAssetIds: [...pick.additional],
    checklist: { ...checklist },
    ...(sameProductConfirmed ? { sameProductColorConfirmed: true } : {}),
  };
}

/** 모든 번호(1..N) */
export function allSlots(candidateCount: number): number[] {
  return Array.from({ length: candidateCount }, (_, i) => i + 1);
}

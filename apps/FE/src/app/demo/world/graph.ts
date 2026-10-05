import type { DemoWorld } from '../demoWorld';
import { STORY } from '../sample/story';
import type { InputValue, InputValues } from './state';
import { STEP_FLOW, type StepCode } from './steps';

/**
 * 단계 입력 그래프(D-32 리뷰 뒤): 어느 단계가 앞 단계의 어떤 산출물을 읽는지, 그리고 그 값이 지금 무엇인지.
 * '재실행 필요' 전파(`engine.ts`의 `propagateFromStep`·`ownerInputChanged`)가 이 표 하나로 돈다 — 단계마다 손으로 고치는 곳이 없다.
 * 근거: BE `step-engine/domain/{steps.ts STEP_GRAPH, step-graph.ts STEP_INPUT_SPECS, input-keys.ts}`와
 * `propagation/propagation.service.ts`.
 *
 * - 앞 단계 산출물(`PREV_STEP`)은 그 단계의 **현재 버전이 완료일 때만** 읽는다(BE `currentCompletedRun`) — 아니면 값이 없다(null).
 * - 단계가 끝날 때마다 읽은 입력을 그 실행에 적어 두고, 앞 단계가 새 버전을 내면 바로 뒤 단계가 지금 값과 견줘 달라진 것만
 *   '재실행 필요'로 둔다(바로 뒤 단계만 — 그 단계를 다시 실행해 값이 달라지면 그 뒤로 번진다).
 * - 설정·환율·구매대행 프로필 입력(`settings.*`·`fx.*`·`profile.*`)은 체험에서 바꿀 수 없어(설정 저장은 403) 싣지 않았다.
 * - 예시 한 가지라 값이 정해진 곳(② 소싱·⑥-1·⑥-2의 산출물)은 다시 실행해도 값이 같다. 사용자가 고른 값(③ 국내 기준가·④ 리프·
 *   ⑤ 선택본)이 바뀔 때만 뒤 단계가 낡아진다.
 */

/** 단계가 직접 읽는 앞 단계(BE `STEP_GRAPH.requires`·`optional`). ⑨는 등록 기록이 원본이라 전파에서 빠진다 */
const READS: Readonly<
  Record<StepCode, { requires: readonly StepCode[]; optional: readonly StepCode[] }>
> = {
  SOURCING: { requires: [], optional: [] },
  PRICING: { requires: ['SOURCING'], optional: [] },
  CATEGORY: { requires: ['SOURCING'], optional: [] },
  THUMBNAIL: { requires: ['SOURCING'], optional: [] },
  COPY: { requires: ['SOURCING'], optional: [] },
  NOTICE_RAW: { requires: ['SOURCING'], optional: [] },
  NOTICE_HTML: { requires: ['SOURCING', 'COPY', 'NOTICE_RAW', 'PRICING'], optional: ['CATEGORY'] },
  TAGS: { requires: ['SOURCING'], optional: ['CATEGORY'] },
  UPLOAD: { requires: ['THUMBNAIL', 'NOTICE_HTML'], optional: [] },
  REGISTER: { requires: [], optional: [] },
};

/** 필수 앞 단계(현재 버전이 완료여야 시작한다) */
export const requiredReads = (code: StepCode): readonly StepCode[] => READS[code].requires;

/** 직접 읽는 앞 단계(필수 + 선택) */
export const readsOf = (code: StepCode): StepCode[] => [
  ...READS[code].requires,
  ...READS[code].optional,
];

/** 이 단계의 산출물을 직접 읽는 뒤 단계(⑨ 제외). '재실행 필요' 전파가 다시 견주는 단계다 */
export const directReaders = (code: StepCode): StepCode[] =>
  STEP_FLOW.filter((other) => other !== 'REGISTER' && readsOf(other).includes(code));

/** 입력 하나의 선언 */
interface InputDecl {
  key: string;
  /** 값이 어디서 오나: 앞 단계 산출물 · 여정 필드 · 오너 입력 */
  kind: 'PREV_STEP' | 'CANDIDATE' | 'OWNER_INPUT';
  /** `PREV_STEP`일 때 산출물을 내는 단계 */
  from?: StepCode;
  /** 시작 조건이다(지문에 든다). false = 실행 중 오너 입력 */
  start: boolean;
}

const prev = (key: string, from: StepCode): InputDecl => ({
  key,
  kind: 'PREV_STEP',
  from,
  start: true,
});
const candidate = (key: string): InputDecl => ({ key, kind: 'CANDIDATE', start: true });
const ownerStart = (key: string): InputDecl => ({ key, kind: 'OWNER_INPUT', start: true });
const ownerRuntime = (key: string): InputDecl => ({ key, kind: 'OWNER_INPUT', start: false });

/** 단계마다 읽는 입력(BE `STEP_INPUT_SPECS`의 앞 단계·여정·오너 입력만) */
export const STEP_INPUTS: Readonly<Record<StepCode, readonly InputDecl[]>> = {
  SOURCING: [],
  // 실행 중 오너 입력: 국내 기준가
  PRICING: [
    prev('sourcing.targetSkus', 'SOURCING'),
    candidate('candidate.gender'),
    ownerRuntime('owner.domesticPrice'),
  ],
  CATEGORY: [prev('sourcing.genre', 'SOURCING'), candidate('candidate.gender')],
  // ② 완료는 시작 조건이지만 ② 값은 지문에 넣지 않는다(BE COMPLETION_ONLY_INPUTS). 실행 중 오너 입력: 레퍼런스 선택
  THUMBNAIL: [ownerRuntime('owner.referenceSelection')],
  COPY: [prev('sourcing.itemText', 'SOURCING'), prev('sourcing.skuAttributes', 'SOURCING')],
  NOTICE_RAW: [
    prev('sourcing.selection', 'SOURCING'),
    prev('sourcing.attributes', 'SOURCING'),
    prev('sourcing.selectedColor', 'SOURCING'),
  ],
  NOTICE_HTML: [
    prev('copy.draft', 'COPY'),
    prev('noticeRaw.facts', 'NOTICE_RAW'),
    prev('pricing.saleSizes', 'PRICING'),
    prev('sourcing.modelInfo', 'SOURCING'),
    // ④ 리프 경로는 선택 입력이다: ④가 끝나 있으면 상품명이 읽고, 아니면 없이 실행한다
    prev('category.leafPath', 'CATEGORY'),
    candidate('candidate.gender'),
    candidate('candidate.anchorKey'),
    candidate('candidate.seedKeyword'),
  ],
  TAGS: [
    candidate('candidate.seedKeyword'),
    prev('sourcing.modelInfo', 'SOURCING'),
    candidate('candidate.gender'),
    ownerStart('owner.competitorTags'),
    prev('category.leafPath', 'CATEGORY'),
  ],
  UPLOAD: [prev('thumbnail.selection', 'THUMBNAIL'), prev('noticeHtml.html', 'NOTICE_HTML')],
  REGISTER: [],
};

/** 단계가 내는 산출물 키(뒤 단계가 이 단계에서 읽는 키 전부 + ⑨가 읽는 키) */
export const OUTPUT_KEYS: Readonly<Record<StepCode, readonly string[]>> = {
  SOURCING: [
    'sourcing.targetSkus',
    'sourcing.genre',
    'sourcing.images',
    'sourcing.itemText',
    'sourcing.skuAttributes',
    'sourcing.selection',
    'sourcing.attributes',
    'sourcing.selectedColor',
    'sourcing.modelInfo',
  ],
  PRICING: ['pricing.saleSizes', 'pricing.judgement'],
  CATEGORY: ['category.leafPath'],
  THUMBNAIL: ['thumbnail.selection'],
  COPY: ['copy.draft'],
  NOTICE_RAW: ['noticeRaw.facts'],
  NOTICE_HTML: ['noticeHtml.html'],
  TAGS: ['tags.final'],
  UPLOAD: ['upload.result'],
  REGISTER: [],
};

/** 입력 키를 화면 글로 (BE `inputKeyLabel` 일부) */
export const INPUT_LABEL: Readonly<Record<string, string>> = {
  'candidate.gender': '성별',
  'candidate.anchorKey': '기준 상품',
  'candidate.seedKeyword': '시드 키워드',
  'sourcing.targetSkus': '② 목표 사이즈 SKU가·재고',
  'sourcing.genre': '② 장르·상품유형',
  'sourcing.itemText': '② 상품명·설명',
  'sourcing.skuAttributes': '② SKU 속성',
  'sourcing.selection': '② 소싱 선택',
  'sourcing.attributes': '② 속성·설명·스펙 이미지',
  'sourcing.selectedColor': '② 선택 색상',
  'sourcing.modelInfo': '② 모델명·상품유형',
  'pricing.saleSizes': '③ 판매 사이즈',
  'category.leafPath': '④ 리프 카테고리',
  'thumbnail.selection': '⑤ 선택본',
  'copy.draft': '⑥-1 카피',
  'noticeRaw.facts': '⑥-2 원산지·소재',
  'noticeHtml.html': '⑥-3 HTML',
  'owner.domesticPrice': '국내 기준가',
  'owner.competitorTags': '경쟁 태그',
  'owner.referenceSelection': '레퍼런스 선택',
};

// ── 값 읽기 ─────────────────────────────────────────────────────────────────

/** 앞 단계의 현재 버전이 완료일 때만 그 산출물 값을 읽는다(BE `currentCompletedRun`) */
function previousOutput(w: DemoWorld, from: StepCode, key: string): InputValue {
  const rec = w.s.steps[from];
  const run = rec.runs[rec.runs.length - 1];
  if (rec.status !== 'COMPLETED' || !run) return { sig: null, sourceRunId: null };
  return { sig: run.outputs?.[key] ?? null, sourceRunId: run.id };
}

/** 여정 필드·오너 입력의 지금 값 */
function directValue(w: DemoWorld, key: string): string | null {
  const c = w.s.candidate;
  switch (key) {
    case 'candidate.gender':
      return c?.gender ?? null;
    case 'candidate.anchorKey':
      return c && (c.anchorModelCode ?? c.anchorItemCode)
        ? `${c.anchorModelCode ?? ''}|${c.anchorItemCode ?? ''}|${c.anchorColorCode ?? ''}`
        : null;
    case 'candidate.seedKeyword':
      return c?.sourceKeyword ?? null;
    case 'owner.domesticPrice': {
      const latest = w.s.pricing.domesticPrices[0];
      return latest ? String(latest.pRefKrw) : null;
    }
    case 'owner.referenceSelection': {
      const refs = w.s.thumbnail.references;
      return refs.length > 0 ? refs.map((ref) => ref.imageAssetId).join(',') : null;
    }
    default:
      // 경쟁 태그처럼 체험에서 넣을 수 없는 입력은 늘 비어 있다
      return null;
  }
}

/** 이 단계가 지금 읽는 입력 전부(앞 단계 산출물은 현재 버전이 완료일 때만) */
export function readInputs(w: DemoWorld, code: StepCode): InputValues {
  const out: InputValues = {};
  for (const decl of STEP_INPUTS[code]) {
    out[decl.key] =
      decl.kind === 'PREV_STEP'
        ? previousOutput(w, decl.from!, decl.key)
        : { sig: directValue(w, decl.key), sourceRunId: null };
  }
  return out;
}

/** 시작 조건 입력 키(지문에 드는 것) */
export const startKeys = (code: StepCode): string[] =>
  STEP_INPUTS[code].filter((decl) => decl.start).map((decl) => decl.key);

/** 입력 키의 출처 종류(낡음 비교표의 `sourceType`) */
export function sourceTypeOf(code: StepCode, key: string): 'PREV_STEP' | 'OWNER_INPUT' {
  const decl = STEP_INPUTS[code].find((d) => d.key === key);
  return decl?.kind === 'PREV_STEP' ? 'PREV_STEP' : 'OWNER_INPUT';
}

/** 값이 달라진 입력 키(저장된 값과 지금 값을 견준다. 한쪽에만 있으면 없는 쪽은 null) */
export function changedKeys(
  stored: InputValues | undefined,
  current: InputValues,
  keys: readonly string[],
): string[] {
  return keys.filter((key) => (stored?.[key]?.sig ?? null) !== (current[key]?.sig ?? null));
}

// ── 산출물 값 ───────────────────────────────────────────────────────────────

/**
 * 산출물 값이 **실제로 읽는** 입력(BE 근거). 적지 않은 산출물은 이 실행이 읽은 입력 전부에 따라 달라진다(⑥-1 카피·⑥-2 원자료·
 * ⑦ 태그·⑧ 업로드 결과가 그렇다). 단계가 입력을 읽어도 산출물 값에는 안 드는 경우만 여기에 적는다:
 * - `noticeHtml.html`(⑥-3 `html_sha256`, 뒤 단계 ⑧이 읽는 값): 고지 → 이미지 자리표시자 → 카피 → 사양 블록을 이어 붙인 HTML이라
 *   ⑥-1 카피(`copy.draft`)·⑥-2 원자료(`noticeRaw.facts`)·③ 판매 사이즈(`pricing.saleSizes`, 사양 블록의 사이즈 칸)만 든다. ④ 리프 경로
 *   (`category.leafPath`)는 **상품명**(`productType`)에만 들고 HTML에는 안 들며, 여정 성별·② 모델명도 고시 칸·상품명에만 든다
 *   (BE `content/assembly/assemble.ts`·`html/detail-html.builder.ts`, ⑧ 입력은 `registration/upload/upload-inputs.ts`).
 *   그래서 ④ 리프가 바뀌어 ⑥-3이 '재실행 필요'가 되어도 다시 실행하면 HTML 값이 같아 ⑧은 낡지 않는다.
 */
const OUTPUT_DEPENDS: Readonly<Record<string, readonly string[]>> = {
  'noticeHtml.html': ['copy.draft', 'noticeRaw.facts', 'pricing.saleSizes'],
};

/**
 * 단계를 끝낼 때 낸 산출물의 값 글. 기본은 '읽은 입력이 같으면 같은 결과'(산출물이 읽는 입력 글을 이어 붙인 글, `OUTPUT_DEPENDS`)이고,
 * 사용자가 골라서 정해지는 값은 그 선택을 그대로 쓴다:
 * - ② 소싱: 예시 상품·색상 하나
 * - ③ 판정: 판매 사이즈(예시는 늘 같다)와 판정(국내 기준가) — 사이즈 목록이 같으면 판매가만 바뀌어도 ⑥-3은 낡지 않는다(BE `saleSizesMm`)
 * - ④ 카테고리: 고른 리프의 전체 이름(`candidate.wholeCategoryName`)
 * - ⑤ 썸네일: 대표·추가 선택(순서 포함)과, 그 이미지를 만든 ⑤ 실행(다시 실행하면 새 이미지라 선택 글도 달라진다)
 */
export function outputsOf(
  w: DemoWorld,
  code: StepCode,
  inputs: InputValues,
): Record<string, string> {
  const textOf = (keys: readonly string[]) =>
    keys.map((key) => `${key}=${inputs[key]?.sig ?? '-'}`).join(';');
  const out: Record<string, string> = {};
  for (const key of OUTPUT_KEYS[code]) {
    out[key] = `${key}#${textOf(OUTPUT_DEPENDS[key] ?? Object.keys(inputs))}`;
  }
  const c = w.s.candidate;
  switch (code) {
    case 'SOURCING':
      for (const key of OUTPUT_KEYS.SOURCING) {
        out[key] = `${key}#${c?.itemCode ?? '-'}|${c?.selectedColor ?? '-'}`;
      }
      break;
    case 'PRICING': {
      const latest = w.s.pricing.domesticPrices[0];
      out['pricing.saleSizes'] = `sizes#${STORY.saleSizesMm.join(',')}`;
      out['pricing.judgement'] = `judgement#${latest?.pRefKrw ?? '-'}`;
      break;
    }
    case 'CATEGORY':
      out['category.leafPath'] = `leaf#${c?.wholeCategoryName ?? '-'}`;
      break;
    case 'THUMBNAIL': {
      const selection = w.s.thumbnail.selection;
      out['thumbnail.selection'] = selection
        ? `selection#${w.s.thumbnail.generationRunId ?? '-'}:${selection.representativeImageAssetId}:${selection.additionalImageAssetIds.join(',')}`
        : 'selection#-';
      break;
    }
    default:
      break;
  }
  return out;
}

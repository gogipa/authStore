import {
  COPY_DOC,
  contentAssemblyOutput,
  contentCopyOutput,
  contentField,
  contentFactOutput,
  factFields,
} from '@/test/fixtures/content';
import type { DemoWorld } from '../demoWorld';
import { DEMO_IMAGE_ID, demoImageUrl } from '../images';
import type { RunRec } from '../world/state';
import { fillShop } from './shop';
import { STORY } from './story';
import type { Ok, Schema } from './types';
import { fakeSha256 } from './util';

type ContentDraftFieldItem = Schema<'ContentDraftFieldItem'>;

const iso = (ms: number): string => new Date(ms).toISOString();

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * ⑥-3 조립 결과 본문(설정 템플릿 v M1-2026-09-24로 채운 사양·고지 블록 — fixture 값). ⑥-2가 안감도 읽었으므로 고시·사양 블록의
 * 소재에 안감을 넣는다. 실행마다 바뀌는 칸(id·버전·시각)은 `contentAssembly`가 덮는다.
 */
function assemblyBase() {
  const out = contentAssemblyOutput({ candidateId: 1 });
  const material = '겉감 합성섬유·합성가죽 / 안감 합성섬유 / 밑창 고무';
  return {
    ...out,
    noticeFields: { ...out.noticeFields, material } as Record<string, unknown>,
    specBlockHtml: out.specBlockHtml.replace('겉감 합성섬유·합성가죽 / 밑창 고무', material),
  };
}

/** SHOES 고시(⑥-3) — 승인 미리보기가 같은 값을 보인다 */
export function noticeFields(): Record<string, unknown> {
  return assemblyBase().noticeFields;
}

/**
 * 상세 HTML 본문(⑥-3 조립 = ⑧이 올린 상세). 이미지 자리 0·1은 ⑤에서 고른 대표·추가 이미지다. `imageSrc`가 자리별 주소를 준다
 * (⑥-3 미리보기 = 앱에 묶은 그림의 절대 주소, ⑧·승인 = 업로드 주소).
 */
export function detailHtml(imageSrc: readonly [string, string]): string {
  const out = assemblyBase();
  const copy = COPY_DOC;
  const blocks = out.disclosureBlocks
    .map((b) => `<p data-block-id="${b.blockId}">${escapeHtml(b.text)}</p>`)
    .join('');
  return [
    '<div data-autostore-detail="v1">',
    `<p data-autostore-image-slot="0"><img src="${imageSrc[0]}" alt="대표 이미지"></p>`,
    `<h2>${escapeHtml(copy.headline)}</h2>`,
    `<ul>${copy.selling_points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`,
    `<p>${escapeHtml(copy.body)}</p>`,
    `<p data-autostore-image-slot="1"><img src="${imageSrc[1]}" alt="추가 이미지 1"></p>`,
    `<p>${escapeHtml(copy.fit_and_styling)}</p>`,
    `<p>${escapeHtml(copy.size_guide)}</p>`,
    out.specBlockHtml,
    `<div data-autostore-section="DISCLOSURE">${blocks}</div>`,
    '</div>',
  ].join('');
}

/** 화면 출처(체험은 브라우저 안에서만 돈다). 모르면 빈 글자 */
function currentOrigin(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origin && origin !== 'null' ? origin : '';
}

/**
 * ⑥-3 미리보기 문서(서버 미리보기와 같은 제한: CSP로 앱 출처 그림만 허용). 이미지는 앱 출처의 절대 주소라 sandbox iframe(고유
 * 출처)에서도 보인다.
 */
export function detailPreviewDocument(): string {
  const origin = currentOrigin();
  const body = detailHtml([
    `${origin}${demoImageUrl(DEMO_IMAGE_ID.generated1)}`,
    `${origin}${demoImageUrl(DEMO_IMAGE_ID.generated2)}`,
  ]);
  const html = [
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${origin || "'none'"}; style-src 'unsafe-inline'">`,
    '<style>body{margin:12px;font:14px/1.6 system-ui,sans-serif;color:#1f1f1f}img{max-width:100%;height:auto}h2{font-size:18px}</style>',
    `</head><body>${body}</body></html>`,
  ].join('');
  return fillShop(html);
}

/**
 * ⑥-3 미리보기 주소: 서버 미리보기(`/api/v1/…/preview`) 대신 부를 때마다 만드는 data: 문서(화면이 iframe `src`로 그대로 연다).
 */
export function detailPreviewUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(detailPreviewDocument())}`;
}

/** ⑥-1 카피 한 버전. 화면은 AI 원 결과(`generatedCopy`)와 유효 카피(`copy`)가 같은 처음 상태를 본다 */
export function contentCopy(
  w: DemoWorld,
  run: RunRec,
  isCurrent: boolean,
): Ok<'/candidates/{candidateId}/content-copy'> {
  return contentCopyOutput({
    stepRunId: run.id,
    candidateId: w.candidate().id,
    version: run.version,
    stepRunStatus: run.status,
    isCurrent,
    contentDraftCopyId: run.id,
    createdAt: iso(run.endedAt ?? w.now()),
  });
}

/** ⑥-2 사실 필드를 ショップA 설명 글(sample/sourcing)과 맞춘다: 안감·밑창도 설명 문장에서 읽었다 */
const FACT_PATCH: Readonly<Record<string, Partial<ContentDraftFieldItem>>> = {
  'fact.material_lining': {
    value: '합성섬유',
    generatedValue: '합성섬유',
    extractionMethod: 'DESCRIPTION_PATTERN',
    evidenceQuote: 'ライニング:合成繊維',
    evidenceImageAssetId: null,
  },
  'fact.material_sole': {
    value: '고무',
    generatedValue: '고무',
    extractionMethod: 'DESCRIPTION_PATTERN',
    evidenceQuote: 'ソール:ゴム底',
  },
};

/** ⑥-2 사실 필드 일곱 행(원산지·소재 셋·굽높이·색상 표기·주의 문구 — 버전마다 항상 모두 있다) */
function factRows(run: RunRec, at: string): ContentDraftFieldItem[] {
  const five = factFields().map((field) => ({
    ...field,
    ...FACT_PATCH[field.fieldKey],
    evidenceUrl: STORY.itemUrl,
  }));
  const color = contentField({
    fieldKey: 'fact.color_ko',
    value: STORY.selectedColor,
    generatedValue: STORY.selectedColor,
    extractionMethod: 'DICTIONARY',
    evidenceQuote: STORY.colorLabelJa,
    evidenceUrl: STORY.itemUrl,
  });
  const caution = contentField({
    fieldKey: 'fact.caution',
    value: String(assemblyBase().noticeFields.caution ?? ''),
    generatedValue: String(assemblyBase().noticeFields.caution ?? ''),
    extractionMethod: 'TEMPLATE',
  });
  return [...five, color, caution].map((field, index) => ({
    ...field,
    id: run.id * 10 + index + 1,
    stepRunId: run.id,
    basisItemCode: STORY.itemCode,
    createdAt: at,
    updatedAt: at,
  }));
}

/** ⑥-2 원산지·소재 한 버전(원산지는 설명문에서 읽어 입력 대기 없이 끝난다) */
export function contentFact(
  w: DemoWorld,
  run: RunRec,
  isCurrent: boolean,
): Ok<'/candidates/{candidateId}/content-fact'> {
  const at = iso(run.endedAt ?? w.now());
  return contentFactOutput({
    stepRunId: run.id,
    candidateId: w.candidate().id,
    version: run.version,
    stepRunStatus: run.status,
    isCurrent,
    contentDraftFactId: run.id,
    sourceItemCode: STORY.itemCode,
    sourcePageUrl: STORY.itemUrl,
    selectedColorRaw: STORY.colorLabelJa,
    createdAt: at,
    fields: factRows(run, at),
    pendingInputs: [],
  });
}

/** ⑥-3 고시·HTML 한 버전 */
export function contentAssembly(
  w: DemoWorld,
  run: RunRec,
  isCurrent: boolean,
): Ok<'/candidates/{candidateId}/content-assembly'> {
  return {
    ...assemblyBase(),
    stepRunId: run.id,
    candidateId: w.candidate().id,
    version: run.version,
    stepRunStatus: run.status,
    isCurrent,
    contentDraftAssemblyId: run.id,
    htmlSha256: fakeSha256('detail-html'),
    createdAt: iso(run.endedAt ?? w.now()),
    previewUrl: detailPreviewUrl(),
  };
}

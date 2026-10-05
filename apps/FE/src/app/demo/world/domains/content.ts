import { get, type DemoRoute } from '../../router';
import {
  contentAssembly,
  contentCopy,
  contentFact,
  detailPreviewDocument,
} from '../../sample/content';
import { currentRun } from '../engine';
import type { RunOutcome, StepRunner } from '../runner';
import type { DemoWorld } from '../../demoWorld';
import { resolveOutputRun } from './outputs';

/**
 * ⑥ 상세 콘텐츠: ⑥-1 카피 · ⑥-2 원산지·소재 · ⑥-3 고시·HTML. 세 단계 모두 눌러서 실행한 뒤 지연 뒤 COMPLETED가 된다.
 * - ⑥-2는 예시 상품(ショップA) 설명문에서 원산지(베트남)를 읽어 입력 대기 없이 끝난다 → 연속 실행·⑥ 묶음이 멈추지 않는다
 * - 산출물은 실행이 COMPLETED로 끝나야 생긴다(실제 BE의 `persist`). 새 실행이 RUNNING인 동안은 현재 버전 포인터가 새 실행으로 옮겨
 *   가 있어 산출물 조회가 404 `STEP_OUTPUT_NOT_FOUND`다. 이전 버전은 `?stepRunId=`로 그대로 읽는다.
 * - 오너 수정(`owner-edits`)·원산지 직접 넣기(`PUT …/content-fields/…`)는 만들지 않는다(체험에서는 403 안내)
 */
export type ContentStep = 'COPY' | 'NOTICE_RAW' | 'NOTICE_HTML';

export interface ContentState {
  /** 산출물을 낸 실행 id(단계별) */
  outputs: Record<ContentStep, number[]>;
}

export const initialContent = (): ContentState => ({
  outputs: { COPY: [], NOTICE_RAW: [], NOTICE_HTML: [] },
});

/** 결과가 정해졌을 때: 완료한 현재 실행에 산출물을 남긴다 */
function recordOutput(w: DemoWorld, code: ContentStep, outcome: RunOutcome): void {
  const run = currentRun(w, code);
  if (outcome.status !== 'COMPLETED' || !run) return;
  if (!w.s.content.outputs[code].includes(run.id)) w.s.content.outputs[code].push(run.id);
}

const completed = (): RunOutcome => ({ status: 'COMPLETED' });

export const copyRunner: StepRunner = {
  stepCode: 'COPY',
  delay: 'medium',
  outcome: completed,
  onSettled: (w, outcome) => recordOutput(w, 'COPY', outcome),
};

export const noticeRawRunner: StepRunner = {
  stepCode: 'NOTICE_RAW',
  delay: 'medium',
  outcome: completed,
  onSettled: (w, outcome) => recordOutput(w, 'NOTICE_RAW', outcome),
};

export const noticeHtmlRunner: StepRunner = {
  stepCode: 'NOTICE_HTML',
  delay: 'short',
  outcome: completed,
  onSettled: (w, outcome) => recordOutput(w, 'NOTICE_HTML', outcome),
};

export const contentRoutes: DemoRoute[] = [
  get('/candidates/{candidateId}/content-copy', ({ world, query }) => {
    const { run, isCurrent } = resolveOutputRun(world, 'COPY', query, world.s.content.outputs.COPY);
    return contentCopy(world, run, isCurrent);
  }),
  get('/candidates/{candidateId}/content-fact', ({ world, query }) => {
    const { run, isCurrent } = resolveOutputRun(
      world,
      'NOTICE_RAW',
      query,
      world.s.content.outputs.NOTICE_RAW,
    );
    return contentFact(world, run, isCurrent);
  }),
  get('/candidates/{candidateId}/content-assembly', ({ world, query }) => {
    const { run, isCurrent } = resolveOutputRun(
      world,
      'NOTICE_HTML',
      query,
      world.s.content.outputs.NOTICE_HTML,
    );
    return contentAssembly(world, run, isCurrent);
  }),
  // 서버 미리보기와 같은 문서(text/html). 화면은 조립 결과의 `previewUrl`(data: 문서)을 쓰고, 이 주소는 직접 열었을 때 같은 모습이다
  get('/candidates/{candidateId}/content-assembly/preview', ({ world, query }) => {
    resolveOutputRun(world, 'NOTICE_HTML', query, world.s.content.outputs.NOTICE_HTML);
    return new Response(detailPreviewDocument(), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }),
];

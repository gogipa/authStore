import { get, type DemoRoute } from '../../router';
import { uploadResult } from '../../sample/registration';
import { currentRun } from '../engine';
import type { RunOutcome, StepRunner } from '../runner';
import { resolveOutputRun } from './outputs';

/**
 * ⑧ 이미지 업로드: ⑤에서 고른 선택본을 1000×1000 JPEG로 맞춰 올리고 ⑥-3 상세 HTML의 이미지 자리를 업로드 주소로 바꾼다. 눌러서
 * 실행한 뒤 지연 뒤 COMPLETED가 된다. 시작 조건(⑤·⑥-3 완료, G3 유효)은 엔진이 막는다.
 * - 산출물은 COMPLETED로 끝난 실행에만 있다(실행 중에는 404 `STEP_OUTPUT_NOT_FOUND`)
 * - 다시 실행하면 같은 이미지 주소를 다시 쓴다(`reused`) — 이미지는 처음 산출물을 낸 실행에서 올렸기 때문이다
 * - ⑧이 끝나 필수 9단계가 모두 완료면 여정은 승인대기가 된다(엔진 `reevaluate`)
 */
export interface UploadState {
  /** 산출물(upload_result)을 낸 실행 id */
  outputs: number[];
  /** 이미지를 처음 올린 실행 id와 시각(ms). 이 뒤 실행은 같은 주소를 다시 쓴다 */
  first: { runId: number; uploadedAt: number } | null;
}

export const initialUpload = (): UploadState => ({ outputs: [], first: null });

export const uploadRunner: StepRunner = {
  stepCode: 'UPLOAD',
  delay: 'medium',
  outcome: (): RunOutcome => ({ status: 'COMPLETED' }),
  onSettled(w, outcome) {
    const run = currentRun(w, 'UPLOAD');
    if (outcome.status !== 'COMPLETED' || !run) return;
    const state = w.s.upload;
    if (!state.outputs.includes(run.id)) state.outputs.push(run.id);
    state.first ??= { runId: run.id, uploadedAt: run.endedAt ?? w.now() };
  },
};

export const uploadRoutes: DemoRoute[] = [
  get('/candidates/{candidateId}/upload-result', ({ world, query }) => {
    const { run, isCurrent } = resolveOutputRun(world, 'UPLOAD', query, world.s.upload.outputs);
    return uploadResult(
      world,
      run,
      isCurrent,
      world.s.upload.first ?? { runId: run.id, uploadedAt: run.startedAt },
    );
  }),
];

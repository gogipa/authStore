import { Injectable, Module } from '@nestjs/common';
import {
  type StepInput,
  type StepInputContext,
  type StepOutcome,
  type StepRunner,
  StepRunnerFor,
  StepRunnerTestDouble,
  type Tx,
} from '../../src/modules/step-engine/contracts/step-runner.js';
import { INPUT_KEYS } from '../../src/modules/step-engine/domain/input-keys.js';
import { StepEngineModule } from '../../src/modules/step-engine/step-engine.module.js';

/**
 * ⑤ G3 선택본 입력 값(가짜 ⑧이 읽는 모양): ⑤ 완료 버전의 선택본 이미지(순서·파일 해시). 없으면 null.
 * 테스트가 ⑧ 시드 입력을 만들 때도 이 함수를 쓴다(지문이 어긋나지 않게).
 */
export async function thumbnailSelectionValue(
  db: Tx,
  thumbnailStepRunId: number | null,
): Promise<unknown> {
  if (thumbnailStepRunId === null) return null;
  const selection = await db.thumbnailSelection.findUnique({
    where: { stepRunId: thumbnailStepRunId },
    include: { images: { orderBy: { sortOrder: 'asc' }, include: { imageAsset: true } } },
  });
  if (!selection) return null;
  return selection.images.map((image) => ({
    sortOrder: image.sortOrder,
    sha256: image.imageAsset.sha256,
  }));
}

/**
 * ⑧ UPLOAD 가짜 실행기(P3-02 e2e — ⑧은 P4-01 전이라 운영 실행기가 없다). 테스트 대역(`@StepRunnerTestDouble`)이다.
 * 입력은 ⑤ G3 선택본 하나(`thumbnail.selection`, PREV_STEP)라 G3 선택본이 바뀌면 ⑧의 지문이 달라져 '재실행 필요'가 된다
 * (US-33 AC3). ⑥-3 HTML은 읽지 않는다(자리표시자 — PRD §5.3 ⑥-3 HTML 규칙). 실행하면 곧바로 완료한다.
 */
@StepRunnerFor('UPLOAD')
@StepRunnerTestDouble()
@Injectable()
export class FakeUploadRunner implements StepRunner {
  readonly stepCode = 'UPLOAD' as const;
  readonly usesAi = false;

  async readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    const thumbnailRunId = ctx.completedRunId('THUMBNAIL');
    return [
      {
        inputKey: INPUT_KEYS.thumbnailSelection,
        sourceType: 'PREV_STEP',
        sourceStepRunId: thumbnailRunId,
        isStartCondition: true,
        required: true,
        value: await thumbnailSelectionValue(ctx.db, thumbnailRunId),
      },
    ];
  }

  run(): Promise<StepOutcome> {
    return Promise.resolve({ kind: 'COMPLETED', output: {} });
  }

  persist(): Promise<void> {
    return Promise.resolve();
  }

  copyOutput(): Promise<void> {
    return Promise.resolve();
  }
}

/** `createTestApp({ imports: [FakeUploadRunnerModule] })` — ⑧만 가짜로 끼운다 */
@Module({
  imports: [StepEngineModule],
  providers: [FakeUploadRunner],
})
export class FakeUploadRunnerModule {}

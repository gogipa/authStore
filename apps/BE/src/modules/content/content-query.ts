import { ApiException } from '../../common/errors/api.exception.js';
import type { StepRun } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

/** int4 상한 */
const MAX_ID = 2_147_483_647;

function invalidQuery(field: string, message: string): ApiException {
  return new ApiException('INVALID_QUERY_PARAMETER', { fieldErrors: [{ field, message }] });
}

/**
 * 산출물 조회 쿼리(05-2 getCandidateContentCopy·getCandidateContentFact·getCandidateContentAssembly·getContentAssemblyPreview:
 * stepRunId만) — 어기면 422 INVALID_QUERY_PARAMETER
 */
export function parseContentQuery(query: Record<string, unknown>): { stepRunId: number | null } {
  for (const key of Object.keys(query)) {
    if (key !== 'stepRunId') throw invalidQuery(key, '받지 않는 조건입니다.');
  }
  if (query.stepRunId === undefined) return { stepRunId: null };
  const raw = typeof query.stepRunId === 'string' ? query.stepRunId : '';
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > MAX_ID) {
    throw invalidQuery('stepRunId', '1 이상의 정수여야 합니다.');
  }
  return { stepRunId: Number(raw) };
}

/**
 * 볼 버전(P3-02 `getCandidateThumbnail`과 같은 규칙): `?stepRunId=`면 그 버전(이 후보의 그 단계 실행이 아니면 404
 * STEP_RUN_NOT_FOUND), 없으면 현재 버전(`candidate_step.current_step_run_id` — 없으면 `notFound()` 404 STEP_OUTPUT_NOT_FOUND)
 */
export async function resolveContentRun(
  prisma: PrismaService,
  candidateId: number,
  stepCode: 'COPY' | 'NOTICE_RAW' | 'NOTICE_HTML',
  stepRunId: number | null,
  notFound: () => ApiException,
): Promise<{ run: StepRun; isCurrent: boolean; stepStatus: string | null }> {
  const step = await prisma.candidateStep.findUnique({
    where: { candidateId_stepCode: { candidateId, stepCode } },
    select: { currentStepRunId: true, status: true },
  });
  const currentId = step?.currentStepRunId ?? null;
  let runId: number;
  if (stepRunId !== null) {
    const found = await prisma.stepRun.findUnique({ where: { id: stepRunId } });
    if (!found || found.candidateId !== candidateId || found.stepCode !== stepCode) {
      throw new ApiException('STEP_RUN_NOT_FOUND', { details: { stepRunId } });
    }
    runId = found.id;
  } else {
    if (currentId === null) throw notFound();
    runId = currentId;
  }
  const run = await prisma.stepRun.findUniqueOrThrow({ where: { id: runId } });
  return { run, isCurrent: currentId === run.id, stepStatus: step?.status ?? null };
}

import { Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { TAG_COMPETITOR_INPUT_MAX_BYTES_LIMIT } from '../../settings/schema/settings.types.js';
import { SettingsService } from '../../settings/settings.service.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import {
  StepEngineTransactions,
  type Db,
  type StepEngineTx,
} from '../../step-engine/candidates/step-engine-tx.js';
import { INPUT_KEYS } from '../../step-engine/domain/input-keys.js';
import type { StepCode } from '../../step-engine/domain/steps.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import {
  activeInputs,
  COMPETITOR_SOURCE_TYPES,
  type CompetitorInputWithItems,
  type CompetitorSourceType,
  insertCompetitorInput,
} from './competitor-input.store.js';
import { parseBrowserResponse } from './parsers/browser-response.parser.js';
import { parseFreeText } from './parsers/free-text.parser.js';
import { CompetitorParseError, type ParsedCompetitorInput } from './parsers/parsed-input.js';
import { parseSellerfinderFile, parseSellerfinderText } from './parsers/sellerfinder.parser.js';

/** 파일 받기 하드 상한(multer, 메모리) — 설정 상한(`tags.competitorInputMaxBytes`)의 최대값과 같다 */
export const TAG_INPUT_FILE_HARD_LIMIT = TAG_COMPETITOR_INPUT_MAX_BYTES_LIMIT;

/** multer 메모리 파일(이름·형식 머리는 쓰지 않는다 — 내용으로만 판별) */
export interface UploadedTagFile {
  size: number;
  buffer: Buffer;
}

/** 05-2 TagCompetitorTagItem */
export interface TagCompetitorTagItemView {
  seq: number;
  tagText: string;
  sourceRank: number | null;
  naverProductId: string | null;
  frequency: number | null;
}

/** 05-2 TagCompetitorInputItem */
export interface TagCompetitorInputView {
  id: number;
  candidateId: number;
  sourceType: CompetitorSourceType;
  hasFrequency: boolean;
  itemCount: number;
  importedAt: string;
  removedAt: string | null;
  tags: TagCompetitorTagItemView[];
}

export function toCompetitorInputView(row: CompetitorInputWithItems): TagCompetitorInputView {
  return {
    id: row.id,
    candidateId: row.candidateId,
    sourceType: row.sourceType as CompetitorSourceType,
    hasFrequency: row.hasFrequency,
    itemCount: row.itemCount,
    importedAt: row.importedAt.toISOString(),
    removedAt: row.removedAt ? row.removedAt.toISOString() : null,
    tags: row.items.map((item) => ({
      seq: item.seq,
      tagText: item.tagText,
      sourceRank: item.sourceRank,
      naverProductId: item.naverProductId,
      frequency: item.frequency,
    })),
  };
}

/** 후보의 경쟁 태그 입력 목록 경로(Location — 단건 조회 API는 없다) */
export function competitorInputsLocation(candidateId: number): string {
  return `/api/v1/candidates/${candidateId}/tag-competitor-inputs`;
}

function invalid(fieldErrors: FieldError[]): ApiException {
  return new ApiException('VALIDATION_FAILED', { fieldErrors });
}

function tooLarge(maxBytes: number): ApiException {
  return new ApiException('PAYLOAD_TOO_LARGE', { details: { maxBytes } });
}

function stepLocked(): ApiException {
  return new ApiException('STEP_LOCKED_BY_RUNNING_STEP', {
    message: formatErrorMessage('STEP_LOCKED_BY_RUNNING_STEP', { 단계: '⑦ 태그' }),
    details: { stepCode: 'TAGS', runningStepCode: 'TAGS' },
  });
}

function toApi(error: CompetitorParseError): ApiException {
  if (error.code === 'UNSUPPORTED_FILE_TYPE') {
    return new ApiException('UNSUPPORTED_FILE_TYPE', {
      message: formatErrorMessage('UNSUPPORTED_FILE_TYPE', { 형식: '엑셀(xlsx)·CSV' }),
      details: { allowed: ['XLSX', 'CSV'] },
    });
  }
  return new ApiException(
    error.code,
    error.fieldErrors.length > 0 ? { fieldErrors: error.fieldErrors } : {},
  );
}

/** 요청 모양(JSON 붙여넣기 또는 multipart 파일) */
export type CompetitorInputRequest =
  | { kind: 'TEXT'; sourceType: CompetitorSourceType; text: string }
  | { kind: 'FILE'; sourceType: 'SELLERFINDER'; file: UploadedTagFile };

/**
 * 요청 모양 검사(05-2 TagCompetitorTextInputRequest·TagCompetitorFileInputRequest). 붙여 넣은 글·파일 이름은 오류에 담지 않는다
 * (`rejectedValue` 없음 — TG-01).
 */
export function parseCompetitorInputRequest(
  body: Record<string, unknown> | undefined,
  file: UploadedTagFile | undefined,
): CompetitorInputRequest {
  const fields = body ?? {};
  const errors: FieldError[] = [];
  for (const key of Object.keys(fields)) {
    if (key !== 'sourceType' && key !== 'text') {
      errors.push({ field: key, message: '받지 않는 값입니다.' });
    }
  }
  const sourceType = fields.sourceType;
  if (
    typeof sourceType !== 'string' ||
    !(COMPETITOR_SOURCE_TYPES as readonly string[]).includes(sourceType)
  ) {
    errors.push({
      field: 'sourceType',
      message: 'SELLERFINDER·BROWSER_RESPONSE·FREE_TEXT 중 하나여야 합니다.',
    });
  }
  if (file) {
    if (sourceType !== undefined && sourceType !== 'SELLERFINDER' && errors.length === 0) {
      errors.push({ field: 'sourceType', message: '파일은 셀라파인더(SELLERFINDER)만 받습니다.' });
    }
    if (fields.text !== undefined) {
      errors.push({ field: 'text', message: '파일과 붙여 넣은 글을 함께 보낼 수 없습니다.' });
    }
    if (errors.length > 0) throw invalid(errors);
    return { kind: 'FILE', sourceType: 'SELLERFINDER', file };
  }
  if (typeof fields.text !== 'string' || fields.text.trim().length === 0) {
    errors.push({ field: 'text', message: '붙여 넣은 글이 필요합니다.' });
  }
  if (errors.length > 0) throw invalid(errors);
  return {
    kind: 'TEXT',
    sourceType: sourceType as CompetitorSourceType,
    text: fields.text as string,
  };
}

/** 원본을 파싱한다(원본은 이 함수 밖으로 나가지 않는다 — 결과는 태그·순위·상품 ID·빈도뿐) */
export function parseCompetitorInput(request: CompetitorInputRequest): ParsedCompetitorInput {
  try {
    if (request.kind === 'FILE') return parseSellerfinderFile(request.file.buffer);
    switch (request.sourceType) {
      case 'SELLERFINDER':
        return parseSellerfinderText(request.text);
      case 'BROWSER_RESPONSE':
        return parseBrowserResponse(request.text);
      case 'FREE_TEXT':
        return parseFreeText(request.text);
    }
  } catch (error) {
    if (error instanceof CompetitorParseError) throw toApi(error);
    // 파서의 예상 밖 오류도 원본 조각이 메시지에 섞이지 않게 위치 없는 형식 오류로 돌려준다
    throw new ApiException('IMPORT_PARSE_FAILED');
  }
}

/**
 * 경쟁 태그 입력(05-2 listTagCompetitorInputs·createTagCompetitorInput·removeTagCompetitorInput, F-TG-02~06, P3-05 규칙 3~6).
 * - 받기(검사 순서): 요청 모양 422 VALIDATION_FAILED → 404 CANDIDATE_NOT_FOUND → 크기 413 PAYLOAD_TOO_LARGE(설정
 *   `tags.competitorInputMaxBytes`, 붙여 넣은 글은 UTF-8 바이트) → 파싱 422(UNSUPPORTED_FILE_TYPE·IMPORT_PARSE_FAILED·IMPORT_EMPTY)
 *   → (후보 행 잠금) 409 CANDIDATE_LOCKED·CANDIDATE_EXCLUDED → ⑦ 실행 중 409 STEP_LOCKED_BY_RUNNING_STEP → 저장 → 완료·재실행
 *   필요 ⑦이면 `StepEngineApi.ownerInputChanged('owner.competitorTags')` → `rerunRequiredSteps`
 * - 빼기: 404 COMPETITOR_INPUT_NOT_FOUND → 이미 뺐으면 204(바꾸지 않음) → 409 CANDIDATE_LOCKED → 409 STEP_LOCKED_BY_RUNNING_STEP →
 *   `removed_at`만 채운다(물리 삭제 금지) → 같은 전파
 * - 원본(파일·붙여 넣은 글·파일 이름)은 DB·로그·감사 기록·AI 어디에도 남기지 않는다. 감사 기록은 OWNER_EDITED에 입력 id·종류·개수만
 */
@Injectable()
export class CompetitorInputsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly api: StepEngineApi,
    private readonly settings: SettingsService,
    private readonly audit: UserActionLogService,
  ) {}

  async list(candidateId: number): Promise<{ items: TagCompetitorInputView[] }> {
    await this.guard.findOr404(this.prisma, candidateId);
    const rows = await activeInputs(this.prisma, candidateId);
    return { items: rows.map(toCompetitorInputView) };
  }

  async create(
    candidateId: number,
    body: Record<string, unknown> | undefined,
    file: UploadedTagFile | undefined,
  ): Promise<TagCompetitorInputView & { rerunRequiredSteps: StepCode[] }> {
    const request = parseCompetitorInputRequest(body, file);
    await this.guard.findOr404(this.prisma, candidateId);
    const maxBytes = this.settings.current().tags.competitorInputMaxBytes;
    const size =
      request.kind === 'FILE' ? request.file.size : Buffer.byteLength(request.text, 'utf8');
    if (size > maxBytes) throw tooLarge(maxBytes);
    const parsed = parseCompetitorInput(request);
    return this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
      this.guard.assertMutable(candidate);
      await this.assertTagsNotRunning(scope.tx, candidateId);
      const saved = await insertCompetitorInput(
        scope.tx,
        candidateId,
        request.sourceType,
        parsed,
        scope.now,
      );
      const rerunRequiredSteps = await this.propagate(scope, candidateId);
      await this.audit.record(
        {
          eventType: 'OWNER_EDITED',
          candidateId,
          stepCode: 'TAGS',
          detail: {
            input: INPUT_KEYS.ownerCompetitorTags,
            action: 'ADD',
            competitorInputId: saved.id,
            sourceType: saved.sourceType,
            itemCount: saved.itemCount,
          },
          occurredAt: scope.now,
        },
        scope.tx,
      );
      return { ...toCompetitorInputView(saved), rerunRequiredSteps };
    });
  }

  async remove(inputId: number): Promise<void> {
    const found = await this.prisma.tagCompetitorInput.findUnique({ where: { id: inputId } });
    if (!found) throw new ApiException('COMPETITOR_INPUT_NOT_FOUND');
    if (found.removedAt !== null) return;
    await this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, found.candidateId);
      const current = await scope.tx.tagCompetitorInput.findUniqueOrThrow({
        where: { id: inputId },
      });
      if (current.removedAt !== null) return;
      this.guard.assertNotLocked(candidate);
      await this.assertTagsNotRunning(scope.tx, found.candidateId);
      await scope.tx.tagCompetitorInput.update({
        where: { id: inputId },
        data: { removedAt: scope.now },
      });
      await this.propagate(scope, found.candidateId);
      await this.audit.record(
        {
          eventType: 'OWNER_EDITED',
          candidateId: found.candidateId,
          stepCode: 'TAGS',
          detail: {
            input: INPUT_KEYS.ownerCompetitorTags,
            action: 'REMOVE',
            competitorInputId: inputId,
            sourceType: current.sourceType,
            itemCount: current.itemCount,
          },
          occurredAt: scope.now,
        },
        scope.tx,
      );
    });
  }

  /** ⑦이 실행 중(RUNNING)이면 409 — 실행이 읽는 입력이 바뀌지 않게 */
  private async assertTagsNotRunning(db: Db, candidateId: number): Promise<void> {
    const step = await db.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId, stepCode: 'TAGS' } },
      select: { status: true },
    });
    if (step?.status === 'RUNNING') throw stepLocked();
  }

  /** 활성 입력이 바뀌었다 → 완료(또는 재실행 필요)된 ⑦의 지문 비교(규칙 6). 바뀐 단계를 돌려준다 */
  private async propagate(scope: StepEngineTx, candidateId: number): Promise<StepCode[]> {
    const step = await scope.tx.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId, stepCode: 'TAGS' } },
      select: { status: true },
    });
    if (step?.status !== 'COMPLETED' && step?.status !== 'RERUN_REQUIRED') return [];
    return this.api.ownerInputChanged(candidateId, INPUT_KEYS.ownerCompetitorTags, scope);
  }
}

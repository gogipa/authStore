import { Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import { StepEngineTransactions } from '../../step-engine/candidates/step-engine-tx.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import type {
  ContentFieldInputRequestDto,
  ContentFieldInputResultDto,
  ContentStepStatus,
} from '../dto/content.dto.js';
import { draftOf, fieldsOf, updateField, type FieldDraft } from '../fields/content-field.store.js';
import { toFieldItem } from '../fields/content-field.view.js';
import {
  COLOR_KO_FIELD_KEY,
  RUNTIME_INPUT_FIELD_KEYS,
  type FactFieldKey,
} from '../fields/field-keys.js';
import { storedPendingInputs } from './content-fact.service.js';
import { NOTICE_RAW_INPUT_DONE } from './notice-raw-step.runner.js';
import { evidenceUrlOf, OriginInputResolver } from './origin-input.resolver.js';

/** 05-2 경로 fieldKey 모양(`^fact\.[a-z_]+$`, 48자 이하) */
const PATH_FIELD_KEY = /^fact\.[a-z_]+$/;

/**
 * 열린 ⑥-2 실행에 필드 오너 입력(05-2 `putContentFieldInput`, F-CT-14, US-15 AC2, P3-03 규칙 12·13). 웹 화면 요청만 받는다
 * (Origin·`X-AutoStore-Client` 가드 — CLI 불가). 검사 순서(Proposed): 모양 422 VALIDATION_FAILED → 실행 없음 404
 * STEP_RUN_NOT_FOUND → ⑥-2 아님 422 INVALID_STEP_CODE → 허용 목록 밖 422 FIELD_NOT_EDITABLE(M1은 `fact.origin`만) → 근거 URL 없음
 * 422 EVIDENCE_URL_REQUIRED(모양이 틀리면 VALIDATION_FAILED) → 모르는 나라 422 ORIGIN_COUNTRY_UNKNOWN → 잠김·제외 409 → 입력 대기
 * 아님 409 STEP_RUN_NOT_WAITING_INPUT.
 * 저장(한 트랜잭션): 행을 `OWNER_INPUT`·`owner_confirmed_at`=지금·`basis_item_code`=현재 itemCode·근거 URL·발췌(선택)로 고치고
 * (재확인 표시가 있으면 `recheck_resolved_at`도), 감사 기록(OWNER_EDITED). 대기 입력이 다 차면 같은 실행을 완료로 끝낸다
 * (step-engine `resumeWaiting({outcome})` — 끝 지문·뒷단계 전파·SSE).
 * P3-04: 허용 키에 색상 표기 확인(`fact.color_ko`)을 더했다 — 근거 URL 없이 글 1~100자(`putColor`).
 */
@Injectable()
export class ContentFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly api: StepEngineApi,
    private readonly origins: OriginInputResolver,
    private readonly audit: UserActionLogService,
  ) {}

  async put(
    stepRunId: number,
    fieldKey: string,
    body: ContentFieldInputRequestDto,
  ): Promise<ContentFieldInputResultDto> {
    if (fieldKey.length > 48 || !PATH_FIELD_KEY.test(fieldKey)) {
      throw new ApiException('VALIDATION_FAILED', {
        fieldErrors: [
          {
            field: 'fieldKey',
            message: 'fact.* 형식(48자 이하)이어야 합니다.',
            rejectedValue: fieldKey,
          },
        ],
      });
    }
    const found = await this.prisma.stepRun.findUnique({ where: { id: stepRunId } });
    if (!found) throw new ApiException('STEP_RUN_NOT_FOUND');
    if (found.stepCode !== 'NOTICE_RAW') {
      throw new ApiException('INVALID_STEP_CODE', {
        details: { stepCode: found.stepCode, reason: 'NOT_NOTICE_RAW' },
      });
    }
    if (!RUNTIME_INPUT_FIELD_KEYS.includes(fieldKey as FactFieldKey)) {
      throw new ApiException('FIELD_NOT_EDITABLE', {
        details: { fieldKey, stepCode: 'NOTICE_RAW' },
      });
    }
    if (fieldKey === COLOR_KO_FIELD_KEY) return this.putColor(found.candidateId, stepRunId, body);
    if (
      body.evidenceUrl === undefined ||
      body.evidenceUrl === null ||
      body.evidenceUrl.trim() === ''
    ) {
      throw new ApiException('EVIDENCE_URL_REQUIRED');
    }
    const evidenceUrl = evidenceUrlOf(body.evidenceUrl);
    if (evidenceUrl === null) {
      throw new ApiException('VALIDATION_FAILED', {
        fieldErrors: [
          {
            field: 'evidenceUrl',
            message: '근거 URL은 http·https 주소여야 합니다.',
            rejectedValue: body.evidenceUrl,
          },
        ],
      });
    }
    const countries = await this.origins.resolve(body.value, 'value');
    const evidenceQuote = body.evidenceQuote?.trim() ? body.evidenceQuote.trim() : null;

    return this.save(found.candidateId, stepRunId, fieldKey, (current, candidate, now) => ({
      ...current,
      value: countries,
      valueSource: 'OWNER_INPUT',
      evidenceUrl,
      evidenceQuote,
      evidenceImageAssetId: null,
      basisItemCode: candidate.itemCode ?? current.basisItemCode,
      ownerConfirmedAt: now,
      choicePending: false,
      recheckResolvedAt: current.recheckReason !== null ? now : null,
    }));
  }

  /**
   * 색상 표기 확인(P3-04 규칙 6, F-CT-17 — 열린 ⑥-2의 `fact.color_ko`). 근거 URL은 받지 않는다(선택 색상 원문이 근거다). 값은 글
   * 1~100자(어기면 422 VALIDATION_FAILED). 색상은 입력 대기 사유가 아니라 저장만 하고, 원산지가 남아 있으면 그대로 기다린다
   */
  private async putColor(
    candidateId: number,
    stepRunId: number,
    body: ContentFieldInputRequestDto,
  ): Promise<ContentFieldInputResultDto> {
    const text = typeof body.value === 'string' ? body.value.trim() : '';
    if (text === '' || [...text].length > 100) {
      throw new ApiException('VALIDATION_FAILED', {
        fieldErrors: [
          {
            field: 'value',
            message: '색상 표기는 1~100자 글이어야 합니다.',
            rejectedValue: body.value,
          },
        ],
      });
    }
    return this.save(candidateId, stepRunId, COLOR_KO_FIELD_KEY, (current, candidate, now) => ({
      ...current,
      value: text,
      valueSource: 'OWNER_INPUT',
      evidenceUrl: null,
      evidenceImageAssetId: null,
      basisItemCode: candidate.itemCode ?? current.basisItemCode,
      ownerConfirmedAt: now,
      choicePending: false,
    }));
  }

  /** 열린 ⑥-2 행 하나를 오너 값으로 고치고(한 트랜잭션), 대기 입력이 다 차면 실행을 끝낸다 */
  private save(
    candidateId: number,
    stepRunId: number,
    fieldKey: string,
    next: (current: FieldDraft, candidate: { itemCode: string | null }, now: Date) => FieldDraft,
  ): Promise<ContentFieldInputResultDto> {
    return this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
      this.guard.assertMutable(candidate);
      const run = await scope.tx.stepRun.findUniqueOrThrow({ where: { id: stepRunId } });
      if (run.status !== 'WAITING_INPUT') throw new ApiException('STEP_RUN_NOT_WAITING_INPUT');
      const row = await scope.tx.contentDraftField.findUnique({
        where: { stepRunId_fieldKey: { stepRunId, fieldKey } },
      });
      if (!row) throw new ApiException('STEP_RUN_NOT_WAITING_INPUT');
      const current = draftOf(row);
      const updated = await updateField(
        scope.tx,
        row.id,
        next(current, candidate, scope.now),
        scope.now,
      );
      await this.audit.record(
        {
          eventType: 'OWNER_EDITED',
          candidateId: run.candidateId,
          stepRunId: run.id,
          stepCode: 'NOTICE_RAW',
          detail: { fieldKey, input: 'RUNTIME', recheckResolved: current.recheckReason !== null },
          occurredAt: scope.now,
        },
        scope.tx,
      );
      const pendingInputs = storedPendingInputs((await fieldsOf(scope.tx, run.id)).map(draftOf));
      let status = run.status as ContentStepStatus;
      if (pendingInputs.length === 0) {
        const closed = await this.api.resumeWaiting(run.id, {
          scope,
          outcome: { kind: 'COMPLETED', output: NOTICE_RAW_INPUT_DONE },
        });
        status = closed.status as ContentStepStatus;
      }
      return {
        field: toFieldItem(updated),
        stepRunId: run.id,
        stepRunStatus: status,
        pendingInputs,
      };
    });
  }
}

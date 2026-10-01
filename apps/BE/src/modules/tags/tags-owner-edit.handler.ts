import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import type { FieldError } from '../../common/errors/error-response.js';
import { SECRET_STORE, type SecretStore } from '../../common/secrets/secret-store.port.js';
import { CLOCK, type Clock } from '../integrations/http/clock.token.js';
import {
  COMMERCE_TAGS_PORT,
  type CommerceTagsPort,
} from '../integrations/naver-commerce/commerce-tags.port.js';
import type { StepOutcome, StepRunContext, Tx } from '../step-engine/contracts/step-runner.js';
import { evaluatePool } from './pipeline/evaluate.js';
import { normalizeTagText, TAG_TEXT_MAX } from './pipeline/normalize.js';
import { selectOwnerEdit } from './pipeline/select-final.js';
import { applyEdits, mergeEdits } from './pipeline/tag-pool.js';
import { FINAL_TAG_LIMIT } from './pipeline/tag-pipeline.types.js';
import {
  copyTagSet,
  editOfRow,
  finalKeysOf,
  poolOfStored,
  readTagSet,
  type TagSetDraft,
} from './tag-set.store.js';
import {
  assertCommerceKeys,
  externalFailure,
  inputFailure,
  ruleContextOf,
  tagsOutputNotFound,
  type TagsOutput,
} from './tags-run.js';
import { tagsRunInputsOf } from './tags-sources.js';

/** owner-edits TAGS EDIT body의 태그 편집(`{ add, remove }`) */
export interface TagEditRequest {
  add: string[];
  remove: string[];
}

function editRequestOf(edit: unknown): TagEditRequest {
  const v = (edit ?? {}) as { add?: unknown; remove?: unknown };
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];
  return { add: list(v.add), remove: list(v.remove) };
}

/**
 * ⑦ 오너 수정 처리기(P3-05 §5.1 `tags-owner-edit.handler.ts`, F-TG-14, 규칙 13·14). step-engine owner-edits(P1-05)가 실행기를
 * 거쳐 부른다(태그 편집 API를 따로 두지 않는다).
 * - `check`(202로 받기 전 — `StepRunner.checkOwnerEdit`): 빈 값·100자 초과·같은 태그를 더하고 빼기 → 422 VALIDATION_FAILED,
 *   더한 뒤 최종 태그 10개 초과 → 422 FINAL_TAG_LIMIT_EXCEEDED(`details.limit`·`count`), 커머스 키 없음 → 409 SECRET_NOT_CONFIGURED
 * - `run`(비동기 OWNER_EDIT 실행): 바탕 버전 편집 목록에 이번 add·remove를 더해(`edited_at` 유지) `tag_owner_edit`에 쌓고, 바탕
 *   버전의 추천·경쟁 후보에 다시 적용한 뒤 정규화 → 규칙 필터 → restricted 재검증을 거친다(오너 수정도 검사를 건너뛰지 않는다).
 *   선정은 바탕 버전 최종 태그에서 뺀 것을 빼고 더한 것을 뒤에 붙인다(빈자리를 순위 밖 태그로 채우지 않는다 — Proposed). 끝나면
 *   엔진이 SSE `step-run.status-changed`를 보낸다
 * - `copy`(RESTORE_VERSION): 그 버전의 후보·편집 목록·읽은 경쟁 입력을 새 버전으로 그대로 복사한다(편집 목록이 되살아난다)
 */
@Injectable()
export class TagsOwnerEditHandler {
  constructor(
    @Inject(COMMERCE_TAGS_PORT) private readonly tags: CommerceTagsPort,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async check(db: Tx, baseStepRunId: number, edit: unknown): Promise<void> {
    const request = editRequestOf(edit);
    const errors: FieldError[] = [];
    const keysOf = (field: 'add' | 'remove', list: string[]) =>
      list.map((raw, index) => {
        const key = normalizeTagText(raw);
        if (key.length === 0) {
          errors.push({ field: `${field}[${index}]`, message: '태그가 비었습니다.' });
        } else if (key.length > TAG_TEXT_MAX) {
          errors.push({
            field: `${field}[${index}]`,
            message: `태그는 ${TAG_TEXT_MAX}자까지입니다.`,
          });
        }
        return key;
      });
    const addKeys = keysOf('add', request.add);
    const removeKeys = keysOf('remove', request.remove);
    if (request.add.length === 0 && request.remove.length === 0) {
      errors.push({ field: 'add', message: '더하거나 뺄 태그가 1개 이상 필요합니다.' });
    }
    removeKeys.forEach((key, index) => {
      if (key.length > 0 && addKeys.includes(key)) {
        errors.push({ field: `remove[${index}]`, message: '같은 태그를 더하면서 뺄 수 없습니다.' });
      }
    });
    if (errors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors: errors });
    const base = await readTagSet(db, baseStepRunId);
    if (!base) throw tagsOutputNotFound();
    const next = new Set(finalKeysOf(base.candidates));
    for (const key of removeKeys) next.delete(key);
    for (const key of addKeys) next.add(key);
    if (next.size > FINAL_TAG_LIMIT) {
      throw new ApiException('FINAL_TAG_LIMIT_EXCEEDED', {
        details: { limit: FINAL_TAG_LIMIT, count: next.size },
      });
    }
    await assertCommerceKeys(this.secrets);
  }

  async run(ctx: StepRunContext, db: Tx): Promise<StepOutcome> {
    const ownerEdit = ctx.ownerEdit;
    if (!ownerEdit) return inputFailure('INTERNAL_ERROR', '태그 편집 내용이 없습니다.');
    const base = await readTagSet(db, ownerEdit.baseStepRunId);
    if (!base) {
      const e = tagsOutputNotFound();
      return inputFailure(e.code, e.message);
    }
    const request = editRequestOf(ownerEdit.edit);
    const now = this.clock.now();
    const edits = mergeEdits(base.edits.map(editOfRow), request.add, request.remove, now);
    const applied = applyEdits(poolOfStored(base.candidates), edits);
    const inputs = tagsRunInputsOf(ctx.inputs);
    let evaluated: Awaited<ReturnType<typeof evaluatePool>>;
    try {
      evaluated = await evaluatePool({
        pool: applied.pool,
        removedKeys: applied.removedKeys,
        ruleContext: ruleContextOf(inputs, ctx.settings),
        batchSize: ctx.settings.tags.restrictedBatchSize,
        restricted: (batch) =>
          this.tags.restrictedTags(batch, {
            candidateId: ctx.candidateId,
            stepRunId: ctx.stepRunId,
          }),
      });
    } catch (error) {
      const failure = externalFailure(error);
      if (failure) return failure;
      throw error;
    }
    const addedNow = request.add.map(normalizeTagText).filter((key) => key.length > 0);
    const candidates = selectOwnerEdit(evaluated.judged, finalKeysOf(base.candidates), addedNow);
    const draft: TagSetDraft = {
      recommendKeywords: base.recommendKeywords,
      leafCategoryId: inputs.leaf?.leafCategoryId ?? null,
      restrictedCheckedAt: evaluated.calls > 0 ? this.clock.now().toISOString() : null,
      aiRelevanceEnabled: false,
      competitorInputIds: base.competitorInputIds,
      candidates,
      edits,
    };
    const output: TagsOutput = { kind: 'TAG_SET', draft };
    return { kind: 'COMPLETED', output };
  }

  async copy(tx: Tx, fromStepRunId: number, toStepRunId: number, edit?: unknown): Promise<void> {
    if (edit !== undefined) {
      // 태그 편집은 owner-edits의 202 실행으로만 한다(EDIT fields는 받지 않는다)
      throw new ApiException('FIELD_NOT_EDITABLE', { details: { stepCode: 'TAGS' } });
    }
    if (!(await copyTagSet(tx, fromStepRunId, toStepRunId))) throw tagsOutputNotFound();
  }
}

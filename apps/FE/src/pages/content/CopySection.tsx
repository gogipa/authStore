import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  CHOICE_TITLE,
  CHOOSE_GENERATED_LABEL,
  CHOOSE_OWNER_LABEL,
  contentKeys,
  COPY_EMPTY_TEXT,
  COPY_FIELD_LABEL,
  COPY_NO_CHANGE_REASON,
  COPY_NOT_EDITABLE_REASON,
  copyDocOf,
  copyEditFields,
  copyFormErrors,
  copyFormOf,
  copyMetaText,
  fieldValueText,
  FIT_AND_SIZE_TITLE,
  headlineCounter,
  isOwnerField,
  KEEP_AS_IS_DISABLED_REASON,
  KEEP_AS_IS_LABEL,
  pendingChoices,
  SAVE_COPY_LABEL,
  SOURCE_FACTS_TITLE,
  type ContentCopyOutput,
  type CopyFieldKey,
  type CopyForm,
} from '@/features/content';
import { useOwnerEdit, type CandidateStepRailItem } from '@/features/step-engine';
import { isApiRequestError } from '@/shared/api/errors';
import { aiGeneratedLabel } from '@/shared/lib/aiEngine';
import {
  Banner,
  Button,
  Chip,
  DisabledReason,
  Disclosure,
  StatusChip,
  TextField,
  Textarea,
} from '@/shared/ui';
import styles from './ContentPage.module.css';

export interface CopySectionProps {
  candidateId: number;
  /** ⑥-1 레일 칸(상태·현재 실행의 AI 엔진) */
  item: CandidateStepRailItem | undefined;
  /** ⑥-1 현재 버전 산출물(없으면 실행 전) */
  output: ContentCopyOutput | undefined;
  /** 머리 오른쪽 '⑥-1 실행' 버튼 자리(ContentPage가 준다) */
  runAction?: ReactNode;
}

/** 오류 문구(05-3 봉투 message 그대로) */
function errorText(error: unknown): string {
  return isApiRequestError(error) ? error.message : '요청을 처리하지 못했습니다.';
}

/**
 * ⑥-1 카피 구획(SCR-06 Content.dc.html `#copy`, F-CT-05·07·08, P3-03 규칙 5~8):
 * - 머리: 제목 · 상태 칩 · 'AI 생성 · 엔진' · '14:21 생성 · 14:31 헤드라인 직접 고침 · v2' · '그대로 유지'(재실행 필요일 때만 —
 *   아니면 꺼진 이유 '재실행 필요일 때만 고를 수 있습니다') · '고친 내용 저장'
 * - 헤드라인(`25/40` 카운터, 41자면 오류) · 셀링포인트(한 줄에 하나) · 본문 · '카피에 쓴 원문 사실' 목록 ·
 *   '착화감·코디 제안 · 사이즈 안내' 펼치기
 * - 다시 실행 결과가 직접 고친 값과 다르면(`choice_pending`) 나란히 보여 주고 고른다(`choose: OWNER|GENERATED`)
 * 저장·그대로 유지·고르기는 오너 수정(`useOwnerEdit` — 새 버전). 성공하면 ⑥-1 산출물을 다시 읽는다.
 */
export function CopySection({ candidateId, item, output, runAction }: CopySectionProps) {
  const queryClient = useQueryClient();
  const edit = useOwnerEdit();
  const doc = copyDocOf(output?.copy);
  const [form, setForm] = useState<CopyForm>(() => copyFormOf(doc));
  const errors = copyFormErrors(form);
  const changes = output ? copyEditFields(form, doc) : [];
  const editable =
    output !== undefined &&
    output.isCurrent &&
    (output.stepRunStatus === 'COMPLETED' || output.stepRunStatus === 'RERUN_REQUIRED');
  const firstError = Object.values(errors)[0] ?? null;
  const saveReason = !editable
    ? COPY_NOT_EDITABLE_REASON
    : changes.length === 0
      ? COPY_NO_CHANGE_REASON
      : firstError;
  const keepReason = output?.keepAsIsAllowed ? null : KEEP_AS_IS_DISABLED_REASON;
  const choices = output ? pendingChoices(output.fields) : [];
  const set = (key: keyof CopyForm) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const ownerChip = (key: CopyFieldKey) =>
    output && isOwnerField(output.fields, key) ? <Chip tone="neutral">직접 입력</Chip> : null;

  const submit = (body: Parameters<typeof edit.mutate>[0]['body']) => {
    edit.reset();
    edit.mutate(
      { candidateId, stepCode: 'COPY', body },
      {
        onSuccess: () =>
          void queryClient.invalidateQueries({ queryKey: contentKeys.copy(candidateId) }),
      },
    );
  };

  return (
    <section id="copy" aria-labelledby="copy-title" className={styles.sub}>
      <div className={styles.subHead}>
        <h2 id="copy-title" className={styles.subTitle}>
          ⑥-1 카피
        </h2>
        {item ? <StatusChip status={item.status} /> : null}
        {output ? (
          <>
            <Chip tone="outline">{aiGeneratedLabel(item?.currentRun?.aiEngine)}</Chip>
            <span className={styles.caption}>{copyMetaText(output)}</span>
          </>
        ) : null}
        <span className={styles.spacer} />
        {runAction}
        {output ? (
          <>
            <Button
              disabled={keepReason !== null || edit.isPending}
              aria-describedby={keepReason ? 'copy-keep-why' : undefined}
              onClick={() => submit({ ownerAction: 'KEEP_AS_IS', baseStepRunId: output.stepRunId })}
            >
              {KEEP_AS_IS_LABEL}
            </Button>
            {keepReason ? (
              <DisabledReason id="copy-keep-why" tone="muted">
                {keepReason}
              </DisabledReason>
            ) : null}
            <Button
              variant="primary"
              disabled={saveReason !== null || edit.isPending}
              aria-describedby={saveReason ? 'copy-save-why' : undefined}
              onClick={() =>
                submit({ ownerAction: 'EDIT', baseStepRunId: output.stepRunId, fields: changes })
              }
            >
              {SAVE_COPY_LABEL}
            </Button>
          </>
        ) : null}
      </div>
      {output && saveReason && saveReason !== COPY_NO_CHANGE_REASON ? (
        <DisabledReason id="copy-save-why" className={styles.reasonLine}>
          {saveReason}
        </DisabledReason>
      ) : null}
      {edit.error ? (
        <Banner tone="blocked" role="alert">
          {errorText(edit.error)}
        </Banner>
      ) : null}
      {!output ? (
        <p className={styles.placeholder}>{COPY_EMPTY_TEXT}</p>
      ) : (
        <div className={styles.copyGrid}>
          {choices.map((choice) => (
            <div
              key={choice.fieldKey}
              className={styles.choice}
              role="group"
              aria-label={CHOICE_TITLE}
            >
              <span className={styles.label}>
                {COPY_FIELD_LABEL[choice.fieldKey as CopyFieldKey]} · {CHOICE_TITLE}
              </span>
              <div className={styles.choiceColumns}>
                <div>
                  <span className={styles.caption}>직접 고친 값</span>
                  <p className={styles.choiceValue}>{fieldValueText(choice.value)}</p>
                </div>
                <div>
                  <span className={styles.caption}>새 결과</span>
                  <p className={styles.choiceValue}>{fieldValueText(choice.generatedValue)}</p>
                </div>
              </div>
              <div className={styles.choiceActions}>
                <Button
                  size="sm"
                  disabled={!editable || edit.isPending}
                  onClick={() =>
                    submit({
                      ownerAction: 'EDIT',
                      baseStepRunId: output.stepRunId,
                      fields: [{ fieldKey: choice.fieldKey, choose: 'OWNER' }],
                    })
                  }
                >
                  {CHOOSE_OWNER_LABEL}
                </Button>
                <Button
                  size="sm"
                  disabled={!editable || edit.isPending}
                  onClick={() =>
                    submit({
                      ownerAction: 'EDIT',
                      baseStepRunId: output.stepRunId,
                      fields: [{ fieldKey: choice.fieldKey, choose: 'GENERATED' }],
                    })
                  }
                >
                  {CHOOSE_GENERATED_LABEL}
                </Button>
              </div>
            </div>
          ))}
          <div className={styles.copyFields}>
            <TextField
              id="copy-headline"
              label={
                <span className={styles.fieldLabel}>헤드라인 {ownerChip('copy.headline')}</span>
              }
              value={form.headline}
              unit={headlineCounter(form.headline)}
              locked={!editable}
              error={errors.headline}
              onChange={(e) => set('headline')(e.target.value)}
            />
            <Textarea
              id="copy-points"
              label={
                <span className={styles.fieldLabel}>
                  셀링포인트 {ownerChip('copy.selling_points')}
                </span>
              }
              rows={3}
              value={form.sellingPoints}
              locked={!editable}
              error={errors.sellingPoints}
              hint="한 줄에 하나씩 3~5개"
              onChange={(e) => set('sellingPoints')(e.target.value)}
            />
            <Textarea
              id="copy-body"
              label={<span className={styles.fieldLabel}>본문 {ownerChip('copy.body')}</span>}
              rows={3}
              value={form.body}
              locked={!editable}
              error={errors.body}
              onChange={(e) => set('body')(e.target.value)}
            />
          </div>
          <div className={styles.copyAside}>
            <div className={styles.facts}>
              <span className={styles.label}>{SOURCE_FACTS_TITLE}</span>
              <ul className={styles.factList}>
                {doc.source_facts_used.map((fact, i) => (
                  <li key={`${i}-${fact}`}>{fact}</li>
                ))}
              </ul>
            </div>
            <Disclosure title={FIT_AND_SIZE_TITLE} look="link">
              <div className={styles.copyFields}>
                <Textarea
                  id="copy-fit"
                  label={
                    <span className={styles.fieldLabel}>
                      착화감·코디 제안 {ownerChip('copy.fit_and_styling')}
                    </span>
                  }
                  rows={3}
                  value={form.fitAndStyling}
                  locked={!editable}
                  error={errors.fitAndStyling}
                  onChange={(e) => set('fitAndStyling')(e.target.value)}
                />
                <Textarea
                  id="copy-size"
                  label={
                    <span className={styles.fieldLabel}>
                      사이즈 안내 {ownerChip('copy.size_guide')}
                    </span>
                  }
                  rows={3}
                  value={form.sizeGuide}
                  locked={!editable}
                  error={errors.sizeGuide}
                  onChange={(e) => set('sizeGuide')(e.target.value)}
                />
              </div>
            </Disclosure>
          </div>
        </div>
      )}
    </section>
  );
}

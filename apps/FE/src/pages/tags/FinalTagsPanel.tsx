import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOwnerEdit } from '@/features/step-engine';
import {
  ADD_BUTTON_LABEL,
  ADD_TAG_LABEL,
  ADD_TAG_PLACEHOLDER,
  addTagDisabledReason,
  DICTIONARY_NOTE,
  FINAL_FULL_REASON,
  FINAL_NOTE,
  FINAL_TITLE,
  finalCountText,
  NEXT_APPROVAL_LABEL,
  normalizeTag,
  RemovableTag,
  TAGS_EMPTY_TEXT,
  tagsKeys,
  type TagSetOutput,
} from '@/features/tags';
import { isApiRequestError } from '@/shared/api/errors';
import { stepPath } from '@/shared/lib/steps';
import { Button, ButtonLink, DisabledReason } from '@/shared/ui';
import styles from './TagsPage.module.css';

export interface FinalTagsPanelProps {
  candidateId: number;
  /** ⑦ 산출물(없으면 실행 전) */
  set: TagSetOutput | undefined;
  /** 고칠 수 있는가(현재 버전이고 ⑦이 완료·재실행 필요) */
  editable: boolean;
  /** ⑦이 실행 중(오너 편집 202 재검증 포함) */
  running: boolean;
}

/**
 * '최종 태그' 패널(Tags.dc.html): 제목 · `n/10` · 안내 글 · 주 버튼 '다음: 최종 승인', 최종 태그(RemovableTag — 삭제 = owner-edits
 * TAGS EDIT `remove`), '태그 추가' 칸·'추가'(owner-edits `add` — 10개면 꺼지고 보드 문구) · "사전에 없는 태그는 '사전 미등록'으로 표시".
 * 편집은 202로 받고 재검증(규칙 필터·restricted-tags)이 끝나면 SSE `step-run.status-changed`가 산출물을 다시 읽힌다.
 */
export function FinalTagsPanel({ candidateId, set, editable, running }: FinalTagsPanelProps) {
  const queryClient = useQueryClient();
  const edit = useOwnerEdit();
  const [text, setText] = useState('');
  const finalTags = set?.finalTags ?? [];
  const finalKeys = finalTags.map((tag) => normalizeTag(tag.text));
  const busy = running || edit.isPending;
  const addReason = addTagDisabledReason({
    editable: editable && set !== undefined,
    running: busy,
    finalCount: finalTags.length,
    text,
    finalKeys,
  });
  const fullReason = finalTags.length >= 10 && !busy && editable ? FINAL_FULL_REASON : null;
  const shownReason = fullReason ?? (text.trim().length > 0 ? addReason : null);
  const unregistered = new Set(
    (set?.candidates ?? []).filter((c) => c.dictionaryUnregistered).map((c) => c.textKey),
  );

  const send = (add: string[], remove: string[]) => {
    if (!set) return;
    edit.reset();
    edit.mutate(
      {
        candidateId,
        stepCode: 'TAGS',
        body: { ownerAction: 'EDIT', baseStepRunId: set.stepRunId, add, remove },
      },
      {
        onSuccess: () => {
          setText('');
          void queryClient.invalidateQueries({ queryKey: tagsKeys.tagSet(candidateId) });
        },
      },
    );
  };

  const onAdd = (event: FormEvent) => {
    event.preventDefault();
    if (addReason === null) send([text.trim()], []);
  };

  return (
    <section aria-labelledby="final-title" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 id="final-title" className={styles.panelTitle}>
          {FINAL_TITLE}
        </h2>
        <span className={styles.count}>{finalCountText(finalTags.length)}</span>
        <span className={styles.caption}>{FINAL_NOTE}</span>
        <span className={styles.spacer} />
        <ButtonLink to={stepPath(candidateId, 'UPLOAD')} variant="primary">
          {NEXT_APPROVAL_LABEL}
        </ButtonLink>
      </div>
      {set ? (
        <ul aria-label={`최종 태그 ${finalTags.length}개`} className={styles.tagList}>
          {finalTags.map((tag) => (
            <RemovableTag
              key={tag.text}
              text={tag.text}
              dictionaryUnregistered={unregistered.has(normalizeTag(tag.text))}
              disabled={busy || !editable}
              onRemove={() => send([], [tag.text])}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.placeholder}>{TAGS_EMPTY_TEXT}</p>
      )}
      <form className={styles.addRow} onSubmit={onAdd}>
        <label htmlFor="tag-add" className={styles.label}>
          {ADD_TAG_LABEL}
        </label>
        <input
          id="tag-add"
          type="text"
          className={styles.addInput}
          placeholder={ADD_TAG_PLACEHOLDER}
          value={text}
          maxLength={100}
          disabled={busy || !editable}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          type="submit"
          disabled={addReason !== null}
          aria-describedby={shownReason ? 'tag-add-why' : undefined}
        >
          {ADD_BUTTON_LABEL}
        </Button>
        {shownReason ? <DisabledReason id="tag-add-why">{shownReason}</DisabledReason> : null}
        <span className={styles.spacer} />
        <span className={styles.caption}>{DICTIONARY_NOTE}</span>
      </form>
      {edit.error ? (
        <p role="alert" className={styles.failed}>
          {isApiRequestError(edit.error) ? edit.error.message : '태그를 고치지 못했습니다.'}
        </p>
      ) : null}
    </section>
  );
}

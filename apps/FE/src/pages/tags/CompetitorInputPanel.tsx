import { useRef, useState, type ChangeEvent } from 'react';
import {
  ADVANCED_TITLE,
  BLOCK_418_NOTICE,
  BROWSER_BUTTON_LABEL,
  BROWSER_LABEL,
  COMPETITOR_CAPTION,
  COMPETITOR_TITLE,
  FREE_TEXT_BUTTON_LABEL,
  FREE_TEXT_LABEL,
  FREE_TEXT_PLACEHOLDER,
  inputSummaryText,
  INPUTS_TITLE,
  PASTE_BUTTON_LABEL,
  PASTE_LABEL,
  PASTE_PLACEHOLDER,
  sourceTypeText,
  TAGS_RUNNING_REASON,
  UPLOAD_CAPTION,
  UPLOAD_LABEL,
  useCreateTagCompetitorInputMutation,
  useRemoveTagCompetitorInputMutation,
  type CompetitorInputSubmit,
  type TagCompetitorInputItem,
} from '@/features/tags';
import { isApiRequestError } from '@/shared/api/errors';
import {
  Banner,
  Button,
  DisabledReason,
  Disclosure,
  Icon,
  IconButton,
  Textarea,
  TextField,
} from '@/shared/ui';
import styles from './TagsPage.module.css';

export interface CompetitorInputPanelProps {
  candidateId: number;
  inputs: readonly TagCompetitorInputItem[];
  /** ⑦이 실행 중이면 입력을 바꿀 수 없다(409 STEP_LOCKED_BY_RUNNING_STEP) */
  running: boolean;
}

/** 오류 글(위치가 있으면 '행·열' 목록을 붙인다 — 값은 서버가 담지 않는다) */
function errorText(error: unknown): string {
  if (!isApiRequestError(error)) return '입력을 저장하지 못했습니다.';
  const where = (error.envelope.fieldErrors ?? [])
    .map((f) => f.field)
    .filter((f) => /^(row|text|file)/.test(f));
  return where.length > 0 ? `${error.message} (${where.join(', ')})` : error.message;
}

/**
 * '경쟁 태그 입력' 패널(Tags.dc.html, F-TG-02~06): '원본은 저장하지 않습니다', 엑셀 파일 올리기(셀라파인더 xlsx·CSV — FormData),
 * 붙여넣기(셀라파인더 표 → '읽기'), 자유 텍스트('더하기'), '(고급) 네이버쇼핑 검색 응답에서 태그 뽑기'(펼치면 418 차단 안내와
 * JSON·HAR 붙여넣기), 읽은 입력 목록(시각·개수·빈도순 여부)과 빼기. 앱은 네이버에 요청하지 않는다 — 오너가 붙여 넣은 글만 보낸다.
 */
export function CompetitorInputPanel({ candidateId, inputs, running }: CompetitorInputPanelProps) {
  const create = useCreateTagCompetitorInputMutation();
  const remove = useRemoveTagCompetitorInputMutation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState('');
  const [freeText, setFreeText] = useState('');
  const [browser, setBrowser] = useState('');
  const busy = running || create.isPending || remove.isPending;

  const submit = (input: CompetitorInputSubmit, clear: () => void) => {
    create.reset();
    create.mutate({ candidateId, input }, { onSuccess: clear });
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) submit({ kind: 'FILE', file }, () => undefined);
  };

  return (
    <section aria-labelledby="comp-title" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 id="comp-title" className={styles.panelTitle}>
          {COMPETITOR_TITLE}
        </h2>
        <span className={styles.caption}>{COMPETITOR_CAPTION}</span>
      </div>
      {running ? <DisabledReason tone="muted">{TAGS_RUNNING_REASON}</DisabledReason> : null}
      <div className={styles.uploadRow}>
        <Button disabled={busy} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={16} />
          {UPLOAD_LABEL}
        </Button>
        <span className={styles.caption}>{UPLOAD_CAPTION}</span>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className={styles.srOnly}
          tabIndex={-1}
          aria-label={UPLOAD_LABEL}
          onChange={onFile}
        />
      </div>
      <div className={styles.inputBlock}>
        <Textarea
          label={PASTE_LABEL}
          rows={2}
          placeholder={PASTE_PLACEHOLDER}
          value={paste}
          disabled={busy}
          onChange={(e) => setPaste(e.target.value)}
        />
        <Button
          size="sm"
          disabled={busy || paste.trim().length === 0}
          onClick={() =>
            submit({ kind: 'TEXT', sourceType: 'SELLERFINDER', text: paste }, () => setPaste(''))
          }
        >
          {PASTE_BUTTON_LABEL}
        </Button>
      </div>
      <div className={styles.freeRow}>
        <TextField
          label={FREE_TEXT_LABEL}
          placeholder={FREE_TEXT_PLACEHOLDER}
          value={freeText}
          disabled={busy}
          onChange={(e) => setFreeText(e.target.value)}
        />
        <Button
          disabled={busy || freeText.trim().length === 0}
          onClick={() =>
            submit({ kind: 'TEXT', sourceType: 'FREE_TEXT', text: freeText }, () => setFreeText(''))
          }
        >
          {FREE_TEXT_BUTTON_LABEL}
        </Button>
      </div>
      <Disclosure title={ADVANCED_TITLE}>
        <div className={styles.inputBlock}>
          <Banner tone="warning">{BLOCK_418_NOTICE}</Banner>
          <Textarea
            label={BROWSER_LABEL}
            rows={3}
            value={browser}
            disabled={busy}
            onChange={(e) => setBrowser(e.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || browser.trim().length === 0}
            onClick={() =>
              submit({ kind: 'TEXT', sourceType: 'BROWSER_RESPONSE', text: browser }, () =>
                setBrowser(''),
              )
            }
          >
            {BROWSER_BUTTON_LABEL}
          </Button>
        </div>
      </Disclosure>
      {create.error ? (
        <Banner tone="blocked" role="alert">
          {errorText(create.error)}
        </Banner>
      ) : null}
      {remove.error ? (
        <Banner tone="blocked" role="alert">
          {isApiRequestError(remove.error) ? remove.error.message : '입력을 빼지 못했습니다.'}
        </Banner>
      ) : null}
      {inputs.length > 0 ? (
        <div className={styles.inputList}>
          <span className={styles.label}>{INPUTS_TITLE}</span>
          <ul aria-label={INPUTS_TITLE} className={styles.plainList}>
            {inputs.map((input) => (
              <li key={input.id} className={styles.inputItem}>
                <span className={styles.inputSource}>{sourceTypeText(input.sourceType)}</span>
                <span className={styles.caption}>{inputSummaryText(input)}</span>
                <span className={styles.spacer} />
                <IconButton
                  icon="close"
                  size="sm"
                  aria-label={`${sourceTypeText(input.sourceType)} 입력 빼기`}
                  disabled={busy}
                  onClick={() => {
                    remove.reset();
                    remove.mutate({ candidateId, inputId: input.id });
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

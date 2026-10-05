import { type FormEvent, useState } from 'react';
import { useAddChildKeywordTermMutation, useChildKeywordTermsQuery } from '@/features/keywords';
import { Button, Chip, Panel, TextField } from '@/shared/ui';
import styles from './ChildTermsPanel.module.css';

/**
 * SCR-02 아동 단어(Keywords.dc.html 오른쪽 아래 '아동 단어 · 이 단어가 든 키워드는 뺍니다', F-KW-07). 보드의 '우선·제외 목록'
 * 패널은 M2라 아동 단어 부분만 따로 패널로 둔다(Proposed). 더할 수만 있고 뺄 수 없다. '단어 더하기'를 누르면 칸이 열린다.
 * 더한 단어는 다음 수집·붙여넣기부터 쓴다(이미 만든 목록에는 다시 적용하지 않는다).
 */
export function ChildTermsPanel() {
  const terms = useChildKeywordTermsQuery();
  const add = useAddChildKeywordTermMutation();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [added, setAdded] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = term.trim();
    if (value === '') return;
    add.mutate(value, {
      onSuccess: (created) => {
        setAdded(created.term);
        setTerm('');
        setOpen(false);
      },
    });
  };

  return (
    <Panel title="아동용 단어" caption="이 단어가 든 키워드는 뺍니다">
      {terms.isError ? <p className={styles.error}>{terms.error.message}</p> : null}
      <ul className={styles.chips} aria-label="아동용 단어 목록">
        {(terms.data?.items ?? []).map((t) => (
          <li key={t.term}>
            <Chip tone="neutral">{t.term}</Chip>
          </li>
        ))}
      </ul>
      {open ? (
        <form className={styles.form} onSubmit={submit}>
          <TextField
            label="더할 단어"
            value={term}
            maxLength={100}
            onChange={(e) => setTerm(e.target.value)}
            error={add.isError ? add.error.message : undefined}
          />
          <div className={styles.formActions}>
            <Button size="sm" type="submit" disabled={term.trim() === '' || add.isPending}>
              {add.isPending ? '더하는 중…' : '더하기'}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false);
                add.reset();
              }}
            >
              취소
            </Button>
          </div>
        </form>
      ) : null}
      <p className={styles.reason}>
        어린이 신발은 KC 인증이 없으면 팔 수 없어서, 이 단어가 든 키워드는 미리 뺍니다.
      </p>
      <div className={styles.foot}>
        <span className={styles.caption}>
          {added
            ? `'${added}' 단어를 더했습니다. 다음 수집·붙여넣기부터 뺍니다.`
            : '더할 수만 있고 뺄 수 없습니다'}
        </span>
        {!open ? (
          <Button
            size="sm"
            onClick={() => {
              setOpen(true);
              setAdded(null);
            }}
          >
            단어 더하기
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

import { useId, useState } from 'react';
import { Button, Icon, IconButton, Radio, Textarea } from '@/shared/ui';
import styles from './PastePanel.module.css';

/** 붙여넣기 분야 값(05-2 KeywordPasteRequest.cid): 여성신발·남성신발·모름(null, 기본) */
export type PasteCid = '50000173' | '50000174' | null;

const PASTE_FIELDS: readonly { value: PasteCid; label: string }[] = [
  { value: '50000173', label: '여성신발' },
  { value: '50000174', label: '남성신발' },
  { value: null, label: '모름' },
];

export interface PastePanelProps {
  onSubmit: (text: string, cid: PasteCid) => void;
  onClose: () => void;
  pending: boolean;
  /** 서버 오류(422 IMPORT_PARSE_FAILED면 줄별 문구를 함께) */
  error: { message: string; lines: string[] } | null;
}

/**
 * SCR-02 '순위 붙여넣기'(Keywords.dc.html 위 줄 오른쪽, F-KW-05). 데이터랩 화면에서 복사한 '순위 + 키워드' 텍스트를 붙여 넣고
 * 분야(기본 모름)를 골라 '목록 만들기'. 버튼 수집이 실패하거나 쉬는 중에도 늘 쓸 수 있다.
 */
export function PastePanel({ onSubmit, onClose, pending, error }: PastePanelProps) {
  const titleId = `paste-title-${useId()}`;
  const fieldLabelId = `paste-field-${useId()}`;
  const radioName = `paste-field-${useId()}`;
  const [text, setText] = useState('');
  const [cid, setCid] = useState<PasteCid>(null);
  const empty = text.trim() === '';

  return (
    <section id="paste-panel" aria-labelledby={titleId} className={styles.panel}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          순위 붙여넣기
        </h2>
        <IconButton icon="close" size="sm" aria-label="붙여넣기 패널 접기" onClick={onClose} />
      </div>
      <Textarea
        label="데이터랩 화면에서 복사한 순위와 키워드"
        placeholder={'1 뉴발란스 530\n2 아식스 젤카야노14'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={styles.textarea}
      />
      <div role="radiogroup" aria-labelledby={fieldLabelId} className={styles.field}>
        <span id={fieldLabelId} className={styles.label}>
          분야
        </span>
        <div className={styles.radios}>
          {PASTE_FIELDS.map((f) => (
            <Radio
              key={f.label}
              name={radioName}
              label={f.label}
              checked={cid === f.value}
              onChange={() => setCid(f.value)}
            />
          ))}
        </div>
      </div>
      <div className={styles.foot}>
        <p className={styles.caption}>
          모름이면 여정 성별은 ② 소싱에서 라쿠텐 장르·상품명으로 정합니다.
        </p>
        <Button disabled={empty || pending} onClick={() => onSubmit(text, cid)}>
          <Icon name="list" size={16} />
          {pending ? '만드는 중…' : '목록 만들기'}
        </Button>
      </div>
      {error ? (
        <div role="alert" className={styles.error}>
          <p className={styles.errorMessage}>{error.message}</p>
          {error.lines.length > 0 ? (
            <ul className={styles.errorLines}>
              {error.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

import { useId, useState } from 'react';
import {
  ANCHOR_LOCKED_NOTE,
  anchorLabel,
  type SourcingComparisonDetail,
  useFixSourcingAnchor,
} from '@/features/sourcing';
import { isApiRequestError } from '@/shared/api/errors';
import { Button, Icon, Radio, Select, TextField } from '@/shared/ui';
import styles from './AnchorPanel.module.css';

type AnchorMode = 'SEARCH_PICK' | 'CODE_ENTRY';

export interface AnchorPanelProps {
  /** 현재 ② 버전 비교표 머리(없으면 — ② 전 — 후보의 확정 앵커만 보인다) */
  head: SourcingComparisonDetail | undefined;
  /** 후보에 확정된 앵커 글(② 전·URL 후보) */
  fixedText: string | null;
}

/**
 * SCR-03 앵커 줄(Sourcing.dc.html '검색 조건' 아래, F-SO-08·11, P2-03 규칙 1·3).
 * - 앵커 전(탐색 모드 — 입력을 기다리는 검색·비교 버전): '검색 결과에서 고르기'(기준 상품) 또는 '型番+색상 코드 입력' →
 *   '앵커 정하기'(`fixSourcingAnchor` 202 — 분류는 곧바로, 페이지 조회는 뒤에서 SSE로)
 * - 앵커 뒤: '型番 1201A019 · 색상 코드 108 · 크림/블랙' + '이 후보에서는 바꿀 수 없습니다 · 다른 모델·색상은 새 후보로 만듭니다'
 *   (읽기 전용)
 */
export function AnchorPanel({ head, fixedText }: AnchorPanelProps) {
  const uid = useId();
  const fix = useFixSourcingAnchor();
  const [mode, setMode] = useState<AnchorMode>('SEARCH_PICK');
  const [itemCode, setItemCode] = useState('');
  const [modelCode, setModelCode] = useState('');
  const [colorCode, setColorCode] = useState('');

  const anchored = head && !head.exploreMode ? anchorLabel(head) : fixedText;
  if (anchored) {
    return (
      <div className={styles.row} aria-label="앵커">
        <Icon name="lock" size={16} />
        <span className={styles.label}>앵커</span>
        <span className={styles.chip}>{anchored}</span>
        <span className={styles.caption}>{ANCHOR_LOCKED_NOTE}</span>
      </div>
    );
  }
  const editable =
    !!head &&
    head.exploreMode &&
    head.comparisonPerformed &&
    head.isCurrent &&
    head.stepStatus === 'WAITING_INPUT';
  if (!head || !editable) return null;

  const pick = itemCode || head.rows[0]?.itemCode || '';
  const color = colorCode.trim() === '' ? null : colorCode.trim();
  const canSubmit = mode === 'SEARCH_PICK' ? pick !== '' : modelCode.trim() !== '';
  const submit = () => {
    if (!canSubmit || fix.isPending) return;
    fix.mutate({
      sourcingComparisonId: head.id,
      body:
        mode === 'SEARCH_PICK'
          ? { anchorInputMethod: 'SEARCH_PICK', anchorItemCode: pick, anchorColorCode: color }
          : {
              anchorInputMethod: 'CODE_ENTRY',
              anchorModelCode: modelCode.trim(),
              anchorColorCode: color,
            },
    });
  };
  const error = fix.error
    ? isApiRequestError(fix.error)
      ? fix.error.message
      : '앵커를 정하지 못했습니다.'
    : null;

  return (
    <div className={styles.editor} aria-label="앵커 정하기">
      <div className={styles.head}>
        <span className={styles.label}>앵커</span>
        <div role="radiogroup" aria-label="앵커 정하는 방법" className={styles.modes}>
          <Radio
            name={`anchor-mode-${uid}`}
            label="검색 결과에서 고르기"
            checked={mode === 'SEARCH_PICK'}
            onChange={() => setMode('SEARCH_PICK')}
          />
          <Radio
            name={`anchor-mode-${uid}`}
            label="型番+색상 코드 입력"
            checked={mode === 'CODE_ENTRY'}
            onChange={() => setMode('CODE_ENTRY')}
          />
        </div>
      </div>
      <div className={styles.fields}>
        {mode === 'SEARCH_PICK' ? (
          <Select
            label="기준 상품"
            value={pick}
            onChange={(e) => setItemCode(e.target.value)}
            className={styles.item}
          >
            {head.rows.map((row) => (
              <option key={row.id} value={row.itemCode}>
                {`${row.shopName ?? row.shopCode} · ${row.itemName}`}
              </option>
            ))}
          </Select>
        ) : (
          <TextField
            label="型番"
            mono
            value={modelCode}
            placeholder="1201A019"
            onChange={(e) => setModelCode(e.target.value)}
            className={styles.code}
          />
        )}
        <TextField
          label="색상 코드(선택)"
          mono
          value={colorCode}
          placeholder="108"
          onChange={(e) => setColorCode(e.target.value)}
          className={styles.code}
        />
        <Button variant="primary" disabled={!canSubmit || fix.isPending} onClick={submit}>
          {fix.isPending ? '정하는 중…' : '앵커 정하기'}
        </Button>
      </div>
      <p className={styles.caption}>
        앵커(型番·색상)를 정하면 같은 상품만 모아 상품 페이지를 읽고 재고·실질가를 계산합니다. 정한
        뒤에는 이 후보에서 바꿀 수 없습니다.
      </p>
      {error ? (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

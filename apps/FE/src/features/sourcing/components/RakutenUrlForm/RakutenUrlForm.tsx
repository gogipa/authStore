import { useId, useState, type ReactNode } from 'react';
import { useCreateCandidate } from '@/features/step-engine';
import { isApiRequestError } from '@/shared/api/errors';
import { cx } from '@/shared/lib/cx';
import { Button, DisabledReason, Radio, Select, TextField } from '@/shared/ui';
import { useAddManualRow, useFetchRakutenItem, useRakutenItem } from '../../api/queries';
import {
  colorOptionsOf,
  entryCheckNotice,
  excludedWordsText,
  existingCandidateIdOf,
  TABLE_MODE_NOT_READY,
  URL_PLACEHOLDER,
  type UrlPasteMode,
} from '../../model/sourcing';
import styles from './RakutenUrlForm.module.css';

const MODE_LABEL: Record<UrlPasteMode, string> = {
  TABLE: '비교표에 넣기',
  CREATE: '바로 여정 만들기',
};

export interface RakutenUrlFormProps {
  /** 칸 라벨. `heading`이면 패널 제목 크기(Sourcing 보드 '라쿠텐 URL 붙여넣기'), `field`면 필드 라벨 */
  label: string;
  labelVariant?: 'heading' | 'field';
  /** 라벨 줄 오른쪽 캡션(보드 '건당 페이지 1회 조회 · 하루 조회에 포함') */
  caption?: ReactNode;
  /** 넣는 방법. 둘이면 라디오를 보인다(보드), 하나면 그 방법만 */
  modes?: readonly UrlPasteMode[];
  /** 페이지를 읽을 수 없는 이유(하루 상한·24시간 쉼 — `pageReadBlockedReason`). 있으면 '넣기'를 끈다 */
  blockedReason?: string | null;
  /** 만든 여정(또는 CANDIDATE_DUPLICATE의 기존 여정)을 연다 — 부르는 화면이 이동한다 */
  onOpenCandidate: (candidateId: number) => void;
  /** 아래 줄 왼쪽 안내 글(보드 문구) */
  note?: ReactNode;
  /** 아래 줄 오른쪽(보드: '성인용 상품 확인' 220px) */
  aside?: ReactNode;
  /**
   * '비교표에 넣기'(수동 행, P2-03 F-SO-34)를 받을 비교표. 없거나 `tableBlockedReason`이 있으면 그 방법을 끄고 이유를 보인다
   */
  tableComparisonId?: number | null;
  /** '비교표에 넣기'를 쓸 수 없는 이유(앵커 전·입력 대기 아님 등) */
  tableBlockedReason?: string | null;
}

/**
 * 라쿠텐 URL 붙여넣기(F-SO-31·32·33·35, P2-02). '넣기' → `fetchRakutenItem`(하루 페이지 조회 1건) → 상품·입구 검사 →
 * 색상 고르기(`getRakutenItem` SKU·variantSelectors) → '여정 만들기'(`createCandidate` RAKUTEN_URL). 만든 여정을 연다.
 * - 제외어(中古·キッズ 등)가 든 상품은 여정을 만들지 않고 문구를 보인다(입구 검사·422 RAKUTEN_ITEM_EXCLUDED_WORD 모두)
 * - 409 CANDIDATE_DUPLICATE면 `details.existingCandidateId` 여정을 연다
 * - 아동화 의심·대상 외 장르는 막지 않고 알린다 — 여정을 만든 뒤 ②가 '성인용 상품 확인' 입력 대기로 멈춘다
 * - '비교표에 넣기'(수동 행, P2-03 F-SO-34): 넣기 → 읽은 상품 → '비교표에 넣기'(`addSourcingComparisonManualRow`). 앵커 전·입력
 *   대기가 아닌 버전이면 그 방법을 끄고 이유를 보인다
 */
export function RakutenUrlForm({
  label,
  labelVariant = 'field',
  caption,
  modes = ['TABLE', 'CREATE'],
  blockedReason = null,
  onOpenCandidate,
  note,
  aside,
  tableComparisonId = null,
  tableBlockedReason = null,
}: RakutenUrlFormProps) {
  const uid = useId();
  const inputId = `rakuten-url-${uid}`;
  const modeLabelId = `rakuten-url-mode-${uid}`;
  const reasonId = `rakuten-url-why-${uid}`;
  const tableReasonId = `rakuten-url-table-why-${uid}`;
  const [url, setUrl] = useState('');
  // '비교표에 넣기'(P2-03): 비교표가 앵커를 정하고 입력을 기다릴 때만. 보드 기본 선택도 '비교표에 넣기'다
  const tableReason =
    tableBlockedReason ?? (tableComparisonId === null ? TABLE_MODE_NOT_READY : null);
  const tableEnabled = modes.includes('TABLE') && tableReason === null;
  const [modeChoice, setModeChoice] = useState<UrlPasteMode | null>(null);
  const mode: UrlPasteMode =
    modes.length === 1
      ? modes[0]!
      : modeChoice === 'TABLE' && !tableEnabled
        ? 'CREATE'
        : (modeChoice ?? (tableEnabled ? 'TABLE' : 'CREATE'));
  const [colorChoice, setColorChoice] = useState<string | null>(null);
  const fetchItem = useFetchRakutenItem();
  const createCandidate = useCreateCandidate();
  const addRow = useAddManualRow();
  const fetched = fetchItem.data ?? null;
  const item = useRakutenItem(fetched?.rakutenItem.id ?? null);
  const colors = colorOptionsOf(item.data ?? fetched?.rakutenItem);
  const color = colorChoice ?? (colors.length === 1 ? colors[0]! : '');

  const reason = blockedReason;
  const busy = fetchItem.isPending || createCandidate.isPending;
  const submitDisabled = url.trim() === '' || busy || reason !== null;

  const submit = () => {
    if (submitDisabled) return;
    createCandidate.reset();
    addRow.reset();
    setColorChoice(null);
    fetchItem.mutate(url.trim());
  };

  const addToTable = () => {
    if (!fetched || tableComparisonId === null) return;
    addRow.mutate({
      sourcingComparisonId: tableComparisonId,
      rakutenItemId: fetched.rakutenItem.id,
    });
  };

  const create = () => {
    if (!fetched || color.trim() === '') return;
    createCandidate.mutate(
      { creationPath: 'RAKUTEN_URL', rakutenItemId: fetched.rakutenItem.id, selectedColor: color },
      {
        onSuccess: (candidate) => onOpenCandidate(candidate.id),
        onError: (error) => {
          const existing = existingCandidateIdOf(error);
          if (existing !== null) onOpenCandidate(existing);
        },
      },
    );
  };

  const fetchError = fetchItem.error
    ? isApiRequestError(fetchItem.error)
      ? fetchItem.error.message
      : '상품 페이지를 읽지 못했습니다.'
    : undefined;
  const createError =
    createCandidate.error && existingCandidateIdOf(createCandidate.error) === null
      ? isApiRequestError(createCandidate.error)
        ? createCandidate.error.message
        : '여정을 만들지 못했습니다.'
      : null;
  const addError = addRow.error
    ? isApiRequestError(addRow.error)
      ? addRow.error.message
      : '비교표에 넣지 못했습니다.'
    : null;
  const excluded = fetched?.checks.excludedWords ?? [];
  const notice = fetched ? entryCheckNotice(fetched.checks) : null;

  return (
    <div className={styles.form}>
      <div className={styles.inputRow}>
        <div className={styles.urlField}>
          <div className={styles.labelRow}>
            <label
              htmlFor={inputId}
              className={labelVariant === 'heading' ? styles.headingLabel : styles.fieldLabel}
            >
              {label}
            </label>
            {caption ? <span className={styles.caption}>{caption}</span> : null}
          </div>
          <TextField
            id={inputId}
            type="url"
            value={url}
            placeholder={URL_PLACEHOLDER}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            aria-invalid={fetchError ? true : undefined}
            aria-describedby={fetchError ? `${inputId}-error` : undefined}
          />
        </div>
        {modes.length > 1 ? (
          <div role="radiogroup" aria-labelledby={modeLabelId} className={styles.modes}>
            <span id={modeLabelId} className={styles.fieldLabel}>
              넣는 방법
            </span>
            <div className={styles.modeOptions}>
              {modes.map((m) => (
                <Radio
                  key={m}
                  name={`rakuten-url-mode-${uid}`}
                  label={MODE_LABEL[m]}
                  checked={mode === m}
                  disabled={m === 'TABLE' && !tableEnabled}
                  aria-describedby={m === 'TABLE' && !tableEnabled ? tableReasonId : undefined}
                  onChange={() => setModeChoice(m)}
                />
              ))}
            </div>
          </div>
        ) : null}
        <Button
          disabled={submitDisabled}
          aria-describedby={reason ? reasonId : undefined}
          onClick={submit}
        >
          {fetchItem.isPending ? '읽는 중…' : '넣기'}
        </Button>
      </div>
      {modes.includes('TABLE') && !tableEnabled && tableReason ? (
        <DisabledReason id={tableReasonId} tone="muted">
          {tableReason}
        </DisabledReason>
      ) : null}
      {reason ? <DisabledReason id={reasonId}>{reason}</DisabledReason> : null}
      {fetchError ? (
        <span id={`${inputId}-error`} role="alert" className={styles.error}>
          {fetchError}
        </span>
      ) : null}
      {fetched ? (
        <div className={styles.result} aria-label="읽은 상품">
          <div className={styles.itemLine}>
            <span className={styles.itemName}>{fetched.rakutenItem.itemName}</span>
            <span className={styles.itemMeta}>
              {fetched.rakutenItem.shopName ? `${fetched.rakutenItem.shopName} · ` : ''}
              <span className={styles.mono}>{fetched.rakutenItem.itemCode}</span>
            </span>
          </div>
          {excluded.length > 0 ? (
            <span role="alert" className={styles.error}>
              {excludedWordsText(excluded)}
            </span>
          ) : mode === 'TABLE' ? (
            <div className={styles.createRow}>
              {addRow.isSuccess ? (
                <span className={styles.notice}>비교표에 &apos;수동&apos; 행으로 넣었습니다.</span>
              ) : null}
              <Button disabled={addRow.isPending || addRow.isSuccess} onClick={addToTable}>
                {addRow.isPending ? '넣는 중…' : '비교표에 넣기'}
              </Button>
            </div>
          ) : (
            <>
              {notice ? <span className={styles.notice}>{notice}</span> : null}
              {fetched.rakutenItem.manualCheckRequired ? (
                <span className={styles.caption}>
                  페이지에서 읽지 못한 칸이 있어 &apos;수동 확인&apos;으로 넘깁니다.
                </span>
              ) : null}
              <div className={styles.createRow}>
                {colors.length > 0 ? (
                  <Select
                    label="색상"
                    value={color}
                    onChange={(e) => setColorChoice(e.target.value)}
                    className={styles.color}
                  >
                    {colors.length > 1 ? <option value="">색상을 고르세요</option> : null}
                    {colors.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <TextField
                    label="색상"
                    value={color}
                    onChange={(e) => setColorChoice(e.target.value)}
                    className={styles.color}
                  />
                )}
                <Button
                  disabled={color.trim() === '' || createCandidate.isPending}
                  onClick={create}
                >
                  {createCandidate.isPending ? '만드는 중…' : '이 색상으로 여정 만들기'}
                </Button>
              </div>
            </>
          )}
          {createError ? (
            <span role="alert" className={styles.error}>
              {createError}
            </span>
          ) : null}
          {addError ? (
            <span role="alert" className={styles.error}>
              {addError}
            </span>
          ) : null}
        </div>
      ) : null}
      {note || aside ? (
        <div className={cx(styles.bottomRow)}>
          {note ? <p className={styles.note}>{note}</p> : <span />}
          {aside ? <div className={styles.aside}>{aside}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  COLOR_EDIT_LABEL,
  COLOR_EMPTY_REASON,
  COLOR_NOT_EDITABLE_REASON,
  COLOR_ROW_LABEL,
  COLOR_SAVE_LABEL,
  contentKeys,
  FACT_EMPTY_TEXT,
  FACT_HEAD_NOTE,
  factField,
  factMetaText,
  factMethodText,
  factSourceText,
  factValueText,
  MATERIAL_PARTS,
  ORIGIN_INPUT_LABEL,
  ORIGIN_NOT_EDITABLE_REASON,
  ORIGIN_SAVE_LABEL,
  ORIGIN_WAITING_TEXT,
  originSaveDisabledReason,
  RECHECK_CONFIRM_LABEL,
  RECHECK_LABEL,
  usePutContentFieldMutation,
  type ContentDraftFieldItem,
  type ContentFactOutput,
} from '@/features/content';
import { useOwnerEdit, type CandidateStepRailItem } from '@/features/step-engine';
import { isApiRequestError } from '@/shared/api/errors';
import { aiGeneratedLabel } from '@/shared/lib/aiEngine';
import { externalLinkProps, useDemo } from '@/shared/lib/demo';
import { Banner, Button, Chip, DisabledReason, StatusChip, TextField } from '@/shared/ui';
import styles from './ContentPage.module.css';

export interface FactTableProps {
  candidateId: number;
  /** ⑥-2 레일 칸 */
  item: CandidateStepRailItem | undefined;
  /** ⑥-2 현재 버전 산출물(없으면 실행 전) */
  output: ContentFactOutput | undefined;
  /** 머리 오른쪽 '⑥-2 실행' 버튼 자리 */
  runAction?: ReactNode;
}

function errorText(error: unknown): string {
  return isApiRequestError(error) ? error.message : '요청을 처리하지 못했습니다.';
}

/** 값 칸 한 줄: 값 · '직접 입력'·'재확인 필요' 칩 */
function ValueLine({
  field,
  prefix,
}: {
  field: ContentDraftFieldItem | undefined;
  prefix?: string;
}) {
  return (
    <span className={styles.factValue}>
      {prefix ? `${prefix} ` : ''}
      {factValueText(field?.value)}
      {field?.valueSource === 'OWNER_INPUT' ? <Chip tone="neutral">직접 입력</Chip> : null}
      {field?.recheckRequired ? <Chip tone="waiting">{RECHECK_LABEL}</Chip> : null}
    </span>
  );
}

/** 출처 · 방법 칸 한 줄 */
function SourceLine({ field }: { field: ContentDraftFieldItem | undefined }) {
  const demo = useDemo();
  if (!field) return <span className={styles.caption}>—</span>;
  return (
    <span className={styles.factSource}>
      {field.valueSource === 'OWNER_INPUT' && field.evidenceUrl ? (
        <a {...externalLinkProps(field.evidenceUrl, demo)}>{factSourceText(field)}</a>
      ) : (
        <span>{factSourceText(field)}</span>
      )}
      <span className={styles.caption}>{factMethodText(field)}</span>
    </span>
  );
}

const quote = (field: ContentDraftFieldItem | undefined) =>
  field?.evidenceQuote ? `'${field.evidenceQuote}'` : '—';

/**
 * ⑥-2 원산지·소재 구획(SCR-06 Content.dc.html `#origin`, F-CT-12·13·14·15, P3-03 규칙 9~14): 머리(상태 칩·'14:24 추출 · v1'·
 * 보드 안내 글) + 표(항목 · 값 · 근거 원문 · 출처·방법 · 동작). 방법 글은 '상품 속성에서 찾음'·'설명문에서 찾음'·'AI로 찾음'·
 * '정보 없음'. 소재는 한 줄에 겉감·안감·밑창을 나눠 보인다. 원산지 '직접 넣기'(나라 + 근거 URL + 원문 발췌 — 근거 URL을 넣기 전에는
 * 저장이 꺼진다): 입력 대기면 `PUT …/content-fields/fact.origin`, 완료된 현재 버전이면 오너 수정(EDIT). '재확인 필요' 칩과 완료 뒤
 * '현재 근거로 확인'(오너 수정 recheckConfirmed). 입력 대기면 경고 띠.
 * P3-04(F-CT-17): '색상 표기' 줄(값 · 선택 색상 원문 · '색상 사전으로 바꿈'/'사전에 없어 AI 보조' · '고치기') — 입력 대기면
 * `PUT …/content-fields/fact.color_ko`, 완료된 현재 버전이면 오너 수정(EDIT). 주의 문구(fact.caution)는 ⑥-3 고시 표가 보인다.
 */
export function FactTable({ candidateId, item, output, runAction }: FactTableProps) {
  const queryClient = useQueryClient();
  const putField = usePutContentFieldMutation();
  const edit = useOwnerEdit();
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [evidenceQuote, setEvidenceQuote] = useState('');
  const [colorOpen, setColorOpen] = useState(false);
  const [colorText, setColorText] = useState('');

  const fields = output?.fields ?? [];
  const origin = factField(fields, 'fact.origin');
  const heel = factField(fields, 'fact.heel_height');
  const color = factField(fields, 'fact.color_ko');
  const waiting = output?.stepRunStatus === 'WAITING_INPUT' && output.isCurrent;
  const completed =
    output?.isCurrent === true &&
    (output.stepRunStatus === 'COMPLETED' || output.stepRunStatus === 'RERUN_REQUIRED');
  const originEditable = waiting || completed;
  const saveReason = originSaveDisabledReason(country, evidenceUrl);
  const pending = putField.isPending || edit.isPending;
  const error = putField.error ?? edit.error;
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: contentKeys.fact(candidateId) });

  const saveOrigin = () => {
    if (!output) return;
    putField.reset();
    edit.reset();
    const onSuccess = () => {
      setOpen(false);
      refresh();
    };
    if (waiting) {
      putField.mutate(
        {
          candidateId,
          stepRunId: output.stepRunId,
          fieldKey: 'fact.origin',
          body: {
            value: country.trim(),
            evidenceUrl: evidenceUrl.trim(),
            evidenceQuote: evidenceQuote.trim() || null,
          },
        },
        { onSuccess },
      );
      return;
    }
    edit.mutate(
      {
        candidateId,
        stepCode: 'NOTICE_RAW',
        body: {
          ownerAction: 'EDIT',
          baseStepRunId: output.stepRunId,
          fields: [
            { fieldKey: 'fact.origin', value: country.trim(), evidenceUrl: evidenceUrl.trim() },
          ],
        },
      },
      { onSuccess },
    );
  };

  /** 색상 표기 고치기(P3-04 F-CT-17): 입력 대기면 열린 실행에 PUT, 완료된 현재 버전이면 오너 수정(EDIT) */
  const saveColor = () => {
    if (!output) return;
    putField.reset();
    edit.reset();
    const value = colorText.trim();
    const onSuccess = () => {
      setColorOpen(false);
      refresh();
    };
    if (waiting) {
      putField.mutate(
        { candidateId, stepRunId: output.stepRunId, fieldKey: 'fact.color_ko', body: { value } },
        { onSuccess },
      );
      return;
    }
    edit.mutate(
      {
        candidateId,
        stepCode: 'NOTICE_RAW',
        body: {
          ownerAction: 'EDIT',
          baseStepRunId: output.stepRunId,
          fields: [{ fieldKey: 'fact.color_ko', value }],
        },
      },
      { onSuccess },
    );
  };

  const confirmRecheck = (field: ContentDraftFieldItem) => {
    if (!output) return;
    edit.reset();
    edit.mutate(
      {
        candidateId,
        stepCode: 'NOTICE_RAW',
        body: {
          ownerAction: 'EDIT',
          baseStepRunId: output.stepRunId,
          fields: [{ fieldKey: field.fieldKey, recheckConfirmed: true }],
        },
      },
      { onSuccess: refresh },
    );
  };

  const recheckButton = (field: ContentDraftFieldItem | undefined) =>
    field?.recheckRequired && completed ? (
      <Button size="sm" disabled={pending} onClick={() => confirmRecheck(field)}>
        {RECHECK_CONFIRM_LABEL}
      </Button>
    ) : null;

  return (
    <section id="origin" aria-labelledby="origin-title" className={styles.sub}>
      <div className={styles.subHead}>
        <h2 id="origin-title" className={styles.subTitle}>
          ⑥-2 원산지·소재
        </h2>
        {item ? <StatusChip status={item.status} /> : null}
        {output ? (
          <>
            {item?.currentRun?.aiEngine ? (
              <Chip tone="outline">{aiGeneratedLabel(item.currentRun.aiEngine)}</Chip>
            ) : null}
            <span className={styles.caption}>{factMetaText(output)}</span>
          </>
        ) : null}
        <span className={styles.caption}>{FACT_HEAD_NOTE}</span>
        <span className={styles.spacer} />
        {runAction}
      </div>
      {waiting ? <Banner tone="warning">{ORIGIN_WAITING_TEXT}</Banner> : null}
      {error ? (
        <Banner tone="blocked" role="alert">
          {errorText(error)}
        </Banner>
      ) : null}
      {!output ? (
        <p className={styles.placeholder}>{FACT_EMPTY_TEXT}</p>
      ) : (
        <div className={styles.tableBox}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">항목</th>
                <th scope="col">값</th>
                <th scope="col">근거 원문</th>
                <th scope="col">출처 · 방법</th>
                <th scope="col" aria-label="동작" />
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">원산지</th>
                <td>
                  <ValueLine field={origin} />
                </td>
                <td className={styles.quote}>{quote(origin)}</td>
                <td>
                  <SourceLine field={origin} />
                </td>
                <td className={styles.actionCell}>
                  <Button
                    size="sm"
                    aria-label="원산지를 근거 URL과 함께 직접 넣기"
                    aria-expanded={open}
                    disabled={!originEditable || pending}
                    aria-describedby={originEditable ? undefined : 'origin-input-why'}
                    onClick={() => setOpen((v) => !v)}
                  >
                    {ORIGIN_INPUT_LABEL}
                  </Button>
                  {recheckButton(origin)}
                </td>
              </tr>
              <tr>
                <th scope="row">소재</th>
                <td>
                  <span className={styles.stack}>
                    {MATERIAL_PARTS.map((part) => (
                      <ValueLine
                        key={part.key}
                        field={factField(fields, part.key)}
                        prefix={part.label}
                      />
                    ))}
                  </span>
                </td>
                <td className={styles.quote}>
                  <span className={styles.stack}>
                    {MATERIAL_PARTS.map((part) => (
                      <span key={part.key}>{quote(factField(fields, part.key))}</span>
                    ))}
                  </span>
                </td>
                <td>
                  <span className={styles.stack}>
                    {MATERIAL_PARTS.map((part) => (
                      <SourceLine key={part.key} field={factField(fields, part.key)} />
                    ))}
                  </span>
                </td>
                <td className={styles.actionCell}>
                  {MATERIAL_PARTS.map((part) => {
                    const f = factField(fields, part.key);
                    return f?.recheckRequired && completed ? (
                      <Button
                        key={part.key}
                        size="sm"
                        disabled={pending}
                        onClick={() => confirmRecheck(f)}
                      >
                        {`${part.label} ${RECHECK_CONFIRM_LABEL}`}
                      </Button>
                    ) : null;
                  })}
                </td>
              </tr>
              <tr>
                <th scope="row">굽높이</th>
                <td>
                  <ValueLine field={heel} />
                </td>
                <td className={styles.quote}>{quote(heel)}</td>
                <td>
                  <SourceLine field={heel} />
                </td>
                <td className={styles.actionCell}>{recheckButton(heel)}</td>
              </tr>
              {color ? (
                <tr>
                  <th scope="row">{COLOR_ROW_LABEL}</th>
                  <td>
                    <span className={styles.factValue}>
                      <ValueLine field={color} />
                      {color.valueSource === 'GENERATED' && color.extractionMethod === 'AI' ? (
                        <Chip tone="outline">AI 생성</Chip>
                      ) : null}
                    </span>
                  </td>
                  <td className={styles.quote}>{quote(color)}</td>
                  <td>
                    <SourceLine field={color} />
                  </td>
                  <td className={styles.actionCell}>
                    <Button
                      size="sm"
                      aria-label="색상 표기 고치기"
                      aria-expanded={colorOpen}
                      disabled={!originEditable || pending}
                      aria-describedby={originEditable ? undefined : 'origin-input-why'}
                      onClick={() => {
                        setColorText(typeof color.value === 'string' ? color.value : '');
                        setColorOpen((v) => !v);
                      }}
                    >
                      {COLOR_EDIT_LABEL}
                    </Button>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {output && !originEditable ? (
        <DisabledReason id="origin-input-why" tone="muted" className={styles.reasonLine}>
          {color ? COLOR_NOT_EDITABLE_REASON : ORIGIN_NOT_EDITABLE_REASON}
        </DisabledReason>
      ) : null}
      {colorOpen && output ? (
        <div className={styles.originForm} role="group" aria-label="색상 표기 고치기">
          <TextField
            label={COLOR_ROW_LABEL}
            value={colorText}
            placeholder="예: 크림/블랙"
            onChange={(e) => setColorText(e.target.value)}
          />
          <span className={styles.formActions}>
            <Button
              disabled={colorText.trim() === '' || pending}
              aria-describedby={colorText.trim() === '' ? 'color-save-why' : undefined}
              onClick={saveColor}
            >
              {COLOR_SAVE_LABEL}
            </Button>
            {colorText.trim() === '' ? (
              <DisabledReason id="color-save-why">{COLOR_EMPTY_REASON}</DisabledReason>
            ) : null}
          </span>
        </div>
      ) : null}
      {open && output ? (
        <div className={styles.originForm} role="group" aria-label="원산지 직접 넣기">
          <TextField
            label="나라"
            value={country}
            placeholder="예: 베트남"
            onChange={(e) => setCountry(e.target.value)}
          />
          <TextField
            label="근거 URL"
            type="url"
            value={evidenceUrl}
            placeholder="라쿠텐 상품 페이지 주소"
            onChange={(e) => setEvidenceUrl(e.target.value)}
          />
          {waiting ? (
            <TextField
              label="원문 발췌(선택)"
              value={evidenceQuote}
              placeholder="예: 原産国：ベトナム"
              onChange={(e) => setEvidenceQuote(e.target.value)}
            />
          ) : null}
          <span className={styles.formActions}>
            <Button
              disabled={saveReason !== null || pending}
              aria-describedby={saveReason ? 'origin-save-why' : undefined}
              onClick={saveOrigin}
            >
              {ORIGIN_SAVE_LABEL}
            </Button>
            {saveReason ? <DisabledReason id="origin-save-why">{saveReason}</DisabledReason> : null}
          </span>
        </div>
      ) : null}
    </section>
  );
}

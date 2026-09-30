import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ASSEMBLY_EMPTY_TEXT,
  assemblyField,
  assemblyMetaText,
  contentKeys,
  DISCLOSURE_FULL_LABEL,
  DISCLOSURE_LOCKED_CHIP,
  DISCLOSURE_MATCHED_CHIP,
  DISCLOSURE_MISMATCHED_CHIP,
  DISCLOSURE_PREVIEW_LINES,
  DISCLOSURE_TITLE,
  disclosureFootText,
  FIXED_TEXT_LABELS,
  FIXED_TEXTS_SUMMARY,
  HEIGHT_OMITTED_TEXT,
  missingAssemblyProfile,
  NOTICE_EDIT_LABEL,
  NOTICE_EDIT_LABELS,
  NOTICE_SAVE_LABEL,
  NOTICE_TITLE,
  noticeEditFields,
  noticeFormOf,
  noticeText,
  originText,
  PRODUCT_NAME_LABEL,
  PRODUCT_NAME_NOT_EDITABLE_REASON,
  PRODUCT_NAME_SAVE_LABEL,
  PRODUCT_NAME_TEMPLATE_CHIP,
  PRODUCT_NAME_TEMPLATE_TEXT,
  PRODUCT_NAME_TOO_LONG_TEXT,
  productNameCheckText,
  productNameCounter,
  productNameSaveDisabledReason,
  productNameTooLong,
  PROFILE_FILL_LINK_LABEL,
  PROFILE_LINK_LABEL,
  PROFILE_OK_TEXT,
  profileMissingText,
  RECHECK_CONFIRM_LABEL,
  RECHECK_LABEL,
  SETTINGS_PATH,
  SPEC_BLOCK_CAPTION,
  SPEC_BLOCK_TITLE,
  specBlockLines,
  type ContentAssemblyOutput,
  type ContentDraftFieldItem,
  type EditableNoticeKey,
  type NoticeForm,
} from '@/features/content';
import { usePurchaseAgencyProfileQuery } from '@/features/settings';
import { useOwnerEdit, type CandidateStepRailItem } from '@/features/step-engine';
import { isApiRequestError, type ApiRequestError } from '@/shared/api/errors';
import {
  Banner,
  Button,
  ButtonLink,
  Chip,
  DefinitionList,
  DisabledReason,
  Disclosure,
  StatusChip,
  TextField,
} from '@/shared/ui';
import styles from './ContentPage.module.css';
import { DetailPreview } from './DetailPreview';

export interface AssemblySectionProps {
  candidateId: number;
  /** ⑥-3 레일 칸 */
  item: CandidateStepRailItem | undefined;
  /** ⑥-3 현재 버전 산출물(없으면 실행 전) */
  output: ContentAssemblyOutput | undefined;
  /** 조립 결과를 다시 받은 시각(미리보기 iframe 다시 열기) */
  reloadKey: number;
  /** 머리 오른쪽 '⑥-3 실행' 버튼 자리 */
  runAction?: ReactNode;
  /** 실행 요청 오류(409 PROFILE_INCOMPLETE면 프로필 링크 띠를 보인다) */
  runError?: ApiRequestError | Error | null;
}

function errorText(error: unknown): string {
  return isApiRequestError(error) ? error.message : '요청을 처리하지 못했습니다.';
}

/** 값 옆 '직접 입력'·'재확인 필요' 칩 */
function FieldChips({ field }: { field: ContentDraftFieldItem | undefined }) {
  if (!field) return null;
  return (
    <>
      {field.valueSource === 'OWNER_INPUT' ? <Chip tone="neutral">직접 입력</Chip> : null}
      {field.recheckRequired ? <Chip tone="waiting">{RECHECK_LABEL}</Chip> : null}
    </>
  );
}

/**
 * ⑥-3 고시·HTML 구획(SCR-06 Content.dc.html `#notice`, F-CT-01~04·16~34, P3-04 규칙 3~15):
 * - 머리: 상태 칩 · '14:32 조립 · v2 · AI 없이 규칙으로 만듦' · '프로필 확인됨: 상호·수입자·A/S' + '프로필 보기'(빈칸이면 막힘 띠
 *   + 설정 링크 — 409 PROFILE_INCOMPLETE도 같다) · '⑥-3 실행'
 * - [상품명 칸(`33/100` · '템플릿 제안' 칩 · 금지 수식어·반복·병행 글 · 템플릿 설명 · '상품명 저장' — 100자를 넘어도 저장은 켜진다) |
 *   상품 사양 블록('⑥-2와 같은 기록으로 만듦')]
 * - [고시 표('상품정보제공고시 · 신발' · '필드 고치기' · 재확인 필요 → '현재 근거로 확인') | 구매대행 고지 미리보기('고칠 수 없음' ·
 *   '템플릿과 일치' · 채운 문장 · 기준일 · 붙은 문장 · '전체 보기')]
 * - HTML 미리보기(`DetailPreview` — iframe sandbox). 보드의 '문구 검사'(M2 F-CT-38·39)는 그리지 않는다
 * 고치기는 오너 수정(EDIT, 새 버전)이고 응답 경고(상품명 100자 초과 등)는 조회의 `productNameWarnings`가 다시 보인다.
 */
export function AssemblySection({
  candidateId,
  item,
  output,
  reloadKey,
  runAction,
  runError,
}: AssemblySectionProps) {
  const queryClient = useQueryClient();
  const edit = useOwnerEdit();
  const profile = usePurchaseAgencyProfileQuery();
  const [name, setName] = useState(output?.productName ?? '');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [notice, setNotice] = useState<NoticeForm>(() => noticeFormOf(output?.noticeFields ?? {}));
  const [disclosureOpen, setDisclosureOpen] = useState(false);

  const missing = missingAssemblyProfile(profile.data?.missingFields ?? []);
  const profileBlocked =
    missing.length > 0 || (isApiRequestError(runError) && runError.code === 'PROFILE_INCOMPLETE');
  const editable =
    output?.isCurrent === true &&
    (output.stepRunStatus === 'COMPLETED' || output.stepRunStatus === 'RERUN_REQUIRED');
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: contentKeys.assembly(candidateId) });

  const send = (
    fields: { fieldKey: string; value?: string | null; recheckConfirmed?: boolean }[],
    done?: () => void,
  ) => {
    if (!output) return;
    edit.reset();
    edit.mutate(
      {
        candidateId,
        stepCode: 'NOTICE_HTML',
        body: { ownerAction: 'EDIT', baseStepRunId: output.stepRunId, fields },
      },
      {
        onSuccess: () => {
          done?.();
          refresh();
        },
      },
    );
  };

  const nameReason = !editable
    ? PRODUCT_NAME_NOT_EDITABLE_REASON
    : output
      ? productNameSaveDisabledReason(name, output.productName)
      : null;
  const noticeFields = (output?.noticeFields ?? {}) as Record<string, unknown>;
  const fields = output?.fields ?? [];
  const recheck = (fieldKey: string) => {
    const field = assemblyField(fields, fieldKey);
    return field?.recheckRequired && editable ? (
      <Button
        size="sm"
        disabled={edit.isPending}
        onClick={() => send([{ fieldKey, recheckConfirmed: true }])}
      >
        {RECHECK_CONFIRM_LABEL}
      </Button>
    ) : null;
  };
  const withChips = (text: ReactNode, fieldKey: string) => (
    <span className={styles.factValue}>
      {text}
      <FieldChips field={assemblyField(fields, fieldKey)} />
      {recheck(fieldKey)}
    </span>
  );

  const noticeItems = output
    ? [
        {
          key: 'origin',
          term: '원산지',
          detail: withChips(originText(output), 'notice.origin_area'),
        },
        {
          key: 'material',
          term: '소재',
          detail: withChips(noticeText(noticeFields, 'material') ?? '—', 'notice.material'),
        },
        {
          key: 'size',
          term: '사이즈',
          detail: withChips(noticeText(noticeFields, 'size') ?? '—', 'notice.size'),
        },
        {
          key: 'color',
          term: '색상',
          detail: withChips(noticeText(noticeFields, 'color') ?? '—', 'notice.color'),
        },
        {
          key: 'manufacturer',
          term: '제조·수입',
          detail: withChips(noticeText(noticeFields, 'manufacturer') ?? '—', 'notice.manufacturer'),
        },
        {
          key: 'height',
          term: '굽높이',
          detail: withChips(
            noticeText(noticeFields, 'height') ?? HEIGHT_OMITTED_TEXT,
            'notice.height',
          ),
        },
        {
          key: 'caution',
          term: '주의사항',
          detail: withChips(noticeText(noticeFields, 'caution') ?? '—', 'notice.caution'),
        },
        {
          key: 'fixed',
          term: '고정 문구',
          detail: (
            <Disclosure title={FIXED_TEXTS_SUMMARY} look="link">
              <DefinitionList
                labelWidth={96}
                items={FIXED_TEXT_LABELS.map(({ key, label }) => ({
                  key,
                  term: label,
                  detail: noticeText(noticeFields, key) ?? '—',
                }))}
              />
            </Disclosure>
          ),
        },
      ]
    : [];

  const blocks = output?.disclosureBlocks ?? [];
  const shownBlocks = disclosureOpen ? blocks : blocks.slice(0, DISCLOSURE_PREVIEW_LINES);
  const check = output ? productNameCheckText(output) : null;
  const isSuggestion = output ? output.productName === output.productNameSuggestion : false;
  const noticeChanges = output ? noticeEditFields(notice, noticeFields) : [];

  return (
    <section id="notice" aria-labelledby="notice-title" className={styles.sub}>
      <div className={styles.subHead}>
        <h2 id="notice-title" className={styles.subTitle}>
          ⑥-3 고시·HTML
        </h2>
        {item ? <StatusChip status={item.status} /> : null}
        {output ? <span className={styles.caption}>{assemblyMetaText(output)}</span> : null}
        <span className={styles.spacer} />
        {profile.data && missing.length === 0 ? (
          <Chip tone="done" icon="check">
            {PROFILE_OK_TEXT}
          </Chip>
        ) : null}
        <Link to={SETTINGS_PATH} className={styles.textLink}>
          {PROFILE_LINK_LABEL}
        </Link>
        {runAction}
      </div>
      {profileBlocked ? (
        <Banner
          tone="blocked"
          actions={<ButtonLink to={SETTINGS_PATH}>{PROFILE_FILL_LINK_LABEL}</ButtonLink>}
        >
          {missing.length > 0
            ? profileMissingText(missing)
            : isApiRequestError(runError)
              ? runError.message
              : ''}
        </Banner>
      ) : null}
      {edit.error ? (
        <Banner tone="blocked" role="alert">
          {errorText(edit.error)}
        </Banner>
      ) : null}
      {!output ? (
        <p className={styles.placeholder}>{ASSEMBLY_EMPTY_TEXT}</p>
      ) : (
        <>
          <div className={styles.assemblyGrid}>
            <div className={styles.block}>
              <div className={styles.labelRow}>
                <label htmlFor="product-name" className={styles.label}>
                  {PRODUCT_NAME_LABEL}
                </label>
                {isSuggestion ? (
                  <Chip tone="neutral">{PRODUCT_NAME_TEMPLATE_CHIP}</Chip>
                ) : (
                  <FieldChips field={assemblyField(fields, 'product_name')} />
                )}
                <span className={styles.spacer} />
                <span className={styles.counter} data-testid="product-name-counter">
                  {productNameCounter(name)}
                </span>
              </div>
              <TextField
                id="product-name"
                value={name}
                disabled={!editable}
                aria-describedby={productNameTooLong(name) ? 'product-name-too-long' : undefined}
                onChange={(e) => setName(e.target.value)}
              />
              {productNameTooLong(name) ? (
                <span id="product-name-too-long" role="status" className={styles.warnText}>
                  {PRODUCT_NAME_TOO_LONG_TEXT}
                </span>
              ) : null}
              {check ? (
                <span className={check.ok ? styles.okText : styles.warnText}>
                  {check.text} <span className={styles.caption}>{check.parallel}</span>
                </span>
              ) : null}
              <span className={styles.caption}>{PRODUCT_NAME_TEMPLATE_TEXT}</span>
              <span className={styles.formActions}>
                <Button
                  size="sm"
                  disabled={nameReason !== null || edit.isPending}
                  aria-describedby={nameReason ? 'product-name-why' : undefined}
                  onClick={() => send([{ fieldKey: 'product_name', value: name.trim() }])}
                >
                  {PRODUCT_NAME_SAVE_LABEL}
                </Button>
                {nameReason ? (
                  <DisabledReason id="product-name-why" tone="muted">
                    {nameReason}
                  </DisabledReason>
                ) : null}
              </span>
            </div>
            <div className={styles.block}>
              <div className={styles.labelRow}>
                <span className={styles.blockTitle}>{SPEC_BLOCK_TITLE}</span>
                <span className={styles.caption}>{SPEC_BLOCK_CAPTION}</span>
              </div>
              <ul className={styles.specLines} aria-label={SPEC_BLOCK_TITLE}>
                {specBlockLines(output.specBlockHtml).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className={styles.assemblyGrid}>
            <div className={styles.block}>
              <div className={styles.labelRow}>
                <span className={styles.blockTitle}>{NOTICE_TITLE}</span>
                <span className={styles.spacer} />
                <Button
                  size="sm"
                  aria-expanded={noticeOpen}
                  disabled={!editable || edit.isPending}
                  onClick={() => {
                    setNotice(noticeFormOf(noticeFields));
                    setNoticeOpen((v) => !v);
                  }}
                >
                  {NOTICE_EDIT_LABEL}
                </Button>
              </div>
              <DefinitionList labelWidth={76} items={noticeItems} />
              {noticeOpen ? (
                <div className={styles.noticeForm} role="group" aria-label="고시 필드 고치기">
                  {(Object.keys(NOTICE_EDIT_LABELS) as EditableNoticeKey[]).map((key) => (
                    <TextField
                      key={key}
                      label={NOTICE_EDIT_LABELS[key]}
                      value={notice[key]}
                      onChange={(e) => setNotice((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                  ))}
                  <span className={styles.formActions}>
                    <Button
                      disabled={noticeChanges.length === 0 || edit.isPending}
                      onClick={() => send(noticeChanges, () => setNoticeOpen(false))}
                    >
                      {NOTICE_SAVE_LABEL}
                    </Button>
                  </span>
                </div>
              ) : null}
            </div>
            <div className={styles.block}>
              <div className={styles.labelRow}>
                <span className={styles.blockTitle}>{DISCLOSURE_TITLE}</span>
                <Chip tone="neutral" icon="lock">
                  {DISCLOSURE_LOCKED_CHIP}
                </Chip>
                {output.disclosureTemplateMatched ? (
                  <Chip tone="done" icon="check">
                    {DISCLOSURE_MATCHED_CHIP}
                  </Chip>
                ) : (
                  <Chip tone="failed" icon="alert">
                    {DISCLOSURE_MISMATCHED_CHIP}
                  </Chip>
                )}
              </div>
              <div
                className={styles.disclosureLines}
                aria-label="구매대행 고지 내용, 고칠 수 없음"
                role="group"
              >
                {shownBlocks.map((block) => (
                  <span key={block.blockId} data-block-id={block.blockId}>
                    {block.text}
                  </span>
                ))}
              </div>
              <div className={styles.labelRow}>
                <span className={styles.caption}>{disclosureFootText(output)}</span>
                <span className={styles.spacer} />
                {blocks.length > DISCLOSURE_PREVIEW_LINES ? (
                  <Button
                    size="sm"
                    aria-expanded={disclosureOpen}
                    onClick={() => setDisclosureOpen((v) => !v)}
                  >
                    {disclosureOpen ? '접기' : DISCLOSURE_FULL_LABEL}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          <DetailPreview previewUrl={output.previewUrl} reloadKey={reloadKey} />
        </>
      )}
    </section>
  );
}

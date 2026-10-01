import { useMemo } from 'react';
import {
  categoryPathText,
  DETAIL_PARTS_TEXT,
  detailFactsText,
  detailPreviewDocument,
  deliveryText,
  draftOptions,
  localizeDetailContent,
  COMBINATION_OPTION_LABEL,
  optionStockText,
  PREVIEW_CAPTION,
  PREVIEW_TITLE,
  productNameLength,
  sourcingMethodText,
  STANDARD_OPTION_LABEL,
  summarySize,
  tagsSummaryText,
  uploadImageAlt,
  uploadImageFileUrl,
  useUploadResultQuery,
  type ApprovalPreview,
  type ApprovalSizeOption,
  type RegistrationOptionType,
} from '@/features/registration';
import { formatKrw, formatPct } from '@/shared/lib/format';
import { Chip, DataTable, Disclosure, Num, type DataTableColumn } from '@/shared/ui';
import styles from './PreviewPanel.module.css';

export interface PreviewPanelProps {
  candidateId: number;
  preview: ApprovalPreview;
  /** '표준형으로 바꾸기'·'조합형으로 바꾸기'(P4-03 F-AP-41 — `?optionType` search param을 바꾼다) */
  onOptionTypeChange?: (optionType: RegistrationOptionType) => void;
}

const VAT_MODE_TEXT: Record<string, string> = { A: '모드 A', B: '모드 B', C: '모드 C' };

/** '비용 분해' 표(05-2 ApprovalMarginBreakdown.sizes — FE 04-3 `ApprovalMarginBreakdown`) */
const BREAKDOWN_COLUMNS: readonly DataTableColumn<ApprovalSizeOption>[] = [
  { key: 'size', header: '사이즈', num: 'mm', value: (row) => row.sizeMm },
  { key: 'yen', header: '상품가', num: 'yen', value: (row) => row.skuPriceYen },
  { key: 'goods', header: '상품원가', num: 'krw', value: (row) => row.cGoodsKrw },
  { key: 'tax', header: '관부가세', num: 'krw', value: (row) => row.cTaxKrw },
  { key: 'price', header: '판매가', num: 'krw', value: (row) => row.sizeSalePriceKrw ?? null },
  { key: 'mkt', header: '수수료', num: 'krw', value: (row) => row.cMktKrw ?? null },
  { key: 'vat', header: '부가세(A)', num: 'krw', value: (row) => row.vatAKrw ?? null },
  { key: 'profitA', header: '순이익(A)', num: 'krw', value: (row) => row.profitAKrw ?? null },
  { key: 'profitB', header: '순이익(B)', num: 'krw', value: (row) => row.profitBKrw ?? null },
  {
    key: 'margin',
    header: '마진율',
    num: 'pct',
    value: (row) => (row.marginRateA == null ? null : row.marginRateA * 100),
  },
  { key: 'stock', header: '라쿠텐 재고', num: 'count', value: (row) => row.stockQuantity ?? null },
];

/**
 * SCR-08 '전체 미리보기'(Approval.dc.html, P4-02 §5 FE `PreviewPanel.tsx`, F-AP-08). 05-2 `ApprovalPreview`로 그린다:
 * 대표이미지(로컬 파일) · 상품명과 'n/100자' · 판매가·순이익·마진율(순이익이 가장 낮은 판매 사이즈) · 소싱 방식 · 카테고리 경로 ·
 * 사이즈 옵션(Num mm — 카테고리가 표준형을 지원하면 '표준형으로 바꾸기', P4-03) · 태그 · 상세 요약 · 배송·통관 · '비용 분해'·'상세 페이지'
 * Disclosure('요청 JSON'은 시안대로 '⑨ 등록' 영역으로 옮겼다 — P4-03).
 * 이미지·상세 렌더링은 외부 주소(shop-phinf)를 부르지 않는다: ⑧ 산출물(`getCandidateUploadResult`)의 `imageAssetId`로
 * `/api/v1/image-assets/{id}/file`(같은 출처)을 쓰고, 상세는 sandbox iframe(`sandbox=""` — 스크립트·같은 출처 권한 없음)에
 * 로컬 주소로 바꾼 HTML을 넣는다. 요청 JSON은 URL 그대로 글로만 보인다. 시안의 '내려받기'(M2 F-AP-49)는 그리지 않는다.
 */
export function PreviewPanel({ candidateId, preview, onOptionTypeChange }: PreviewPanelProps) {
  const upload = useUploadResultQuery(candidateId).data;
  const imageIdByUrl = useMemo(
    () => new Map((upload?.images ?? []).map((image) => [image.url, image.imageAssetId])),
    [upload],
  );
  const representative = upload?.images.find((image) => image.role === 'REPRESENTATIVE');
  const size = summarySize(preview);
  const options = draftOptions(preview);
  const tags = tagsSummaryText(preview.tags);
  const nameLength = productNameLength(preview.productName);
  const detailDocument = useMemo(() => {
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    return detailPreviewDocument(
      localizeDetailContent(preview.detailContent, imageIdByUrl, origin),
      origin,
    );
  }, [preview.detailContent, imageIdByUrl]);

  return (
    <section aria-labelledby="preview-title" className={styles.panel}>
      <div className={styles.head}>
        <h2 id="preview-title" className={styles.title}>
          {PREVIEW_TITLE}
        </h2>
        <span className={styles.caption}>{PREVIEW_CAPTION}</span>
      </div>
      <div className={styles.product}>
        {representative ? (
          <img
            className={styles.thumb}
            src={uploadImageFileUrl(representative.imageAssetId)}
            alt={uploadImageAlt(representative)}
            width={96}
            height={96}
          />
        ) : (
          <div role="img" aria-label="대표 이미지 자리" className={styles.thumbEmpty} />
        )}
        <div className={styles.productText}>
          <span className={styles.name}>{preview.productName}</span>
          <div className={styles.priceRow}>
            <span className={styles.price}>{formatKrw(preview.salePriceKrw)}</span>
            {size ? (
              <span className={styles.profit}>
                순이익 <Num value={size.profitAKrw ?? null} unit="krw" align="inline" /> · 마진율{' '}
                <Num
                  value={size.marginRateA == null ? null : size.marginRateA * 100}
                  unit="pct"
                  align="inline"
                />
              </span>
            ) : null}
          </div>
          <div className={styles.metaRow}>
            <span className={nameLength > 100 ? styles.over : styles.caption}>
              상품명 {nameLength}/100자 · 대표이미지 1000×1000
            </span>
            <Chip tone="outline">AI 생성</Chip>
          </div>
        </div>
      </div>
      <dl className={styles.facts}>
        <dt>소싱 방식</dt>
        <dd>{sourcingMethodText(preview.sourcingMethod)}</dd>
        <dt>카테고리</dt>
        <dd>{categoryPathText(preview.wholeCategoryName)}</dd>
        <dt>사이즈 옵션</dt>
        <dd className={styles.options}>
          <span className={styles.sizes}>
            {options.map((option) => (
              <span key={option.sizeMm} className={styles.size}>
                {option.sizeMm}
              </span>
            ))}
            <span className={styles.unit}>mm</span>
          </span>
          <span className={styles.optionRow}>
            <span className={styles.caption}>{optionStockText(preview)}</span>
            {preview.optionType === 'STANDARD' ? (
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => onOptionTypeChange?.('COMBINATION')}
              >
                {COMBINATION_OPTION_LABEL}
              </button>
            ) : preview.standardOptionSupported ? (
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => onOptionTypeChange?.('STANDARD')}
              >
                {STANDARD_OPTION_LABEL}
              </button>
            ) : null}
          </span>
        </dd>
        <dt>{`태그 ${preview.tags.length}개`}</dt>
        <dd>
          {tags.head}
          {tags.rest > 0 ? <span className={styles.caption}> 외 {tags.rest}개</span> : null}
        </dd>
        <dt>상세</dt>
        <dd className={styles.stack}>
          <span>{DETAIL_PARTS_TEXT}</span>
          <span className={styles.caption}>{detailFactsText(preview)}</span>
        </dd>
        <dt>배송·통관</dt>
        <dd>{deliveryText(preview)}</dd>
      </dl>
      <div className={styles.disclosures}>
        <Disclosure
          title="비용 분해"
          meta={`판매가 ${formatKrw(preview.salePriceKrw)} 기준 · ${VAT_MODE_TEXT[preview.marginBreakdown.vatMode] ?? preview.marginBreakdown.vatMode}`}
        >
          <div className={styles.breakdown}>
            <p className={styles.caption}>
              {`배대지 ${formatKrw(preview.marginBreakdown.cFwdKrw)}${preview.marginBreakdown.fwdAssumed ? '(가정값)' : ''} · 목표 마진 ${formatPct(preview.marginBreakdown.targetMarginRate * 100)} · 최소 이익 ${formatKrw(preview.marginBreakdown.minProfitKrw)}`}
            </p>
            <DataTable
              columns={BREAKDOWN_COLUMNS}
              rows={preview.marginBreakdown.sizes}
              rowKey={(row) => row.sizeMm}
            />
          </div>
        </Disclosure>
        <Disclosure
          title="상세 페이지"
          meta={
            <>
              <Chip tone="outline">AI 생성</Chip>
              <span className={styles.caption}>카피·원산지 추출 포함</span>
            </>
          }
        >
          <iframe
            title="상세 페이지 미리보기"
            className={styles.frame}
            sandbox=""
            srcDoc={detailDocument}
          />
        </Disclosure>
      </div>
    </section>
  );
}

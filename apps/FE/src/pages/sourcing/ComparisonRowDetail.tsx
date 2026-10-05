import { useState } from 'react';
import {
  anchorLabel,
  comparisonParams,
  itemFactsText,
  needsOwnerDecision,
  pointBreakdownText,
  rowIdentityText,
  SIZE_STATUS_LABEL,
  sizeStockMismatchText,
  sizeStockOf,
  type ComparisonGender,
  type SourcingComparisonDetail,
  type SourcingComparisonRow,
  type SourcingRowPatch,
  useRakutenItem,
} from '@/features/sourcing';
import { cx } from '@/shared/lib/cx';
import { Button, TextField } from '@/shared/ui';
import styles from './ComparisonRowDetail.module.css';

export interface ComparisonRowDetailProps {
  head: SourcingComparisonDetail;
  row: SourcingComparisonRow;
  gender: ComparisonGender | null;
  /** 비교표를 바꿀 수 있다(입력을 기다리는 현재 버전) */
  editable: boolean;
  /** '하루 조회 38/110' 글(없으면 줄을 줄인다) */
  usageText: string | null;
  /** 페이지를 읽을 수 없는 이유(하루 상한·쉼) */
  pageBlocked: string | null;
  stockCheckPending: boolean;
  savePending: boolean;
  onStockCheck: () => void;
  onPatch: (patch: SourcingRowPatch) => void;
}

/** 쿠폰(엔 정수 ≥ 0) 글 → 값. 틀리면 null */
function parseCoupon(text: string): number | null {
  const t = text.replace(/[,¥\s]/g, '');
  if (!/^\d{1,9}$/.test(t)) return null;
  return Number(t);
}

/** 배율(≥ 0, 소수 넷째 자리까지) 글 → 값. 틀리면 null */
function parseMultiplier(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(t)) return null;
  return Number(t);
}

/**
 * 펼친 비교표 행(Sourcing.dc.html 샵 A 아래, F-SO-20·25·26·27·28, F-BS-38):
 * - '상품' 줄(보드에 없음 — F-SO-28·RK-09 열 중 보드 9열에 없는 상품명·리뷰 수·평점·해외 배송 가능을 여기에 둔다, Proposed)
 * - '목표 사이즈 재고 · 取り寄せ는 뺍니다' + 사이즈별 '있음·품절·取り寄せ·없음'(검증 행 — 그 페이지 스냅샷 SKU로 그린다).
 *   다시 그린 '있음' 수가 서버 판정과 다르면 안내 한 줄(고르기·순위는 서버 값)
 * - '재고 확인' + '하루 조회 38/110에 포함'
 * - 쿠폰 금액(¥)·샵·이벤트 배율(배) 칸: 바꾸고 칸을 떠나거나 Enter면 `PATCH` → 응답 순서로 다시 그린다. 송료는 읽기 전용(입력 M2)
 * - 포인트 분해 글('포인트 10배 = 기본 1 + 상품 추가 9 + 샵·이벤트 0 → 1,090pt (근사). …')
 * - 불확실한 행: 기준 상품과 이 상품(상품명·型番·색상 번호·JAN)을 나란히 + AI 판정 참고(확신도·이유) + '같은 상품'·
 *   '다른 상품'(내가 정하는 최종 판단 — 링크를 열지 않아도 판단 근거가 보이게). 표 칸 이름과 같은 '같은 상품인가'(D-47)
 */
export function ComparisonRowDetail({
  head,
  row,
  gender,
  editable,
  usageText,
  pageBlocked,
  stockCheckPending,
  savePending,
  onStockCheck,
  onPatch,
}: ComparisonRowDetailProps) {
  const params = comparisonParams(head);
  const item = useRakutenItem(row.rakutenItemId ?? null);
  const [coupon, setCoupon] = useState<string | null>(null);
  const [multiplier, setMultiplier] = useState<string | null>(null);
  const couponText = coupon ?? String(row.couponYen);
  const multiplierText = multiplier ?? String(row.shopEventMultiplier);
  const couponValue = parseCoupon(couponText);
  const multiplierValue = parseMultiplier(multiplierText);

  const commitCoupon = () => {
    if (coupon === null) return;
    if (couponValue !== null && couponValue !== row.couponYen) {
      onPatch({ couponYen: couponValue });
      setCoupon(null);
    } else if (couponValue !== null) setCoupon(null);
  };
  const commitMultiplier = () => {
    if (multiplier === null) return;
    if (multiplierValue !== null && multiplierValue !== row.shopEventMultiplier) {
      onPatch({ shopEventMultiplier: multiplierValue });
      setMultiplier(null);
    } else if (multiplierValue !== null) setMultiplier(null);
  };

  const sizes =
    row.isVerified && item.data
      ? sizeStockOf(item.data.skus, {
          gender,
          params,
          anchorColorCode: head.anchorColorCode ?? null,
          anchorColorLabel: head.anchorColorLabel ?? null,
          itemBackOrderFlag: item.data.backOrderFlag ?? null,
        })
      : [];
  const sizeMismatch = sizeStockMismatchText(sizes, row);
  const ai = (row.aiMatch ?? null) as { match: boolean; confidence: number; reason: string } | null;
  const shopName = row.shopName ?? row.shopCode;
  const anchorItemName = head.anchorItemCode
    ? (head.rows.find((r) => r.itemCode === head.anchorItemCode)?.itemName ?? null)
    : null;

  return (
    <div className={styles.detail}>
      <div role="group" aria-label={`${shopName} 상품 정보`} className={styles.itemRow}>
        <span className={cx(styles.label, styles.rowHead)}>상품</span>
        <div className={styles.itemBody}>
          <span className={styles.itemName}>{row.itemName}</span>
          <span className={styles.muted}>{itemFactsText(row)}</span>
        </div>
      </div>
      <div className={styles.stockRow}>
        <div className={styles.stockHead}>
          <span className={styles.label}>목표 사이즈 재고</span>
          <span className={styles.muted}>取り寄せ(주문 후 입고)는 뺍니다</span>
        </div>
        {sizes.length > 0 ? (
          <ul aria-label={`${shopName} 사이즈별 재고`} className={styles.sizes}>
            {sizes.map((s) => (
              <li key={s.sizeMm} className={cx(styles.size, styles[s.status])}>
                <span className={styles.sizeMm}>{s.sizeMm}</span>
                <span className={styles.sizeStatus}>{SIZE_STATUS_LABEL[s.status]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className={styles.muted}>
            {row.isVerified
              ? gender
                ? '사이즈 표를 읽는 중입니다.'
                : '성별을 고르면 목표 사이즈 재고를 봅니다.'
              : '상품 페이지를 읽지 않았습니다.'}
          </span>
        )}
        <span className={styles.grow} />
        <div className={styles.check}>
          <Button
            size="sm"
            disabled={!editable || stockCheckPending || pageBlocked !== null}
            title={pageBlocked ?? undefined}
            onClick={onStockCheck}
          >
            {stockCheckPending ? '읽는 중…' : '재고 확인'}
          </Button>
          {usageText ? <span className={styles.usage}>하루 조회 {usageText}에 포함</span> : null}
        </div>
      </div>
      {sizeMismatch ? <span className={styles.muted}>{sizeMismatch}</span> : null}
      {row.manualCheckRequired && row.manualCheckReason ? (
        <span className={styles.muted}>수동 확인: {row.manualCheckReason}</span>
      ) : null}
      <div className={styles.inputs}>
        <TextField
          label="쿠폰 금액"
          unit="¥"
          numeric
          inputMode="numeric"
          hint="선택 · 비우면 0"
          value={couponText}
          disabled={!editable || savePending}
          error={coupon !== null && couponValue === null ? '0 이상 정수' : undefined}
          onChange={(e) => setCoupon(e.target.value)}
          onBlur={commitCoupon}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitCoupon();
          }}
          className={styles.input}
        />
        <TextField
          label="샵·이벤트 배율"
          unit="배"
          numeric
          inputMode="decimal"
          hint="선택 · 비우면 0"
          value={multiplierText}
          disabled={!editable || savePending}
          error={
            multiplier !== null && multiplierValue === null ? '0 이상, 소수 넷째 자리' : undefined
          }
          onChange={(e) => setMultiplier(e.target.value)}
          onBlur={commitMultiplier}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitMultiplier();
          }}
          className={styles.input}
        />
        <TextField
          label="일본 내 배송비"
          unit="¥"
          numeric
          locked
          value={
            row.shippingYen === null || row.shippingYen === undefined ? '' : String(row.shippingYen)
          }
          hint="직접 입력은 M2"
          readOnly
          className={styles.input}
        />
        <p className={styles.points}>
          {row.isVerified
            ? pointBreakdownText(row, params)
            : '페이지를 읽으면 포인트와 실질가를 계산합니다(근사).'}
        </p>
      </div>
      {needsOwnerDecision(row) ? (
        <div role="group" aria-label="같은 상품 판단" className={styles.decision}>
          <div className={styles.decisionHead}>
            <span className={styles.label}>같은 상품인가</span>
            <span className={styles.grow} />
            <Button
              size="sm"
              variant={row.ownerMatchDecision === 'MATCH' ? 'primary' : 'secondary'}
              aria-pressed={row.ownerMatchDecision === 'MATCH'}
              disabled={!editable || savePending}
              onClick={() => onPatch({ ownerMatchDecision: 'MATCH' })}
            >
              같은 상품
            </Button>
            <Button
              size="sm"
              variant={row.ownerMatchDecision === 'NO_MATCH' ? 'primary' : 'secondary'}
              aria-pressed={row.ownerMatchDecision === 'NO_MATCH'}
              disabled={!editable || savePending}
              onClick={() => onPatch({ ownerMatchDecision: 'NO_MATCH' })}
            >
              다른 상품
            </Button>
          </div>
          <dl className={styles.compare}>
            <dt className={cx(styles.label, styles.rowHead)}>기준 상품</dt>
            <dd className={styles.compareValue}>
              <span className={styles.itemName}>{anchorItemName ?? anchorLabel(head)}</span>
              {anchorItemName ? <span className={styles.muted}>{anchorLabel(head)}</span> : null}
            </dd>
            <dt className={cx(styles.label, styles.rowHead)}>이 상품</dt>
            <dd className={styles.compareValue}>
              <span className={styles.itemName}>{row.itemName}</span>
              <span className={styles.muted}>{rowIdentityText(row)}</span>
            </dd>
          </dl>
          {ai ? (
            <span className={styles.muted}>
              AI 판정 참고 · {ai.match ? '같은 상품' : '다른 상품'}(확신도{' '}
              {Math.round(ai.confidence * 100)}%) — {ai.reason}
            </span>
          ) : (
            <span className={styles.muted}>
              규칙으로 가리지 못했습니다. 같은 상품인지 직접 정해 주세요.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

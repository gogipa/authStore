import { useId, useState, type FormEvent } from 'react';
import { isApiRequestError } from '@/shared/api/errors';
import { formatKstTime } from '@/shared/lib/format';
import { Button, Chip, DisabledReason, Icon, TextField } from '@/shared/ui';
import { useCreateDomesticPriceMutation, useDomesticPricesQuery } from '../../api/domesticPrices';
import { useNaverShoppingLinksQuery } from '../../api/naverShoppingLinks';
import { parsePriceKrw, type NaverShoppingLink } from '../../model/judgement';
import styles from './DomesticPricePanel.module.css';

export interface DomesticPricePanelProps {
  candidateId: number;
  /** 저장을 막는 이유(잠긴·제외 후보, ③ 실행 중). 있으면 저장 단추를 끈다 */
  blockedReason?: string | null;
}

/** 안내(보드 그대로) */
export const DOMESTIC_PRICE_NOTE = '판정을 마친 뒤 값을 바꾸면 ③을 다시 실행해야 합니다.';

function linkText(link: NaverShoppingLink, index: number): string {
  if (index === 0) return '네이버쇼핑에서 찾아보기 (새 탭)';
  return link.kind === 'MODEL_CODE' ? '型番으로 찾아보기 (새 탭)' : '키워드로 찾아보기 (새 탭)';
}

/**
 * '국내 기준가' 패널(SCR-04, Judgement.dc.html, F-PJ-12·13, P2-05). 네이버쇼핑 검색 링크(새 탭, `rel=noopener noreferrer`)는
 * 이 패널에만 둔다 — 라쿠텐 가격이 보이는 영역(사이즈 표·비용 분해)과 나눈다(CON-14). 금액 칸은 '판매가 + 고객 배송비'
 * 총액(원), 근거 링크는 선택. 저장하면 `POST …/domestic-prices` → ③이 기다리면 이어 계산하고, 완료였으면 값이 바뀔 때
 * 재실행 필요가 된다. 셀라파인더 엑셀 올리기(보드)는 M2라 두지 않는다.
 */
export function DomesticPricePanel({ candidateId, blockedReason = null }: DomesticPricePanelProps) {
  const titleId = useId();
  const reasonId = useId();
  const links = useNaverShoppingLinksQuery(candidateId).data?.items ?? [];
  const latest = useDomesticPricesQuery(candidateId, { size: 1 }).data?.content[0];
  const save = useCreateDomesticPriceMutation();
  const [price, setPrice] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const priceText = price ?? (latest ? latest.pRefKrw.toLocaleString('ko-KR') : '');
  const urlText = url ?? latest?.sourceUrl ?? '';
  const value = parsePriceKrw(priceText);
  const priceError = touched && value === null ? '1원 이상의 금액(숫자)을 넣어 주세요.' : undefined;
  const serverError = save.error ? (isApiRequestError(save.error) ? save.error : null) : null;
  const fieldErrors = serverError?.envelope.fieldErrors ?? [];
  const fieldError = (field: string) => fieldErrors.find((f) => f.field === field)?.message;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (value === null || blockedReason) return;
    save.mutate(
      {
        candidateId,
        body: {
          pRefKrw: value,
          sourceUrl: urlText.trim() === '' ? null : urlText.trim(),
          sourceKind: 'MANUAL',
        },
      },
      {
        onSuccess: () => {
          setPrice(null);
          setUrl(null);
          setTouched(false);
        },
      },
    );
  };

  return (
    <section aria-labelledby={titleId} className={styles.panel}>
      <div className={styles.head}>
        <h3 id={titleId} className={styles.title}>
          국내 기준가
        </h3>
        <span className={styles.grow} />
        {links.map((link, i) => (
          <a
            key={link.kind}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            title={link.query}
            className={styles.link}
          >
            {linkText(link, i)}
            <Icon name="external" size={16} />
          </a>
        ))}
      </div>
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.row}>
          <div className={styles.price}>
            <TextField
              label="국내 기준가 · 판매가 + 고객 배송비"
              unit="원"
              numeric
              inputMode="numeric"
              value={priceText}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={() => setTouched(true)}
              error={priceError ?? fieldError('pRefKrw')}
            />
            <Chip tone="neutral">직접 입력</Chip>
          </div>
          <div className={styles.url}>
            <TextField
              label="근거 링크"
              type="url"
              value={urlText}
              onChange={(e) => setUrl(e.target.value)}
              error={fieldError('sourceUrl')}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={save.isPending || !!blockedReason}
            aria-describedby={blockedReason ? reasonId : undefined}
          >
            저장
          </Button>
        </div>
        {blockedReason ? (
          <DisabledReason id={reasonId} tone="muted">
            {blockedReason}
          </DisabledReason>
        ) : null}
        {serverError && fieldErrors.length === 0 ? (
          <p role="alert" className={styles.error}>
            {serverError.message}
          </p>
        ) : null}
        <p className={styles.note}>
          {latest ? `${formatKstTime(latest.enteredAt)} 입력 · ` : ''}
          {DOMESTIC_PRICE_NOTE}
        </p>
      </form>
    </section>
  );
}

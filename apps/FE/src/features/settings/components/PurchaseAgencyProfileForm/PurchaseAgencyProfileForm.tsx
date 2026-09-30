import { type ReactNode, useId } from 'react';
import { Link } from 'react-router';
import {
  useCommerceAddressbooksQuery,
  useCommerceMetaSyncStatusQuery,
  useCommerceReturnDeliveryCompaniesQuery,
} from '@/features/integrations';
import { formatKstTime } from '@/shared/lib/format';
import { Banner, Panel, Select, Textarea, TextField } from '@/shared/ui';
import { useDispatchDeliveryCompaniesQuery } from '../../api/dispatchDeliveryCompanies';
import {
  NOTICE_REFER_TO_DETAIL_PLACEHOLDER,
  NOTICE_WARRANTY_PLACEHOLDER,
  type ProfileFormField,
  saveResultText,
} from '../../model/profileForm';
import type { PurchaseAgencyProfileFormState } from '../../model/usePurchaseAgencyProfileForm';
import styles from './PurchaseAgencyProfileForm.module.css';

/** 시스템 상태 화면의 메타데이터 동기화 패널(P1-08 `#meta-sync`) */
export const SYSTEM_META_SYNC_PATH = '/system#meta-sync';

/** 수입자 빈칸 안내(보드 문구 그대로) */
export const IMPORTER_MISSING_TEXT =
  '수입자가 비어 있어 ⑥-3을 시작할 수 없습니다. 수입자를 넣고 저장해 주세요. 기본값은 없습니다.';

/** 선택지 한 번에 받는 수(05-2 size 최대). 주소록·택배사는 이보다 적다 */
const OPTION_PAGE = { size: 100 } as const;

/** 고르기 칸의 빈 선택지(Proposed) */
const NONE_OPTION = '고르지 않음';

interface Option {
  value: string;
  label: string;
}

/** 지금 값이 목록에 없으면(사라진 행) 그 값을 선택지로 남긴다 — 저장하면 404로 알린다 */
function withCurrent(options: Option[], current: string, missingLabel: string): Option[] {
  if (current === '' || options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: missingLabel }];
}

function SelectOptions({ options }: { options: Option[] }) {
  return (
    <>
      <option value="">{NONE_OPTION}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </>
  );
}

/** 캐시가 비어 고를 것이 없을 때: 라벨 + 안내 + 지금 동기화 링크 */
function EmptyCache({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <div className={styles.field} role="group" aria-labelledby={labelId}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <p className={styles.empty}>
        {children} <Link to={SYSTEM_META_SYNC_PATH}>시스템 상태에서 지금 동기화</Link>
      </p>
    </div>
  );
}

export interface PurchaseAgencyProfileFormProps {
  form: PurchaseAgencyProfileFormState;
}

/**
 * SCR-10 '구매대행 프로필' 탭(Settings.dc.html): '출고·반품', '배송비·반품비·수량', '판매자·고시' 세 묶음(F-ST-07~10).
 * 보드의 '스마트스토어센터' 외부 링크는 글자로만 둔다(src에 외부 주소를 두지 않는 규칙 15, Proposed).
 * 해외 출고지는 `overseas=true` 주소록만, 반품·교환지는 주소록 전체, 반품 택배사는 동기화 목록, 발송 택배사는 설정 파일
 * 목록에서 고른다. 배송비는 '무료배송' 고정(읽기 전용). 저장·되돌리기 버튼은 화면 머리에 있다(폼 상태는 `form`).
 */
export function PurchaseAgencyProfileForm({ form }: PurchaseAgencyProfileFormProps) {
  const baseId = useId();
  const importerWarnId = `${baseId}-importer`;
  const overseas = useCommerceAddressbooksQuery({ overseas: true, ...OPTION_PAGE });
  const addressbooks = useCommerceAddressbooksQuery(OPTION_PAGE);
  const returnCompanies = useCommerceReturnDeliveryCompaniesQuery(OPTION_PAGE);
  const dispatch = useDispatchDeliveryCompaniesQuery();
  const syncStatus = useCommerceMetaSyncStatusQuery();

  const { values, profile, fieldErrors } = form;
  const addressbookSyncedAt =
    syncStatus.data?.items.find((item) => item.target === 'ADDRESSBOOK')?.lastSucceededAt ?? null;

  if (form.loading) {
    return (
      <Panel title="구매대행 프로필">
        <p className={styles.muted}>불러오는 중입니다.</p>
      </Panel>
    );
  }
  if (form.loadError || !values || !profile) {
    return (
      <Panel title="구매대행 프로필">
        <Banner tone="warning">{form.loadError?.message ?? '프로필을 불러오지 못했습니다.'}</Banner>
      </Panel>
    );
  }

  const set = (field: ProfileFormField) => (value: string) => form.setField(field, value);
  const importerMissing = profile.importer === null;

  const overseasOptions = withCurrent(
    (overseas.data?.content ?? []).map((a) => ({ value: String(a.id), label: `${a.name} · 해외` })),
    values.overseasShippingCommerceAddressbookId,
    `목록에 없는 주소록 #${values.overseasShippingCommerceAddressbookId}`,
  );
  const returnOptions = withCurrent(
    (addressbooks.data?.content ?? []).map((a) => ({
      value: String(a.id),
      label: `${a.name} · ${a.isOverseas ? '해외' : '국내'}`,
    })),
    values.returnCommerceAddressbookId,
    `목록에 없는 주소록 #${values.returnCommerceAddressbookId}`,
  );
  const returnCompanyOptions = withCurrent(
    (returnCompanies.data?.content ?? []).map((c) => ({ value: String(c.id), label: c.name })),
    values.commerceReturnDeliveryCompanyId,
    `목록에 없는 택배사 #${values.commerceReturnDeliveryCompanyId}`,
  );
  const dispatchOptions = withCurrent(
    (dispatch.data?.items ?? []).map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })),
    values.dispatchDeliveryCompanyCode,
    `목록에 없는 코드 ${values.dispatchDeliveryCompanyCode}`,
  );

  const overseasEmpty = overseas.isSuccess && overseas.data.content.length === 0;
  const addressbooksEmpty = addressbooks.isSuccess && addressbooks.data.content.length === 0;
  const returnCompaniesEmpty =
    returnCompanies.isSuccess && returnCompanies.data.content.length === 0;
  const dispatchHint = dispatch.isError
    ? dispatch.error.message
    : dispatch.isSuccess && dispatch.data.items.length === 0
      ? '설정 파일(delivery.dispatchCompanies)에 출처를 밝힌 코드가 아직 없습니다'
      : '출처를 밝힌 코드 목록에서 고릅니다';

  return (
    <Panel title="구매대행 프로필" caption="모든 상품의 배송·반품·고시에 같이 들어갑니다">
      <div className={styles.body}>
        {form.saved ? (
          <Banner tone="info" role="status">
            {saveResultText(form.saved)}
          </Banner>
        ) : null}
        {form.saveError ? (
          <Banner tone="blocked" role="alert">
            {form.saveError.message}
          </Banner>
        ) : null}
        {profile.addressWarnings.length > 0 ? (
          <Banner tone="warning">
            <ul className={styles.warnings} aria-label="주소록 경고">
              {profile.addressWarnings.map((w) => (
                <li key={`${w.field}-${w.code}`}>{w.message}</li>
              ))}
            </ul>
          </Banner>
        ) : null}

        <section className={styles.section} aria-labelledby={`${baseId}-shipping`}>
          <h3 id={`${baseId}-shipping`} className={styles.sectionTitle}>
            출고·반품
          </h3>
          {overseasEmpty ? (
            <EmptyCache label="해외 출고지">
              고를 수 있는 해외 주소록이 없습니다. 스마트스토어센터에서 해외 출고지를 먼저 등록한 뒤
            </EmptyCache>
          ) : (
            <Select
              label="해외 출고지"
              value={values.overseasShippingCommerceAddressbookId}
              onChange={(e) => set('overseasShippingCommerceAddressbookId')(e.target.value)}
              error={fieldErrors.overseasShippingCommerceAddressbookId}
              hint={
                <>
                  주소록의 해외 주소만 고를 수 있습니다 · 주소록 동기화{' '}
                  {addressbookSyncedAt ? formatKstTime(addressbookSyncedAt) : '전'} · 없으면
                  스마트스토어센터에서 먼저 등록
                </>
              }
            >
              <SelectOptions options={overseasOptions} />
            </Select>
          )}
          {addressbooksEmpty ? (
            <EmptyCache label="반품·교환지">주소록이 아직 없습니다.</EmptyCache>
          ) : (
            <Select
              label="반품·교환지"
              value={values.returnCommerceAddressbookId}
              onChange={(e) => set('returnCommerceAddressbookId')(e.target.value)}
              error={fieldErrors.returnCommerceAddressbookId}
            >
              <SelectOptions options={returnOptions} />
            </Select>
          )}
          <div className={styles.grid}>
            {returnCompaniesEmpty ? (
              <EmptyCache label="반품 택배사">반품 택배사 목록이 아직 없습니다.</EmptyCache>
            ) : (
              <Select
                label="반품 택배사"
                value={values.commerceReturnDeliveryCompanyId}
                onChange={(e) => set('commerceReturnDeliveryCompanyId')(e.target.value)}
                error={fieldErrors.commerceReturnDeliveryCompanyId}
                hint="동기화한 택배사 목록에서 고릅니다"
              >
                <SelectOptions options={returnCompanyOptions} />
              </Select>
            )}
            <Select
              label="발송 택배사"
              value={values.dispatchDeliveryCompanyCode}
              onChange={(e) => set('dispatchDeliveryCompanyCode')(e.target.value)}
              error={fieldErrors.dispatchDeliveryCompanyCode}
              hint={dispatchHint}
            >
              <SelectOptions options={dispatchOptions} />
            </Select>
          </div>
        </section>

        <section
          className={`${styles.section} ${styles.divided}`}
          aria-labelledby={`${baseId}-fees`}
        >
          <h3 id={`${baseId}-fees`} className={styles.sectionTitle}>
            배송비·반품비·수량
          </h3>
          <div className={styles.grid}>
            <TextField label="배송비" value="무료배송" locked hint="판매가에 포함합니다 · 고정" />
            <TextField
              label="주문당 최대 구매수량"
              value={values.maxPurchaseQuantityPerOrder}
              onChange={(e) => set('maxPurchaseQuantityPerOrder')(e.target.value)}
              inputMode="numeric"
              numeric
              unit="켤레"
              error={fieldErrors.maxPurchaseQuantityPerOrder}
              hint="여러 켤레를 받으면 합산 과세될 수 있습니다"
            />
            <TextField
              label="반품비"
              value={values.returnFeeKrw}
              onChange={(e) => set('returnFeeKrw')(e.target.value)}
              inputMode="numeric"
              numeric
              unit="원"
              placeholder="[반품비]"
              error={fieldErrors.returnFeeKrw}
              hint="고지의 반송비 안내에 들어갑니다"
            />
            <TextField
              label="교환비"
              value={values.exchangeFeeKrw}
              onChange={(e) => set('exchangeFeeKrw')(e.target.value)}
              inputMode="numeric"
              numeric
              unit="원"
              placeholder="[교환비]"
              error={fieldErrors.exchangeFeeKrw}
              hint="교환은 반품 뒤 재주문으로 받습니다"
            />
          </div>
        </section>

        <section
          className={`${styles.section} ${styles.divided}`}
          aria-labelledby={`${baseId}-seller`}
        >
          <h3 id={`${baseId}-seller`} className={styles.sectionTitle}>
            판매자·고시
          </h3>
          <div className={styles.grid}>
            <TextField
              label="상호"
              value={values.businessName}
              onChange={(e) => set('businessName')(e.target.value)}
              placeholder="[내 상호]"
              maxLength={100}
              error={fieldErrors.businessName}
            />
            <TextField
              label="A/S 연락처"
              value={values.afterServicePhone}
              onChange={(e) => set('afterServicePhone')(e.target.value)}
              placeholder="[A/S 연락처]"
              maxLength={40}
              error={fieldErrors.afterServicePhone}
            />
          </div>
          <Textarea
            label="A/S 안내"
            value={values.afterServiceGuide}
            onChange={(e) => set('afterServiceGuide')(e.target.value)}
            placeholder="[A/S 안내]"
            maxLength={1000}
            rows={2}
            error={fieldErrors.afterServiceGuide}
            hint="등록 요청의 A/S 안내와 구매대행 고지의 A/S 줄에 들어갑니다"
          />
          <TextField
            label="수입자 · 필수"
            value={values.importer}
            onChange={(e) => set('importer')(e.target.value)}
            placeholder="고시의 '제조자 / 수입자' 칸에 적을 수입자"
            maxLength={100}
            error={fieldErrors.importer}
            aria-describedby={importerMissing ? importerWarnId : undefined}
          />
          {importerMissing ? (
            <div id={importerWarnId}>
              <Banner tone="warning">{IMPORTER_MISSING_TEXT}</Banner>
            </div>
          ) : null}
          <div className={styles.grid}>
            <TextField
              label="고시 고정 문구 · 품질보증기준"
              value={values.noticeWarranty}
              onChange={(e) => set('noticeWarranty')(e.target.value)}
              placeholder={NOTICE_WARRANTY_PLACEHOLDER}
              maxLength={1000}
              error={fieldErrors.noticeWarranty}
            />
            <TextField
              label="고시 고정 문구 · 나머지 항목"
              value={values.noticeReferToDetail}
              onChange={(e) => set('noticeReferToDetail')(e.target.value)}
              placeholder={NOTICE_REFER_TO_DETAIL_PLACEHOLDER}
              maxLength={1000}
              error={fieldErrors.noticeReferToDetail}
            />
          </div>
        </section>
      </div>
    </Panel>
  );
}

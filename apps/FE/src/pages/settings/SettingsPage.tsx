import { useId, useState } from 'react';
import {
  formatRecordRate,
  fxAutoCaption,
  fxTabCaption,
  latestOf,
  useLatestFxRatesQuery,
  type FxRateLatestSet,
} from '@/features/pricing';
import {
  ForwarderRateTablePanel,
  formatTierFee,
  PurchaseAgencyProfileForm,
  RATE_TABLE_CSV_HINT,
  rateTableTabCaption,
  rateTableVersionLabel,
  readDefaultForwarderFeeKrw,
  readShoeBox,
  shoeBoxTier,
  useActiveForwarderRateTable,
  type ForwarderRateTableDetail,
  readAppliedCostDefaults,
  readSelectedAiEngine,
  readSellTaxableSizes,
  type SettingsFieldError,
  type SettingsView,
  usePurchaseAgencyProfileForm,
  useReloadSettingsMutation,
  useSettingsQuery,
  VAT_MODE_LABEL,
} from '@/features/settings';
import { EMPTY_VALUE, formatKrw, type FractionDigits } from '@/shared/lib/format';
import {
  Banner,
  Button,
  ButtonLink,
  Chip,
  Icon,
  Num,
  PageHeader,
  Switch,
  TabPanel,
  Tabs,
  type TabItem,
} from '@/shared/ui';
import { SettingsFxTab } from './SettingsFxTab';
import styles from './SettingsPage.module.css';

/** M1 탭 3개(Settings 보드 순서). 나머지 탭(템플릿·사전, 브랜드 사전, 목표 사이즈, AI 공급자, 기준값 버전)은 M2다. */
type SettingsTab = 'profile' | 'costs' | 'fx';

/**
 * 탭 3개(보드 순서). '구매대행 프로필'은 수입자(importer)가 비면 '수입자 입력 필요' 칩을 단다(보드).
 * 저장된 값 기준이다 — 칸에 적기만 하고 저장하지 않았으면 칩이 남는다.
 * P2-04: '비용·요금표' 캡션 '요금표 v2026-09'(활성 버전), '환율' 캡션 '원가 8.76원/엔 · 09:00'(보드). 받는 중이면 캡션 없음.
 */
function settingsTabs(
  importerMissing: boolean,
  captions: { costs?: string; fx?: string },
): readonly TabItem<SettingsTab>[] {
  return [
    {
      value: 'profile',
      label: '구매대행 프로필',
      caption: importerMissing ? <Chip tone="waiting">수입자 입력 필요</Chip> : undefined,
    },
    { value: 'costs', label: '비용·요금표', caption: captions.costs },
    { value: 'fx', label: '환율', caption: captions.fx },
  ];
}

const TAB_ID_PREFIX = 'settings';

/** 요율 표기(보드: 2.5% · 3.0% · 3.63%) */
const RATE_DIGITS: FractionDigits = { minFractionDigits: 1, maxFractionDigits: 3 };

/**
 * SCR-10 설정(Settings.dc.html)의 M1 부분: 화면 머리, 탭 틀 3개, 'AI 엔진' 링크 카드, '설정 파일 검사'(+ 다시 읽기),
 * '적용 중인 기본값'(비용·부가세 모드·과세 사이즈 판매), 안내 줄. 값은 `GET /settings`의 `content`에서 읽는다.
 * 통과한 설정이 하나도 없으면(503 SETTINGS_INVALID) 차단 띠에 봉투 message를 보인다.
 * P1-09: '구매대행 프로필' 탭 본문과 머리의 '되돌리기'·'저장'(프로필 탭을 볼 때만, Proposed — 다른 탭의 저장은
 * P2-04가 정한다).
 * P2-04: '비용·요금표' 탭 = 배대지 요금표 가져오기·구간 표(`ForwarderRateTablePanel`), '환율' 탭 = 최신 환율·경고·직접 입력·기록.
 * 두 탭은 머리 저장 버튼이 없다(가져오기·넣기가 바로 저장 — Proposed). 요약의 '배대지 요금표'·'환율' 묶음(보드)과 'CSV 가져오기'·
 * '환율 직접 입력' 단추는 그 탭으로 옮겨 첫 칸에 초점을 둔다.
 */
export function SettingsPage() {
  const settings = useSettingsQuery();
  const profileForm = usePurchaseAgencyProfileForm();
  const fx = useLatestFxRatesQuery();
  const rateTable = useActiveForwarderRateTable();
  const [tab, setTab] = useState<SettingsTab>('profile');
  const [rateTableFocus, setRateTableFocus] = useState(0);
  const [fxFocus, setFxFocus] = useState(0);
  const view = settings.data;
  const unavailable = settings.error?.code === 'SETTINGS_INVALID' ? settings.error : null;
  const failed = settings.isError && !unavailable ? settings.error : null;
  const importerMissing = profileForm.profile?.importer === null;
  const profileReady = profileForm.values !== null;

  return (
    <>
      <PageHeader
        title="설정"
        screenId="SCR-10"
        description="모든 상품에 공통으로 쓰는 값입니다. 저장할 때 형식을 검사하고, 안전장치를 끄거나 기준을 낮추는 값은 저장하지 않습니다."
        actions={
          tab === 'profile' ? (
            <>
              <Button onClick={profileForm.reset} disabled={!profileReady || profileForm.saving}>
                되돌리기
              </Button>
              <Button
                variant="primary"
                onClick={profileForm.save}
                disabled={!profileReady || profileForm.saving}
              >
                {profileForm.saving ? '저장 중…' : '저장'}
              </Button>
            </>
          ) : undefined
        }
      />
      {unavailable ? <Banner tone="blocked">{unavailable.message}</Banner> : null}
      {failed ? <Banner tone="warning">{failed.message}</Banner> : null}
      <div className={styles.layout}>
        <div className={styles.side}>
          <Tabs
            items={settingsTabs(importerMissing, {
              costs:
                rateTable.summary === undefined
                  ? undefined
                  : rateTableTabCaption(rateTable.summary),
              fx: fx.data ? fxTabCaption(fx.data) : undefined,
            })}
            value={tab}
            onValueChange={setTab}
            aria-label="설정 항목"
            idPrefix={TAB_ID_PREFIX}
          />
          <AiEngineCard view={view} />
          <SettingsCheck
            view={view}
            pending={settings.isPending}
            unavailableErrors={unavailable?.envelope.fieldErrors ?? null}
          />
        </div>
        <TabPanel idPrefix={TAB_ID_PREFIX} value={tab} className={styles.tabPanel}>
          {tab === 'profile' ? <PurchaseAgencyProfileForm form={profileForm} /> : null}
          {tab === 'costs' ? (
            <ForwarderRateTablePanel
              defaultFeeKrw={readDefaultForwarderFeeKrw(view?.content)}
              focusRequest={rateTableFocus}
            />
          ) : null}
          {tab === 'fx' ? <SettingsFxTab focusRequest={fxFocus} /> : null}
        </TabPanel>
        <aside aria-label="적용 중인 기본값" className={styles.summary}>
          <AppliedDefaults
            view={view}
            rateTable={rateTable.table}
            fx={fx.data}
            onImportCsv={() => {
              setTab('costs');
              setRateTableFocus((n) => n + 1);
            }}
            onManualFx={() => {
              setTab('fx');
              setFxFocus((n) => n + 1);
            }}
          />
          <Banner tone="info" icon="lock">
            아동 단어·실존 인물 차단어·고지 필수 블록은 더할 수만 있고 뺄 수 없습니다.
          </Banner>
        </aside>
      </div>
    </>
  );
}

/** 'AI 엔진' 링크 카드: 현재 엔진·텍스트 모델(content.ai). 고르는 곳은 SCR-13(P1-11). */
function AiEngineCard({ view }: { view: SettingsView | undefined }) {
  const titleId = useId();
  const selected = readSelectedAiEngine(view?.content);
  return (
    <section aria-labelledby={titleId} className={styles.card}>
      <h2 id={titleId} className={styles.cardTitle}>
        AI 엔진
      </h2>
      <p className={styles.cardText}>
        AI 엔진은 별도 페이지에서 고릅니다 · 현재{' '}
        <strong className={styles.strong}>{selected?.displayName ?? EMPTY_VALUE}</strong>
        {selected?.textModel ? (
          <>
            {' '}
            <span className={styles.mono}>({selected.textModel})</span>
          </>
        ) : null}
      </p>
      <ButtonLink to="/settings/ai-engine" size="sm" className={styles.cardAction}>
        AI 엔진 설정
        <Icon name="arrow-right" />
      </ButtonLink>
    </section>
  );
}

/**
 * '설정 파일 검사': 오류가 없으면 '오류 없음', 있으면 칸 이름(JSON 경로)과 문구 목록.
 * '설정 파일 다시 읽기'(POST /settings-snapshots)는 시안에 없어 이 카드 아래에 보조 버튼으로 두었다(Proposed).
 */
function SettingsCheck({
  view,
  pending,
  unavailableErrors,
}: {
  view: SettingsView | undefined;
  pending: boolean;
  unavailableErrors: SettingsFieldError[] | null;
}) {
  const titleId = useId();
  const reload = useReloadSettingsMutation();
  const errors = view?.errors ?? unavailableErrors ?? [];
  const known = view !== undefined || unavailableErrors !== null;
  const ok = view?.valid === true && errors.length === 0;

  return (
    <section aria-labelledby={titleId} className={styles.card}>
      <h2 id={titleId} className={styles.cardTitle}>
        설정 파일 검사
      </h2>
      {pending ? <span className={styles.muted}>확인 중…</span> : null}
      {known && ok ? (
        <span className={`${styles.badge} ${styles.badgeOk}`}>
          <Icon name="check" size={12} strokeWidth={2.5} />
          오류 없음
        </span>
      ) : null}
      {known && !ok ? (
        <>
          <span className={`${styles.badge} ${styles.badgeError}`}>
            <Icon name="alert" size={12} />
            {errors.length > 0 ? `오류 ${errors.length}건` : '확인 필요'}
          </span>
          {errors.length > 0 ? (
            <ul className={styles.errorList} aria-label="설정 파일 오류">
              {errors.map((error, index) => (
                <li key={`${error.field}-${index}`} className={styles.errorItem}>
                  <code className={styles.field}>{error.field}</code>
                  <span>{error.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <p className={styles.caption}>
        앱을 켤 때와 설정 파일을 다시 읽을 때 형식을 검사합니다. 오류가 있으면 여기에 칸 이름과 함께
        보여 드립니다.
      </p>
      <Button
        size="sm"
        className={styles.cardAction}
        disabled={reload.isPending}
        onClick={() => reload.mutate()}
      >
        설정 파일 다시 읽기
      </Button>
      {reload.isError ? (
        <p role="alert" className={styles.alertText}>
          {reload.error.message}
        </p>
      ) : null}
      {reload.isSuccess ? (
        <p role="status" className={styles.caption}>
          {reload.data.created
            ? `새 설정을 적용했습니다 · 바뀐 칸 ${reload.data.changedKeys.length}개`
            : '바뀐 내용이 없습니다'}
        </p>
      ) : null}
    </section>
  );
}

/**
 * '적용 중인 기본값': 비용 6칸 + 부가세 모드, 배대지 요금표(버전·신발 박스 요금·CSV 안내·'CSV 가져오기'), 환율(원가 환율·수집 안내·
 * '환율 직접 입력'), 과세 사이즈 판매(M1은 파일로만 바꾼다) — Settings 보드 순서.
 */
function AppliedDefaults({
  view,
  rateTable,
  fx,
  onImportCsv,
  onManualFx,
}: {
  view: SettingsView | undefined;
  /** 활성 요금표 상세(없으면 null, 받는 중이면 undefined) */
  rateTable: ForwarderRateTableDetail | null | undefined;
  fx: FxRateLatestSet | undefined;
  onImportCsv: () => void;
  onManualFx: () => void;
}) {
  const titleId = useId();
  const taxableHelpId = useId();
  const costs = readAppliedCostDefaults(view?.content);
  const sellTaxable = readSellTaxableSizes(view?.content);
  const rows = [
    {
      term: '카드 가산',
      detail: <Num value={costs.cardSurchargePct} unit="pct" digits={RATE_DIGITS} />,
    },
    {
      term: '판매수수료',
      detail: <Num value={costs.saleFeePct} unit="pct" digits={RATE_DIGITS} />,
    },
    {
      term: 'Npay 수수료',
      detail: <Num value={costs.npayFeePct} unit="pct" digits={RATE_DIGITS} />,
    },
    { term: '기타비용', detail: <Num value={costs.miscCostKrw} unit="krw" /> },
    { term: '목표 마진', detail: <Num value={costs.targetMarginPct} unit="pct" /> },
    { term: '최소 이익', detail: <Num value={costs.minProfitKrw} unit="krw" /> },
    {
      term: '부가세 모드',
      detail: (costs.vatMode && VAT_MODE_LABEL[costs.vatMode]) ?? costs.vatMode ?? EMPTY_VALUE,
    },
  ];

  return (
    <section aria-labelledby={titleId} className={styles.summaryCard}>
      <h2 id={titleId} className={styles.summaryTitle}>
        적용 중인 기본값
      </h2>
      <div className={styles.group}>
        <h3 className={styles.groupTitle}>비용</h3>
        <dl className={styles.values}>
          {rows.map((row) => (
            <div key={row.term} className={styles.valueRow}>
              <dt className={styles.term}>{row.term}</dt>
              <dd className={styles.detail}>{row.detail}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.caption}>
          목표 마진은 모드 A로 계산합니다. 모드 B(총액 과세) 기준 순이익이 0원보다 작은 사이즈는
          팔지 않습니다.
        </p>
      </div>
      <RateTableDefaults view={view} rateTable={rateTable} onImportCsv={onImportCsv} />
      <FxDefaults fx={fx} onManualFx={onManualFx} />
      <div className={`${styles.group} ${styles.divided}`}>
        {sellTaxable === null ? (
          <div className={styles.switchRow}>
            <span className={styles.switchLabel}>과세 사이즈 판매</span>
            <span className={styles.muted}>{EMPTY_VALUE}</span>
          </div>
        ) : (
          <Switch
            label="과세 사이즈 판매"
            checked={sellTaxable}
            disabled
            aria-describedby={taxableHelpId}
            className={styles.switchRow}
          />
        )}
        <p id={taxableHelpId} className={styles.caption}>
          {sellTaxable
            ? '과세 사이즈도 관부가세 예상액을 판매가에 넣어 팝니다.'
            : '지금은 면세 사이즈만 팝니다. 관세사 확인 뒤 켜면 관부가세 예상액을 판매가에 넣습니다.'}{' '}
          설정 파일(<code className={styles.field}>pricing.sellTaxableSizes</code>)에서 바꿉니다.
        </p>
      </div>
    </section>
  );
}

/**
 * 요약 '배대지 요금표'(보드): 버전(활성 버전 'v2026-09', 없으면 '없음'), '신발 박스 1.2kg'(설정 박스가 들어가는 구간 요금, 없으면
 * 기본 배대지 비용 + '가정값'), CSV 열 안내, 'CSV 가져오기'(요금표 탭으로 옮겨 파일 칸에 초점).
 */
function RateTableDefaults({
  view,
  rateTable,
  onImportCsv,
}: {
  view: SettingsView | undefined;
  rateTable: ForwarderRateTableDetail | null | undefined;
  onImportCsv: () => void;
}) {
  const titleId = useId();
  const box = readShoeBox(view?.content);
  const tier = rateTable ? shoeBoxTier(rateTable.tiers, box) : null;
  const boxLabel = `신발 박스 ${box.weightKg}kg`;
  let boxFee = EMPTY_VALUE;
  if (rateTable === null)
    boxFee = `${formatKrw(readDefaultForwarderFeeKrw(view?.content))} · 가정값`;
  else if (tier) boxFee = formatTierFee(tier.fee, tier.currency);
  else if (rateTable) boxFee = '구간 밖';
  return (
    <section aria-labelledby={titleId} className={`${styles.group} ${styles.divided}`}>
      <h3 id={titleId} className={styles.groupTitle}>
        배대지 요금표
      </h3>
      <dl className={styles.values}>
        <div className={styles.valueRow}>
          <dt className={styles.term}>버전</dt>
          <dd className={`${styles.detail} ${styles.monoValue}`}>
            {rateTable === undefined
              ? EMPTY_VALUE
              : rateTable
                ? rateTableVersionLabel(rateTable)
                : '없음'}
          </dd>
        </div>
        <div className={styles.valueRow}>
          <dt className={styles.term}>{boxLabel}</dt>
          <dd className={`${styles.detail} ${styles.monoValue}`}>{boxFee}</dd>
        </div>
      </dl>
      <p className={styles.caption}>{RATE_TABLE_CSV_HINT}</p>
      <Button size="sm" className={styles.cardAction} onClick={onImportCsv}>
        <Icon name="upload" />
        CSV 가져오기
      </Button>
    </section>
  );
}

/** 요약 '환율'(보드): 원가 환율 값, '09:00 자동 수집. 수집이 실패하면 …' 안내, '환율 직접 입력'(환율 탭으로 옮겨 첫 칸에 초점) */
function FxDefaults({
  fx,
  onManualFx,
}: {
  fx: FxRateLatestSet | undefined;
  onManualFx: () => void;
}) {
  const titleId = useId();
  const cost = latestOf(fx, 'COST/JPY');
  return (
    <section aria-labelledby={titleId} className={`${styles.group} ${styles.divided}`}>
      <h3 id={titleId} className={styles.groupTitle}>
        환율
      </h3>
      <dl className={styles.values}>
        <div className={styles.valueRow}>
          <dt className={styles.term}>원가 환율</dt>
          <dd className={`${styles.detail} ${styles.monoValue}`}>
            {cost ? formatRecordRate(cost) : EMPTY_VALUE}
          </dd>
        </div>
      </dl>
      <p className={styles.caption}>{fxAutoCaption(cost)}</p>
      {fx && fx.warnings.length > 0 ? (
        <p className={styles.alertText}>경고 {fx.warnings.length}건 · 환율 탭에서 확인해 주세요</p>
      ) : null}
      <Button size="sm" className={styles.cardAction} onClick={onManualFx}>
        환율 직접 입력
      </Button>
    </section>
  );
}

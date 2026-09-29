import { useId, useState } from 'react';
import {
  readAppliedCostDefaults,
  readSelectedAiEngine,
  readSellTaxableSizes,
  type SettingsFieldError,
  type SettingsView,
  useReloadSettingsMutation,
  useSettingsQuery,
  VAT_MODE_LABEL,
} from '@/features/settings';
import { EMPTY_VALUE, type FractionDigits } from '@/shared/lib/format';
import {
  Banner,
  Button,
  ButtonLink,
  Icon,
  Num,
  PageHeader,
  Panel,
  Switch,
  TabPanel,
  Tabs,
  type TabItem,
} from '@/shared/ui';
import styles from './SettingsPage.module.css';

/** M1 탭 3개(Settings 보드 순서). 나머지 탭(템플릿·사전, 브랜드 사전, 목표 사이즈, AI 공급자, 기준값 버전)은 M2다. */
type SettingsTab = 'profile' | 'costs' | 'fx';

const TABS: readonly TabItem<SettingsTab>[] = [
  { value: 'profile', label: '구매대행 프로필' },
  { value: 'costs', label: '비용·요금표' },
  { value: 'fx', label: '환율' },
];

const TAB_ID_PREFIX = 'settings';

/** 탭 본문을 채울 곳: 구매대행 프로필 P1-09, 요금표·환율 P2-04. 머리의 '되돌리기'·'저장'도 그쪽(F-ST-12 M2·P1-09) 몫이다. */
const TAB_BODY: Record<SettingsTab, { title: string; caption?: string }> = {
  profile: { title: '구매대행 프로필', caption: '모든 상품의 배송·반품·고시에 같이 들어갑니다' },
  costs: { title: '비용·요금표' },
  fx: { title: '환율' },
};

/** 요율 표기(보드: 2.5% · 3.0% · 3.63%) */
const RATE_DIGITS: FractionDigits = { minFractionDigits: 1, maxFractionDigits: 3 };

/**
 * SCR-10 설정(Settings.dc.html)의 M1 부분: 화면 머리, 탭 틀 3개, 'AI 엔진' 링크 카드, '설정 파일 검사'(+ 다시 읽기),
 * '적용 중인 기본값'(비용·부가세 모드·과세 사이즈 판매), 안내 줄. 값은 `GET /settings`의 `content`에서 읽는다.
 * 통과한 설정이 하나도 없으면(503 SETTINGS_INVALID) 차단 띠에 봉투 message를 보인다.
 */
export function SettingsPage() {
  const settings = useSettingsQuery();
  const [tab, setTab] = useState<SettingsTab>('profile');
  const view = settings.data;
  const unavailable = settings.error?.code === 'SETTINGS_INVALID' ? settings.error : null;
  const failed = settings.isError && !unavailable ? settings.error : null;
  const body = TAB_BODY[tab];

  return (
    <>
      <PageHeader
        title="설정"
        screenId="SCR-10"
        description="모든 상품에 공통으로 쓰는 값입니다. 저장할 때 형식을 검사하고, 안전장치를 끄거나 기준을 낮추는 값은 저장하지 않습니다."
      />
      {unavailable ? <Banner tone="blocked">{unavailable.message}</Banner> : null}
      {failed ? <Banner tone="warning">{failed.message}</Banner> : null}
      <div className={styles.layout}>
        <div className={styles.side}>
          <Tabs
            items={TABS}
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
          <Panel title={body.title} caption={body.caption}>
            <p className={styles.muted}>이 탭의 입력은 아직 만들지 않았습니다.</p>
          </Panel>
        </TabPanel>
        <aside aria-label="적용 중인 기본값" className={styles.summary}>
          <AppliedDefaults view={view} />
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

/** '적용 중인 기본값': 비용 6칸 + 부가세 모드, 과세 사이즈 판매(M1은 파일로만 바꾼다). */
function AppliedDefaults({ view }: { view: SettingsView | undefined }) {
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

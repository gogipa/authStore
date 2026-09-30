import type { ReactNode } from 'react';
import type { AiEngineModelPair, AiEngineOption } from '@/features/settings';
import {
  type AiEngineCheckView,
  authStatusView,
  formatLatency,
  installChip,
  smokeChip,
  type StatusChipView,
  versionSupportText,
} from '@/features/system';
import { cx } from '@/shared/lib/cx';
import { EMPTY_VALUE, formatKstTime } from '@/shared/lib/format';
import {
  Button,
  Chip,
  CommandBox,
  type CommandLine,
  DefinitionList,
  type DefinitionItem,
  DisabledReason,
  Radio,
  Select,
  TextField,
} from '@/shared/ui';
import styles from './EngineCard.module.css';

/** [연결 테스트] 옆 캡션(보드 문구) */
export const SMOKE_TEST_CAPTION = "'OK' 한 단어를 받는 호출 1회 · 누를 때만 돕니다";
/** 설치 안 된 카드의 꺼진 이유(보드 문구) */
export const NOT_INSTALLED_REASON = '설치되지 않아 고를 수 없습니다';

/** 로그인(·설치) 방법 명령 상자(보드 문구, 문자열 상수 — CLI를 실행해 만든 값이 아니다) */
function loginLines(engine: AiEngineOption['engineCode'], installed: boolean): CommandLine[] {
  if (engine === 'CLAUDE') {
    return [
      {
        command: 'claude',
        note: (
          <>
            실행 후 <span className={styles.mono}>/login</span>
          </>
        ),
      },
    ];
  }
  if (engine === 'AGY') return [{ command: 'agy', note: '처음 실행할 때 로그인 창이 뜹니다' }];
  const login: CommandLine = { command: 'codex login', note: '구독 로그인 · API 키는 안 씀' };
  return installed
    ? [login]
    : [{ command: 'npm install -g @openai/codex', copyLabel: '설치 명령 복사' }, login];
}

function StateChip({ chip }: { chip: StatusChipView }) {
  return (
    <Chip tone={chip.tone} icon={chip.icon}>
      {chip.label}
    </Chip>
  );
}

export interface EngineCardProps {
  option: AiEngineOption;
  /** 이 엔진의 최신 점검·마지막 연결 테스트 */
  view: AiEngineCheckView;
  /** 저장된(사용 중) 엔진인가 */
  inUse: boolean;
  /** 화면에서 고른 엔진인가 */
  picked: boolean;
  /** 화면의 텍스트·비전 모델 */
  models: AiEngineModelPair;
  onPick: () => void;
  onModelChange: (kind: keyof AiEngineModelPair, value: string) => void;
  onTest: () => void;
  /** 점검 요청을 보내는 중(버튼을 잠시 끈다) */
  requesting?: boolean;
  /** 저장 흐름(연결 테스트 → 저장)이 도는 중: 라디오·모델·[연결 테스트]를 잠시 끈다(테스트한 값과 저장할 값이 어긋나지 않게) */
  locked?: boolean;
}

/**
 * SCR-13 엔진 카드(04-3 organism EngineCard, AiEngine.dc.html, P1-11 규칙 11). `picked` → `.selected`(2px accent 테두리),
 * 설치되지 않았으면 `disabled`(라디오·모델·[연결 테스트]를 끄고 이유를 보인다 — 카드는 숨기지 않는다).
 * 머리 칩: '사용 중'(저장된 엔진) · '저장 전'(골랐지만 저장 안 함) · '설치 안 됨' · '실험적'(M0 S7 기준 미달·미측정).
 */
export function EngineCard({
  option,
  view,
  inUse,
  picked,
  models,
  onPick,
  onModelChange,
  onTest,
  requesting = false,
  locked = false,
}: EngineCardProps) {
  const engine = option.engineCode;
  const id = engine.toLowerCase();
  const latest = view.latest;
  const notInstalled = latest?.installed === false;
  const reasonId = `eng-${id}-why`;
  const nameId = `eng-${id}-name`;
  const auth = authStatusView(view);
  const smoke = view.lastSmoke;

  const items: DefinitionItem[] = [
    {
      key: 'install',
      term: '설치',
      detail: notInstalled ? (
        <span className={styles.muted}>
          <span className={styles.monoSmall}>{option.binName} --version</span> 응답 없음
        </span>
      ) : (
        <>
          <StateChip chip={installChip(latest)} />
          {latest?.cliVersion ? <span className={styles.version}>{latest.cliVersion}</span> : null}
          {latest ? (
            <span className={styles.caption}>{versionSupportText(latest.versionSupported)}</span>
          ) : null}
        </>
      ),
    },
    {
      key: 'bin',
      term: '실행 파일',
      detail: (
        <span className={cx(styles.path, notInstalled && styles.muted)}>
          {notInstalled ? '찾지 못함' : (latest?.binPath ?? EMPTY_VALUE)}
        </span>
      ),
    },
    {
      key: 'auth',
      term: '로그인',
      detail: notInstalled ? (
        <span className={styles.faint}>설치 뒤 확인</span>
      ) : (
        <>
          <StateChip chip={auth.chip} />
          {auth.note ? (
            <span className={auth.noteIsCommand ? styles.command : styles.caption}>
              {auth.note}
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: 'smoke',
      term: '연결 테스트',
      detail: notInstalled ? (
        <span className={styles.faint}>설치 뒤 할 수 있음</span>
      ) : (
        <>
          <StateChip chip={smokeChip(smoke)} />
          {smoke ? (
            <>
              <span className={styles.latency}>{formatLatency(smoke.latencyMs)}</span>
              <span className={styles.caption}>
                <span className={styles.mono}>{formatKstTime(smoke.checkedAt)}</span>
                {smoke.model ? ` · ${smoke.model}` : ''}
              </span>
            </>
          ) : null}
        </>
      ),
    },
  ];

  const modelField = (kind: keyof AiEngineModelPair, label: string): ReactNode => {
    const fieldId = `${id}-${kind}-model`;
    const value = models[kind];
    return (
      <>
        <label htmlFor={fieldId} className={styles.fieldLabel}>
          {label}
        </label>
        {option.allowCustomModel ? (
          <TextField
            id={fieldId}
            mono
            value={value ?? ''}
            placeholder="모델 ID 직접 입력"
            maxLength={100}
            disabled={notInstalled || locked}
            onChange={(e) => onModelChange(kind, e.target.value)}
          />
        ) : (
          <Select
            id={fieldId}
            mono
            value={value ?? ''}
            disabled={notInstalled || locked}
            onChange={(e) => onModelChange(kind, e.target.value)}
          >
            {value === null ? <option value="">고르지 않음</option> : null}
            {value !== null && !option.modelOptions.includes(value) ? (
              <option value={value}>{value}</option>
            ) : null}
            {option.modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        )}
      </>
    );
  };

  return (
    <section
      aria-labelledby={nameId}
      className={cx(styles.card, picked && styles.selected, notInstalled && styles.disabled)}
      data-engine={engine}
    >
      <div className={styles.head}>
        <Radio
          id={`eng-${id}`}
          name="ai-engine"
          value={engine}
          checked={picked}
          disabled={notInstalled || locked}
          aria-describedby={notInstalled ? reasonId : undefined}
          onChange={onPick}
          className={styles.radio}
          label={
            <span id={nameId} className={styles.nameRow}>
              <span className={styles.name}>{option.displayName}</span>
              <span className={styles.bin}>{option.binName}</span>
            </span>
          }
        />
        {option.experimental ? <Chip tone="outline">실험적</Chip> : null}
        {inUse ? <Chip tone="accent">사용 중</Chip> : null}
        {picked && !inUse ? <Chip tone="waiting">저장 전</Chip> : null}
        {notInstalled ? (
          <Chip tone="idle" icon="circle">
            설치 안 됨
          </Chip>
        ) : null}
      </div>

      <DefinitionList items={items} labelWidth={76} />

      <div className={styles.models}>
        {modelField('text', '텍스트 모델')}
        {modelField('vision', '비전 모델')}
      </div>

      <div className={styles.test}>
        <Button
          size="sm"
          disabled={notInstalled || requesting || locked}
          aria-describedby={notInstalled ? reasonId : undefined}
          onClick={onTest}
        >
          연결 테스트
        </Button>
        {notInstalled ? (
          <DisabledReason id={reasonId}>{NOT_INSTALLED_REASON}</DisabledReason>
        ) : engine === 'AGY' ? (
          <span className={styles.caption}>
            모델 목록은 <span className={styles.mono}>agy models</span> 결과입니다
          </span>
        ) : (
          <span className={styles.caption}>{SMOKE_TEST_CAPTION}</span>
        )}
      </div>

      <CommandBox
        label={
          notInstalled ? '설치·로그인 방법 · 설치 뒤 [다시 감지]' : '로그인 방법 · 본인 구독 계정'
        }
        lines={loginLines(engine, !notInstalled)}
      />

      <p className={styles.terms}>{option.termsNote}</p>
    </section>
  );
}

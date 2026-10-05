import { type FormEvent, useEffect, useId, useState } from 'react';
import { useControllableState } from '@/shared/lib/useControllableState';
import { Banner, Button, Chip, Panel, TextField } from '@/shared/ui';
import { useSaveSecretMutation, useSecretsQuery } from '../../api/secrets';
import {
  SECRET_KEYS,
  SECRET_LABEL,
  type SecretKey,
  secretLabelText,
  secretRowId,
  type SecretStatus,
} from '../../model/secretLabels';
import styles from './SecretKeysPanel.module.css';

/** 비밀값 최대 길이(05-2 SecretValueRequest maxLength) */
const SECRET_VALUE_MAX = 4096;

export interface SecretKeysPanelProps {
  /** 입력칸을 연 키(제어). 주지 않으면 패널 안에서 기억한다 */
  editingKey?: SecretKey | null;
  onEditingKeyChange?: (key: SecretKey | null) => void;
  /** 값을 늘리면 열린 키의 입력칸으로 초점을 다시 옮긴다(인증 상태의 'client_secret 다시 넣기') */
  focusRequest?: number;
  /** 보일 키(순서 그대로). 기본은 6개 모두. 설정 마법사(D-29 5번·D-30)는 커머스API·라쿠텐 키 4개만 */
  keys?: readonly SecretKey[];
}

/**
 * SCR-11 (1) 키 입력(System.dc.html, F-SY-01·F-BS-25). 키마다 '키체인에 저장됨' 칩과 '다시 넣기'(없으면 '넣기').
 * 누르면 그 행 아래에 `type=password`·`autocomplete=off` 칸과 [저장]·[취소]가 열린다. 저장한 값은 다시 보여 주지 않고,
 * 성공하면 칸을 닫아 값이 화면에 남지 않는다. 행 id는 `secret-<키>`(주소 조각으로 바로 연다).
 */
export function SecretKeysPanel({
  editingKey,
  onEditingKeyChange,
  focusRequest = 0,
  keys = SECRET_KEYS,
}: SecretKeysPanelProps) {
  const secrets = useSecretsQuery();
  const [open, setOpen] = useControllableState<SecretKey | null>(
    editingKey,
    null,
    onEditingKeyChange,
  );
  const [savedKey, setSavedKey] = useState<SecretKey | null>(null);
  const byKey = new Map<SecretKey, SecretStatus>(
    (secrets.data?.items ?? []).map((item) => [item.secretKey, item]),
  );

  const toggle = (key: SecretKey) => {
    setSavedKey(null);
    setOpen(open === key ? null : key);
  };

  return (
    <Panel id="keys" title="키 입력">
      <p className={styles.caption}>값은 보여 주지 않습니다 · macOS 키체인에만 저장합니다</p>
      {secrets.isError ? <Banner tone="blocked">{secrets.error.message}</Banner> : null}
      <ul className={styles.list}>
        {keys.map((key) => (
          <SecretRow
            key={key}
            secretKey={key}
            status={byKey.get(key)}
            pending={secrets.isPending}
            open={open === key}
            saved={savedKey === key}
            focusRequest={focusRequest}
            onToggle={() => toggle(key)}
            onClose={() => setOpen(null)}
            onSaved={() => {
              setOpen(null);
              setSavedKey(key);
            }}
          />
        ))}
      </ul>
    </Panel>
  );
}

function SecretRow({
  secretKey,
  status,
  pending,
  open,
  saved,
  focusRequest,
  onToggle,
  onClose,
  onSaved,
}: {
  secretKey: SecretKey;
  status: SecretStatus | undefined;
  pending: boolean;
  open: boolean;
  saved: boolean;
  focusRequest: number;
  onToggle: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { service, name } = SECRET_LABEL[secretKey];
  const text = secretLabelText(secretKey);
  const formId = useId();
  const configured = status?.configured === true;
  const action = configured ? '다시 넣기' : '넣기';

  return (
    <li id={secretRowId(secretKey)} className={styles.row} data-secret-key={secretKey}>
      <div className={styles.rowHead}>
        <span className={styles.name}>
          {service}
          {name ? (
            <>
              {' '}
              <span className={styles.mono}>{name}</span>
            </>
          ) : null}
        </span>
        {status === undefined ? (
          pending ? (
            <span className={styles.muted}>확인 중…</span>
          ) : null
        ) : configured ? (
          <Chip tone="done" icon="check">
            키체인에 저장됨
          </Chip>
        ) : (
          <Chip tone="waiting">저장 안 됨</Chip>
        )}
        <Button
          size="sm"
          aria-label={`${text} ${action}`}
          aria-expanded={open}
          aria-controls={open ? formId : undefined}
          onClick={onToggle}
        >
          {action}
        </Button>
      </div>
      {open ? (
        <SecretForm
          id={formId}
          secretKey={secretKey}
          focusRequest={focusRequest}
          onCancel={onClose}
          onSaved={onSaved}
        />
      ) : null}
      {saved ? (
        <p role="status" className={styles.saved}>
          키체인에 저장했습니다. 값은 다시 보여 드리지 않습니다.
        </p>
      ) : null}
    </li>
  );
}

function SecretForm({
  id,
  secretKey,
  focusRequest,
  onCancel,
  onSaved,
}: {
  id: string;
  secretKey: SecretKey;
  focusRequest: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const inputId = `secret-input-${secretKey}`;
  const [value, setValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const save = useSaveSecretMutation();
  const text = secretLabelText(secretKey);

  // 열릴 때와 다시 넣기 요청마다 입력칸으로 초점을 옮긴다
  useEffect(() => {
    document.getElementById(inputId)?.focus();
  }, [inputId, focusRequest]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.length === 0) {
      setLocalError('값을 넣어 주세요.');
      return;
    }
    setLocalError(null);
    save.mutate(
      { secretKey, value },
      {
        onSuccess: () => {
          setValue('');
          save.reset();
          onSaved();
        },
      },
    );
  };

  const serverError = save.error
    ? (save.error.envelope.fieldErrors?.[0]?.message ?? save.error.message)
    : null;

  return (
    <form id={id} className={styles.form} onSubmit={submit} aria-label={`${text} 넣기`}>
      <TextField
        id={inputId}
        label={`${text} 새 값`}
        type="password"
        autoComplete="off"
        spellCheck={false}
        maxLength={SECRET_VALUE_MAX}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setLocalError(null);
        }}
        error={localError ?? serverError ?? undefined}
        hint="저장하면 칸을 비우고 다시 보여 주지 않습니다."
      />
      <div className={styles.formActions}>
        <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
          {save.isPending ? '저장 중…' : '저장'}
        </Button>
        <Button size="sm" onClick={onCancel} disabled={save.isPending}>
          취소
        </Button>
      </div>
    </form>
  );
}

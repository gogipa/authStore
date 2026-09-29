import { useState, type ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { IconButton } from '../IconButton/IconButton';
import styles from './CommandBox.module.css';

export interface CommandLine {
  /** 터미널에 칠 명령(mono 13px). */
  command: string;
  /** 명령 옆 설명(캡션). 예: '실행 후 /login'. */
  note?: ReactNode;
  /** 복사 버튼 이름. 기본 '명령 <command> 복사'. */
  copyLabel?: string;
}

export interface CommandBoxProps {
  /** 상자 위 라벨(예: '로그인 방법 · 본인 구독 계정'). */
  label?: ReactNode;
  lines: readonly CommandLine[];
  /** 복사할 때 부르는 함수. 기본은 `navigator.clipboard.writeText`. 테스트가 바꿔 넣는다. */
  copy?: (text: string) => Promise<void>;
  className?: string;
}

async function copyToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard) throw new Error('clipboard unavailable');
  await navigator.clipboard.writeText(text);
}

/**
 * 명령 상자(04-3 CommandBox, AiEngine 보드): bg 바탕 상자 안에 명령과 복사 아이콘 버튼.
 * 복사 결과는 화면 읽기 프로그램에도 알린다(`role="status"`).
 */
export function CommandBox({ label, lines, copy = copyToClipboard, className }: CommandBoxProps) {
  const [status, setStatus] = useState('');

  async function onCopy(command: string) {
    try {
      await copy(command);
      setStatus(`복사했습니다: ${command}`);
    } catch {
      setStatus('복사하지 못했습니다. 명령을 직접 골라 복사하세요.');
    }
  }

  return (
    <div className={cx(styles.wrap, className)}>
      {label !== undefined ? <span className={styles.label}>{label}</span> : null}
      <div className={cx(styles.box, lines.length > 1 && styles.multi)}>
        {lines.map((line) => (
          <div key={line.command} className={styles.line}>
            <code className={styles.command}>{line.command}</code>
            <span className={styles.note}>{line.note}</span>
            <IconButton
              icon="copy"
              aria-label={line.copyLabel ?? `명령 ${line.command} 복사`}
              onClick={() => void onCopy(line.command)}
            />
          </div>
        ))}
      </div>
      <span role="status" className={styles.srOnly}>
        {status}
      </span>
    </div>
  );
}

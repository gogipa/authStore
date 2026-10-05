import { useDemo } from '@/shared/lib/demo';
import { ButtonLink, Icon, type ButtonSize } from '@/shared/ui';
import { DEMO_ENTRY_TEXT, DEMO_START_PATH } from '../../content';
import styles from './DemoEntry.module.css';

export interface DemoEntryProps {
  size?: ButtonSize;
  /** 체험 안에서: note = '지금 체험 중' 글(기본), hidden = 아무것도 그리지 않음(대시보드 카드 머리) */
  inDemo?: 'note' | 'hidden';
}

/**
 * 체험 입구 [체험해 보기](F-GD-05, D-31): 체험의 첫 화면(`DEMO_START_PATH` — 키워드)을 새 탭으로 연다(지금 화면·데이터는 그대로). 설정 마법사 6·7단계·사용 안내
 * '체험해 보기' 패널·대시보드 작업 흐름 카드가 쓴다. 체험 안에서는 버튼 대신 '지금 체험 중' 글을 보인다.
 * 새 탭 전체 로드라 체험 앱이 처음부터 켜진다(라우터 이동이 아니다 — `reloadDocument`).
 */
export function DemoEntry({ size = 'sm', inDemo = 'note' }: DemoEntryProps) {
  if (useDemo() !== null) {
    return inDemo === 'note' ? <p className={styles.inDemo}>{DEMO_ENTRY_TEXT.inDemo}</p> : null;
  }
  return (
    <ButtonLink
      to={DEMO_START_PATH}
      reloadDocument
      target="_blank"
      rel="noopener noreferrer"
      size={size}
      aria-label={`${DEMO_ENTRY_TEXT.open} (${DEMO_ENTRY_TEXT.newTab})`}
    >
      {DEMO_ENTRY_TEXT.open}
      <Icon name="external" size={16} />
    </ButtonLink>
  );
}

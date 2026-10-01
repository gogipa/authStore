import { Chip, IconButton } from '@/shared/ui';
import styles from './RemovableTag.module.css';

export interface RemovableTagProps {
  /** 태그 글 */
  text: string;
  /** '사전 미등록' 표시(오너가 더했고 추천 코드가 없다, F-TG-14) */
  dictionaryUnregistered?: boolean;
  /** 삭제 버튼을 눌렀을 때 */
  onRemove: () => void;
  /** 삭제를 막을 때(⑦ 실행 중 등). 이유는 화면이 따로 보인다 */
  disabled?: boolean;
}

/**
 * 최종 태그 하나 + 삭제 버튼(04-3 molecule RemovableTag, Tags.dc.html 최종 태그 줄): 32px 높이, line 테두리, radius 4, 13px 글자,
 * 오른쪽 24px 아이콘 버튼(`'{태그} 태그 삭제'`). 사전에 없는 태그는 waiting 칩 '사전 미등록'을 붙인다.
 */
export function RemovableTag({
  text,
  dictionaryUnregistered = false,
  onRemove,
  disabled = false,
}: RemovableTagProps) {
  return (
    <li className={styles.tag}>
      <span className={styles.text}>{text}</span>
      {dictionaryUnregistered ? <Chip tone="waiting">사전 미등록</Chip> : null}
      <IconButton
        icon="close"
        size="sm"
        aria-label={`${text} 태그 삭제`}
        disabled={disabled}
        onClick={onRemove}
      />
    </li>
  );
}

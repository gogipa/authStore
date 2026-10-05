import { Chip } from '@/shared/ui';
import { READINESS_TEXT } from '../../content';
import type { ReadinessState } from '../../model/readiness';

/** 시작 준비 항목 칩(완료·할 일·확인 중·확인 못함 — 색만으로 알리지 않게 글자를 함께, 화면시안_명세 §8.2) */
export function ReadinessStateChip({ state }: { state: ReadinessState }) {
  switch (state) {
    case 'done':
      return (
        <Chip tone="done" icon="check">
          {READINESS_TEXT.chipDone}
        </Chip>
      );
    case 'todo':
      return <Chip tone="waiting">{READINESS_TEXT.chipTodo}</Chip>;
    case 'error':
      return (
        <Chip tone="waiting" icon="alert">
          {READINESS_TEXT.chipError}
        </Chip>
      );
    default:
      return <Chip tone="idle">{READINESS_TEXT.chipLoading}</Chip>;
  }
}

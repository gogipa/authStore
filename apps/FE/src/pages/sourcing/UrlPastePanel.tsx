import type { ReactNode } from 'react';
import { RakutenUrlForm, URL_PASTE_CAPTION, URL_PASTE_NOTE } from '@/features/sourcing';
import styles from './UrlPastePanel.module.css';

export interface UrlPastePanelProps {
  /** 페이지를 읽을 수 없는 이유(하루 상한·24시간 쉼). 있으면 '넣기'를 끄고 이유를 보인다 */
  blockedReason: string | null;
  /** 만든 후보·같은 상품·색상의 진행 중 후보를 연다 */
  onOpenCandidate: (candidateId: number) => void;
  /** 오른쪽 아래 자리('성인용 상품 확인') */
  aside?: ReactNode;
}

/**
 * SCR-03 '라쿠텐 URL 붙여넣기'(Sourcing.dc.html 아래 패널, F-SO-31·33·35): URL 칸 + 넣는 방법('비교표에 넣기'·
 * '바로 후보 만들기') + '넣기', 건당 페이지 1회(하루 조회에 포함). 제외어 상품은 넣지 않고, 같은 상품·색상의 진행 중 후보가
 * 있으면 그 후보를 연다. '비교표에 넣기'(수동 행)는 P2-03이 잇는다.
 */
export function UrlPastePanel({ blockedReason, onOpenCandidate, aside }: UrlPastePanelProps) {
  return (
    <section aria-label="라쿠텐 URL 붙여넣기" className={styles.panel}>
      <RakutenUrlForm
        label="라쿠텐 URL 붙여넣기"
        labelVariant="heading"
        caption={URL_PASTE_CAPTION}
        modes={['TABLE', 'CREATE']}
        blockedReason={blockedReason}
        onOpenCandidate={onOpenCandidate}
        note={URL_PASTE_NOTE}
        aside={aside}
      />
    </section>
  );
}

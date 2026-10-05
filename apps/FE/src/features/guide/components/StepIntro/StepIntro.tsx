import type { ReactNode } from 'react';
import { ButtonLink, DefinitionList, Disclosure } from '@/shared/ui';
import type { GuideLink } from '../../content';
import { useStepGuideVisible } from '../../model/stepGuideVisible';
import styles from './StepIntro.module.css';

export interface StepIntroGlossaryItem {
  /** 화면 읽기·키로 쓰는 값 */
  id: string;
  term: string;
  text: string;
}

export interface StepIntroProps {
  /** 영역 이름(화면 읽기 프로그램) */
  label: string;
  /** 이 단계가 하는 일 한 문장 */
  purpose: string;
  nowLabel: string;
  /** 지금 할 일 한 줄. 알 수 없는 상태면 null(줄을 그리지 않는다) */
  now: ReactNode | null;
  /** 지금 할 일 아래에 놓는 이동 버튼 — 고칠 곳이 다른 단계일 때(⑧⑨). 다음 단계로 넘어가는 버튼은 화면 아래에 둔다 */
  nowLink?: GuideLink;
  glossaryTitle: string;
  /** 풀이 제목 옆 작은 글(펼치지 않아도 된다는 뜻) */
  glossaryHint?: string;
  glossary: readonly StepIntroGlossaryItem[];
}

/**
 * 단계 화면 맨 위 안내(D-34, 화면시안_명세 §10): 이 단계가 하는 일 한 문장 · 지금 할 일 한 줄 · 접어 둔 '낯선 말·버튼 풀이'.
 * 지금 할 일은 상태에 따라 바뀌어서 `role="status"`로 알린다(초점은 옮기지 않는다). 글은 content.ts(= 안내문구.md §9).
 */
export function StepIntro({
  label,
  purpose,
  nowLabel,
  now,
  nowLink,
  glossaryTitle,
  glossaryHint,
  glossary,
}: StepIntroProps) {
  // 체험에서만 그린다(D-43)
  const visible = useStepGuideVisible();
  if (!visible) return null;
  return (
    <section aria-label={label} className={styles.intro}>
      <p className={styles.purpose}>{purpose}</p>
      <p role="status" className={styles.now}>
        {now ? (
          <>
            <strong className={styles.nowLabel}>{nowLabel}</strong> {now}
          </>
        ) : null}
      </p>
      {now && nowLink ? (
        <div className={styles.next}>
          <ButtonLink to={nowLink.to} size="sm">
            {nowLink.label}
          </ButtonLink>
        </div>
      ) : null}
      <Disclosure title={glossaryTitle} meta={glossaryHint} look="link">
        <DefinitionList
          labelWidth={168}
          items={glossary.map((item) => ({ key: item.id, term: item.term, detail: item.text }))}
        />
      </Disclosure>
    </section>
  );
}

import { fillText, STEP_GUIDE_COMMON, type ScreenGuideContent } from '../../content';
import { StepIntro } from '../StepIntro/StepIntro';

export interface ScreenGuidePanelProps {
  guide: ScreenGuideContent;
  /** 지금 할 일 키(`guide.now`의 키). 알 수 없는 상태면 null — 줄을 감춘다 */
  nowKey: string | null;
  /** 글 속 `{이름}` 자리 값(풀이 글에도 쓴다) */
  values?: Readonly<Record<string, string | number>>;
  /** 지금 할 일 옆 이동 링크 주소(글은 `guide.links[nowKey]`). 없으면 링크를 그리지 않는다 */
  linkTo?: string;
}

/**
 * ③~⑨ 화면 맨 위 안내(D-41): `StepIntro`에 화면 글(`ScreenGuideContent`)을 채워 그린다. ②는 같은 판을 `SOURCING_*` 글로 직접 쓴다(D-34).
 * 글은 content.ts(= 안내문구.md §10). 지금 할 일이 있는 자리에는 화면 코드가 `NowMark`를 감싼다.
 */
export function ScreenGuidePanel({ guide, nowKey, values = {}, linkTo }: ScreenGuidePanelProps) {
  const nowText = nowKey ? guide.now[nowKey] : undefined;
  const linkLabel = nowKey ? guide.links[nowKey] : undefined;
  return (
    <StepIntro
      label={guide.region}
      purpose={guide.purpose}
      nowLabel={STEP_GUIDE_COMMON.nowLabel}
      now={nowText ? fillText(nowText, values) : null}
      nowLink={linkTo && linkLabel ? { label: linkLabel, to: linkTo } : undefined}
      glossaryTitle={STEP_GUIDE_COMMON.glossaryTitle}
      glossaryHint={STEP_GUIDE_COMMON.glossaryHint}
      glossary={Object.entries(guide.glossary).map(([id, entry]) => ({
        id,
        term: entry.term,
        text: fillText(entry.text, values),
      }))}
    />
  );
}

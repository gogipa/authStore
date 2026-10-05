import { useId, useState } from 'react';
import {
  checklistComplete,
  emptyChecklist,
  G3_CHECKLIST_TITLE,
  G3_INVALID_TEXT,
  G3_PASS_LABEL,
  G3_REPICK_CAPTION,
  G3_REPICK_NOTE,
  g3ChecklistItems,
  g3DisabledReason,
  NEXT_CONTENT_LABEL,
  SAME_PRODUCT_DESCRIPTION,
  SAME_PRODUCT_LABEL,
  SAME_PRODUCT_NOTE,
  type G3ChecklistKey,
  type G3ChecklistState,
  type ThumbnailOutput,
  type ThumbnailPick,
} from '@/features/thumbnails';
import { isApiRequestError } from '@/shared/api/errors';
import { formatKstTime } from '@/shared/lib/format';
import { stepPath } from '@/shared/lib/steps';
import { Button, ButtonLink, Checkbox, DisabledReason, GateBadge, Panel } from '@/shared/ui';
import styles from './ThumbnailPage.module.css';

export interface G3ChecklistProps {
  candidateId: number;
  /** ⑤ 현재 버전 산출물(없으면 고를 수 없다) */
  output: ThumbnailOutput | undefined;
  /** 여정의 선택 색상(체크리스트 '색상이 {선택 색상}과 같음') */
  selectedColor: string | null | undefined;
  pick: ThumbnailPick;
  /** 대표 후보의 번호('후보 4 기준') */
  representativeSlotNo: number | null;
  /** 생성 중인 번호가 있는가 */
  running: boolean;
  /** 지금 고른 것이 유효한 G3 통과의 선택과 같은가 */
  passedSame: boolean;
  /** G3 통과 요청(본문은 부모가 만든다). 진행 중이면 true */
  pending: boolean;
  error: Error | null;
  onPass: (checklist: G3ChecklistState, sameProductConfirmed: boolean) => void;
}

/**
 * '선택 전 확인'(SCR-05, Thumbnail.dc.html, F-TH-14·15·16, P3-02 규칙 9·10·12).
 * - 머리 캡션 '후보 4 기준 · 7개 모두 확인', 체크 7개(보드 문구 그대로 — '색상이 {선택 색상}과 같음'. 첫 항목만 D-22로 보드와
 *   다르다: '신발 길이가 화면 폭의 70% 이상' — `g3ChecklistItems`). 대표를 바꾸면 모두 풀린다(체크는 그 후보 기준이다).
 *   미리 켜 두지 않는다
 * - '같은 상품·색상' 확인: `sameProductColorRequired`일 때만 체크 상자, 아니면 보드의 설명 문장
 * - '썸네일 선택(G3)' 버튼: 7개 모두 체크(+ 필요하면 같은 상품·색상) 전에는 꺼짐 + 꺼진 이유 글. ⑤ 완료 뒤 다시 고르면
 *   ⑤의 새 버전이 생긴다는 캡션
 * - 통과 뒤(G3 유효 + 지금 선택과 같음): GateBadge 'G3 썸네일 선택 · 통과' · 시각 · '레퍼런스·선택본·앵커 키가 바뀌면 다시 골라야
 *   합니다.' · '다음: ⑥ 상세 콘텐츠'(보드 주 버튼)
 */
export function G3Checklist({
  candidateId,
  output,
  selectedColor,
  pick,
  representativeSlotNo,
  running,
  passedSame,
  pending,
  error,
  onPass,
}: G3ChecklistProps) {
  const reasonId = useId();
  const [checks, setChecks] = useState<{ rep: number | null; state: G3ChecklistState }>({
    rep: pick.representative,
    state: emptyChecklist(),
  });
  const [sameProduct, setSameProduct] = useState(false);
  // 대표를 바꾸면 체크를 모두 푼다(체크는 그 후보 기준)
  const state = checks.rep === pick.representative ? checks.state : emptyChecklist();
  const toggle = (key: G3ChecklistKey, value: boolean) =>
    setChecks({ rep: pick.representative, state: { ...state, [key]: value } });

  const required = output?.sameProductColorRequired === true;
  const g3 = output?.g3;
  const passed = g3?.valid === true && passedSame;
  const reason = g3DisabledReason({
    stepRunStatus: output?.stepRunStatus ?? null,
    running,
    pick,
    checklist: state,
    sameProductColorRequired: required,
    sameProductConfirmed: sameProduct,
    passedSame: passed,
  });
  const badge = passed ? 'passed' : pick.representative !== null ? 'pending' : 'locked';
  const repick = output?.stepRunStatus === 'COMPLETED' && !passed;
  const errorText = error
    ? isApiRequestError(error)
      ? error.message
      : '요청을 처리하지 못했습니다.'
    : null;

  return (
    <Panel
      title={G3_CHECKLIST_TITLE}
      caption={
        representativeSlotNo !== null
          ? `후보 ${representativeSlotNo} 기준 · 7개 모두 확인`
          : '대표 후보를 고르면 확인합니다'
      }
      className={styles.checklistPanel}
    >
      <div className={styles.checklistGrid}>
        {g3ChecklistItems(selectedColor).map((item) => (
          <Checkbox
            key={item.key}
            label={item.label}
            checked={state[item.key]}
            disabled={passed || pick.representative === null}
            onChange={(e) => toggle(item.key, e.target.checked)}
          />
        ))}
      </div>
      {required ? (
        <Checkbox
          label={SAME_PRODUCT_LABEL}
          description={SAME_PRODUCT_DESCRIPTION}
          checked={sameProduct}
          disabled={passed || pick.representative === null}
          onChange={(e) => setSameProduct(e.target.checked)}
        />
      ) : output ? (
        <p className={styles.note}>{SAME_PRODUCT_NOTE}</p>
      ) : null}
      <div className={styles.checklistFoot}>
        <div className={styles.gateLine}>
          <span className={styles.gateRow}>
            <GateBadge gate="G3" state={badge} />
            {passed && g3?.passedAt ? (
              <span className={styles.mono}>{formatKstTime(g3.passedAt)}</span>
            ) : null}
          </span>
          {passed ? (
            <p className={styles.caption}>{G3_REPICK_NOTE}</p>
          ) : g3?.gatePassId && !g3.valid ? (
            <p className={styles.caption}>{G3_INVALID_TEXT}</p>
          ) : repick ? (
            <p className={styles.caption}>{G3_REPICK_CAPTION}</p>
          ) : null}
        </div>
        {passed ? (
          <ButtonLink variant="primary" to={stepPath(candidateId, 'COPY')}>
            {NEXT_CONTENT_LABEL}
          </ButtonLink>
        ) : (
          <span className={styles.passAction}>
            <Button
              variant={output && output.generationRuns.length > 0 ? 'primary' : 'secondary'}
              disabled={reason !== null || pending || !checklistComplete(state) || !output}
              aria-describedby={reason ? reasonId : undefined}
              onClick={() => onPass(state, required && sameProduct)}
            >
              {G3_PASS_LABEL}
            </Button>
            {reason ? <DisabledReason id={reasonId}>{reason}</DisabledReason> : null}
          </span>
        )}
      </div>
      {errorText ? (
        <p role="alert" className={styles.error}>
          {errorText}
        </p>
      ) : null}
    </Panel>
  );
}

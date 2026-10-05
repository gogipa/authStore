import { useId, useState, type ReactNode } from 'react';
import { isApiRequestError } from '@/shared/api/errors';
import { Banner, Button, Checkbox, Chip, DisabledReason, Radio } from '@/shared/ui';
import { useSelectCategoryLeafMutation } from '../../api/categoryDecision';
import {
  blockReasonText,
  CATEGORY_BLOCK_ERROR_CODES,
  categoryChecks,
  formatCategoryPath,
  GENDER_PATH_ALL_CAPTION,
  GENDER_SHOE_LABEL,
  KC_FILLED_TEXT,
  KC_NOT_NEEDED_TEXT,
  KC_WILL_FILL_TEXT,
  selectDisabledReason,
  type CategoryDecisionDetail,
  type CategoryOption,
} from '../../model/category';
import styles from './CategoryPanel.module.css';

export interface CategoryPanelProps {
  candidateId: number;
  decision: CategoryDecisionDetail;
  /** 가운데 칸 위(성별 재확인 — `GenderRecheck`) */
  genderSlot?: ReactNode;
  /** 오른쪽 칸 아래(완료 뒤 '다음: ⑤ 썸네일' 링크) */
  nextSlot?: ReactNode;
  /** 고르기를 막는 밖의 이유(잠긴·제외 여정). 있으면 고르기 단추를 끈다 */
  blockedReason?: string | null;
}

/** 확인 줄 칩(보드: 완료 = done + 체크) */
function CheckChip({
  ok,
  okText,
  badText,
  pendingText,
}: {
  ok: boolean | null;
  okText: string;
  badText: string;
  pendingText: string;
}) {
  if (ok === null) return <Chip tone="idle">{pendingText}</Chip>;
  return ok ? (
    <Chip tone="done" icon="check">
      {okText}
    </Chip>
  ) : (
    <Chip tone="failed" icon="alert">
      {badText}
    </Chip>
  );
}

/**
 * ④ '리프 카테고리' 패널(SCR-04 `#category`, Judgement.dc.html, F-CA-03·04·06·07·08, P2-06).
 * - 왼쪽: '리프 카테고리' 라디오 목록(경로는 ` > `로). 막힌 후보(아동·제외 품목·성별 불일치·사라짐)는 꺼 두고 옆에 이유 글
 *   (DisabledReason). KC 인증 예외 후보는 'KC 확인 필요' 칩. 매핑표로 뽑지 못한 후보(`GENDER_PATH_ALL`)면 '남성신발 전체
 *   목록에서 고르기 · 장르 없는 URL 여정용' 단추로 결정 응답의 목록 전체(스크롤)를 연다 — 목록 밖 검색·직접 선택은 M2(F-CA-11)
 * - 가운데: 성별 재확인 자리(`genderSlot`) + '성별·카테고리 일치'
 * - 오른쪽: 'KC 면제 성인용 확인'(KC 후보는 체크해야 고르기 단추가 켜진다 — 웹 화면 전용) + '아동 카테고리 아님' + 고르기 단추
 *   ('이 카테고리로 확정', 입력 대기일 때만, 보드에 없음 — Proposed) + `nextSlot`
 * 고르기 오류(409·422)는 05-3 문구를 막힘 띠(Banner blocked)로 보인다.
 */
export function CategoryPanel({
  candidateId,
  decision,
  genderSlot,
  nextSlot,
  blockedReason = null,
}: CategoryPanelProps) {
  const leafLabelId = useId();
  const reasonId = useId();
  const listId = useId();
  const waiting = decision.stepStatus === 'WAITING_INPUT';
  const select = useSelectCategoryLeafMutation();
  const [selectedId, setSelectedId] = useState<string | null>(decision.leafCategoryId ?? null);
  const [kcConfirmed, setKcConfirmed] = useState(decision.exceptionDecision === 'KC_EXEMPT');
  const [expanded, setExpanded] = useState(false);

  const options = decision.categoryOptions;
  const selected: CategoryOption | null =
    options.find((o) => o.leafCategoryId === selectedId) ?? null;
  const checks = categoryChecks(decision.gender, selected);
  const pathAll = decision.candidateSource === 'GENDER_PATH_ALL';
  // 성별 경로 전체 목록은 열었을 때만 보인다(닫혀 있으면 고른 리프 한 줄)
  const visible = !pathAll || expanded ? options : selected ? [selected] : [];
  const disabledReason = selectDisabledReason({
    waiting,
    option: selected,
    kcConfirmed,
    blockedReason,
  });
  const error = select.error && isApiRequestError(select.error) ? select.error : null;

  const kcCaption = !selected
    ? null
    : decision.exceptionDecision === 'KC_EXEMPT' &&
        selected.leafCategoryId === decision.leafCategoryId
      ? KC_FILLED_TEXT
      : checks.kcRequired
        ? KC_WILL_FILL_TEXT
        : KC_NOT_NEEDED_TEXT;

  const submit = () => {
    if (!selected || disabledReason) return;
    select.mutate({
      candidateId,
      categoryDecisionId: decision.id,
      body: {
        leafCategoryId: selected.leafCategoryId,
        // 웹 화면에서 체크한 것만 true(KC가 아닌 리프는 늘 false)
        kcExemptAdultConfirmed: selected.kcExemptionRequired && kcConfirmed,
      },
    });
  };

  return (
    <div className={styles.wrap}>
      {error ? (
        <Banner
          tone={CATEGORY_BLOCK_ERROR_CODES.includes(error.code) ? 'blocked' : 'warning'}
          role="alert"
        >
          {error.message}
        </Banner>
      ) : null}
      <div className={styles.panel}>
        <div role="radiogroup" aria-labelledby={leafLabelId} className={styles.leafColumn}>
          <span id={leafLabelId} className={styles.label}>
            리프 카테고리
          </span>
          {visible.length > 0 ? (
            <div id={listId} className={pathAll && expanded ? styles.scrollList : styles.list}>
              {visible.map((option) => {
                const checked = option.leafCategoryId === selectedId;
                return (
                  <div
                    key={option.leafCategoryId}
                    className={checked ? styles.rowSelected : styles.row}
                  >
                    <Radio
                      name={`leaf-${decision.id}`}
                      value={option.leafCategoryId}
                      label={formatCategoryPath(option.wholeCategoryName)}
                      checked={checked}
                      disabled={!waiting || option.blocked}
                      onChange={() => {
                        setSelectedId(option.leafCategoryId);
                        select.reset();
                      }}
                      description={
                        option.blocked && option.blockReason ? (
                          <DisabledReason tone="muted">
                            {blockReasonText(option.blockReason)}
                          </DisabledReason>
                        ) : undefined
                      }
                    />
                    {option.kcExemptionRequired && !option.blocked ? (
                      <Chip tone="waiting">KC 확인 필요</Chip>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {pathAll ? (
            <div className={styles.allRow}>
              <Button
                size="sm"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setExpanded((v) => !v)}
              >
                {GENDER_SHOE_LABEL[decision.gender]} 전체 목록에서 고르기
              </Button>
              <span className={styles.caption}>{GENDER_PATH_ALL_CAPTION}</span>
            </div>
          ) : null}
        </div>

        <div className={styles.middleColumn}>
          {genderSlot}
          <div className={styles.bottom}>
            <CheckChip
              ok={checks.genderMatch}
              okText="성별·카테고리 일치"
              badText="성별·카테고리 불일치"
              pendingText="성별·카테고리 확인 전"
            />
          </div>
        </div>

        <div className={styles.rightColumn}>
          <Checkbox
            label="KC 면제 성인용 확인"
            checked={kcConfirmed && checks.kcRequired}
            disabled={!waiting || !checks.kcRequired}
            onChange={(e) => {
              setKcConfirmed(e.target.checked);
              select.reset();
            }}
          />
          {kcCaption ? <span className={styles.caption}>{kcCaption}</span> : null}
          <div className={styles.chipRow}>
            <CheckChip
              ok={checks.notChild}
              okText="아동 카테고리 아님"
              badText="아동 카테고리"
              pendingText="아동 카테고리 확인 전"
            />
          </div>
          {waiting ? (
            <div className={styles.actions}>
              <Button
                disabled={select.isPending || disabledReason !== null}
                aria-describedby={disabledReason ? reasonId : undefined}
                onClick={submit}
              >
                이 카테고리로 확정
              </Button>
              {disabledReason ? (
                <DisabledReason id={reasonId} className={styles.reason}>
                  {disabledReason}
                </DisabledReason>
              ) : null}
            </div>
          ) : null}
          {nextSlot ? <div className={styles.next}>{nextSlot}</div> : null}
        </div>
      </div>
    </div>
  );
}

import { useId, useState } from 'react';
import {
  ADDITIONAL_LABEL,
  CANDIDATE_GRID_TITLE,
  candidateSummaryText,
  GRID_EMPTY_TEXT,
  REGENERATE_LABEL,
  REPRESENTATIVE_LABEL,
  SLOT_EMPTY_TEXT,
  SLOT_FAILED_TITLE,
  SLOT_REFUSED_TITLE,
  SLOT_RUNNING_TEXT,
  slotCells,
  useGenerationRunQuery,
  type SlotCell,
  type ThumbnailFaceOption,
  type ThumbnailGenerationSummary,
  type ThumbnailPick,
} from '@/features/thumbnails';
import { cx } from '@/shared/lib/cx';
import { Button, Checkbox, Chip, DisabledReason, Disclosure, Panel, Radio } from '@/shared/ui';
import { RefusalNotice } from './RefusalNotice';
import styles from './ThumbnailPage.module.css';

export interface CandidateGridProps {
  /** ⑤ 버전의 생성 시도(번호·회차 순) */
  runs: readonly ThumbnailGenerationSummary[];
  /** 후보 칸 수 N(설정) */
  candidateCount: number;
  /** 대표·추가로 고를 수 있는가(⑤ 현재 버전이 입력 대기·완료) */
  selectable: boolean;
  pick: ThumbnailPick;
  onChooseRepresentative: (imageAssetId: number) => void;
  onToggleAdditional: (imageAssetId: number) => void;
  /** 번호별 '다시 만들기'를 보이는가(⑤ 현재 버전이 입력 대기일 때만 — 닫힌 ⑤에는 새 시도를 더할 수 없다) */
  canRegenerate: boolean;
  /** 다시 만들 수 없는 이유(생성 옵션 패널과 같은 조건 — 레퍼런스 확인·차단어·생성 중). 없으면 null */
  regenerateDisabledReason: string | null;
  /** 번호 하나 다시 만들기(얼굴 노출을 주면 그 수준으로 — 거부 뒤 낮춘 재시도) */
  onRegenerate: (slotNo: number, faceOption?: ThumbnailFaceOption) => void;
}

/** 결과 이미지 파일 경로(05-2 getImageAssetFile) */
function imageUrl(imageAssetId: number): string {
  return `/api/v1/image-assets/${imageAssetId}/file`;
}

/** 칸의 '프롬프트' 펼치기 — 열 때만 시도 한 건(프롬프트 전문)을 읽는다 */
function PromptDisclosure({ run }: { run: ThumbnailGenerationSummary }) {
  const [open, setOpen] = useState(false);
  const detail = useGenerationRunQuery(open ? run.generationRunId : null);
  return (
    <Disclosure
      title="프롬프트"
      meta={run.promptAdjusted ? '조정 문구 사용' : '기본 골격 사용'}
      look="link"
      open={open}
      onOpenChange={setOpen}
    >
      {detail.data ? (
        <pre className={styles.promptPreview} aria-label={`후보 ${run.slotNo} 프롬프트`}>
          {detail.data.prompt}
        </pre>
      ) : detail.error ? (
        <p className={styles.placeholder}>{detail.error.message}</p>
      ) : (
        <p className={styles.placeholder}>불러오는 중입니다.</p>
      )}
    </Disclosure>
  );
}

interface CellProps extends Omit<CandidateGridProps, 'runs' | 'candidateCount'> {
  cell: SlotCell;
  radioName: string;
}

function CandidateCell({
  cell,
  radioName,
  selectable,
  pick,
  onChooseRepresentative,
  onToggleAdditional,
  canRegenerate,
  regenerateDisabledReason,
  onRegenerate,
}: CellProps) {
  const reasonId = useId();
  const run = cell.latest;
  const imageId = run?.status === 'SUCCEEDED' ? (run.resultImageAssetId ?? null) : null;
  const choosable = selectable && imageId !== null;
  const isRep = imageId !== null && pick.representative === imageId;
  const isExtra = imageId !== null && pick.additional.includes(imageId);
  const label = `후보 ${cell.slotNo}`;
  return (
    <li className={cx(styles.candidateCard, isRep && styles.candidateCardSelected)}>
      <div className={styles.candidateFrame}>
        {imageId !== null ? (
          <img className={styles.image} src={imageUrl(imageId)} alt={`${label} 생성 이미지`} />
        ) : run?.status === 'RUNNING' ? (
          <Chip tone="running">{SLOT_RUNNING_TEXT}</Chip>
        ) : run ? null : (
          <span className={styles.placeholder}>{SLOT_EMPTY_TEXT}</span>
        )}
      </div>
      <div className={styles.candidateHead}>
        <span className={styles.candidateName}>{label}</span>
        {run && run.attemptNo > 1 ? (
          <span className={styles.caption}>{run.attemptNo}회차</span>
        ) : null}
      </div>
      {run?.status === 'REFUSED' && canRegenerate ? (
        <RefusalNotice
          reason={run.refusalReason ?? ''}
          faceOption={run.faceOption}
          disabledReason={regenerateDisabledReason}
          onRetry={(next) => onRegenerate(cell.slotNo, next)}
        />
      ) : null}
      {run?.status === 'FAILED' ? (
        <p className={styles.failedText} role="status">
          <strong>{SLOT_FAILED_TITLE}</strong> {run.errorMessage ?? ''}
        </p>
      ) : null}
      <div className={styles.pickRow}>
        <Radio
          name={radioName}
          label={REPRESENTATIVE_LABEL}
          aria-label={`${label} ${REPRESENTATIVE_LABEL}`}
          checked={isRep}
          disabled={!choosable}
          onChange={() => imageId !== null && onChooseRepresentative(imageId)}
        />
        <Checkbox
          label={ADDITIONAL_LABEL}
          aria-label={`${label} ${ADDITIONAL_LABEL}`}
          checked={isExtra}
          disabled={!choosable || isRep}
          onChange={() => imageId !== null && onToggleAdditional(imageId)}
        />
      </div>
      {run?.status === 'REFUSED' && !canRegenerate ? (
        <p className={styles.failedText}>
          <strong>{SLOT_REFUSED_TITLE}</strong> {run.refusalReason ?? ''}
        </p>
      ) : null}
      {canRegenerate && run && run.status !== 'RUNNING' ? (
        <div className={styles.regenerateRow}>
          <Button
            size="sm"
            disabled={regenerateDisabledReason !== null}
            aria-describedby={regenerateDisabledReason ? reasonId : undefined}
            aria-label={`${label} ${REGENERATE_LABEL}`}
            onClick={() => onRegenerate(cell.slotNo)}
          >
            {REGENERATE_LABEL}
          </Button>
          {regenerateDisabledReason ? (
            <DisabledReason id={reasonId} tone="muted">
              {regenerateDisabledReason}
            </DisabledReason>
          ) : null}
        </div>
      ) : null}
      {run ? <PromptDisclosure run={run} /> : null}
    </li>
  );
}

/**
 * '썸네일 후보' 패널(SCR-05, Thumbnail.dc.html, F-TH-07·09·12·13·16·17, P3-02).
 * - 머리 캡션: '14:20 생성 · 1:1 · 1K · 생성 거부 없음'(보드 '2K'는 D-21로 기본 1K. M2 '비중·디테일 자동 검사'는 뺀다)
 * - 후보 N칸(N = 설정 후보 수, 번호마다 최신 회차): 생성 중(칩) · 거부(사유 + '얼굴 노출을 낮춰 다시 만들기') · 실패(사유) ·
 *   완료(이미지). 칸마다 '대표' 라디오·'추가' 체크(완료 칸만 — 원본은 여기 없다), '다시 만들기', '프롬프트' 펼치기(시도 한 건 조회)
 * - 신발 비중 %·디테일 결과·'AI 생성' 칩은 M2라 그리지 않는다
 */
export function CandidateGrid({ runs, candidateCount, ...rest }: CandidateGridProps) {
  const radioName = useId();
  const cells = slotCells(runs, candidateCount);
  return (
    <Panel
      title={CANDIDATE_GRID_TITLE}
      caption={candidateSummaryText(runs) || undefined}
      className={styles.candidatesPanel}
    >
      {runs.length === 0 ? <p className={styles.placeholder}>{GRID_EMPTY_TEXT}</p> : null}
      <ul className={styles.candidateGrid} aria-label="썸네일 후보">
        {cells.map((cell) => (
          <CandidateCell key={cell.slotNo} cell={cell} radioName={radioName} {...rest} />
        ))}
      </ul>
    </Panel>
  );
}

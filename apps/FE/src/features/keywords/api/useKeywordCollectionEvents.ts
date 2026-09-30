import { useCallback, useEffect, useState } from 'react';
import { onProgressEvent } from '@/shared/api/events';
import {
  type KeywordCollectionAbortedEvent,
  type KeywordCollectionAccepted,
  type KeywordCollectionCompletedEvent,
  pagesPerCidFor,
  type RankLimit,
} from '../model/keywords';

/** 버튼 수집 진행(화면 상태 — 서버에 조회 API가 없는 값이라 SSE로만 받는다) */
export interface KeywordCollectionProgress {
  keywordSnapshotId: number;
  phase: 'running' | 'completed' | 'aborted';
  /** 요청한 cid 순서(여성신발 → 남성신발) */
  cids: string[];
  pagesPerCid: number;
  /** cid별 끝낸 페이지 수 */
  pagesByCid: Record<string, number>;
  requestsDone: number;
  requestsTotal: number;
  completed: KeywordCollectionCompletedEvent | null;
  aborted: KeywordCollectionAbortedEvent | null;
}

function initial(
  keywordSnapshotId: number,
  cids: readonly string[],
  pagesPerCid: number,
): KeywordCollectionProgress {
  return {
    keywordSnapshotId,
    phase: 'running',
    cids: [...cids],
    pagesPerCid,
    pagesByCid: Object.fromEntries(cids.map((cid) => [cid, 0])),
    requestsDone: 0,
    requestsTotal: cids.length * pagesPerCid,
    completed: null,
    aborted: null,
  };
}

/**
 * SSE `keyword-collection.progress`·`.completed`·`.aborted`(P1-02 shared/api/events.ts 연결 하나를 같이 쓴다) → 진행률 상태.
 * 묶음·상태 쿼리 무효화는 events.ts 무효화 표가 한다(P2-01). `start(accepted)`는 202 응답으로 0/N 진행을 연다.
 * 다른 묶음의 알림이 오면(다른 창에서 시작) 그 묶음으로 바꾼다.
 */
export function useKeywordCollectionEvents() {
  const [progress, setProgress] = useState<KeywordCollectionProgress | null>(null);

  useEffect(() => {
    const offs = [
      onProgressEvent('keyword-collection.progress', (data) =>
        setProgress((prev) => {
          const base =
            prev && prev.keywordSnapshotId === data.keywordSnapshotId
              ? prev
              : initial(data.keywordSnapshotId, [data.cid], data.pagesPerCid);
          const cids = base.cids.includes(data.cid) ? base.cids : [...base.cids, data.cid];
          return {
            ...base,
            phase: 'running',
            cids,
            pagesPerCid: data.pagesPerCid,
            pagesByCid: { ...base.pagesByCid, [data.cid]: data.page },
            requestsDone: data.requestsDone,
            requestsTotal: data.requestsTotal,
          };
        }),
      ),
      onProgressEvent('keyword-collection.completed', (data) =>
        setProgress((prev) => {
          const base =
            prev && prev.keywordSnapshotId === data.keywordSnapshotId
              ? prev
              : initial(data.keywordSnapshotId, [], 0);
          return { ...base, phase: 'completed', completed: data };
        }),
      ),
      onProgressEvent('keyword-collection.aborted', (data) =>
        setProgress((prev) => {
          const base =
            prev && prev.keywordSnapshotId === data.keywordSnapshotId
              ? prev
              : initial(data.keywordSnapshotId, [], 0);
          return { ...base, phase: 'aborted', aborted: data };
        }),
      ),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);

  /** 202를 받으면 0/N으로 연다(한 페이지 20개 가정 — 첫 진행 알림이 서버 값으로 맞춘다) */
  const start = useCallback((accepted: KeywordCollectionAccepted) => {
    setProgress((prev) =>
      prev && prev.keywordSnapshotId === accepted.keywordSnapshotId
        ? prev
        : initial(
            accepted.keywordSnapshotId,
            accepted.requestedCids,
            pagesPerCidFor(accepted.rankLimit as RankLimit),
          ),
    );
  }, []);

  return { progress, start };
}

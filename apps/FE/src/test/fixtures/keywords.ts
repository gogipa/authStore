import type {
  ChildKeywordTermList,
  KeywordCollectionStatus,
  KeywordSnapshotDetail,
  KeywordSnapshotPage,
  RankedKeyword,
  RankedKeywordPage,
} from '@/features/keywords';

/** 키워드 화면 fixture(P2-01). 예시 키워드는 화면시안_명세 §4(남성신발 순위) */
export const SNAPSHOT_ID = 7;

const MEN_KEYWORDS = [
  '뉴발란스 530',
  '아식스 젤카야노14',
  '아디다스 삼바',
  '오니츠카타이거 멕시코66',
  '나이키 코르테즈',
  '살로몬 XT-6',
  '반스 올드스쿨',
  '뉴발란스 2002R',
  '호카 클리프톤',
  '컨버스 척70',
];

export function keywordSnapshotDetail(
  overrides: Partial<KeywordSnapshotDetail> = {},
): KeywordSnapshotDetail {
  return {
    id: SNAPSHOT_ID,
    method: 'BUTTON',
    collectedAt: '2026-09-24T04:30:00.000Z',
    requestedCids: ['50000173', '50000174'],
    periodStart: '2026-08-23',
    periodEnd: '2026-09-23',
    rankLimit: 100,
    responseRange: '2026.08.23. ~ 2026.09.23.',
    rangeMatched: true,
    status: 'COMPLETED',
    abortReason: null,
    httpStatus: null,
    filters: null,
    keywordCount: 200,
    excludedCount: 3,
    structureChangeSuspected: false,
    blockedUntil: null,
    ...overrides,
  };
}

export function keywordSnapshotPage(content = [keywordSnapshotDetail()]): KeywordSnapshotPage {
  return {
    content,
    page: { number: 0, size: 1, totalElements: content.length, totalPages: content.length },
  };
}

export function rankedKeyword(overrides: Partial<RankedKeyword> = {}): RankedKeyword {
  return {
    id: 100,
    keywordSnapshotId: SNAPSHOT_ID,
    cid: '50000173',
    rank: 1,
    keyword: '뉴발란스 530',
    excludedReason: null,
    selectedAt: null,
    candidateIds: [],
    ...overrides,
  };
}

/** 한 분야 10줄(id 100~109) */
export function keywordRows(cid = '50000173'): RankedKeyword[] {
  return MEN_KEYWORDS.map((keyword, i) =>
    rankedKeyword({ id: 100 + i, rank: i + 1, keyword, cid }),
  );
}

export function childRows(cid = '50000173'): RankedKeyword[] {
  return [
    rankedKeyword({ id: 200, rank: 16, keyword: '키즈 운동화', cid, excludedReason: 'CHILD' }),
  ];
}

export function rankedKeywordPage(
  content: RankedKeyword[],
  totalElements = content.length,
  size = 10,
  number = 0,
): RankedKeywordPage {
  return {
    content,
    page: { number, size, totalElements, totalPages: Math.ceil(totalElements / size) },
  };
}

export function collectionStatus(
  overrides: Partial<KeywordCollectionStatus> = {},
): KeywordCollectionStatus {
  return {
    collecting: false,
    runningKeywordSnapshotId: null,
    lastKeywordSnapshotId: SNAPSHOT_ID,
    lastCollectedAt: '2026-09-24T04:30:00.000Z',
    lastStatus: 'COMPLETED',
    lastAbortReason: null,
    blockedUntil: null,
    requestIntervalSeconds: 2,
    disabledReasonCode: null,
    ...overrides,
  };
}

export function childTermList(extra: string[] = []): ChildKeywordTermList {
  return {
    items: [
      ...['키즈', '주니어', '아동', 'キッズ', 'ジュニア', 'ベビー'].map((term) => ({
        term,
        builtIn: true,
      })),
      ...extra.map((term) => ({ term, builtIn: false })),
    ],
  };
}

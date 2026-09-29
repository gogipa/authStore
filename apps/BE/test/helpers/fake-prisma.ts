/**
 * 단위 테스트용 메모리 Prisma(표 몇 개만). Jest ESM이라 jest.mock 없이 손으로 만든 가짜를 Nest DI로 끼운다
 * (`{ provide: PrismaService, useValue: fake }`). 쓰는 조건만 흉내 낸다: 같음·in·notIn·not·OR, 평면 orderBy, select(평면).
 * CHECK는 update 순서가 중요한 ck_candidate_ready 하나만 흉내 낸다. 나머지 실제 쿼리·CHECK·트리거는 e2e(autostore_test)가 확인한다.
 */

export type FakeRow = Record<string, unknown> & { id: number };

type Where = Record<string, unknown>;

function matchesValue(actual: unknown, cond: unknown): boolean {
  if (
    cond !== null &&
    typeof cond === 'object' &&
    !(cond instanceof Date) &&
    !Array.isArray(cond)
  ) {
    const c = cond as Record<string, unknown>;
    if ('in' in c && !(c.in as unknown[]).includes(actual)) return false;
    if ('notIn' in c && (c.notIn as unknown[]).includes(actual)) return false;
    if ('not' in c && actual === c.not) return false;
    if ('equals' in c && actual !== c.equals) return false;
    return true;
  }
  if (actual instanceof Date && cond instanceof Date) return actual.getTime() === cond.getTime();
  return actual === cond;
}

export function matchesWhere(row: FakeRow, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Where[]).some((w) => matchesWhere(row, w))) return false;
      continue;
    }
    if (key === 'AND') {
      if (!(cond as Where[]).every((w) => matchesWhere(row, w))) return false;
      continue;
    }
    if (!matchesValue(row[key], cond)) return false;
  }
  return true;
}

function sortRows(rows: FakeRow[], orderBy: unknown): FakeRow[] {
  const orders = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<
    string,
    'asc' | 'desc'
  >[];
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      const [field, dir] = Object.entries(order)[0] ?? [];
      if (!field) continue;
      const av = a[field] instanceof Date ? a[field].getTime() : (a[field] as number);
      const bv = b[field] instanceof Date ? b[field].getTime() : (b[field] as number);
      if (av === bv) continue;
      const cmp = av < bv ? -1 : 1;
      return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function pick(row: FakeRow, select: unknown): Record<string, unknown> {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const [key, on] of Object.entries(select as Record<string, unknown>))
    if (on) out[key] = row[key];
  return out;
}

/** 행 CHECK 흉내: 어긋나면 제약 이름을, 맞으면 null을 돌려준다 */
export type FakeRowCheck = (row: FakeRow) => string | null;

export class FakeTable {
  rows: FakeRow[] = [];
  private seq = 0;

  constructor(
    private readonly defaults: Record<string, unknown> = {},
    private readonly check?: FakeRowCheck,
  ) {}

  seed(row: Omit<FakeRow, 'id'> & { id?: number }): FakeRow {
    const id = row.id ?? ++this.seq;
    this.seq = Math.max(this.seq, id);
    const full = { ...this.defaults, ...row, id } as FakeRow;
    this.rows.push(full);
    return full;
  }

  findFirst = (args: { where?: Where; orderBy?: unknown; select?: unknown } = {}) => {
    const row = sortRows(
      this.rows.filter((r) => matchesWhere(r, args.where)),
      args.orderBy,
    )[0];
    return Promise.resolve(row ? pick(row, args.select) : null);
  };

  findFirstOrThrow = async (args: { where?: Where; orderBy?: unknown; select?: unknown } = {}) => {
    const row = await this.findFirst(args);
    if (!row) throw new Error('not found');
    return row;
  };

  findMany = (args: { where?: Where; orderBy?: unknown; select?: unknown } = {}) =>
    Promise.resolve(
      sortRows(
        this.rows.filter((r) => matchesWhere(r, args.where)),
        args.orderBy,
      ).map((r) => pick(r, args.select)),
    );

  findUnique = (args: { where: Where; select?: unknown }) => this.findFirst(args);

  findUniqueOrThrow = (args: { where: Where; select?: unknown }) => this.findFirstOrThrow(args);

  count = (args: { where?: Where } = {}) =>
    Promise.resolve(this.rows.filter((r) => matchesWhere(r, args.where)).length);

  create = (args: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...this.seed(args.data) });

  update = (args: { where: Where; data: Record<string, unknown> }) => {
    const row = this.rows.find((r) => matchesWhere(r, args.where));
    if (!row) return Promise.reject(new Error('update: not found'));
    const violated = this.check?.({ ...row, ...args.data });
    if (violated) {
      return Promise.reject(new Error(`update: CHECK 제약 ${violated} 위반`));
    }
    Object.assign(row, args.data);
    return Promise.resolve({ ...row });
  };
}

/** ck_candidate_ready: 승인대기 이상은 item_code·anchor_color_code·gender·leaf_category_id가 있어야 한다 */
const CANDIDATE_READY_FREE = ['TEMP', 'WORKING', 'EXCLUDED'];
const checkCandidateReady: FakeRowCheck = (row) =>
  CANDIDATE_READY_FREE.includes(row.status as string) ||
  (row.itemCode != null &&
    row.anchorColorCode != null &&
    row.gender != null &&
    row.leafCategoryId != null)
    ? null
    : 'ck_candidate_ready';

/** step-engine 후보 서비스가 쓰는 표만 둔 가짜(update는 ck_candidate_ready를 흉내 낸다) */
export class FakeStepEnginePrisma {
  candidate = new FakeTable(
    {
      status: 'WORKING',
      excludedReason: null,
      anchorModelCode: null,
      anchorItemCode: null,
      anchorColorCode: null,
      anchorFixedAt: null,
      itemCode: null,
      selectedColor: null,
      gender: null,
      genderSource: null,
      genderRecheckRequired: false,
      leafCategoryId: null,
      rakutenQuery: null,
    },
    checkCandidateReady,
  );
  candidateStep = new FakeTable({ staleInputs: [], staleSince: null, currentStepRunId: null });
  candidateStatusHistory = new FakeTable();
  gatePass = new FakeTable();

  /** SELECT id FROM candidate WHERE id = $1 FOR UPDATE */
  $queryRaw = (_strings: TemplateStringsArray, ...values: unknown[]) =>
    Promise.resolve(
      this.candidate.rows.filter((r) => r.id === values[0]).map((r) => ({ id: r.id })),
    );

  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn(this);
  }

  /** 후보 1행 + 단계 10행(주지 않은 단계는 NOT_RUN) */
  seedCandidate(
    candidate: Record<string, unknown>,
    steps: Record<string, string> = {},
    codes: readonly string[] = [],
  ): FakeRow {
    const row = this.candidate.seed(candidate);
    for (const stepCode of codes) {
      const status = steps[stepCode] ?? 'NOT_RUN';
      this.candidateStep.seed({
        candidateId: row.id,
        stepCode,
        status,
        currentStepRunId: status === 'NOT_RUN' ? null : 1000 + this.candidateStep.rows.length,
      });
    }
    return row;
  }
}

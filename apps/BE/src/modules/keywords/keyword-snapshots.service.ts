import { Inject, Injectable } from '@nestjs/common';
import { BUILTIN_CHILD_TERMS, findChildTerm } from '../../common/child-shoe/child-shoe.rules.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { parsePageRequest, toPage } from '../../common/paging/page-request.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CallUsageService } from '../integrations/call-usage/call-usage.service.js';
import { CLOCK, type Clock } from '../integrations/http/clock.token.js';
import { SettingsService } from '../settings/settings.service.js';
import type {
  KeywordCollectionStatusDto,
  KeywordSnapshotDetailDto,
  KeywordSnapshotDto,
  KeywordSnapshotPageDto,
  ListKeywordSnapshotsQueryDto,
  ListSnapshotKeywordsQueryDto,
  RankedKeywordPageDto,
} from './dto/keyword-snapshot.dto.js';
import {
  KEYWORD_WITH_CANDIDATES,
  KeywordRepository,
  toRankedKeywordDto,
  toSnapshotDto,
} from './keyword.repository.js';
import {
  isStructureChangeReason,
  KEYWORD_EXCLUDED_REASON_CHILD,
  type KeywordSnapshotStatus,
  PASTE_TEXT_MAX_LENGTH,
} from './keywords.constants.js';
import { parsePastedRanks } from './paste-parser.js';

/** 요청 간격 기본(설정이 없을 때 — 설정 기본 템플릿과 같은 값) */
const DEFAULT_REQUEST_INTERVAL_SECONDS = 2;

/**
 * 키워드 묶음 조회·붙여넣기·수집 상태(F-KW-01·03~07, P2-01 규칙 9·10·14).
 * 버튼 수집 실행은 `KeywordCollectionService`가 맡는다.
 */
@Injectable()
export class KeywordSnapshotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: KeywordRepository,
    private readonly settings: SettingsService,
    private readonly usage: CallUsageService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 붙여넣기(F-KW-05, 규칙 9): 100,000자 초과 413 → 줄 파싱(형식·순위 중복 422 IMPORT_PARSE_FAILED, 0줄 422 IMPORT_EMPTY)
   * → 묶음(PASTE·COMPLETED, 기간·범위 null) + 키워드 줄을 한 트랜잭션으로. 아동 단어가 든 줄은 excluded_reason CHILD.
   * 쉼·수집 중과 관계없이 늘 된다. 설정이 없으면(503 대신) 기본 아동 단어로 거른다(붙여넣기는 늘 써야 하는 경로).
   */
  async createPaste(text: string, cid: string | null): Promise<KeywordSnapshotDto> {
    const length = [...text].length;
    if (length > PASTE_TEXT_MAX_LENGTH) {
      throw new ApiException('PAYLOAD_TOO_LARGE', {
        details: { field: 'text', maxLength: PASTE_TEXT_MAX_LENGTH, length },
      });
    }
    const parsed = parsePastedRanks(text);
    if (!parsed.ok) throw new ApiException(parsed.code, { fieldErrors: parsed.fieldErrors });
    const childTerms = this.settings.currentOrNull()?.safety.childKeywords ?? BUILTIN_CHILD_TERMS;
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.keywordSnapshot.create({
        data: {
          method: 'PASTE',
          collectedAt: now,
          requestedCids: cid ? [cid] : [],
          status: 'COMPLETED',
        },
      });
      await this.repo.insertKeywords(
        row.id,
        parsed.rows.map((r) => ({
          cid,
          rank: r.rank,
          keyword: r.keyword,
          excluded: findChildTerm(r.keyword, childTerms) !== null,
        })),
        tx,
      );
      return this.repo.toDto(row, tx);
    });
  }

  /** 묶음 목록(규칙 10): sort=collectedAt만(기본 desc, 같으면 id 같은 방향), 필터 method·status */
  async list(query: ListKeywordSnapshotsQueryDto): Promise<KeywordSnapshotPageDto> {
    const req = parsePageRequest('/keyword-snapshots', query);
    const where: Prisma.KeywordSnapshotWhereInput = {
      ...(query.method ? { method: query.method } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const direction = req.sort[0]!.direction;
    const [rows, total] = await Promise.all([
      this.prisma.keywordSnapshot.findMany({
        where,
        orderBy: [{ collectedAt: direction }, { id: direction }],
        skip: req.skip,
        take: req.take,
      }),
      this.prisma.keywordSnapshot.count({ where }),
    ]);
    const counts = await this.repo.countsOf(rows.map((r) => r.id));
    return toPage(
      rows.map((r) => toSnapshotDto(r, counts.get(r.id)!)),
      req,
      total,
    );
  }

  /**
   * 묶음 한 건: 구조 변경 의심(ABORTED + 앞 5종)·24시간 쉼(call_log DATALAB, 지금 기준)·지금 고른 키워드(D-33 —
   * 묶음에서 selected_at이 가장 늦은 키워드, 없으면 null. 표가 쪽으로 나뉘어 줄만으로는 알 수 없어 함께 준다).
   */
  async get(id: number): Promise<KeywordSnapshotDetailDto> {
    const row = await this.repo.findSnapshot(id);
    if (!row) throw new ApiException('KEYWORD_SNAPSHOT_NOT_FOUND');
    const [dto, cooldown, selected] = await Promise.all([
      this.repo.toDto(row),
      this.usage.activeCooldown('DATALAB', this.clock.now()),
      this.repo.findCurrentSelected(id),
    ]);
    return {
      ...dto,
      structureChangeSuspected:
        row.status === 'ABORTED' && isStructureChangeReason(row.abortReason),
      blockedUntil: cooldown ? cooldown.blockedUntil.toISOString() : null,
      selectedKeyword: selected ? toRankedKeywordDto(selected) : null,
    };
  }

  /**
   * 묶음 안 키워드(규칙 10·11): 기본 excluded=false(아동화로 빠진 줄 제외), true면 빠진 줄만. sort=rank만(기본 asc,
   * 같은 순위는 cid·id 순). 필터 cid. candidateIds = candidate.source_keyword_id 역참조.
   */
  async listKeywords(
    snapshotId: number,
    query: ListSnapshotKeywordsQueryDto,
  ): Promise<RankedKeywordPageDto> {
    const req = parsePageRequest('/keyword-snapshots/{keywordSnapshotId}/keywords', query);
    const snapshot = await this.repo.findSnapshot(snapshotId);
    if (!snapshot) throw new ApiException('KEYWORD_SNAPSHOT_NOT_FOUND');
    const where: Prisma.KeywordWhereInput = {
      keywordSnapshotId: snapshotId,
      excludedReason: query.excluded === true ? KEYWORD_EXCLUDED_REASON_CHILD : null,
      ...(query.cid !== undefined ? { cid: query.cid } : {}),
    };
    const direction = req.sort[0]!.direction;
    const [rows, total] = await Promise.all([
      this.prisma.keyword.findMany({
        where,
        include: KEYWORD_WITH_CANDIDATES,
        orderBy: [{ rank: direction }, { cid: 'asc' }, { id: 'asc' }],
        skip: req.skip,
        take: req.take,
      }),
      this.prisma.keyword.count({ where }),
    ]);
    return toPage(rows.map(toRankedKeywordDto), req, total);
  }

  /**
   * 수집 상태(규칙 14): 수집 중(RUNNING 묶음), 마지막으로 끝난 버튼 수집, 24시간 쉼(call_log), 요청 간격(설정),
   * '수집' 버튼의 꺼진 이유(수집 중 → ALREADY_IN_PROGRESS, 쉼 → EXTERNAL_CALL_COOLDOWN).
   */
  async collectionStatus(): Promise<KeywordCollectionStatusDto> {
    const now = this.clock.now();
    const [running, last, cooldown] = await Promise.all([
      this.repo.findRunning(),
      this.repo.findLastFinishedButton(),
      this.usage.activeCooldown('DATALAB', now),
    ]);
    const interval =
      this.settings.currentOrNull()?.keywords.datalab.requestIntervalSeconds ??
      DEFAULT_REQUEST_INTERVAL_SECONDS;
    return {
      collecting: running !== null,
      runningKeywordSnapshotId: running?.id ?? null,
      lastKeywordSnapshotId: last?.id ?? null,
      lastCollectedAt: last ? last.collectedAt.toISOString() : null,
      lastStatus: (last?.status as KeywordSnapshotStatus | undefined) ?? null,
      lastAbortReason: last?.abortReason ?? null,
      blockedUntil: cooldown ? cooldown.blockedUntil.toISOString() : null,
      requestIntervalSeconds: interval,
      disabledReasonCode: running
        ? 'ALREADY_IN_PROGRESS'
        : cooldown
          ? 'EXTERNAL_CALL_COOLDOWN'
          : null,
    };
  }
}

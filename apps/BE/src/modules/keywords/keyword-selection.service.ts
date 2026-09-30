import { Inject, Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../common/audit/user-action-log.service.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../integrations/http/clock.token.js';
import type { RankedKeywordDto } from './dto/keyword-snapshot.dto.js';
import { KeywordRepository, toRankedKeywordDto } from './keyword.repository.js';

/**
 * G1 키워드 고르기(F-KW-08, US-02 AC2, P2-01 규칙 13). G1 기록 = `keyword.selected_at`(후보 단위 게이트가 아니라
 * gate_pass에 두지 않는다, ERD §3.2). 체크박스 토글을 멱등하게 하려고 하위 리소스 PUT·DELETE로 둔다.
 */
@Injectable()
export class KeywordSelectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: KeywordRepository,
    private readonly audit: UserActionLogService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 고르기(PUT): 없는 id 404 KEYWORD_NOT_FOUND, 아동화로 빠진 키워드 409 KEYWORD_EXCLUDED(ck_keyword_excluded_not_selected),
   * 이미 골랐으면 selectedAt 그대로(멱등, 기록 없음). 새로 고를 때만 감사 기록 GATE_PASSED·G1(candidate_id NULL)을
   * 같은 트랜잭션에 남긴다. 동시에 두 번 와도 `selected_at IS NULL` 조건 갱신이라 기록은 한 번이다.
   */
  async select(keywordId: number | null): Promise<RankedKeywordDto> {
    return this.prisma.$transaction(async (tx) => {
      const keyword = keywordId === null ? null : await this.repo.findKeyword(keywordId, tx);
      if (!keyword) throw new ApiException('KEYWORD_NOT_FOUND');
      if (keyword.excludedReason !== null) {
        throw new ApiException('KEYWORD_EXCLUDED', { details: { keywordId: keyword.id } });
      }
      if (keyword.selectedAt !== null) return toRankedKeywordDto(keyword);
      const now = this.clock.now();
      const updated = await tx.keyword.updateMany({
        where: { id: keyword.id, selectedAt: null, excludedReason: null },
        data: { selectedAt: now },
      });
      if (updated.count === 1) {
        await this.audit.record(
          {
            eventType: 'GATE_PASSED',
            gate: 'G1',
            candidateId: null,
            detail: { keywordId: keyword.id, keywordSnapshotId: keyword.keywordSnapshotId },
            occurredAt: now,
          },
          tx,
        );
      }
      const after = await this.repo.findKeyword(keyword.id, tx);
      return toRankedKeywordDto(after!);
    });
  }

  /**
   * 고르기 취소(DELETE, 204): 없는 id 404, 이 키워드를 출처로 만든 후보가 있으면 409 KEYWORD_IN_USE(details.candidateIds).
   * 이미 비어 있어도 204(멱등).
   */
  async unselect(keywordId: number | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const keyword = keywordId === null ? null : await this.repo.findKeyword(keywordId, tx);
      if (!keyword) throw new ApiException('KEYWORD_NOT_FOUND');
      if (keyword.candidates.length > 0) {
        throw new ApiException('KEYWORD_IN_USE', {
          details: { keywordId: keyword.id, candidateIds: keyword.candidates.map((c) => c.id) },
        });
      }
      if (keyword.selectedAt === null) return;
      await tx.keyword.update({ where: { id: keyword.id }, data: { selectedAt: null } });
    });
  }
}

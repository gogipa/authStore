import { Inject, Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../common/audit/user-action-log.service.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../integrations/http/clock.token.js';
import type { RankedKeywordDto } from './dto/keyword-snapshot.dto.js';
import { KeywordRepository, toRankedKeywordDto } from './keyword.repository.js';

/**
 * G1 키워드 고르기(F-KW-08, US-02 AC2, P2-01 규칙 13, D-33). G1 기록 = `keyword.selected_at`(후보 단위 게이트가 아니라
 * gate_pass에 두지 않는다, ERD §3.2). 화면은 한 묶음에서 키워드를 하나만 고른다(D-33, Proposed): 묶음 안에서
 * `selected_at`이 가장 늦은 키워드가 '지금 고른 키워드'다(`KeywordRepository.findCurrentSelected`). 다른 키워드로 바꿔도
 * 앞서 고른 키워드의 `selected_at`은 지우지 않는다(그 키워드로 만든 후보의 G1 통과 시각·승인 이력이라 `gate.service`가 쓴다).
 * 멱등하게 하려고 하위 리소스 PUT·DELETE로 둔다.
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
   * 고르기(PUT, D-33): '이 키워드를 지금 고른 키워드로 한다'. 없는 id 404 KEYWORD_NOT_FOUND, 아동화로 빠진 키워드
   * 409 KEYWORD_EXCLUDED(ck_keyword_excluded_not_selected). 이미 지금 고른 키워드면 그대로(멱등, 기록 없음).
   * 아니면(앞서 고른 키워드를 다시 고르거나 처음 고르는 키워드) `selected_at = max(지금, 묶음의 가장 늦은 selected_at + 1ms)`로
   * 정해 가장 늦은 값이 되게 하고(시계가 같거나 거꾸로 가도 순서가 선다), 감사 기록 GATE_PASSED·G1(candidate_id NULL)을
   * 같은 트랜잭션에 남긴다. 다른 키워드의 `selected_at`은 건드리지 않는다. 동시에 두 번 와도 갱신 조건
   * (`selected_at`이 비었거나 새 값보다 앞섬)이 한 번만 맞아 기록은 한 번이다.
   */
  async select(keywordId: number | null): Promise<RankedKeywordDto> {
    return this.prisma.$transaction(async (tx) => {
      const keyword = keywordId === null ? null : await this.repo.findKeyword(keywordId, tx);
      if (!keyword) throw new ApiException('KEYWORD_NOT_FOUND');
      if (keyword.excludedReason !== null) {
        throw new ApiException('KEYWORD_EXCLUDED', { details: { keywordId: keyword.id } });
      }
      const current = await this.repo.findCurrentSelected(keyword.keywordSnapshotId, tx);
      if (current !== null && current.id === keyword.id) return toRankedKeywordDto(current);
      const now = this.clock.now();
      const selectedAt = current?.selectedAt
        ? new Date(Math.max(now.getTime(), current.selectedAt.getTime() + 1))
        : now;
      const updated = await tx.keyword.updateMany({
        where: {
          id: keyword.id,
          excludedReason: null,
          OR: [{ selectedAt: null }, { selectedAt: { lt: selectedAt } }],
        },
        data: { selectedAt },
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
   * 이미 비어 있어도 204(멱등). 하나만 고르는 화면(D-33)은 부르지 않는다(남겨 둔 API).
   * 지금 고른 키워드를 비우면 그다음으로 늦게 고른 것이 지금 고른 키워드가 된다.
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

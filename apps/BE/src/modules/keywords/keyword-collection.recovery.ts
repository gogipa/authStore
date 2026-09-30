import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * 앱 재시작 정리(P2-01 Proposed, 작업 문서 §8 '수집 중 앱이 꺼지면 RUNNING이 남아 ALREADY_IN_PROGRESS로 계속 막힌다'):
 * 요청을 받기 전(onApplicationBootstrap)에 RUNNING으로 남은 버튼 수집 묶음을 ABORTED + `APP_RESTART`로 닫는다.
 * 이미 저장한 키워드 줄은 그대로 둔다(삭제 금지). 사유 값은 새 마이그레이션(`20260930000000_keyword_abort_reasons`)으로
 * ck_kws_abort_reason에 더했다. 이 앱은 프로세스 하나라 시작 시점의 RUNNING은 모두 앞 프로세스가 남긴 것이다.
 */
@Injectable()
export class KeywordCollectionRecovery implements OnApplicationBootstrap {
  private readonly logger = new Logger(KeywordCollectionRecovery.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const count = await this.recover();
      if (count > 0) {
        this.logger.warn(
          `앱 재시작: 진행 중이던 데이터랩 수집 ${count}건을 중단(APP_RESTART)으로 닫았습니다`,
        );
      }
    } catch (e) {
      this.logger.error({ err: e }, '데이터랩 수집 재시작 정리에 실패했습니다');
    }
  }

  /** RUNNING 묶음을 모두 ABORTED(APP_RESTART)로 닫는다. 닫은 수 */
  async recover(): Promise<number> {
    const res = await this.prisma.keywordSnapshot.updateMany({
      where: { status: 'RUNNING' },
      data: { status: 'ABORTED', abortReason: 'APP_RESTART', httpStatus: null },
    });
    return res.count;
  }
}

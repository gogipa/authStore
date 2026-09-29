import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfigService } from '../common/config/app-config.service.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * DB 세션 시간대. @prisma/adapter-pg는 timestamptz 값을 오프셋 없는 UTC 벽시계 문자열로 보내고,
 * 읽을 때는 오프셋을 +00:00으로 바꿔 버린다. 세션 시간대가 UTC가 아니면(예: 서버 기본 Asia/Seoul)
 * 저장·조회 시각이 9시간 어긋나고 ck_call_log_kst·ck_ual_kst 같은 CHECK가 KST 0~9시에 깨진다.
 * 그래서 접속마다 TimeZone=UTC로 맞춘다(06-2 §9).
 */
export const PRISMA_SESSION_OPTIONS = '-c TimeZone=UTC';

/**
 * Prisma 7 클라이언트(드라이버 어댑터 @prisma/adapter-pg).
 * 첫 쿼리 때 접속하고, 앱 종료(shutdown hooks) 때 끊는다.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        options: PRISMA_SESSION_OPTIONS,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

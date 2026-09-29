import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfigService } from '../common/config/app-config.service.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Prisma 7 클라이언트(드라이버 어댑터 @prisma/adapter-pg).
 * 첫 쿼리 때 접속하고, 앱 종료(shutdown hooks) 때 끊는다.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfigService) {
    super({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

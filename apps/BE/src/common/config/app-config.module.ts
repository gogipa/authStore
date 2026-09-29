import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service.js';
import { validateEnv } from './env.validation.js';
import { BE_ENV_FILE } from './paths.js';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      // 셸 환경변수가 .env보다 앞선다(테스트가 DATABASE_URL을 바꿀 수 있게).
      envFilePath: [BE_ENV_FILE],
      validate: validateEnv,
      cache: true,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './common/config/app-config.module.js';
import { AppConfigService } from './common/config/app-config.service.js';
import { FE_DIST_DIR } from './common/config/paths.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { SecretsModule } from './common/secrets/secrets.module.js';
import { CategoryModule } from './modules/category/category.module.js';
import { ContentModule } from './modules/content/content.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { KeywordsModule } from './modules/keywords/keywords.module.js';
import { PricingModule } from './modules/pricing/pricing.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { RegistrationModule } from './modules/registration/registration.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { SourcingModule } from './modules/sourcing/sourcing.module.js';
import { StepEngineModule } from './modules/step-engine/step-engine.module.js';
import { SystemModule } from './modules/system/system.module.js';
import { TagsModule } from './modules/tags/tags.module.js';
import { ThumbnailsModule } from './modules/thumbnails/thumbnails.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    PrismaModule,
    // 공통: 진행 알림(SSE)·이미지 파일·감사 기록(전역)
    CommonModule,
    // 공통: 비밀정보 저장소 SECRET_STORE(키체인, 전역, P1-07)
    SecretsModule,
    // 운영에서 FE 빌드(apps/FE/dist)가 있으면 BE가 화면도 내보낸다. /api 밖은 SPA 대체(index.html)
    ServeStaticModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        config.isProduction && existsSync(join(FE_DIST_DIR, 'index.html'))
          ? [{ rootPath: FE_DIST_DIR, exclude: ['/api/{*path}'] }]
          : [],
    }),
    // 핵심
    StepEngineModule,
    // 단계
    KeywordsModule,
    SourcingModule,
    PricingModule,
    CategoryModule,
    ThumbnailsModule,
    ContentModule,
    TagsModule,
    RegistrationModule,
    // 관리
    ProductsModule,
    SettingsModule,
    SystemModule,
    // 기반
    IntegrationsModule,
  ],
})
export class AppModule {}

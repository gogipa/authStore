import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { AppConfigService } from './common/config/app-config.service.js';

/** 항상 127.0.0.1에만 붙는다(03-2 §5). 다른 주소로 바꾸는 설정은 두지 않는다. */
export const BIND_HOST = '127.0.0.1';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  await configureApp(app);
  const { port } = app.get(AppConfigService);
  await app.listen(port, BIND_HOST);
}

void bootstrap();

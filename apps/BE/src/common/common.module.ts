import { Global, Module } from '@nestjs/common';
import { UserActionLogService } from './audit/user-action-log.service.js';
import {
  DEFAULT_SSE_HEARTBEAT_INTERVAL_MS,
  EventsController,
  SSE_HEARTBEAT_INTERVAL_MS,
} from './events/events.controller.js';
import { ProgressEventsService } from './events/progress-events.service.js';
import { FileStorageService } from './files/file-storage.service.js';
import { ImageAssetsController } from './files/image-assets.controller.js';
import { ImageAssetsService } from './files/image-assets.service.js';

/**
 * common(C4 §3): 진행 알림(SSE)·파일 저장(image_asset)·감사 로그(user_action_log).
 * 모든 모듈이 같이 쓰므로 전역으로 낸다. 공개 시그니처는 이후 실행 문서가 그대로 쓴다:
 * - ProgressEventsService.publish(name, data, { candidateId? })
 * - ImageAssetsService.saveImage(buffer, meta, tx?)
 * - UserActionLogService.record(input, tx?)
 */
@Global()
@Module({
  controllers: [EventsController, ImageAssetsController],
  providers: [
    ProgressEventsService,
    FileStorageService,
    ImageAssetsService,
    UserActionLogService,
    { provide: SSE_HEARTBEAT_INTERVAL_MS, useValue: DEFAULT_SSE_HEARTBEAT_INTERVAL_MS },
  ],
  exports: [ProgressEventsService, FileStorageService, ImageAssetsService, UserActionLogService],
})
export class CommonModule {}

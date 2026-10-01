import { Module, type OnModuleInit } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { StepEngineModule } from '../step-engine/step-engine.module.js';
import { AssemblyOwnerEditHandler } from './assembly/assembly-owner-edit.handler.js';
import { ContentAssemblyController } from './assembly/content-assembly.controller.js';
import { ContentAssemblyService } from './assembly/content-assembly.service.js';
import { contentOutputReader } from './assembly/content-output.reader.js';
import { NoticeHtmlStepRunner } from './assembly/notice-html-step.runner.js';
import { noticeHtmlReader } from './assembly/notice-html.reader.js';
import { OriginCodeResolver } from './assembly/notice/origin-code.resolver.js';
import { ContentCopyController } from './copy/content-copy.controller.js';
import { ContentCopyService } from './copy/content-copy.service.js';
import { CopyOwnerEditHandler } from './copy/copy-owner-edit.handler.js';
import { CopyStepRunner } from './copy/copy-step.runner.js';
import { ContentFactController } from './facts/content-fact.controller.js';
import { ContentFactService } from './facts/content-fact.service.js';
import { ContentFieldsController } from './facts/content-fields.controller.js';
import { ContentFieldsService } from './facts/content-fields.service.js';
import { FactOwnerEditHandler } from './facts/fact-owner-edit.handler.js';
import { NoticeRawStepRunner } from './facts/notice-raw-step.runner.js';
import { OriginInputResolver } from './facts/origin-input.resolver.js';
import { SpecImageCollector } from './facts/spec-image.collector.js';

/**
 * ⑥ 상세 콘텐츠(03-ADR-003 모듈 경계 — 다른 단계 모듈은 import하지 않는다). P3-03: ⑥-1 카피·⑥-2 사양 추출(근거 포함).
 * P3-04: ⑥-3 고시·사양 블록·구매대행 고지·상세 HTML·상품명(`assembly/`), ⑥-2 색상 표기·주의 문구.
 * - 실행기 둘(P1-05 `@StepRunnerFor` — step-engine 레지스트리가 모은다): `CopyStepRunner`(COPY, AI 텍스트)·`NoticeRawStepRunner`
 *   (NOTICE_RAW, 규칙 추출 → AI 비전·텍스트). ② 산출물은 step-engine 창구(`StepEngineApi.readSourcingItemContent`)로만 읽는다
 * - 오너 수정 처리기 둘(실행기 `copyOutput`이 부른다 — step-engine owner-edits): `CopyOwnerEditHandler`(EDIT·KEEP_AS_IS·
 *   RESTORE_VERSION)·`FactOwnerEditHandler`(EDIT·RESTORE_VERSION, 재확인 해소)
 * - AI는 P1-10 `AiExecutor`(integrations)로만, 스펙 이미지는 라쿠텐 이미지 포트(관문 RAKUTEN_IMAGE) + P1-01 이미지 저장, 원산지
 *   나라 검사는 설정 사전(P1-03 `SettingsService`) + 원산지 캐시(`CommerceMetaCacheService.findOriginAreasByCountry`)
 * - API: `GET /candidates/{id}/content-copy`, `GET /candidates/{id}/content-fact`, `PUT /step-runs/{id}/content-fields/{fieldKey}`
 * P3-04 ⑥-3(`assembly/`, AI 없음):
 * - 실행기 `NoticeHtmlStepRunner`(NOTICE_HTML): ⑥-1·⑥-2는 같은 모듈 표에서, ② 모델명·③ 판매 사이즈는 step-engine 창구
 *   (`readSourcingItemContent`·`readPricingSaleSizes`)로, 프로필은 settings `PurchaseAgencyProfileService`로 읽는다. 원산지 코드는
 *   integrations `CommerceMetaCacheService`(`OriginCodeResolver`). 순수 조립 `assemble.ts`(고시·사양 블록·고지·HTML·상품명)
 * - 오너 수정 `AssemblyOwnerEditHandler`(EDIT notice.*·product_name·원산지 코드, RESTORE_VERSION)
 * - API: `GET /candidates/{id}/content-assembly`, `GET …/content-assembly/preview`(text/html + CSP — G3 선택본은
 *   `StepEngineApi.readThumbnailSelection`)
 * - 상세 HTML 계약(자리표시자·고지 블록 해시)은 공용 `common/rules/detail-html.ts`(P4-01·P4-02가 같이 쓴다)
 * P4-01: ⑥-3 상세 HTML 읽기(`assembly/notice-html.reader.ts`)를 앱 시작 때 `StepEngineApi.registerNoticeHtmlReader`로 끼운다 —
 * ⑧ 업로드(registration)가 `readNoticeHtml`로 읽는다
 * P4-02: ⑥ 산출물 읽기(`assembly/content-output.reader.ts` — ⑥-3 조립·⑥-2 사실·⑥-1 카피)를 `StepEngineApi.registerContentOutputReader`
 * 로 끼운다 — 최종 승인 미리보기·사전 검증(registration)이 읽는다
 */
@Module({
  imports: [IntegrationsModule, SettingsModule, StepEngineModule],
  controllers: [
    ContentCopyController,
    ContentFactController,
    ContentFieldsController,
    ContentAssemblyController,
  ],
  providers: [
    CopyStepRunner,
    CopyOwnerEditHandler,
    ContentCopyService,
    NoticeRawStepRunner,
    FactOwnerEditHandler,
    OriginInputResolver,
    SpecImageCollector,
    ContentFactService,
    ContentFieldsService,
    OriginCodeResolver,
    AssemblyOwnerEditHandler,
    NoticeHtmlStepRunner,
    ContentAssemblyService,
  ],
})
export class ContentModule implements OnModuleInit {
  constructor(private readonly api: StepEngineApi) {}

  onModuleInit(): void {
    this.api.registerNoticeHtmlReader(noticeHtmlReader);
    this.api.registerContentOutputReader(contentOutputReader);
  }
}

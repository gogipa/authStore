import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { ChildKeywordTermsController } from './child-keyword-terms.controller.js';
import { ChildKeywordTermsService } from './child-keyword-terms.service.js';
import { KeywordCollectionStatusController } from './keyword-collection-status.controller.js';
import { KeywordCollectionRecovery } from './keyword-collection.recovery.js';
import { KeywordCollectionService } from './keyword-collection.service.js';
import { KeywordSelectionController } from './keyword-selection.controller.js';
import { KeywordSelectionService } from './keyword-selection.service.js';
import { KeywordSnapshotsController } from './keyword-snapshots.controller.js';
import { KeywordSnapshotsService } from './keyword-snapshots.service.js';
import { KeywordRepository } from './keyword.repository.js';

/**
 * ① 키워드(P2-01, 05-2 태그 keywords): 데이터랩 버튼 수집·순위 붙여넣기·키워드 묶음·아동화 키워드 제외·G1 키워드 고르기·
 * 아동 단어 더하기. API 9개(05-1 §2.2).
 * - 데이터랩은 integrations의 `DATALAB_RANK_PORT`로만 부른다(관문 target=DATALAB). 쉼·상한 판단은 `CallUsageService`(call_log)
 * - 설정은 `SettingsService`로만 읽고 쓴다(아동 단어 더하기 = 설정 파일 다시 쓰기 + 새 스냅샷)
 * - 아동화 공통 판별(F-BS-12)은 `common/child-shoe`의 순수 함수를 부른다(② P2-02·④ P2-06도 같은 함수)
 * - 후보 만들기(creationPath=KEYWORD)는 step-engine(P1-04) `POST /candidates`가 keyword 표를 읽어 검사한다
 *   (이 모듈은 step-engine을 import하지 않는다)
 * - 시계·대기는 integrations의 `CLOCK`(now·sleep). 재시작 때 RUNNING 묶음은 `KeywordCollectionRecovery`가 닫는다
 */
@Module({
  imports: [IntegrationsModule, SettingsModule],
  controllers: [
    KeywordSnapshotsController,
    KeywordSelectionController,
    KeywordCollectionStatusController,
    ChildKeywordTermsController,
  ],
  providers: [
    KeywordRepository,
    KeywordCollectionService,
    KeywordSnapshotsService,
    KeywordSelectionService,
    ChildKeywordTermsService,
    KeywordCollectionRecovery,
  ],
})
export class KeywordsModule {}

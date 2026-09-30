import { Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../common/audit/user-action-log.service.js';
import { BUILTIN_CHILD_TERMS, isSameTerm } from '../../common/child-shoe/child-shoe.rules.js';
import { SettingsService } from '../settings/settings.service.js';
import type {
  ChildKeywordTermCreatedDto,
  ChildKeywordTermListDto,
} from './dto/child-keyword-term.dto.js';
import { CHILD_KEYWORD_AUDIT_SETTING } from './keywords.constants.js';

function isBuiltIn(term: string): boolean {
  return BUILTIN_CHILD_TERMS.some((w) => isSameTerm(w, term));
}

/**
 * 아동 단어(F-KW-07, P2-01 규칙 11). 목록의 원본은 설정 `safety.childKeywords`(ERD 부록 A)다.
 * 더하기만 된다(DELETE 라우트가 없다). 더하면 설정 파일에 다시 쓰고 새 settings_snapshot을 만든다(SettingsService).
 * 이미 수집한 묶음의 keyword 행에는 다시 적용하지 않는다(05-2 x-decision) — 다음 수집·붙여넣기부터 쓴다.
 */
@Injectable()
export class ChildKeywordTermsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: UserActionLogService,
  ) {}

  /** 목록(설정 순서 그대로). `builtIn`이면 기본 단어 */
  list(): ChildKeywordTermListDto {
    const terms = this.settings.current().safety.childKeywords;
    return { items: terms.map((term) => ({ term, builtIn: isBuiltIn(term) })) };
  }

  /**
   * 더하기: 같은 단어(NFKC·소문자 정규화) 409 CHILD_TERM_ALREADY_EXISTS. 설정 파일 쓰기 + 새 스냅샷 + 감사 기록
   * SETTING_CHANGED(detail { setting, term, changedKeys })을 SettingsService가 한 줄로 처리한다.
   */
  async add(term: string): Promise<ChildKeywordTermCreatedDto> {
    const outcome = await this.settings.addChildKeyword(term, {
      inTransaction: async (tx, changedKeys) => {
        await this.audit.record(
          {
            eventType: 'SETTING_CHANGED',
            detail: {
              setting: CHILD_KEYWORD_AUDIT_SETTING,
              term: term.trim(),
              changedKeys: [...changedKeys],
            },
          },
          tx,
        );
      },
    });
    return { term: outcome.term, builtIn: false, settingsSnapshotId: outcome.snapshotId };
  }
}

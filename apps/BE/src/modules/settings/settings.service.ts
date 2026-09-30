import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { isSameTerm } from '../../common/child-shoe/child-shoe.rules.js';
import { APP_VERSION } from '../../common/config/app-version.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import type { FieldError } from '../../common/errors/error-response.js';
import { ProgressEventsService } from '../../common/events/progress-events.service.js';
import type { Prisma, SettingsSnapshot } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SettingsReloadResultDto } from './dto/settings-reload-result.dto.js';
import type { SettingsSnapshotDto, SettingsViewDto } from './dto/settings-view.dto.js';
import { describeSafetyItems } from './safety/safety-floor.validator.js';
import type { AiSettings, AppSettings } from './schema/settings.types.js';
import {
  type AtomicWriteOps,
  canonicalJson,
  checkSettingsValue,
  ROOT_FIELD,
  type SettingsFileManifestEntry,
  SettingsFileLoader,
  type SettingsLoadResult,
} from './settings-file.loader.js';
import { SETTINGS_RERUN_PROPAGATOR, type SettingsRerunPropagator } from './settings-rerun.port.js';

/** 설정 파일 검사 결과(GET /settings의 valid·errors) */
export interface SettingsStatus {
  valid: boolean;
  errors: FieldError[];
}

/** POST /settings-snapshots 결과. created면 201 */
export interface SettingsReloadOutcome {
  created: boolean;
  result: SettingsReloadResultDto;
}

type LoadedFailed = Extract<SettingsLoadResult, { ok: false }>;

/** 스냅샷으로 저장할 통과한 설정(파일 다시 읽기·ai 섹션 저장 공통) */
interface PassedSettings {
  settings: AppSettings;
  contentSha256: string;
  fileManifest: SettingsFileManifestEntry[];
}

/** ai 섹션 저장(P1-11) 결과 */
export interface AiSectionReplaceOutcome {
  /** false면 같은 값이라 아무것도 쓰지 않았다(새 스냅샷·SSE 없음) */
  changed: boolean;
  snapshotId: number;
  changedKeys: string[];
}

export interface AiSectionReplaceOptions {
  /** 스냅샷 트랜잭션 안에서 함께 할 일(감사 기록 SETTING_CHANGED 등) */
  inTransaction?: (tx: Prisma.TransactionClient, changedKeys: readonly string[]) => Promise<void>;
  /** 테스트: 원자 쓰기의 rename을 바꿔 끼운다 */
  writeOps?: Partial<AtomicWriteOps>;
}

/** 아동 단어 더하기(P2-01) 결과 */
export interface ChildKeywordAddOutcome {
  /** 더한 단어(앞뒤 공백을 뗀 글자) */
  term: string;
  /** 새(또는 같은 내용의) 설정 스냅샷 id */
  snapshotId: number;
  changedKeys: string[];
}

interface CurrentSettings {
  snapshotId: number;
  settings: Readonly<AppSettings>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 두 설정의 달라진 키(점 경로, 예 `costs.targetMarginPct`). 객체는 안으로 들어가고, 배열·값은 통째로 비교한다
 * (`sourcing.ngKeywords`처럼 목록 하나가 한 키). 한쪽에만 있는 키도 넣는다. 사전순.
 */
export function diffSettingsKeys(prev: unknown, next: unknown): string[] {
  const out: string[] = [];
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (isPlainObject(a) && isPlainObject(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const key of keys) walk(a[key], b[key], path === '' ? key : `${path}.${key}`);
      return;
    }
    if (canonicalJson(a) !== canonicalJson(b)) out.push(path);
  };
  walk(prev, next, '');
  return out;
}

/** `ai` 섹션 키. 엔진·모델 변경은 재실행 필요 전파에서 뺀다(D-16 R9, ERD §3.11) */
export function isAiSettingsKey(key: string): boolean {
  return key === 'ai' || key.startsWith('ai.');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** 422 문구의 `{위치}`: 첫 오류 경로(+ 나머지 수) */
function describeLocation(errors: readonly FieldError[]): string {
  const first = errors[0]?.field ?? ROOT_FIELD;
  return errors.length > 1 ? `${first} 외 ${errors.length - 1}곳` : first;
}

function toSnapshotDto(row: SettingsSnapshot, isCurrent: boolean): SettingsSnapshotDto {
  return {
    id: row.id,
    contentSha256: row.contentSha256,
    schemaVersion: row.schemaVersion,
    appVersion: row.appVersion,
    fileManifest: row.fileManifest,
    content: row.content as Record<string, unknown>,
    firstLoadedAt: row.firstLoadedAt.toISOString(),
    lastLoadedAt: row.lastLoadedAt.toISOString(),
    isCurrent,
  };
}

/**
 * 설정(F-ST-01, ERD §3.11). 앱을 켤 때 설정 파일을 읽어 검사하고, 통과한 내용을 `settings_snapshot`에 내용 해시별로
 * 한 번 저장해 '현재 설정'으로 쓴다. 다른 모듈은 파일을 읽지 않고 `current()`·`currentSnapshotId()`만 쓴다.
 *
 * - 시작 검사와 다시 읽기(POST /settings-snapshots)는 같은 로더·검사기를 쓴다. 한 번에 하나씩만 돈다.
 * - 검사에 실패해도 앱은 뜬다. 전에 통과한 스냅샷(지금 스키마·안전 기준도 통과하는 것)이 있으면 그것을 계속 쓰고
 *   `status()`는 valid=false·errors를 준다. 하나도 없으면 `current()`·GET /settings가 503 SETTINGS_INVALID다.
 * - 응답·로그·SSE에 설정 파일의 절대 경로를 넣지 않는다.
 */
@Injectable()
export class SettingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SettingsService.name);
  private currentState: CurrentSettings | null = null;
  private check: SettingsStatus = { valid: false, errors: [] };
  private queue: Promise<unknown> = Promise.resolve();
  private propagator: SettingsRerunPropagator;

  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: SettingsFileLoader,
    private readonly events: ProgressEventsService,
    @Inject(SETTINGS_RERUN_PROPAGATOR) propagator: SettingsRerunPropagator,
  ) {
    this.propagator = propagator;
  }

  onApplicationBootstrap(): Promise<void> {
    return this.initialize();
  }

  // ── 다른 모듈이 쓰는 창구 ─────────────────────────────────────────────────

  /** 현재 설정(읽기 전용). 통과한 스냅샷이 없으면 503 SETTINGS_INVALID */
  current(): Readonly<AppSettings> {
    return this.requireCurrent().settings;
  }

  /** 현재 설정. 없으면 null(요청 밖에서 기본값으로 버틸 곳: 하루 상한 등) */
  currentOrNull(): Readonly<AppSettings> | null {
    return this.currentState?.settings ?? null;
  }

  /** 현재 설정 스냅샷 id(StepRun.settings_snapshot_id, P1-05). 없으면 503 SETTINGS_INVALID */
  currentSnapshotId(): number {
    return this.requireCurrent().snapshotId;
  }

  /** 진행 중인 시작 검사·다시 읽기가 끝날 때까지(없으면 곧바로). 앱 시작 AI 엔진 점검이 선택 엔진을 읽기 전에 기다린다(P1-10) */
  async whenIdle(): Promise<void> {
    await this.queue.then(
      () => undefined,
      () => undefined,
    );
  }

  /** 설정 파일 검사 결과(마지막 시작 검사·다시 읽기) */
  status(): SettingsStatus {
    return { valid: this.check.valid, errors: [...this.check.errors] };
  }

  /**
   * 재실행 필요 전파를 바꿔 끼운다(P1-05). 모듈 순환 없이 step-engine이 자기 onModuleInit에서 부를 수 있게 둔
   * 창구다. DI로 바꾸려면 SETTINGS_RERUN_PROPAGATOR 제공자를 바꾼다.
   */
  setRerunPropagator(propagator: SettingsRerunPropagator): void {
    this.propagator = propagator;
  }

  // ── 시작·다시 읽기 ────────────────────────────────────────────────────────

  /** 앱 시작 검사(onApplicationBootstrap). 실패해도 던지지 않는다(앱은 떠서 오류를 보여 준다) */
  initialize(): Promise<void> {
    return this.serialized(async () => {
      try {
        const prevRow = await this.latestRow();
        const loaded = await this.loader.load();
        if (loaded.createdFromTemplate) {
          this.logger.log('설정 파일이 없어 기본 템플릿으로 만들었습니다(settings/settings.json).');
        }
        if (loaded.ok) {
          const saved = await this.saveSnapshot(loaded, prevRow?.content ?? null);
          this.adopt(saved.row.id, loaded.settings);
          this.runAfterCommit(saved.afterCommit);
          this.logger.log(
            `설정 파일 검사 통과: 스냅샷 #${saved.row.id}(${saved.created ? '새로 만듦' : '같은 내용'}), 바뀐 키 ${saved.changedKeys.length}개`,
          );
          return;
        }
        this.check = { valid: false, errors: loaded.errors };
        this.logFailure('앱 시작', loaded);
        this.currentState = null;
        if (prevRow) {
          const recheck = checkSettingsValue(prevRow.content);
          if (recheck.ok)
            this.currentState = { snapshotId: prevRow.id, settings: deepFreeze(recheck.settings) };
        }
        this.logger.warn(
          this.currentState
            ? `전에 통과한 설정 스냅샷 #${this.currentState.snapshotId}을 계속 씁니다.`
            : '쓸 수 있는 설정 스냅샷이 없습니다. 설정이 필요한 기능은 503 SETTINGS_INVALID로 멈춥니다.',
        );
      } catch (error) {
        this.logger.error(
          { err: error },
          '설정을 읽거나 스냅샷을 저장하지 못했습니다. 설정이 필요한 기능은 멈춥니다.',
        );
        this.check = {
          valid: false,
          errors: [
            {
              field: ROOT_FIELD,
              message:
                '설정 스냅샷을 저장하지 못했습니다. 앱 로그를 확인한 뒤 설정 파일을 다시 읽어 주세요.',
            },
          ],
        };
      }
    });
  }

  /**
   * 설정 파일 다시 읽기(POST /settings-snapshots). 시작 검사와 같은 코드다.
   * 실패하면 현재 스냅샷은 그대로 두고 422를 던진다. 성공·실패 모두 SSE `settings.reloaded`를 보낸다
   * (실패: settingsSnapshotId null·valid false — GET /settings의 검사 결과가 바뀌었으므로, Proposed).
   */
  reload(): Promise<SettingsReloadOutcome> {
    return this.serialized(async () => {
      const loaded = await this.loader.load();
      if (!loaded.ok) {
        this.check = { valid: false, errors: loaded.errors };
        this.logFailure('다시 읽기', loaded);
        this.events.publish('settings.reloaded', {
          settingsSnapshotId: null,
          changedKeys: [],
          valid: false,
          errors: loaded.errors.map((e) => `${e.field}: ${e.message}`),
          rerunRequiredStepCount: 0,
        });
        throw this.toReloadError(loaded);
      }
      const saved = await this.saveSnapshot(loaded, this.currentState?.settings ?? null);
      this.adopt(saved.row.id, loaded.settings);
      this.events.publish('settings.reloaded', {
        settingsSnapshotId: saved.row.id,
        changedKeys: saved.changedKeys,
        valid: true,
        errors: [],
        rerunRequiredStepCount: saved.rerunRequiredStepCount,
      });
      this.runAfterCommit(saved.afterCommit);
      return {
        created: saved.created,
        result: {
          snapshot: toSnapshotDto(saved.row, true),
          created: saved.created,
          changedKeys: saved.changedKeys,
          rerunRequiredStepCount: saved.rerunRequiredStepCount,
        },
      };
    });
  }

  /**
   * AI 엔진 선택 저장(P1-11 PUT /settings/ai-engine, D-16 R8·R9). 다시 읽기와 같은 줄(한 번에 하나씩)에서 돈다.
   * 1. 현재 설정(없으면 503)과 ai가 같으면 아무것도 하지 않는다(changed=false)
   * 2. 설정 파일의 `ai` 섹션만 원자적으로 쓴다(`SettingsFileLoader.writeAiSection` — 임시 파일 → fsync → rename)
   * 3. 현재 설정 + 새 ai로 새 `settings_snapshot`(같은 내용이 있으면 — 예전에 쓴 ai로 돌아가면 — 새 행 없이 그 행의
   *    last_loaded_at만 갱신하고 그 id를 쓴다, P1-03 중복 제거). ai 키는 재실행 필요 전파에 넘기지 않으므로
   *    rerunRequiredStepCount는 0이다
   * 4. SSE `settings.reloaded { settingsSnapshotId, changedKeys, valid: true, errors: [], rerunRequiredStepCount: 0 }`
   *    (앞선 다시 읽기의 실패는 싣지 않는다. GET /settings의 valid·errors는 파일 검사 결과 그대로)
   * 파일에 다시 읽지 않은 다른 수정이 있어도 스냅샷은 '현재 설정 + 새 ai'다(다른 키는 다음 다시 읽기·시작 때 반영).
   * 저장 조건(10분 안 연결 테스트 통과)·모델 검사는 부르는 쪽(AiEngineSettingsService)이 먼저 한다.
   */
  replaceAiSection(
    ai: AiSettings,
    options: AiSectionReplaceOptions = {},
  ): Promise<AiSectionReplaceOutcome> {
    return this.serialized(async () => {
      const current = this.requireCurrent();
      if (canonicalJson(current.settings.ai) === canonicalJson(ai)) {
        return { changed: false, snapshotId: current.snapshotId, changedKeys: [] };
      }
      const checked = checkSettingsValue({ ...current.settings, ai });
      if (!checked.ok) {
        throw new ApiException('SETTINGS_SCHEMA_INVALID', {
          message: formatErrorMessage('SETTINGS_SCHEMA_INVALID', {
            위치: describeLocation(checked.errors),
          }),
          fieldErrors: checked.errors,
        });
      }
      const fileManifest = await this.loader.writeAiSection(
        checked.settings.ai,
        checked.settings,
        options.writeOps,
      );
      const saved = await this.saveSnapshot(
        { settings: checked.settings, contentSha256: checked.contentSha256, fileManifest },
        current.settings,
        options.inTransaction,
      );
      this.currentState = { snapshotId: saved.row.id, settings: deepFreeze(checked.settings) };
      // 규칙 5: 이 알림의 valid·errors는 방금 저장한 스냅샷의 검사 결과다(늘 통과 → true·[]).
      // 앞선 다시 읽기가 실패했어도 그 오류를 싣지 않는다 — 파일 검사 결과는 GET /settings의 valid·errors(this.check)에 남는다
      this.events.publish('settings.reloaded', {
        settingsSnapshotId: saved.row.id,
        changedKeys: saved.changedKeys,
        valid: true,
        errors: [],
        rerunRequiredStepCount: saved.rerunRequiredStepCount,
      });
      this.runAfterCommit(saved.afterCommit);
      this.logger.log(
        `AI 엔진 설정 저장: 스냅샷 #${saved.row.id}, 바뀐 키 ${saved.changedKeys.length}개`,
      );
      return { changed: true, snapshotId: saved.row.id, changedKeys: saved.changedKeys };
    });
  }

  /**
   * 아동 단어 더하기(P2-01 POST /child-keyword-terms, F-KW-07 '더할 수만 있다'). `replaceAiSection`과 같은 줄에서 돈다.
   * 1. 현재 설정(없으면 503). 같은 단어(NFKC·소문자·앞뒤 공백 정규화 비교, Proposed)가 있으면 409 CHILD_TERM_ALREADY_EXISTS
   * 2. 설정 파일의 `safety.childKeywords`만 원자적으로 바꿔 쓴다(나머지 키·다시 읽지 않은 수정은 그대로)
   * 3. 현재 설정 + 새 목록으로 설정 스냅샷(같은 내용이 있으면 그 행 — P1-03 중복 제거) + 재실행 필요 전파 + `inTransaction`
   *    (감사 기록 SETTING_CHANGED)을 한 트랜잭션으로
   * 4. SSE `settings.reloaded { valid: true, errors: [] }`
   * 이미 수집한 키워드 묶음에는 다시 적용하지 않는다(05-2 addChildKeywordTerm x-decision) — 다음 수집·붙여넣기부터 쓴다.
   */
  addChildKeyword(
    rawTerm: string,
    options: AiSectionReplaceOptions = {},
  ): Promise<ChildKeywordAddOutcome> {
    return this.serialized(async () => {
      const current = this.requireCurrent();
      const term = rawTerm.trim();
      if (current.settings.safety.childKeywords.some((w) => isSameTerm(w, term))) {
        throw new ApiException('CHILD_TERM_ALREADY_EXISTS', { details: { term } });
      }
      const childKeywords = [...current.settings.safety.childKeywords, term];
      const checked = checkSettingsValue({
        ...current.settings,
        safety: { ...current.settings.safety, childKeywords },
      });
      if (!checked.ok) {
        throw new ApiException('SETTINGS_SCHEMA_INVALID', {
          message: formatErrorMessage('SETTINGS_SCHEMA_INVALID', {
            위치: describeLocation(checked.errors),
          }),
          fieldErrors: checked.errors,
        });
      }
      const fileManifest = await this.loader.writeChildKeywords(
        checked.settings.safety.childKeywords,
        checked.settings,
        options.writeOps,
      );
      const saved = await this.saveSnapshot(
        { settings: checked.settings, contentSha256: checked.contentSha256, fileManifest },
        current.settings,
        options.inTransaction,
      );
      this.currentState = { snapshotId: saved.row.id, settings: deepFreeze(checked.settings) };
      this.events.publish('settings.reloaded', {
        settingsSnapshotId: saved.row.id,
        changedKeys: saved.changedKeys,
        valid: true,
        errors: [],
        rerunRequiredStepCount: saved.rerunRequiredStepCount,
      });
      this.runAfterCommit(saved.afterCommit);
      this.logger.log(`아동 단어를 더했습니다: 스냅샷 #${saved.row.id}`);
      return { term, snapshotId: saved.row.id, changedKeys: saved.changedKeys };
    });
  }

  /** GET /settings: 현재 스냅샷 + 검사 결과. 통과한 스냅샷이 없으면 503(fieldErrors에 검사 오류) */
  async getView(): Promise<SettingsViewDto> {
    const current = this.currentState;
    const row = current
      ? await this.prisma.settingsSnapshot.findUnique({ where: { id: current.snapshotId } })
      : null;
    if (!row) {
      throw new ApiException('SETTINGS_INVALID', { fieldErrors: this.check.errors });
    }
    const latest = await this.latestRow();
    return {
      ...toSnapshotDto(row, latest?.id === row.id),
      valid: this.check.valid,
      errors: [...this.check.errors],
    };
  }

  // ── 내부 ─────────────────────────────────────────────────────────────────

  private requireCurrent(): CurrentSettings {
    if (!this.currentState) {
      throw new ApiException('SETTINGS_INVALID', { fieldErrors: this.check.errors });
    }
    return this.currentState;
  }

  private adopt(snapshotId: number, settings: AppSettings): void {
    this.currentState = { snapshotId, settings: deepFreeze(settings) };
    this.check = { valid: true, errors: [] };
  }

  /** 한 번에 하나씩(시작 검사·다시 읽기가 겹치면 같은 해시로 두 행을 만들려다 UNIQUE에 걸린다) */
  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** 현재 스냅샷 = last_loaded_at이 가장 큰 행(같으면 id가 큰 행) */
  private latestRow(): Promise<SettingsSnapshot | null> {
    return this.prisma.settingsSnapshot.findFirst({
      orderBy: [{ lastLoadedAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * 통과한 내용을 저장한다. 같은 해시가 있으면 last_loaded_at만, 없으면 새 행. 그리고 달라진 키(ai 섹션 제외)를
   * 재실행 필요 전파 포트에 같은 트랜잭션으로 넘긴다.
   * @param prevContent 직전 현재 스냅샷의 content(없으면 null → changedKeys는 빈 배열)
   */
  private async saveSnapshot(
    loaded: PassedSettings,
    prevContent: unknown,
    inTransaction?: AiSectionReplaceOptions['inTransaction'],
  ): Promise<{
    row: SettingsSnapshot;
    created: boolean;
    changedKeys: string[];
    rerunRequiredStepCount: number;
    /** 커밋 뒤 부를 일(전파가 맡긴 SSE) */
    afterCommit: (() => void)[];
  }> {
    const changedKeys = prevContent === null ? [] : diffSettingsKeys(prevContent, loaded.settings);
    const propagateKeys = changedKeys.filter((key) => !isAiSettingsKey(key));
    const afterCommit: (() => void)[] = [];
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const existing = await tx.settingsSnapshot.findUnique({
        where: { contentSha256: loaded.contentSha256 },
      });
      let row: SettingsSnapshot;
      if (existing) {
        // ck_settings_snapshot_time(last ≥ first): PC 시계가 뒤로 가도 깨지지 않게
        const lastLoadedAt = now < existing.firstLoadedAt ? existing.firstLoadedAt : now;
        row = await tx.settingsSnapshot.update({
          where: { id: existing.id },
          data: { lastLoadedAt },
        });
      } else {
        row = await tx.settingsSnapshot.create({
          data: {
            contentSha256: loaded.contentSha256,
            schemaVersion: loaded.settings.schemaVersion,
            appVersion: APP_VERSION,
            fileManifest: loaded.fileManifest as unknown as Prisma.InputJsonValue,
            content: loaded.settings as unknown as Prisma.InputJsonValue,
            firstLoadedAt: now,
            lastLoadedAt: now,
          },
        });
      }
      const rerunRequiredStepCount =
        propagateKeys.length > 0
          ? await this.propagator(propagateKeys, tx, (fn) => afterCommit.push(fn))
          : 0;
      if (inTransaction) await inTransaction(tx, changedKeys);
      return { row, created: !existing, changedKeys, rerunRequiredStepCount, afterCommit };
    });
  }

  /** 설정 트랜잭션 커밋 뒤 전파가 맡긴 일(SSE)을 부른다. 하나가 실패해도 나머지는 부른다 */
  private runAfterCommit(callbacks: readonly (() => void)[]): void {
    for (const fn of callbacks) {
      try {
        fn();
      } catch (error) {
        this.logger.error({ err: error }, '설정 변경 뒤 작업(SSE 등)이 실패했습니다');
      }
    }
  }

  private toReloadError(loaded: LoadedFailed): ApiException {
    if (loaded.kind === 'SAFETY') {
      return new ApiException('SAFETY_SETTING_RELAXATION_REJECTED', {
        message: formatErrorMessage('SAFETY_SETTING_RELAXATION_REJECTED', {
          항목: describeSafetyItems(loaded.violations),
        }),
        fieldErrors: loaded.errors,
        details: { violations: loaded.violations },
      });
    }
    return new ApiException('SETTINGS_SCHEMA_INVALID', {
      message: formatErrorMessage('SETTINGS_SCHEMA_INVALID', {
        위치: describeLocation(loaded.errors),
      }),
      fieldErrors: loaded.errors,
    });
  }

  /** 실패 로그: 칸 경로와 문구만(값·파일 경로 없음) */
  private logFailure(when: string, loaded: LoadedFailed): void {
    const kind = loaded.kind === 'SAFETY' ? '안전 기준 완화' : '형식 오류';
    this.logger.warn(
      { fields: loaded.errors.map((e) => e.field) },
      `설정 파일 검사 실패(${when}, ${kind}) ${loaded.errors.length}건`,
    );
  }
}

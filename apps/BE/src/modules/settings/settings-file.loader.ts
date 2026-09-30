import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { ErrorObject } from 'ajv';
import { AppConfigService } from '../../common/config/app-config.service.js';
import type { FieldError } from '../../common/errors/error-response.js';
import { readDefaultSettingsText } from './defaults/default-settings.js';
import { validateSafetyFloor, type SafetyViolation } from './safety/safety-floor.validator.js';
import { compileSettingsValidator } from './schema/settings.schema.js';
import type { AppSettings } from './schema/settings.types.js';

/**
 * 설정 파일 구성(Proposed, ERD §7.4-1·06-4 §2.1): `APP_DATA_DIR/settings/settings.json` **한 파일**.
 * 템플릿·사전을 따로 나누지 않는다(M2 설정 화면도 같은 파일에 다시 쓴다). `file_manifest`는 여러 파일에 대비해 배열이다.
 */
export const SETTINGS_DIR_NAME = 'settings';
export const SETTINGS_FILE_NAME = 'settings.json';

/** file_manifest 한 줄: 파일 이름(경로 없음)·원문 SHA-256·크기(바이트) */
export interface SettingsFileManifestEntry {
  name: string;
  sha256: string;
  sizeBytes: number;
}

/** 파싱·스키마 오류가 파일 전체에 걸릴 때의 field(JSON Pointer 뿌리) */
export const ROOT_FIELD = '/';

/** 검사 결과. 통과하면 기본값을 채운 설정과 내용 해시를 준다 */
export type SettingsCheckResult =
  | { ok: true; settings: AppSettings; contentSha256: string }
  | { ok: false; kind: 'SCHEMA'; errors: FieldError[] }
  | { ok: false; kind: 'SAFETY'; errors: FieldError[]; violations: SafetyViolation[] };

/** 파일 읽기 + 검사 결과 */
export type SettingsLoadResult = SettingsCheckResult & {
  /** 파일이 없어 기본 템플릿을 복사해 만들었는지 */
  createdFromTemplate: boolean;
  /** 읽은 파일 목록(읽지 못했으면 빈 배열) */
  fileManifest: SettingsFileManifestEntry[];
};

// ── 정규화·해시 ─────────────────────────────────────────────────────────────

/** 키를 정렬한 JSON(공백 없음). 배열 순서는 그대로다. 키 순서·공백만 다른 두 파일은 같은 글자가 된다 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** settings_snapshot.content_sha256: 정규화한 내용(기본값 채운 뒤)의 SHA-256 */
export function settingsContentSha256(settings: AppSettings): string {
  return sha256Hex(canonicalJson(settings));
}

// ── 검사 ────────────────────────────────────────────────────────────────────

const validate = compileSettingsValidator();

/** 비밀값처럼 보이는 키 이름(모르는 키 안내 문구를 바꾼다). 설정 파일은 비밀을 받지 않는다(NFR-02) */
const SECRET_KEY_NAME =
  /(secret|password|passwd|token|cookie|credential|api[-_]?key|access[-_]?key|auth[-_]?key|service[-_]?key|private[-_]?key|client[-_]?id|application[-_]?id)/i;

const TYPE_LABEL: Record<string, string> = {
  number: '숫자',
  integer: '정수',
  string: '글자',
  boolean: 'true·false',
  array: '목록([ ])',
  object: '묶음({ })',
  null: 'null',
};

function pointerEscape(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

function describeTypes(type: unknown): string {
  const list = Array.isArray(type) ? type : String(type).split(',');
  return list.map((t) => TYPE_LABEL[String(t)] ?? String(t)).join(' 또는 ');
}

/** Ajv 오류 하나 → FieldError. 값(rejectedValue)은 넣지 않는다(비밀값이 섞여 있을 수 있다) */
function toFieldError(e: ErrorObject): FieldError {
  const base = e.instancePath;
  const params = e.params as Record<string, unknown>;
  const at = (field: string, message: string): FieldError => ({
    field: field === '' ? ROOT_FIELD : field,
    message,
  });
  switch (e.keyword) {
    case 'additionalProperties': {
      const key = String(params.additionalProperty);
      return at(
        `${base}/${pointerEscape(key)}`,
        SECRET_KEY_NAME.test(key)
          ? '비밀 값(API 키·시크릿·토큰)은 설정 파일에 둘 수 없습니다. 이 키를 지우고, 비밀 값은 시스템 화면에서 키체인에 넣어 주세요.'
          : '알 수 없는 설정 키입니다. 지우거나 이름을 확인해 주세요.',
      );
    }
    case 'required':
      return at(
        `${base}/${pointerEscape(String(params.missingProperty))}`,
        '꼭 있어야 하는 값입니다.',
      );
    case 'type': {
      const types = describeTypes(params.type);
      return at(
        base,
        e.parentSchema?.nullable ? `${types} 또는 null이어야 합니다.` : `${types}여야 합니다.`,
      );
    }
    case 'minimum':
      return at(base, `${String(params.limit)} 이상이어야 합니다.`);
    case 'exclusiveMinimum':
      return at(base, `${String(params.limit)}보다 커야 합니다.`);
    case 'maximum':
      return at(base, `${String(params.limit)} 이하여야 합니다.`);
    case 'exclusiveMaximum':
      return at(base, `${String(params.limit)}보다 작아야 합니다.`);
    case 'multipleOf':
      return at(
        base,
        params.multipleOf === 0.001
          ? '소수는 셋째 자리까지만 쓸 수 있습니다.'
          : `${String(params.multipleOf)}의 배수여야 합니다.`,
      );
    case 'enum': {
      const allowed = (params.allowedValues as unknown[]).map((v) => String(v)).join(', ');
      return at(base, `다음 값 중 하나여야 합니다: ${allowed}.`);
    }
    case 'const':
      return at(base, `'${String(params.allowedValue)}'여야 합니다.`);
    case 'pattern':
      if (base.endsWith('/basisDate')) return at(base, '날짜는 YYYY-MM-DD 모양이어야 합니다.');
      if (base.endsWith('/id')) return at(base, '블록 ID는 대문자·숫자·밑줄(_)로 40자까지 씁니다.');
      if (base.endsWith('/code')) {
        return at(base, '코드는 영문·숫자·밑줄(_)·하이픈(-)·점(.)으로 40자까지 씁니다.');
      }
      return at(base, '모양이 맞지 않습니다.');
    case 'minLength':
      return at(
        base,
        params.limit === 1
          ? '비워 둘 수 없습니다.'
          : `${String(params.limit)}자 이상이어야 합니다.`,
      );
    case 'maxLength':
      return at(base, `${String(params.limit)}자 이하여야 합니다.`);
    case 'minItems':
      return at(base, `항목이 ${String(params.limit)}개 이상이어야 합니다.`);
    case 'maxItems':
      return at(base, `항목은 ${String(params.limit)}개까지입니다.`);
    default:
      return at(base, '형식이 맞지 않습니다.');
  }
}

function dedupe(errors: FieldError[]): FieldError[] {
  const seen = new Set<string>();
  return errors.filter((e) => {
    const key = `${e.field}\n${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 스키마로 볼 수 없는 값끼리의 관계 */
function crossFieldErrors(settings: AppSettings): FieldError[] {
  const out: FieldError[] = [];
  for (const gender of ['MALE', 'FEMALE'] as const) {
    const range = settings.sourcing.targetSizeMm[gender];
    if (range.min > range.max) {
      out.push({
        field: `/sourcing/targetSizeMm/${gender}/min`,
        message: '최소 사이즈가 최대 사이즈보다 클 수 없습니다.',
      });
    }
  }
  const { deliveryDaysMin, deliveryDaysMax } = settings.notice.values;
  if (deliveryDaysMin !== null && deliveryDaysMax !== null && deliveryDaysMin > deliveryDaysMax) {
    out.push({
      field: '/notice/values/deliveryDaysMin',
      message: '배송기간 최소가 최대보다 클 수 없습니다.',
    });
  }
  const seen = new Set<string>();
  settings.notice.blocks.forEach((block, index) => {
    if (seen.has(block.id)) {
      out.push({
        field: `/notice/blocks/${index}/id`,
        message: `블록 ID '${block.id}'가 앞 블록과 겹칩니다.`,
      });
    }
    seen.add(block.id);
  });
  const codes = new Set<string>();
  settings.delivery.dispatchCompanies.forEach((company, index) => {
    if (codes.has(company.code)) {
      out.push({
        field: `/delivery/dispatchCompanies/${index}/code`,
        message: `발송 택배사 코드 '${company.code}'가 앞 줄과 겹칩니다.`,
      });
    }
    codes.add(company.code);
  });
  return out;
}

/** JSON 문법 오류 위치(줄·칸). 파일 내용은 문구에 넣지 않는다 */
function parseErrorMessage(text: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  const lineCol = /line (\d+) column (\d+)/.exec(raw);
  if (lineCol) {
    return `JSON 문법 오류: ${lineCol[1]}번째 줄 ${lineCol[2]}번째 칸 근처를 확인해 주세요.`;
  }
  const position = /position (\d+)/.exec(raw);
  if (position) {
    const before = text.slice(0, Number(position[1]));
    const line = before.split('\n').length;
    const column = before.length - before.lastIndexOf('\n');
    return `JSON 문법 오류: ${line}번째 줄 ${column}번째 칸 근처를 확인해 주세요.`;
  }
  return 'JSON 문법 오류: 파일이 비었거나 끝이 잘렸습니다.';
}

/**
 * 설정 JSON 글자 하나를 검사한다(시작·다시 읽기 공통, 순수 함수).
 * 1) JSON 파싱 2) JSON Schema(Ajv, 오류를 모두 모은다) + 값끼리의 관계 3) 안전 기준 하한.
 * 앞 단계에서 오류가 나면 뒤 단계는 보지 않는다.
 */
export function checkSettingsText(text: string): SettingsCheckResult {
  const source = text.replace(/^\uFEFF/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return {
      ok: false,
      kind: 'SCHEMA',
      errors: [{ field: ROOT_FIELD, message: parseErrorMessage(source, error) }],
    };
  }
  return checkSettingsValue(parsed);
}

/** 파싱한 값을 검사한다(원본은 바꾸지 않는다). 스냅샷 content를 다시 검사할 때도 쓴다 */
export function checkSettingsValue(value: unknown): SettingsCheckResult {
  const data = structuredClone(value);
  if (!validate(data)) {
    return { ok: false, kind: 'SCHEMA', errors: dedupe((validate.errors ?? []).map(toFieldError)) };
  }
  const relation = crossFieldErrors(data);
  if (relation.length > 0) return { ok: false, kind: 'SCHEMA', errors: relation };
  const violations = validateSafetyFloor(data);
  if (violations.length > 0) {
    return {
      ok: false,
      kind: 'SAFETY',
      violations,
      errors: violations.map(({ field, message }) => ({ field, message })),
    };
  }
  return { ok: true, settings: data, contentSha256: settingsContentSha256(data) };
}

// ── 파일 ────────────────────────────────────────────────────────────────────

export function settingsDirPath(appDataDir: string): string {
  return join(appDataDir, SETTINGS_DIR_NAME);
}

export function settingsFilePath(appDataDir: string): string {
  return join(settingsDirPath(appDataDir), SETTINGS_FILE_NAME);
}

/** 설정 JSON 글자(2칸 들여쓰기 + 끝 줄바꿈) */
export function formatSettingsJson(settings: AppSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/**
 * 설정 파일을 원자적으로 쓴다: 같은 폴더의 임시 파일(`.settings.json.<난수>.tmp`)에 쓰고 rename.
 * 쓰다 멈춰도 원래 파일은 그대로다. P1-11(PUT /settings/ai-engine)이 `ai` 섹션을 쓸 때 이 함수를 쓴다.
 * @param content 설정 값 또는 그대로 쓸 글자
 */
export async function writeSettingsFileAtomically(
  appDataDir: string,
  content: AppSettings | string,
): Promise<void> {
  const dir = settingsDirPath(appDataDir);
  await mkdir(dir, { recursive: true });
  const text = typeof content === 'string' ? content : formatSettingsJson(content);
  const tmp = join(dir, `.${SETTINGS_FILE_NAME}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(tmp, settingsFilePath(appDataDir));
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * 설정 파일 로더. 위치는 AppConfigService.appDataDir(테스트는 이 서비스를 바꿔 끼워 임시 폴더를 쓴다).
 * 응답·로그에 파일의 절대 경로를 넣지 않는다(05-1 §1.2).
 */
@Injectable()
export class SettingsFileLoader {
  constructor(private readonly config: AppConfigService) {}

  /**
   * 파일을 읽어 검사한다. 파일이 없으면 기본 템플릿을 복사해 만든 뒤 읽는다(Proposed: 첫 실행 편의.
   * 시작과 다시 읽기가 같다).
   */
  async load(): Promise<SettingsLoadResult> {
    const appDataDir = this.config.appDataDir;
    let createdFromTemplate = false;
    let bytes: Buffer;
    try {
      bytes = await readFile(settingsFilePath(appDataDir));
    } catch (error) {
      if (!isNotFound(error)) return this.unreadable();
      try {
        await writeSettingsFileAtomically(appDataDir, readDefaultSettingsText());
        createdFromTemplate = true;
        bytes = await readFile(settingsFilePath(appDataDir));
      } catch {
        return this.unreadable();
      }
    }
    const fileManifest: SettingsFileManifestEntry[] = [
      { name: SETTINGS_FILE_NAME, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength },
    ];
    return { ...checkSettingsText(bytes.toString('utf8')), createdFromTemplate, fileManifest };
  }

  /** 설정 파일을 원자적으로 쓴다(P1-11용) */
  write(settings: AppSettings): Promise<void> {
    return writeSettingsFileAtomically(this.config.appDataDir, settings);
  }

  private unreadable(): SettingsLoadResult {
    return {
      ok: false,
      kind: 'SCHEMA',
      errors: [
        {
          field: ROOT_FIELD,
          message: `설정 파일(${SETTINGS_DIR_NAME}/${SETTINGS_FILE_NAME})을 읽지 못했습니다. 파일 권한을 확인해 주세요.`,
        },
      ],
      createdFromTemplate: false,
      fileManifest: [],
    };
  }
}

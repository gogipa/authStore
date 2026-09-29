import { Injectable } from '@nestjs/common';
import type { Prisma, UserActionLog } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toKstDateValue } from '../time/kst.js';

/** user_action_log.event_type(CHECK ck_ual_event 11종, ERD §3.13) */
export const USER_ACTION_EVENT_TYPES = [
  'GATE_PASSED',
  'OWNER_CONFIRMED',
  'OWNER_EDITED',
  'CATEGORY_DECISION',
  'SETTING_CHANGED',
  'GATE_ENTERED',
  'SCREEN_ENTERED',
  'SCREEN_LEFT',
  'WINDOW_INACTIVE',
  'WINDOW_ACTIVE',
  'PRODUCT_ACTION',
] as const;
export type UserActionEventType = (typeof USER_ACTION_EVENT_TYPES)[number];

/** gate(CHECK ck_ual_gate) */
export const USER_ACTION_GATES = ['G1', 'G2', 'G3', 'G4', 'G5'] as const;
export type UserActionGate = (typeof USER_ACTION_GATES)[number];

/** step_code(CHECK ck_ual_step_code) */
export const USER_ACTION_STEP_CODES = [
  'SOURCING',
  'PRICING',
  'CATEGORY',
  'THUMBNAIL',
  'COPY',
  'NOTICE_RAW',
  'NOTICE_HTML',
  'TAGS',
  'UPLOAD',
  'REGISTER',
] as const;

/** gate가 꼭 있어야 하는 종류(CHECK ck_ual_gate_required) */
const GATE_REQUIRED: ReadonlySet<string> = new Set(['GATE_ENTERED', 'GATE_PASSED']);

/**
 * detail에 넣지 않는 키(비밀값·경쟁 태그 원문, NFR-02·TG-01). 키 이름으로 막는다. Proposed(06-2 §9).
 * 키 이름을 적는 것(`secretKey: 'COMMERCE_CLIENT_ID'`)은 된다. 값 자체가 비밀인지까지는 알 수 없으므로,
 * 부르는 쪽은 비밀값을 detail에 넣지 않는다.
 */
export const FORBIDDEN_DETAIL_KEYS: readonly RegExp[] = [
  /^(secret|password|passwd|token|cookie|authorization)$/i,
  /client[-_]?secret/i,
  /secret[-_]?(value|sign)/i,
  /(access|refresh|bearer|id|auth)[-_]?token/i,
  /token[-_]?value/i,
  /api[-_]?key/i,
  /access[-_]?key/i,
  /application[-_]?id/i,
  /auth[-_]?key/i,
  /service[-_]?key/i,
  /competitor[-_]?tags?/i,
  /raw[-_]?tags?/i,
];

export function isForbiddenDetailKey(key: string): boolean {
  return FORBIDDEN_DETAIL_KEYS.some((re) => re.test(key));
}

export interface UserActionLogInput {
  eventType: UserActionEventType;
  candidateId?: number | null;
  stepRunId?: number | null;
  registrationId?: number | null;
  stepCode?: (typeof USER_ACTION_STEP_CODES)[number] | null;
  gate?: UserActionGate | null;
  /** 부가 정보(확인 항목 이름, 바뀐 설정 키 등). 비밀값·경쟁 태그 원문 금지 */
  detail?: Record<string, unknown> | null;
  /** 발생 시각. 생략하면 지금. kst_date는 이 값으로 계산한다 */
  occurredAt?: Date;
}

/** 입력이 규칙(CHECK·detail 금지 키)에 맞지 않음(앱 코드의 잘못) */
export class UserActionLogInputError extends Error {
  constructor(readonly violations: string[]) {
    super(`user_action_log 입력 오류: ${violations.join(' / ')}`);
  }
}

/** 입력 검사. 위반 목록(없으면 빈 배열) */
export function validateUserActionLogInput(input: UserActionLogInput): string[] {
  const v: string[] = [];
  if (!(USER_ACTION_EVENT_TYPES as readonly string[]).includes(input.eventType)) {
    v.push(`eventType은 ${USER_ACTION_EVENT_TYPES.join('·')} 중 하나`);
  }
  if (GATE_REQUIRED.has(input.eventType) && !input.gate) {
    v.push(`${input.eventType}에는 gate가 필요하다`);
  }
  if (input.gate && !(USER_ACTION_GATES as readonly string[]).includes(input.gate)) {
    v.push(`gate는 ${USER_ACTION_GATES.join('·')} 중 하나`);
  }
  if (input.stepCode && !(USER_ACTION_STEP_CODES as readonly string[]).includes(input.stepCode)) {
    v.push('stepCode가 단계 코드가 아니다');
  }
  if (input.detail) {
    for (const key of collectKeys(input.detail)) {
      if (isForbiddenDetailKey(key)) v.push(`detail에 넣을 수 없는 키: ${key}`);
    }
  }
  if (input.occurredAt && Number.isNaN(input.occurredAt.getTime())) {
    v.push('occurredAt이 올바른 시각이 아니다');
  }
  return v;
}

function collectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const x of value) collectKeys(x, out);
  } else if (value && typeof value === 'object') {
    for (const [k, x] of Object.entries(value)) {
      out.push(k);
      collectKeys(x, out);
    }
  }
  return out;
}

/**
 * 감사 기록(user_action_log, 추가만). 공개 시그니처(이후 실행 문서가 그대로 쓴다):
 * `record(input, tx?) → UserActionLog`
 * 게이트 통과와 기록이 한 트랜잭션이 되도록 부르는 쪽의 Prisma 트랜잭션 클라이언트를 받는다.
 */
@Injectable()
export class UserActionLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: UserActionLogInput, tx?: Prisma.TransactionClient): Promise<UserActionLog> {
    const violations = validateUserActionLogInput(input);
    if (violations.length > 0) throw new UserActionLogInputError(violations);
    // occurred_at을 앱에서 정해 kst_date와 같은 시각으로 쓴다(DB now()와 0시 경계에서 어긋나지 않게, ck_ual_kst)
    const occurredAt = input.occurredAt ?? new Date();
    const db: Prisma.TransactionClient = tx ?? this.prisma;
    return db.userActionLog.create({
      data: {
        occurredAt,
        kstDate: toKstDateValue(occurredAt),
        eventType: input.eventType,
        candidateId: input.candidateId ?? null,
        stepRunId: input.stepRunId ?? null,
        registrationId: input.registrationId ?? null,
        stepCode: input.stepCode ?? null,
        gate: input.gate ?? null,
        detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { ERROR_CODES, type ErrorCode } from '../../../common/errors/error-codes.js';
import type { Prisma, PurchaseAgencyProfile } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CommerceMetaCacheService } from '../../integrations/commerce-meta/commerce-meta-cache.service.js';
import { SettingsService } from '../settings.service.js';
import type {
  PurchaseAgencyProfileAddressWarningDto,
  PurchaseAgencyProfileDto,
  PurchaseAgencyProfileSaveResultDto,
} from './dto/purchase-agency-profile.dto.js';
import { FIXED_DELIVERY_FEE_KRW } from './profile-fixed-values.js';
import { profileInputKey } from './profile-input-keys.js';
import {
  buildProfileFragment,
  type ProfileRegistrationFragment,
} from './profile-registration-fragment.js';
import { PROFILE_RERUN_PROPAGATOR, type ProfileRerunPropagator } from './profile-rerun.port.js';
import {
  changedProfileFields,
  emptyProfileValues,
  missingFieldsOf,
  normalizeProfileValues,
  type ProfileField,
  profileValuesFromRow,
  type PurchaseAgencyProfileValues,
} from './profile-values.js';

/** 설치본당 1행(ck_pap_singleton) */
export const PROFILE_SINGLETON_KEY = 1;

/** user_action_log SETTING_CHANGED detail의 `setting`(바뀐 키 이름만 남긴다, 값은 넣지 않는다) */
export const PROFILE_AUDIT_SETTING = 'PURCHASE_AGENCY_PROFILE';

/** 읽기 함수가 받는 DB(트랜잭션 안에서도 읽을 수 있게) */
type Db = Prisma.TransactionClient;

/** 주소 경고 문구(Proposed P1-09, 05-2에 문구가 없다) */
const ADDRESS_WARNING_MESSAGE = {
  overseasShippingCommerceAddressbookId: {
    ADDRESSBOOK_NOT_FOUND:
      '해외 출고지 주소록이 최신 동기화에서 사라졌습니다. 다른 해외 주소를 골라 저장해 주세요.',
    ADDRESS_NOT_OVERSEAS:
      '해외 출고지로 고른 주소록이 더는 해외 주소가 아닙니다. 해외 주소를 다시 골라 저장해 주세요.',
  },
  returnCommerceAddressbookId: {
    ADDRESSBOOK_NOT_FOUND:
      '반품·교환지 주소록이 최신 동기화에서 사라졌습니다. 다른 주소를 골라 저장해 주세요.',
  },
} as const;

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** 참조 검사 오류: 봉투 message와 같은 문구를 그 칸의 fieldErrors에도 담는다(화면이 칸을 표시할 수 있게) */
function fieldError(code: ErrorCode, field: ProfileField): ApiException {
  return new ApiException(code, {
    fieldErrors: [{ field, message: ERROR_CODES[code].message }],
    details: { field },
  });
}

/**
 * 구매대행 프로필(F-ST-07~10, purchase_agency_profile 설치본당 1행). SettingsModule이 export한다.
 *
 * 다른 모듈이 쓰는 창구(P3-04 ⑥-3, P4-02 G4 사전 검증, P4-03 ⑨):
 * - `getCurrent()`: 현재 프로필 + `missingFields` + `addressWarnings`(GET 응답과 같은 모양, 행이 없으면 빈 기본값)
 * - `currentValues(db?)`: 값만(단계 실행기 `readInputs`에서 `profileStepInputs(stepCode, values)`로 입력을 낼 때)
 * - `computeMissingFields(values, fields?)`: 비어 있는 필수값(⑥-3은 NOTICE_HTML_REQUIRED_PROFILE_FIELDS로 좁힌다)
 * - `registrationFragment()`: ⑨ 요청 본문의 배송·A/S 조각(`buildProfileFragment`, 주소는 네이버 주소록 번호)
 *
 * 저장(PUT)은 전체 교체다: 정리(빈 문자열 → null) → 참조 검사(주소록·반품 택배사 캐시, 설정의 발송 택배사 목록) →
 * 한 트랜잭션에서 upsert + 재실행 필요 전파(바뀐 키만) + 감사 기록. 같은 값이면 아무것도 쓰지 않는다.
 * 주소록·반품 택배사는 P1-08 `CommerceMetaCacheService`로만 읽는다(settings → integrations, C4 §3 Proposed).
 */
@Injectable()
export class PurchaseAgencyProfileService {
  private readonly logger = new Logger(PurchaseAgencyProfileService.name);
  private propagator: ProfileRerunPropagator;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CommerceMetaCacheService,
    private readonly settings: SettingsService,
    private readonly audit: UserActionLogService,
    @Inject(PROFILE_RERUN_PROPAGATOR) propagator: ProfileRerunPropagator,
  ) {
    this.propagator = propagator;
  }

  /**
   * 재실행 필요 전파를 바꿔 끼운다(P1-05 step-engine `PropagationService.onModuleInit`). settings가 step-engine을
   * import하지 않고도 전파를 부를 수 있게 둔 창구다(설정 변경의 `SettingsService.setRerunPropagator`와 같다).
   */
  setRerunPropagator(propagator: ProfileRerunPropagator): void {
    this.propagator = propagator;
  }

  // ── 읽기 ─────────────────────────────────────────────────────────────────

  /** GET /purchase-agency-profile: 현재 프로필(행이 없으면 빈 기본값) + 빈 필수값 + 주소 경고 */
  async getCurrent(): Promise<PurchaseAgencyProfileDto> {
    return this.toView(await this.findRow(this.prisma));
  }

  /** 현재 프로필 값(행이 없으면 빈 기본값). 트랜잭션 안에서 읽으려면 `db`를 준다 */
  async currentValues(db: Db = this.prisma): Promise<PurchaseAgencyProfileValues> {
    const row = await this.findRow(db);
    return row ? profileValuesFromRow(row) : emptyProfileValues();
  }

  /** 비어 있는 필수값 이름(기본 PROFILE_REQUIRED_FIELDS 순서). 빈칸이 있어도 저장은 된다 */
  computeMissingFields(
    values: PurchaseAgencyProfileValues,
    fields?: readonly ProfileField[],
  ): ProfileField[] {
    return missingFieldsOf(values, fields);
  }

  /**
   * 프로필이 가리키는 주소록의 경고(막지 않음, 05-2 PurchaseAgencyProfileAddressWarning): 최신 동기화에서 사라졌으면
   * ADDRESSBOOK_NOT_FOUND, 해외 출고지가 더는 해외 주소가 아니면 ADDRESS_NOT_OVERSEAS.
   */
  async computeAddressWarnings(
    values: PurchaseAgencyProfileValues,
  ): Promise<PurchaseAgencyProfileAddressWarningDto[]> {
    const warnings: PurchaseAgencyProfileAddressWarningDto[] = [];
    const shippingId = values.overseasShippingCommerceAddressbookId;
    if (shippingId !== null) {
      const row = await this.cache.findAddressbook(shippingId);
      const messages = ADDRESS_WARNING_MESSAGE.overseasShippingCommerceAddressbookId;
      if (!row || row.removedAt !== null) {
        warnings.push({
          field: 'overseasShippingCommerceAddressbookId',
          code: 'ADDRESSBOOK_NOT_FOUND',
          message: messages.ADDRESSBOOK_NOT_FOUND,
        });
      } else if (!row.isOverseas) {
        warnings.push({
          field: 'overseasShippingCommerceAddressbookId',
          code: 'ADDRESS_NOT_OVERSEAS',
          message: messages.ADDRESS_NOT_OVERSEAS,
        });
      }
    }
    const returnId = values.returnCommerceAddressbookId;
    if (returnId !== null) {
      const row = await this.cache.findAddressbook(returnId);
      if (!row || row.removedAt !== null) {
        warnings.push({
          field: 'returnCommerceAddressbookId',
          code: 'ADDRESSBOOK_NOT_FOUND',
          message: ADDRESS_WARNING_MESSAGE.returnCommerceAddressbookId.ADDRESSBOOK_NOT_FOUND,
        });
      }
    }
    return warnings;
  }

  /**
   * ⑨ 요청 본문의 배송·A/S 조각(P4-03). 현재 프로필과 그 프로필이 가리키는 주소록·반품 택배사 캐시 행으로 만든다.
   * 사라진 행(removed_at)도 번호는 넘긴다 — 막을지는 G4 사전 검증(P4-02)이 `addressWarnings`로 정한다.
   */
  async registrationFragment(): Promise<ProfileRegistrationFragment> {
    const values = await this.currentValues();
    const shipping =
      values.overseasShippingCommerceAddressbookId === null
        ? null
        : await this.cache.findAddressbook(values.overseasShippingCommerceAddressbookId);
    const returnAddress =
      values.returnCommerceAddressbookId === null
        ? null
        : await this.cache.findAddressbook(values.returnCommerceAddressbookId);
    const returnCompany =
      values.commerceReturnDeliveryCompanyId === null
        ? null
        : await this.cache.findReturnDeliveryCompany(values.commerceReturnDeliveryCompanyId);
    return buildProfileFragment(values, { shipping, return: returnAddress }, returnCompany);
  }

  // ── 저장 ─────────────────────────────────────────────────────────────────

  /**
   * PUT /purchase-agency-profile(전체 교체). 값이 바뀐 키만 `profile.<필드>`로 재실행 필요 전파에 넘기고
   * `user_action_log`(SETTING_CHANGED, detail은 바뀐 키 이름만)를 남긴다. 저장·전파·감사 기록은 한 트랜잭션이다
   * (Proposed, 03-2 §4 단계 완료 원칙과 같다). 전파 SSE는 커밋 뒤에 보낸다. 같은 값이면 아무것도 쓰지 않는다.
   * 한 번에 하나씩 돈다(바뀐 키 계산과 쓰기 사이에 다른 저장이 끼지 않게).
   */
  replace(input: PurchaseAgencyProfileValues): Promise<PurchaseAgencyProfileSaveResultDto> {
    return this.serialized(async () => {
      const next = normalizeProfileValues(input);
      await this.assertReferences(next);
      const afterCommit: (() => void)[] = [];
      const outcome = await this.prisma.$transaction(async (tx) => {
        const row = await this.findRow(tx);
        const before = row ? profileValuesFromRow(row) : emptyProfileValues();
        const changed = changedProfileFields(before, next);
        if (changed.length === 0) return { row, changed, rerunRequiredStepCount: 0 };
        const data = {
          ...next,
          noticeFixedTexts: next.noticeFixedTexts as Prisma.InputJsonObject,
          deliveryFeeKrw: FIXED_DELIVERY_FEE_KRW,
        };
        const saved = await tx.purchaseAgencyProfile.upsert({
          where: { singletonKey: PROFILE_SINGLETON_KEY },
          create: { singletonKey: PROFILE_SINGLETON_KEY, ...data },
          update: data,
        });
        const rerunRequiredStepCount = await this.propagator(
          changed.map(profileInputKey),
          tx,
          (fn) => afterCommit.push(fn),
        );
        await this.audit.record(
          {
            eventType: 'SETTING_CHANGED',
            detail: { setting: PROFILE_AUDIT_SETTING, changedKeys: changed },
          },
          tx,
        );
        return { row: saved, changed, rerunRequiredStepCount };
      });
      this.runAfterCommit(afterCommit);
      if (outcome.changed.length > 0) {
        this.logger.log(
          { changedKeys: outcome.changed },
          `구매대행 프로필 저장: 바뀐 키 ${outcome.changed.length}개, 재실행 필요 ${outcome.rerunRequiredStepCount}개`,
        );
      }
      return {
        profile: await this.toView(outcome.row),
        rerunRequiredStepCount: outcome.rerunRequiredStepCount,
      };
    });
  }

  /**
   * 참조 검사(F-ST-08·09): 해외 출고지는 있고(removed_at NULL) 해외 주소여야 한다, 반품·교환지·반품 택배사는 있고
   * 사라지지 않아야 한다, 발송 택배사 코드는 현재 설정 스냅샷의 목록 안이어야 한다(스냅샷이 없으면 503 SETTINGS_INVALID).
   * 칸 순서(05-2 required)대로 보고 첫 오류를 던진다.
   */
  async assertReferences(values: PurchaseAgencyProfileValues): Promise<void> {
    const shippingId = values.overseasShippingCommerceAddressbookId;
    if (shippingId !== null) {
      const row = await this.cache.findAddressbook(shippingId);
      if (!row || row.removedAt !== null) {
        throw fieldError('ADDRESSBOOK_NOT_FOUND', 'overseasShippingCommerceAddressbookId');
      }
      if (!row.isOverseas) {
        throw fieldError('ADDRESS_NOT_OVERSEAS', 'overseasShippingCommerceAddressbookId');
      }
    }
    const returnId = values.returnCommerceAddressbookId;
    if (returnId !== null) {
      const row = await this.cache.findAddressbook(returnId);
      if (!row || row.removedAt !== null) {
        throw fieldError('ADDRESSBOOK_NOT_FOUND', 'returnCommerceAddressbookId');
      }
    }
    const code = values.dispatchDeliveryCompanyCode;
    if (code !== null) {
      const allowed = this.settings.current().delivery.dispatchCompanies;
      if (!allowed.some((company) => company.code === code)) {
        throw fieldError('DELIVERY_COMPANY_NOT_ALLOWED', 'dispatchDeliveryCompanyCode');
      }
    }
    const companyId = values.commerceReturnDeliveryCompanyId;
    if (companyId !== null) {
      const row = await this.cache.findReturnDeliveryCompany(companyId);
      if (!row || row.removedAt !== null) {
        throw fieldError('RETURN_DELIVERY_COMPANY_NOT_FOUND', 'commerceReturnDeliveryCompanyId');
      }
    }
  }

  // ── 내부 ─────────────────────────────────────────────────────────────────

  private findRow(db: Db): Promise<PurchaseAgencyProfile | null> {
    return db.purchaseAgencyProfile.findUnique({ where: { singletonKey: PROFILE_SINGLETON_KEY } });
  }

  private async toView(row: PurchaseAgencyProfile | null): Promise<PurchaseAgencyProfileDto> {
    const values = row ? profileValuesFromRow(row) : emptyProfileValues();
    return {
      id: row?.id ?? null,
      ...values,
      deliveryFeeKrw: FIXED_DELIVERY_FEE_KRW,
      createdAt: iso(row?.createdAt),
      updatedAt: iso(row?.updatedAt),
      missingFields: missingFieldsOf(values),
      addressWarnings: await this.computeAddressWarnings(values),
    };
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** 커밋 뒤 전파가 맡긴 일(SSE)을 부른다. 하나가 실패해도 나머지는 부른다 */
  private runAfterCommit(callbacks: readonly (() => void)[]): void {
    for (const fn of callbacks) {
      try {
        fn();
      } catch (error) {
        this.logger.error({ err: error }, '프로필 저장 뒤 작업(SSE 등)이 실패했습니다');
      }
    }
  }
}

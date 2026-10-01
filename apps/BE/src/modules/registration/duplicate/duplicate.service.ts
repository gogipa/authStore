import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { assertCommerceKeys } from '../../../common/secrets/assert-commerce-keys.js';
import { SECRET_STORE, type SecretStore } from '../../../common/secrets/secret-store.port.js';
import {
  COMMERCE_PRODUCTS_PORT,
  type CommerceProductsCallContext,
  type CommerceProductsPort,
  type SellerCodeSearchResult,
} from '../../integrations/naver-commerce/commerce-products.port.js';
import type { ApprovalInputs } from '../draft/approval-inputs.js';
import type { SellerCodeLookup } from '../pre-validation/pre-validation.types.js';
import { smartstoreProductUrl } from '../register/registration-record.js';

/** 05-2 ApprovalWarning */
export interface ApprovalWarning {
  code: string;
  message: string;
}

/** 05-2 ApprovalDuplicateInfo(P4-03 — source·registeredAt·smartstoreProductUrl을 더했다) */
export interface ApprovalDuplicateInfo {
  duplicated: boolean;
  existingRegistrationId: number | null;
  originProductNo: string | null;
  channelProductNo: string | null;
  /** 어디서 찾았나: LOCAL(이 앱 등록 기록)·COMMERCE_API(SELLER_CODE 조회). 중복이 아니면 null */
  source: 'LOCAL' | 'COMMERCE_API' | null;
  /** 이 앱 기록의 '등록됨' 시각(F-AP-37 — 기존 상품 보기). 모르면 null */
  registeredAt: string | null;
  /** 스마트스토어센터 상품 화면 주소(F-AP-37 — 새 창). 상품 번호를 모르면 null */
  smartstoreProductUrl: string | null;
}

/**
 * 중복 정보(F-AP-36·37 — 순수 함수). 로컬 기록이 먼저이고, 없으면 SELLER_CODE 조회 결과(사전 검증만 — 미리보기는 `sellerCode` 없음)
 */
export function duplicateInfoOf(
  inputs: Pick<ApprovalInputs, 'registrations'>,
  sellerCode: SellerCodeLookup | null = null,
): ApprovalDuplicateInfo {
  const local = inputs.registrations.duplicate;
  if (local) {
    return {
      duplicated: true,
      existingRegistrationId: local.registrationId,
      originProductNo: local.originProductNo,
      channelProductNo: local.channelProductNo,
      source: 'LOCAL',
      registeredAt: local.registeredAt ?? null,
      smartstoreProductUrl: smartstoreProductUrl(local.originProductNo),
    };
  }
  if (sellerCode?.ok && sellerCode.product) {
    return {
      duplicated: true,
      existingRegistrationId: null,
      originProductNo: sellerCode.product.originProductNo,
      channelProductNo: sellerCode.product.channelProductNo,
      source: 'COMMERCE_API',
      registeredAt: null,
      smartstoreProductUrl: smartstoreProductUrl(sellerCode.product.originProductNo),
    };
  }
  return {
    duplicated: false,
    existingRegistrationId: null,
    originProductNo: null,
    channelProductNo: null,
    source: null,
    registeredAt: null,
    smartstoreProductUrl: null,
  };
}

/**
 * 막지 않는 경고(05-3 §5.2 — 순수 함수). `SAME_MODEL_REGISTERED`: 샵(`itemCode`)은 달라도 같은 모델·색상(후보 앵커 型番 +
 * 색상 코드)이 이미 진행 중·등록됨 기록으로 있다(F-AP-38·RG-12 — 05-3 뜻을 이것으로 바로잡았다).
 */
export function approvalWarningsOf(
  inputs: Pick<ApprovalInputs, 'registrations'>,
): ApprovalWarning[] {
  const same = inputs.registrations.sameModel ?? [];
  if (same.length === 0) return [];
  const list = same
    .map(
      (row) => `${row.itemCode}${row.originProductNo ? ` · 상품 번호 ${row.originProductNo}` : ''}`,
    )
    .join(', ');
  return [
    {
      code: 'SAME_MODEL_REGISTERED',
      message: `같은 모델·색상이 다른 샵 상품으로 이미 등록돼 있습니다(${list}). 같은 상품을 두 번 올리지 않는지 확인해 주세요.`,
    },
  ];
}

/**
 * 등록 중복 교차 확인(P4-03 §5 `duplicate/duplicate.service.ts`, F-AP-36, US-22 AC2, 규칙 10). 로컬 확인은 입력 읽기
 * (`ApprovalInputsLoader` — `uq_registration_live_key`와 같은 조건)가 하고, 여기서는 커머스API 상품 검색(SELLER_CODE)을 한다. 끄는
 * 설정은 없다. 승인 화면 사전 검증(`DUPLICATE` 항목)·승인 직전(409 `DUPLICATE_REGISTRATION`)·결과확인 조회가 같은 포트를 쓴다.
 */
@Injectable()
export class DuplicateService {
  private readonly logger = new Logger(DuplicateService.name);

  constructor(
    @Inject(COMMERCE_PRODUCTS_PORT) private readonly products: CommerceProductsPort,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
  ) {}

  /** 사전 검증용: 던지지 않는다(실패는 사유로 — DUPLICATE 항목만 실패). 코드가 없으면 조회하지 않는다(REQUIRED_FIELDS가 막는다) */
  async lookupSellerCode(
    sellerManagementCode: string | null,
    context: CommerceProductsCallContext = {},
  ): Promise<SellerCodeLookup> {
    if (!sellerManagementCode) return { ok: true, product: null };
    try {
      const result = await this.searchSellerCode(sellerManagementCode, context);
      return { ok: true, product: result.product };
    } catch (error) {
      if (error instanceof ApiException) return { ok: false, reason: error.message };
      this.logger.error({ err: error }, '판매자관리코드 조회 중 예상 못 한 오류가 났습니다');
      return { ok: false, reason: '커머스API 상품 조회 중 알 수 없는 오류가 났습니다' };
    }
  }

  /** 결과확인용: 키 없음 409 `SECRET_NOT_CONFIGURED`, 외부 실패 502를 그대로 던진다 */
  async searchSellerCode(
    sellerManagementCode: string,
    context: CommerceProductsCallContext = {},
  ): Promise<SellerCodeSearchResult> {
    await assertCommerceKeys(this.secrets);
    return this.products.searchProductsBySellerCode(sellerManagementCode, context);
  }
}

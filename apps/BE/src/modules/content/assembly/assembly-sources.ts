import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  NOTICE_HTML_REQUIRED_PROFILE_FIELDS,
  missingFieldsOf,
  type PurchaseAgencyProfileValues,
} from '../../settings/purchase-agency-profile/profile-values.js';
import type { NoticeSettings } from '../../settings/schema/settings.types.js';
import type { SourcingItemContentView } from '../../step-engine/ports/sourcing-selection.port.js';
import { flattenAttributes } from '../content-sources.js';
import { isCopyDraft, type CopyDraft } from '../copy/copy.schema.js';
import { fieldsOf } from '../fields/content-field.store.js';
import { assemblyFactsOf, type AssemblyFacts } from './assembly-facts.js';
import type { AssemblyProfile } from './assemble.js';
import { compareKey } from '../facts/fact-text.js';
import { BRAND_ATTRIBUTE_NAMES, isParallelImport } from './product-name/product-name.builder.js';

type Db = Prisma.TransactionClient;

/**
 * ⑥-3 입력 읽기(P3-04 규칙 1 — 시작 조건). ⑥-1·⑥-2는 같은 모듈 산출물이라 표를 직접 읽고, ②·③은 step-engine 창구로, 프로필은
 * settings 서비스로 읽는다(03-ADR-003·C4 §3).
 */

/** ⑥-1 유효 카피(content_draft_copy.copy). 없거나 모양이 다르면 null */
export async function readCopyDoc(db: Db, copyStepRunId: number): Promise<CopyDraft | null> {
  const row = await db.contentDraftCopy.findUnique({ where: { stepRunId: copyStepRunId } });
  return row && isCopyDraft(row.copy) ? row.copy : null;
}

/** ⑥-2 결과(사실 필드 유효 값 + 선택 색상 원문). 산출물이 없으면 null */
export async function readAssemblyFacts(
  db: Db,
  factStepRunId: number,
): Promise<AssemblyFacts | null> {
  const head = await db.contentDraftFact.findUnique({ where: { stepRunId: factStepRunId } });
  if (!head) return null;
  return assemblyFactsOf(await fieldsOf(db, factStepRunId), head.selectedColorRaw);
}

/** 상품명 재료 가운데 ②에서 오는 값(입력 `sourcing.modelInfo`) */
export interface SourcingModelInfo {
  modelCode: string | null;
  parallelImport: boolean;
  brandAttribute: string | null;
}

/** ② 속성의 브랜드 값(원문, NFKC 정리) */
export function brandAttributeOf(content: SourcingItemContentView): string | null {
  const names = new Set(BRAND_ATTRIBUTE_NAMES.map(compareKey));
  const attr = flattenAttributes(content.itemAttributes, content.skuAttributes).find((a) =>
    names.has(compareKey(a.name)),
  );
  const text = attr?.text.normalize('NFKC').trim();
  return text ? text.slice(0, 100) : null;
}

export function modelInfoOf(content: SourcingItemContentView): SourcingModelInfo {
  return {
    modelCode: content.modelCode?.trim() ? content.modelCode.trim() : null,
    parallelImport: isParallelImport(content.itemName),
    brandAttribute: brandAttributeOf(content),
  };
}

/** 후보의 ① 선택 키워드 글(키워드 후보만). 없으면 null */
export async function keywordOf(db: Db, sourceKeywordId: number | null): Promise<string | null> {
  if (sourceKeywordId === null) return null;
  const keyword = await db.keyword.findUnique({
    where: { id: sourceKeywordId },
    select: { keyword: true },
  });
  return keyword?.keyword ?? null;
}

/** ⑥-3이 더 보는 빈칸(Proposed): 고지 `{반품비}`를 채울 프로필 반품비 */
export const ASSEMBLY_EXTRA_PROFILE_FIELDS = ['returnFeeKrw'] as const;

/** 빈칸 이름 → 화면 이름(`PROFILE_INCOMPLETE` {항목}) */
export const ASSEMBLY_MISSING_LABEL: Readonly<Record<string, string>> = {
  businessName: '상호',
  afterServicePhone: 'A/S 연락처',
  afterServiceGuide: 'A/S 안내',
  importer: '수입자',
  returnFeeKrw: '반품비',
  'notice.values.deliveryDaysMin': '배송기간 최소(설정 파일)',
  'notice.values.deliveryDaysMax': '배송기간 최대(설정 파일)',
};

/**
 * ⑥-3 시작 전 빈칸(규칙 2, F-CT-24 — P1-09 `NOTICE_HTML_REQUIRED_PROFILE_FIELDS` 상호·A/S 연락처·A/S 안내·수입자). 고지 템플릿을
 * 채울 수 없는 값도 함께 본다(Proposed): 프로필 반품비(`{반품비}`), 설정 `notice.values.deliveryDaysMin·Max`(`{배송기간_*}` —
 * F-BS-03 개인 값이라 기본 템플릿은 null, 코드 기본값을 두지 않는다)
 */
export function assemblyMissingFields(
  profile: PurchaseAgencyProfileValues,
  notice: Pick<NoticeSettings, 'values'>,
): string[] {
  const missing: string[] = missingFieldsOf(profile, [
    ...NOTICE_HTML_REQUIRED_PROFILE_FIELDS,
    ...ASSEMBLY_EXTRA_PROFILE_FIELDS,
  ]);
  if (notice.values.deliveryDaysMin === null) missing.push('notice.values.deliveryDaysMin');
  if (notice.values.deliveryDaysMax === null) missing.push('notice.values.deliveryDaysMax');
  return missing;
}

/** 409 PROFILE_INCOMPLETE(`details.missingFields`, 화면은 설정 프로필 링크) */
export function profileIncomplete(missing: readonly string[]): ApiException {
  return new ApiException('PROFILE_INCOMPLETE', {
    message: formatErrorMessage('PROFILE_INCOMPLETE', {
      항목: missing.map((field) => ASSEMBLY_MISSING_LABEL[field] ?? field).join(', '),
    }),
    details: { missingFields: [...missing], settingsPath: '/settings' },
  });
}

/** 빈칸 검사를 통과한 프로필 → 조립 값(빈칸이면 null) */
export function assemblyProfileOf(values: PurchaseAgencyProfileValues): AssemblyProfile | null {
  if (
    !values.businessName ||
    !values.afterServicePhone ||
    !values.afterServiceGuide ||
    !values.importer ||
    values.returnFeeKrw === null
  ) {
    return null;
  }
  return {
    businessName: values.businessName,
    afterServicePhone: values.afterServicePhone,
    afterServiceGuide: values.afterServiceGuide,
    importer: values.importer,
    returnFeeKrw: values.returnFeeKrw,
    maxPurchaseQuantityPerOrder: values.maxPurchaseQuantityPerOrder,
    noticeFixedTexts: { ...values.noticeFixedTexts },
  };
}

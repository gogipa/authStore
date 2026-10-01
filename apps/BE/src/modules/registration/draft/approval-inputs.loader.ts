import { Injectable } from '@nestjs/common';
import type { Candidate } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CommerceMetaCacheService } from '../../integrations/commerce-meta/commerce-meta-cache.service.js';
import { ProfileFragmentError } from '../../settings/purchase-agency-profile/profile-registration-fragment.js';
import { PurchaseAgencyProfileService } from '../../settings/purchase-agency-profile/purchase-agency-profile.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import type { Db } from '../../step-engine/candidates/step-engine-tx.js';
import type { StepCode, StepStatus } from '../../step-engine/domain/steps.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import { imageSourcesOf } from '../pre-validation/checks/check-helpers.js';
import { readUploadResult } from '../upload/upload-result.store.js';
import type {
  ApprovalInputs,
  ApprovalRegistrationsInput,
  ApprovalUploadInput,
} from './approval-inputs.js';

/** 진행 중·등록됨 등록 기록 상태(`uq_registration_live_key`·처음 N건 셈 — failed_at 없음과 함께) */
export const LIVE_REGISTRATION_STATUSES = ['REGISTERING', 'RESULT_CHECK_REQUIRED', 'REGISTERED'];
/** 이 후보의 '진행 중' 기록(등록요청중·결과확인필요, failed_at 없음 — 05-3 REGISTRATION_IN_PROGRESS) */
export const IN_PROGRESS_REGISTRATION_STATUSES = ['REGISTERING', 'RESULT_CHECK_REQUIRED'];
/** 원천 사슬(derived_from)을 따라갈 최대 깊이(업로드본 → 생성본 → … — 순환 방지) */
const DERIVATION_DEPTH_MAX = 10;

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

/**
 * 최종 승인 입력 읽기(P4-02 §5 `approval-inputs.loader.ts`). 후보 1건의 **현재 버전** 산출물(③④⑤⑥⑦⑧)과 프로필·설정·등록 기록을 읽어
 * 순수 데이터(`ApprovalInputs`)로 만든다. 앞 단계 산출물은 step-engine이 주는 현재 버전 포인터(`candidate_step.current_step_run_id`)로
 * 찾아 step-engine 읽기 창구(`StepEngineApi.read…` — 각 단계 모듈이 등록)로만 읽고, 다른 단계 모듈의 서비스·표를 직접 부르지
 * 않는다(03-ADR-003). 이미지 메타(`image_asset`)는 common 표, 등록 기록·업로드 산출물은 registration 표다. 외부 호출은 없다.
 */
@Injectable()
export class ApprovalInputsLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly api: StepEngineApi,
    private readonly settings: SettingsService,
    private readonly profiles: PurchaseAgencyProfileService,
    private readonly meta: CommerceMetaCacheService,
  ) {}

  async load(candidate: Candidate, db: Db = this.prisma): Promise<ApprovalInputs> {
    const settings = this.settings.current();
    const stepRows = await db.candidateStep.findMany({
      where: { candidateId: candidate.id },
      select: { stepCode: true, status: true, currentStepRunId: true },
    });
    const steps: ApprovalInputs['steps'] = {};
    for (const row of stepRows) {
      steps[row.stepCode as StepCode] = {
        status: row.status as StepStatus,
        currentStepRunId: row.currentStepRunId,
      };
    }
    const runOf = (code: StepCode) => steps[code]?.currentStepRunId ?? null;
    const [g2, g3] = await Promise.all([
      this.api.gateState(candidate.id, 'G2', db),
      this.api.gateState(candidate.id, 'G3', db),
    ]);
    const gate = (state: typeof g2) => ({
      valid: state.valid,
      passedAt: iso(state.passedAt),
      changedBasisKeys: state.changedBasisKeys,
    });

    const sourcing = await this.loadSourcing(candidate, runOf('SOURCING'), db);
    const pricingRun = runOf('PRICING');
    const judgement = pricingRun ? await this.api.readPricingJudgement(pricingRun, db) : null;
    const categoryRun = runOf('CATEGORY');
    const category = categoryRun ? await this.api.readCategoryDecision(categoryRun, db) : null;
    const leaf = candidate.leafCategoryId
      ? await this.meta.findCategory(candidate.leafCategoryId)
      : null;
    const thumbnailRun = runOf('THUMBNAIL');
    const thumbnail = thumbnailRun
      ? await this.api.readThumbnailSelectionDetail(thumbnailRun, db)
      : null;
    const copyRun = runOf('COPY');
    const copy = copyRun ? await this.api.readContentCopy(copyRun, db) : null;
    const factsRun = runOf('NOTICE_RAW');
    const facts = factsRun ? await this.api.readContentFacts(factsRun, db) : null;
    const assemblyRun = runOf('NOTICE_HTML');
    const assembly = assemblyRun ? await this.api.readContentAssembly(assemblyRun, db) : null;
    const tagsRun = runOf('TAGS');
    const tags = tagsRun ? await this.api.readFinalTags(tagsRun, db) : null;
    const upload = await this.loadUpload(runOf('UPLOAD'), db);
    const knownUploadUrls = await this.knownUploadUrls(upload, db);
    const profile = await this.loadProfile();
    const registrations = await this.loadRegistrations(candidate, db);
    const switchRow = await db.registrationSwitch.findUnique({ where: { singletonKey: 1 } });

    return {
      candidate: {
        id: candidate.id,
        status: candidate.status,
        creationPath: candidate.creationPath,
        itemCode: candidate.itemCode,
        selectedColor: candidate.selectedColor,
        anchorModelCode: candidate.anchorModelCode,
        anchorItemCode: candidate.anchorItemCode,
        anchorColorCode: candidate.anchorColorCode,
        gender:
          candidate.gender === 'MALE' || candidate.gender === 'FEMALE' ? candidate.gender : null,
        leafCategoryId: candidate.leafCategoryId,
        wholeCategoryName: candidate.wholeCategoryName,
        noComparisonConfirmedAt: iso(candidate.noComparisonConfirmedAt),
      },
      steps,
      gates: { G2: gate(g2), G3: gate(g3) },
      sourcing,
      judgement: judgement
        ? {
            ...judgement,
            rakutenPageCollectedAt: iso(judgement.rakutenPageCollectedAt),
            judgedAt: judgement.judgedAt.toISOString(),
            sizes: judgement.sizes.map(({ rakutenSkuId: _sku, ...size }) => size),
          }
        : null,
      category: category
        ? {
            categoryStepRunId: category.categoryStepRunId,
            leafCategoryId: category.leafCategoryId,
            wholeCategoryName: category.wholeCategoryName,
            genderPathMatch: category.genderPathMatch,
            exceptionDecision: category.exceptionDecision,
            certificationExcludeContent: category.certificationExcludeContent ?? null,
            kcExemptAdultConfirmedAt: iso(category.kcExemptAdultConfirmedAt),
          }
        : null,
      categoryLeaf: { exists: leaf !== null, removed: leaf?.removedAt != null },
      thumbnail: thumbnail
        ? {
            thumbnailStepRunId: thumbnail.thumbnailStepRunId,
            uncheckedChecklistKeys: thumbnail.uncheckedChecklistKeys,
            sameProductColorConfirmedAt: iso(thumbnail.sameProductColorConfirmedAt),
            references: thumbnail.references,
          }
        : null,
      copy,
      facts: facts
        ? {
            noticeRawStepRunId: facts.noticeRawStepRunId,
            origin: facts.origin
              ? {
                  countries: facts.origin.countries,
                  valueSource: facts.origin.valueSource,
                  extractionMethod: facts.origin.extractionMethod,
                  evidenceUrl: facts.origin.evidenceUrl,
                  basisItemCode: facts.origin.basisItemCode,
                }
              : null,
            materials: facts.materials,
            rechecks: facts.rechecks,
          }
        : null,
      assembly,
      tags,
      upload,
      knownUploadUrls,
      profile,
      settings: {
        judgementValidityHours: settings.safety.judgementValidityHours,
        minBlockWords: [...settings.safety.minBlockWords],
        originConfusionWords: [...settings.safety.originConfusionWords],
        extraChargeWords: [...settings.safety.extraChargeWords],
        notice: {
          blocks: settings.notice.blocks.map((block) => ({ ...block })),
          leatherTerms: [...settings.notice.leatherTerms],
          aiImageLabel: settings.notice.aiImageLabel,
        },
        initialSuspensionCount: settings.registration.initialSuspensionCount,
        optionStockCap: settings.registration.optionStockCap,
      },
      registrations,
      apiBlocked: switchRow?.apiBlocked ?? true,
    };
  }

  /** ② 현재 버전의 소싱 선택과 목표 사이즈 재고 칸(성별을 모르면 칸 없음) */
  private async loadSourcing(
    candidate: Candidate,
    sourcingStepRunId: number | null,
    db: Db,
  ): Promise<ApprovalInputs['sourcing']> {
    if (sourcingStepRunId === null) return null;
    const selection = await this.api.readSourcingSelection(sourcingStepRunId, db);
    if (!selection) return null;
    const gender =
      candidate.gender === 'MALE' || candidate.gender === 'FEMALE' ? candidate.gender : null;
    const target = gender
      ? await this.api.readSourcingTargetSkus(sourcingStepRunId, gender, db)
      : null;
    return {
      sourcingStepRunId,
      comparisonPerformed: selection.comparisonPerformed,
      itemCode: selection.itemCode,
      itemUrl: selection.itemUrl,
      sizes: (target?.sizes ?? []).map((size) => ({
        sizeMm: size.sizeMm,
        status: size.status,
        quantity: size.quantity ?? null,
      })),
    };
  }

  /** ⑧ 현재 버전 산출물 + 업로드본 크기·원천 사슬의 참조 전용 여부 */
  private async loadUpload(
    uploadStepRunId: number | null,
    db: Db,
  ): Promise<ApprovalUploadInput | null> {
    if (uploadStepRunId === null) return null;
    const result = await readUploadResult(db, uploadStepRunId);
    if (!result) return null;
    const images = [];
    for (const image of result.images) {
      const assetId = image.uploadedImage.imageAssetId;
      const chain = await this.derivationChain(assetId, db);
      const asset = chain[0];
      images.push({
        role:
          image.role === 'REPRESENTATIVE' ? ('REPRESENTATIVE' as const) : ('ADDITIONAL' as const),
        sortOrder: image.sortOrder,
        url: image.uploadedImage.url,
        uploadedImageId: image.uploadedImageId,
        imageAssetId: assetId,
        width: asset?.width ?? 0,
        height: asset?.height ?? 0,
        referenceOnlyInChain: chain.some((row) => row.usageRight === 'REFERENCE_ONLY'),
      });
    }
    return {
      uploadResultId: result.id,
      uploadStepRunId,
      detailContent: result.detailContent,
      images,
    };
  }

  /** 업로드본에서 원천까지(derived_from) image_asset 행(첫 원소 = 업로드본) */
  private async derivationChain(
    imageAssetId: number,
    db: Db,
  ): Promise<{ id: number; width: number; height: number; usageRight: string }[]> {
    const out: { id: number; width: number; height: number; usageRight: string }[] = [];
    let next: number | null = imageAssetId;
    while (next !== null && out.length < DERIVATION_DEPTH_MAX) {
      const row: {
        id: number;
        width: number;
        height: number;
        usageRight: string;
        derivedFromImageAssetId: number | null;
      } | null = await db.imageAsset.findUnique({
        where: { id: next },
        select: {
          id: true,
          width: true,
          height: true,
          usageRight: true,
          derivedFromImageAssetId: true,
        },
      });
      if (!row || out.some((seen) => seen.id === row.id)) break;
      out.push(row);
      next = row.derivedFromImageAssetId;
    }
    return out;
  }

  /** 요청 초안·최종 본문의 이미지 URL 가운데 `uploaded_image.url`에 있는 것(UNIQUE url 역조회) */
  private async knownUploadUrls(upload: ApprovalUploadInput | null, db: Db): Promise<string[]> {
    if (!upload) return [];
    const urls = [
      ...new Set([...upload.images.map((i) => i.url), ...imageSourcesOf(upload.detailContent)]),
    ];
    if (urls.length === 0) return [];
    const rows = await db.uploadedImage.findMany({
      where: { url: { in: urls } },
      select: { url: true },
    });
    return rows.map((row) => row.url);
  }

  /** ⑨ 요청 배송·A/S 조각(P1-09). 만들지 못하면 이유만(사전 검증 REQUIRED_FIELDS가 막는다) */
  private async loadProfile(): Promise<ApprovalInputs['profile']> {
    try {
      return { fragment: await this.profiles.registrationFragment(), fragmentError: null };
    } catch (error) {
      if (error instanceof ProfileFragmentError)
        return { fragment: null, fragmentError: error.message };
      throw error;
    }
  }

  private async loadRegistrations(
    candidate: Candidate,
    db: Db,
  ): Promise<ApprovalRegistrationsInput> {
    const liveCount = await db.registration.count({
      where: { status: { in: LIVE_REGISTRATION_STATUSES }, failedAt: null },
    });
    const inProgress = await db.registration.findFirst({
      where: {
        stepRun: { candidateId: candidate.id },
        status: { in: IN_PROGRESS_REGISTRATION_STATUSES },
        failedAt: null,
      },
      orderBy: { id: 'desc' },
      select: { id: true, status: true },
    });
    const duplicate =
      candidate.itemCode && candidate.selectedColor
        ? await db.registration.findFirst({
            where: {
              itemCode: candidate.itemCode,
              selectedColor: candidate.selectedColor,
              status: { in: LIVE_REGISTRATION_STATUSES },
              failedAt: null,
            },
            orderBy: { id: 'desc' },
            select: { id: true, status: true, originProductNo: true, channelProductNo: true },
          })
        : null;
    return {
      liveCount,
      inProgress: inProgress ? { registrationId: inProgress.id, status: inProgress.status } : null,
      duplicate: duplicate
        ? {
            registrationId: duplicate.id,
            status: duplicate.status,
            originProductNo: duplicate.originProductNo,
            channelProductNo: duplicate.channelProductNo,
          }
        : null,
    };
  }
}

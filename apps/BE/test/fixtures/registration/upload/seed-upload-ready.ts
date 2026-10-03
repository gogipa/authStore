import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ImageAssetsService } from '../../../../src/common/files/image-assets.service.js';
import type { Candidate, ImageAsset, Prisma } from '../../../../src/generated/prisma/client.js';
import { SettingsService } from '../../../../src/modules/settings/settings.service.js';
import type { StepCode } from '../../../../src/modules/step-engine/domain/steps.js';
import { GateValidityService } from '../../../../src/modules/step-engine/gates/gate-validity.service.js';
import {
  inputContextOf,
  loadStepRows,
  readResolvedInputs,
} from '../../../../src/modules/step-engine/execution/step-run-store.js';
import { StepRunnerRegistry } from '../../../../src/modules/step-engine/runner/step-runner.registry.js';
import type { PrismaService } from '../../../../src/prisma/prisma.service.js';
import { truncate, type TestApp } from '../../../helpers/test-app.js';
import { createCandidate } from '../../step-engine/candidate.factory.js';
import { insertStepRun, type StepRunInputFixture } from '../../step-engine/step-run.factory.js';
import { SOURCING_SNAPSHOT_TABLES, STEP_ENGINE_TABLES } from '../../step-engine/truncate.js';

/**
 * ⑧ 업로드 e2e 시드(P4-01 §5 fixtures `seed-upload-ready.ts`). 후보 + ⑤ 완료(G3 통과, 선택본 2장 — 대표 PNG 1024·추가는 이름만
 * .jpg인 WebP) + ⑥-3 완료(자리표시자 HTML)를 Prisma INSERT로 심는다. 닫힌 step_run은 UPDATE하지 않는다(새 행만 넣는다).
 * - 선택본 이미지는 실제 파일이 있어야 한다(⑧이 읽어 정규화한다) — P1-01 `ImageAssetsService.saveImage`로 GENERATED를 넣는다
 * - ⑤ 버전에는 생성 시도(`generation_run` SUCCEEDED)를 둔다 — 같은 버전 생성본으로 G3을 다시 고를 수 있게(⑤ 다시 고르기 e2e)
 * - G3 통과 기록은 실제 G3 공급자(thumbnails)로 지문을 계산해 넣는다(`seedG3Pass` — 통과 시각은 가짜 시계 시작보다 1분 앞이라
 *   테스트 안의 G3 다시 고르기가 '최신 통과'가 된다)
 * - ⑥-1·⑦은 '완료'로 둔다(⑧이 재실행 필요가 될 때 그대로인지 본다). ⑥-3의 다른 값(고시·고지)은 자리 채우기 값이다
 * - 심은 ⑤·⑥-3 버전에는 **지금 운영 실행기가 읽는 입력**(값 해시)을 그대로 남긴다(`currentInputsOf`). 그래야 G3 다시 고르기·⑥-3
 *   이전 버전 다시 고르기가 만드는 오너 수정 새 버전이 '입력이 그대로'로 완료되고, 엔진이 직접 읽는 ⑧로 재실행 필요를 전파한다
 * 실제 상품·이미지가 아니다(단색 블록 그림).
 */

export const UPLOAD_FIXTURE_DIR = import.meta.dirname;

export function uploadSeedBytes(name: string): Buffer {
  return readFileSync(join(UPLOAD_FIXTURE_DIR, name));
}

/** fixture 자리표시자 HTML(P3-04 ⑥-3 출력 모양 — 10칸·고지 블록) */
export function placeholderHtml(): string {
  return readFileSync(join(UPLOAD_FIXTURE_DIR, 'html-with-placeholders.html'), 'utf8');
}

export interface UploadReadyOptions {
  /** G3 통과 기록을 남길지(기본 true) */
  passG3?: boolean;
  /** 선택본 추가 자리에 라쿠텐 원본(참조 전용)을 억지로 넣는다(규칙 5 e2e) */
  withOriginal?: boolean;
  /** ⑥-3 HTML(기본 fixture) */
  html?: string;
}

export interface UploadReadySeed {
  candidate: Candidate;
  thumbnailStepRunId: number;
  noticeHtmlStepRunId: number;
  /** 선택본 원천(sort_order 순) */
  images: ImageAsset[];
  html: string;
}

const AT = new Date('2026-09-28T00:00:00Z');

/**
 * 이 후보에서 운영 실행기(`stepCode`)가 지금 읽는 입력(값 포함)을 심을 행 모양으로. 값이 없는 선택 PREV_STEP 입력은 엔진처럼
 * 행을 남기지 않는다(`ck_step_run_input_prev`)
 */
export async function currentInputsOf(
  t: TestApp,
  candidateId: number,
  stepCode: StepCode,
): Promise<StepRunInputFixture[]> {
  const runner = t.app.get(StepRunnerRegistry).get(stepCode);
  if (!runner) throw new Error(`${stepCode} 실행기가 없습니다`);
  const candidate = await t.prisma.candidate.findUniqueOrThrow({ where: { id: candidateId } });
  const rows = await loadStepRows(t.prisma, candidateId);
  const inputs = await readResolvedInputs(
    runner,
    inputContextOf(t.prisma, candidate, t.app.get(SettingsService).current(), rows),
  );
  return inputs
    .filter((input) => !(input.sourceType === 'PREV_STEP' && input.sourceStepRunId == null))
    .map((input) => ({
      inputKey: input.inputKey,
      sourceType: input.sourceType,
      sourceStepRunId: input.sourceStepRunId ?? null,
      isStartCondition: input.isStartCondition,
      value: input.value,
    }));
}

/**
 * ⑥-3 완료 버전 하나(content_draft_assembly — HTML 말고는 자리 채우기 값, 입력은 지금 ⑥-3 실행기가 읽는 값). makeCurrent면
 * 현재 버전
 */
export async function insertNoticeHtmlVersion(
  t: TestApp,
  candidateId: number,
  html: string,
  makeCurrent = true,
): Promise<number> {
  const prisma = t.prisma;
  const run = await insertStepRun(prisma, {
    candidateId,
    stepCode: 'NOTICE_HTML',
    status: 'COMPLETED',
    makeCurrent,
    inputs: await currentInputsOf(t, candidateId, 'NOTICE_HTML'),
  });
  await prisma.contentDraftAssembly.create({
    data: {
      stepRunId: run.id,
      productName: '아식스 젤카야노14 러닝화 크림 남성(fixture)',
      noticeFields: { material: '겉감 메시 / 안감 정보 없음 / 밑창 고무' },
      noticeSizesMm: [250, 255, 260],
      originAreaCode: '0200037',
      originAreaPlural: false,
      originAreaContent: null,
      importer: '[내 상호]',
      specBlockHtml: '<ul data-autostore-spec="v1"></ul>',
      specOriginLabel: '베트남',
      disclosureTemplateVersion: 'M1-2026-09-24',
      disclosureTemplateDate: new Date('2026-09-24T00:00:00Z'),
      disclosureBlockIds: ['AGENCY'],
      disclosureBlocks: [],
      html,
      htmlSha256: createHash('sha256').update(html, 'utf8').digest('hex'),
    },
  });
  return run.id;
}

/** G3 통과 기록(지문 = 실제 G3 공급자가 지금 값으로 계산) */
export async function seedG3Pass(
  t: TestApp,
  candidateId: number,
  thumbnailStepRunId: number,
): Promise<number> {
  const computed = await t.app
    .get(GateValidityService)
    .basisOf(t.prisma, candidateId, 'G3', thumbnailStepRunId);
  if (!computed) throw new Error('G3 공급자가 없습니다');
  const row = await t.prisma.gatePass.create({
    data: {
      candidateId,
      gate: 'G3',
      fingerprint: computed.fingerprint,
      fingerprintBasis: computed.basis as Prisma.InputJsonObject,
      basisStepRunId: thumbnailStepRunId,
      basisStepCode: 'THUMBNAIL',
      passedAt: new Date(AT.getTime() - 60_000),
    },
  });
  return row.id;
}

export async function seedUploadReady(
  t: TestApp,
  options: UploadReadyOptions = {},
): Promise<UploadReadySeed> {
  const { candidate } = await createCandidate(t.prisma, {
    gender: 'MALE',
    steps: {
      SOURCING: 'COMPLETED',
      COPY: 'COMPLETED',
      NOTICE_RAW: 'COMPLETED',
      TAGS: 'COMPLETED',
    },
  });
  const assets = t.app.get(ImageAssetsService);
  const representative = await assets.saveImage(uploadSeedBytes('gen-1024.png'), {
    kind: 'GENERATED',
    candidateId: candidate.id,
  });
  const additional = options.withOriginal
    ? await assets.saveImage(uploadSeedBytes('gen-portrait.png'), {
        kind: 'ORIGINAL',
        sourceSection: 'PRODUCT_IMAGE',
        sourceUrl: 'https://tshop.r10s.jp/shop-a/cabinet/item/fixture-original.jpg',
        sourceItemCode: 'shop-a:10000123',
        collectedAt: AT,
      })
    : await assets.saveImage(uploadSeedBytes('gen-webp-named.jpg'), {
        kind: 'GENERATED',
        candidateId: candidate.id,
      });
  const images = [representative, additional];

  const thumbnail = await insertStepRun(t.prisma, {
    candidateId: candidate.id,
    stepCode: 'THUMBNAIL',
    status: 'COMPLETED',
    inputs: await currentInputsOf(t, candidate.id, 'THUMBNAIL'),
  });
  for (const [i, image] of images.entries()) {
    if (image.kind !== 'GENERATED') continue;
    await t.prisma.generationRun.create({
      data: {
        stepRunId: thumbnail.id,
        slotNo: i + 1,
        attemptNo: 1,
        triggerType: 'INITIAL',
        prompt: 'fixture prompt',
        faceOption: 'FULL_FACE',
        requestedSizePx: 1024,
        provider: 'AGY',
        model: 'fake-image-gen',
        referenceSetSha256: 'a'.repeat(64),
        status: 'SUCCEEDED',
        resultImageAssetId: image.id,
        startedAt: AT,
        finishedAt: AT,
      },
    });
  }
  await t.prisma.thumbnailSelection.create({
    data: {
      stepRunId: thumbnail.id,
      checklist: { version: 'M1-1' },
      selectedAt: AT,
      images: {
        create: images.map((image, index) => ({
          imageAssetId: image.id,
          role: index === 0 ? 'REPRESENTATIVE' : 'ADDITIONAL',
          sortOrder: index,
        })),
      },
    },
  });
  if (options.passG3 ?? true) await seedG3Pass(t, candidate.id, thumbnail.id);

  const html = options.html ?? placeholderHtml();
  const noticeHtmlStepRunId = await insertNoticeHtmlVersion(t, candidate.id, html);
  return {
    candidate: await t.prisma.candidate.findUniqueOrThrow({ where: { id: candidate.id } }),
    thumbnailStepRunId: thumbnail.id,
    noticeHtmlStepRunId,
    images,
    html,
  };
}

/** ⑧ e2e가 비우는 표(산출물 동결·추가만 트리거 → TRUNCATE … RESTART IDENTITY CASCADE) */
export const UPLOAD_TABLES = [
  'image_asset',
  'generation_run',
  'thumbnail_reference',
  'thumbnail_selection',
  'thumbnail_selection_image',
  'content_draft_assembly',
  'content_draft_field',
  'uploaded_image',
  'upload_result',
  'upload_result_image',
  'call_log',
] as const;

export async function truncateUpload(prisma: PrismaService): Promise<void> {
  await truncate(prisma, [...STEP_ENGINE_TABLES, ...SOURCING_SNAPSHOT_TABLES, ...UPLOAD_TABLES]);
}

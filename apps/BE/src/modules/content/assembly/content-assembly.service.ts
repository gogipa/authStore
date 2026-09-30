import { Injectable } from '@nestjs/common';
import {
  extractDisclosureBlocks,
  fillImagePlaceholders,
  renderedBlockSha256,
  renderedMatchesTemplate,
} from '../../../common/rules/detail-html.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import { parseContentQuery, resolveContentRun } from '../content-query.js';
import type { ContentAssemblyOutputDto } from '../dto/content-assembly.dto.js';
import type { ContentStepStatus } from '../dto/content.dto.js';
import { fieldsOf } from '../fields/content-field.store.js';
import { sortFields, toFieldItem } from '../fields/content-field.view.js';
import { ASSEMBLY_FIELD_KEYS, PRODUCT_NAME_FIELD_KEY } from './assembly-fields.js';
import { assemblyOutputNotFound } from './assembly-owner-edit.handler.js';
import { assemblyRowOf, dateText } from './assembly.store.js';
import { requiredBlockProblems } from './disclosure/disclosure-renderer.js';
import { localImageUrl } from './html/image-placeholder.js';
import { isDetailAreaCode, OriginCodeResolver } from './notice/origin-code.resolver.js';
import { PARALLEL_IMPORT_WORD } from './product-name/product-name.builder.js';
import { productNameWarnings } from './product-name/product-name.warnings.js';

/** 미리보기 CSP(05-2 getContentAssemblyPreview — iframe 샌드박스와 같은 출처 이미지만) */
export const PREVIEW_CSP = "sandbox; img-src 'self'";

/** 미리보기 경로(05-2 ContentAssemblyOutput.previewUrl) */
export function previewUrlOf(candidateId: number, stepRunId: number): string {
  return `/api/v1/candidates/${candidateId}/content-assembly/preview?stepRunId=${stepRunId}`;
}

/** 미리보기 문서 틀(최소 글꼴·폭만 — 외부 글꼴·스크립트 없음) */
export function previewDocument(body: string): string {
  return [
    '<!doctype html>',
    '<html lang="ko"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>상세페이지 미리보기</title>',
    '<style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#15202b;background:#fff}',
    'img{display:block;max-width:100%;height:auto;margin:8px auto}ul{padding-left:20px}',
    '[data-autostore-section="DISCLOSURE"]{padding:12px;border:1px solid #d3dae1;border-radius:4px;background:#f5f7f9}</style>',
    '</head><body>',
    body,
    '</body></html>',
  ].join('');
}

/**
 * ⑥-3 조회(05-2 `getCandidateContentAssembly`·`getContentAssemblyPreview`, P3-04 규칙 12·13).
 * - 조회: `content_draft_assembly`(HTML 본문 빼고) + notice.*·product_name 필드 행. 상품명 경고는 조회 때 지금 설정의 금지 수식어로
 *   계산한다(§7.4-33 — 저장하지 않는다). 고지 블록 글은 저장 HTML의 `data-block-id` 요소에서 읽고, 기록 해시·템플릿과 맞는지
 *   (`disclosureTemplateMatched`)를 함께 준다. `?stepRunId=` 규칙은 ⑥-1·⑥-2 조회와 같다(다른 후보·단계 404 STEP_RUN_NOT_FOUND)
 * - 미리보기: 자리표시자를 지금 G3 선택 로컬 이미지(`/api/v1/image-assets/{id}/file`)로 채운다(선택본에 없는 칸은 뺀다). ⑥-3은
 *   다시 실행하지 않는다 — 썸네일만 다시 골라도 바뀐다
 */
@Injectable()
export class ContentAssemblyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: CandidateGuardService,
    private readonly api: StepEngineApi,
    private readonly settings: SettingsService,
    private readonly origins: OriginCodeResolver,
  ) {}

  private async resolve(candidateId: number, rawQuery: Record<string, unknown>) {
    const query = parseContentQuery(rawQuery);
    await this.guard.findOr404(this.prisma, candidateId);
    const { run, isCurrent } = await resolveContentRun(
      this.prisma,
      candidateId,
      'NOTICE_HTML',
      query.stepRunId,
      assemblyOutputNotFound,
    );
    const row = await this.prisma.contentDraftAssembly.findUnique({ where: { stepRunId: run.id } });
    if (!row) throw assemblyOutputNotFound();
    return { run, isCurrent, row };
  }

  async get(
    candidateId: number,
    rawQuery: Record<string, unknown>,
  ): Promise<ContentAssemblyOutputDto> {
    const { run, isCurrent, row } = await this.resolve(candidateId, rawQuery);
    const assembly = assemblyRowOf(row);
    const fields = sortFields(await fieldsOf(this.prisma, run.id), ASSEMBLY_FIELD_KEYS);
    const nameRow = fields.find(
      (f) => f.fieldKey === PRODUCT_NAME_FIELD_KEY && f.valueSource === 'OWNER_INPUT',
    );
    const suggestion =
      typeof nameRow?.generatedValue === 'string' ? nameRow.generatedValue : assembly.productName;
    const settings = this.settings.currentOrNull();
    const texts = extractDisclosureBlocks(assembly.html);
    const blocks = assembly.disclosureBlocks.map((block) => ({
      blockId: block.block_id,
      sha256: block.sha256,
      conditional: block.conditional,
      text: texts.find((t) => t.blockId === block.block_id)?.text ?? '',
    }));
    const templates = settings?.notice.blocks ?? [];
    const matched =
      settings !== null &&
      requiredBlockProblems(templates).length === 0 &&
      blocks.every((block) => {
        const template = templates.find((t) => t.id === block.blockId);
        return (
          block.text !== '' &&
          renderedBlockSha256(block.text) === block.sha256 &&
          template !== undefined &&
          renderedMatchesTemplate(template.text, block.text)
        );
      });
    return {
      stepRunId: run.id,
      candidateId,
      version: run.version,
      stepRunStatus: run.status as ContentStepStatus,
      isCurrent,
      contentDraftAssemblyId: row.id,
      productName: assembly.productName,
      productNameSuggestion: suggestion,
      productNameWarnings: productNameWarnings(
        assembly.productName,
        settings?.content.productNameBannedWords ?? [],
      ),
      parallelImport: suggestion.split(/\s+/).includes(PARALLEL_IMPORT_WORD),
      noticeFields: assembly.noticeFields as unknown as Record<string, unknown>,
      noticeSizesMm: assembly.noticeSizesMm,
      originAreaCode: assembly.originAreaCode,
      originAreaName: isDetailAreaCode(assembly.originAreaCode)
        ? null
        : await this.origins.nameOf(assembly.originAreaCode),
      originAreaPlural: assembly.originAreaPlural,
      originAreaContent: assembly.originAreaContent,
      importer: assembly.importer,
      specBlockHtml: assembly.specBlockHtml,
      specOriginLabel: assembly.specOriginLabel,
      disclosureTemplateVersion: assembly.disclosureTemplateVersion,
      disclosureTemplateDate: dateText(row.disclosureTemplateDate),
      disclosureBlockIds: assembly.disclosureBlockIds,
      disclosureBlocks: blocks,
      disclosureTemplateMatched: matched,
      htmlSha256: assembly.htmlSha256,
      previewUrl: previewUrlOf(candidateId, run.id),
      createdAt: row.createdAt.toISOString(),
      fields: fields.map(toFieldItem),
      linterResult: null,
      linterBlockingCount: null,
    };
  }

  /** 미리보기 HTML 문서(자리표시자 → 지금 G3 선택 로컬 이미지) */
  async preview(candidateId: number, rawQuery: Record<string, unknown>): Promise<string> {
    const { row } = await this.resolve(candidateId, rawQuery);
    const selection = await this.api.readThumbnailSelection(candidateId);
    const bySlot = new Map((selection?.images ?? []).map((image) => [image.sortOrder, image]));
    const body = fillImagePlaceholders(row.html, (slot) => {
      const image = bySlot.get(slot);
      return image ? localImageUrl(image.imageAssetId) : null;
    });
    return previewDocument(body);
  }
}

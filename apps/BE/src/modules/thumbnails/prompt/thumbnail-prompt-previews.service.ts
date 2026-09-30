import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { AppSettings } from '../../settings/schema/settings.types.js';
import { SettingsService } from '../../settings/settings.service.js';
import type {
  ThumbnailPromptPreviewDto,
  ThumbnailPromptPreviewRequestDto,
} from '../dto/thumbnail-prompt-preview.dto.js';
import { ThumbnailReferenceRepository } from '../references/thumbnail-reference.repository.js';
import { notThumbnailRun } from '../references/thumbnail-references.service.js';
import { REFERENCE_MAX, REFERENCE_MIN } from '../thumbnail-sources.js';
import { buildPrompt, normalizeAdjustment, type ThumbnailFaceOption } from './prompt-builder.js';
import { findBlockedTerms, personBlockDictionary } from './real-person-guard.js';

/** 프롬프트와 차단어 검사 결과(미리보기·P3-02 생성 요청이 같이 쓴다) */
export interface CheckedPrompt {
  prompt: string;
  requestedSizePx: number;
  promptAdjusted: boolean;
  blockedTerms: string[];
}

/**
 * 설정 → 프롬프트 + 차단어 검사(P3-01 규칙 11·13). 골격·해상도는 설정 `thumbnail`, 사전은 앱 내장 ∪ 설정
 * `safety.personBlockWords`. 검사는 골격·해상도·얼굴 옵션·조정 문구를 모두 채운 **전체 프롬프트**에 한다.
 */
export function checkThumbnailPrompt(
  settings: Readonly<AppSettings>,
  faceOption: ThumbnailFaceOption,
  promptAdjustment: string | null | undefined,
): CheckedPrompt {
  const adjustment = normalizeAdjustment(promptAdjustment);
  const prompt = buildPrompt(
    settings.thumbnail.promptTemplate,
    settings.thumbnail.resolutionPx,
    faceOption,
    adjustment,
  );
  return {
    prompt,
    requestedSizePx: settings.thumbnail.resolutionPx,
    promptAdjusted: adjustment !== null,
    blockedTerms: findBlockedTerms(prompt, personBlockDictionary(settings.safety.personBlockWords)),
  };
}

/**
 * 썸네일 프롬프트 미리보기와 실존 인물 차단어 검사(05-2 `createThumbnailPromptPreview`, F-TH-06·10·11, P3-01 규칙 11~15).
 * 처리 리소스라 저장하지 않고 늘 200이다(차단어가 있어도). 막는 것은 생성 요청의 서버 재검사(P3-02, 422
 * `REAL_PERSON_NAME_BLOCKED`)다. `generationAllowed` = 차단어 없음 AND 이 ⑤ 버전에 '사람·얼굴 없음'을 확인한 레퍼런스 1~3장.
 * 실행 없음 404 `STEP_RUN_NOT_FOUND`, ⑤가 아니면 422 `INVALID_STEP_CODE`. 설정은 지금 설정(차단어 추가분도 최신)을 쓴다.
 */
@Injectable()
export class ThumbnailPromptPreviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly references: ThumbnailReferenceRepository,
  ) {}

  async preview(body: ThumbnailPromptPreviewRequestDto): Promise<ThumbnailPromptPreviewDto> {
    const run = await this.prisma.stepRun.findUnique({ where: { id: body.stepRunId } });
    if (!run) throw new ApiException('STEP_RUN_NOT_FOUND');
    if (run.stepCode !== 'THUMBNAIL') throw notThumbnailRun(run);
    const checked = checkThumbnailPrompt(
      this.settings.current(),
      body.faceOption,
      body.promptAdjustment,
    );
    const refs = await this.references.referencesOf(this.prisma, run.id);
    const referencesConfirmed =
      refs.length >= REFERENCE_MIN &&
      refs.length <= REFERENCE_MAX &&
      refs.every((row) => row.noPersonConfirmedAt instanceof Date);
    const detected = checked.blockedTerms.length > 0;
    return {
      prompt: checked.prompt,
      faceOption: body.faceOption,
      requestedSizePx: checked.requestedSizePx,
      promptAdjusted: checked.promptAdjusted,
      realPersonNameDetected: detected,
      blockedTerms: checked.blockedTerms,
      generationAllowed: !detected && referencesConfirmed,
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { isAiExecutionError } from '../integrations/ai-engine/ai-engine.errors.js';
import type { AiJsonSchema } from '../integrations/ai-engine/ai-engine.port.js';
import { AiExecutor } from '../integrations/ai-engine/ai-executor.service.js';
import type { PinnedAiContext } from '../integrations/ai-engine/ai-executor.types.js';
import type { AiInputBlock } from '../integrations/ai-engine/ai-prompt-guard.js';

/**
 * AI 동일 상품 판정 보조(F-BS-38, PRD §8.2 RK-03 6·§8.9 표, P2-03 규칙 4). 규칙(型番·색상 코드·JAN·メーカー型番)으로도
 * 불확실한 행만 두 상품의 이름·속성을 선택 AI 엔진에 넣어 `{ match, confidence, reason }`을 받는다(P1-10 실행기 —
 * 그 ② 실행에 시작 때 고정한 엔진, `StepEngineApi.pinnedAiOf`). 결과는 참고다: `ai_match`에만 두고 `anchor_match`·선택을
 * 바꾸지 않는다(최종은 오너 `ownerMatchDecision`).
 * - 부를 범위(Proposed): 앵커 뒤 규칙 분류가 NEEDS_REVIEW인 API 행, 페이지를 읽었는데 JAN·メーカー型番이 어긋난 MATCH 행.
 *   한 작업에 `AI_MATCH_MAX_ROWS`(10)행까지, 이미 결과가 있거나 오너가 판단한 행은 부르지 않는다
 * - 실패(Proposed): 그 행만 결과 없이 두고 비교는 계속한다(`ai_match` NULL). 엔진을 쓸 수 없게 되면 그 작업의 나머지 행은
 *   부르지 않는다
 */

/** 결과 스키마(규칙 7: additionalProperties false, 모두 required) */
export const AI_MATCH_SCHEMA: AiJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['match', 'confidence', 'reason'],
  properties: {
    match: { type: 'boolean', description: '같은 상품(같은 모델·같은 색상)이면 true' },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: '확신도 0~1' },
    reason: { type: 'string', maxLength: 500, description: '판단 이유(한국어 한두 문장)' },
  },
};

export const AI_MATCH_TASK = { name: 'F-BS-38', kind: 'TEXT' } as const;

/** 한 작업(앵커 뒤 조회·재고 확인)에서 AI를 부를 최대 행 수(Proposed) */
export const AI_MATCH_MAX_ROWS = 10;

export interface AiMatchResult {
  match: boolean;
  confidence: number;
  reason: string;
}

export interface AiMatchProduct {
  itemName: string;
  shopName?: string | null;
  modelCode?: string | null;
  colorCode?: string | null;
  colorLabel?: string | null;
}

const INSTRUCTION = [
  '두 라쿠텐 신발 상품이 같은 상품(같은 모델·같은 색상)인지 판정한다.',
  "'기준 상품'과 '비교 상품'의 상품명·型番·색상만 보고, 모델(型番)과 색상 코드가 모두 같을 때만 match=true로 둔다.",
  '사이즈·샵·가격·배송 문구 차이는 무시한다. 확신도(confidence)는 0~1, 이유(reason)는 한국어 한두 문장이다.',
].join('\n');

function productText(p: AiMatchProduct): string {
  return [
    `상품명: ${p.itemName}`,
    p.shopName ? `샵: ${p.shopName}` : null,
    p.modelCode ? `型番: ${p.modelCode}` : null,
    p.colorCode ? `색상 코드: ${p.colorCode}` : null,
    p.colorLabel ? `색상: ${p.colorLabel}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function isResult(value: unknown): value is AiMatchResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.match === 'boolean' &&
    typeof v.confidence === 'number' &&
    v.confidence >= 0 &&
    v.confidence <= 1 &&
    typeof v.reason === 'string'
  );
}

@Injectable()
export class AiMatchService {
  private readonly logger = new Logger(AiMatchService.name);

  constructor(private readonly ai: AiExecutor) {}

  /**
   * 두 상품 판정 한 번. 실패하면 null(`stop`=true면 엔진을 쓸 수 없어 이 작업의 나머지를 부르지 않는다).
   * 기준 상품의 型番·색상 코드를 오너가 넣었으면(CODE_ENTRY) 출처는 OWNER_INPUT, 상품 글은 RAKUTEN(공개 판매 글)
   */
  async judge(
    ctx: PinnedAiContext,
    anchor: AiMatchProduct & { ownerEntered?: boolean },
    row: AiMatchProduct,
  ): Promise<{ result: AiMatchResult | null; stop: boolean }> {
    const blocks: AiInputBlock[] = [
      {
        source: anchor.ownerEntered ? 'OWNER_INPUT' : 'RAKUTEN',
        label: '기준 상품',
        text: productText(anchor),
      },
      { source: 'RAKUTEN', label: '비교 상품', text: productText(row) },
    ];
    try {
      const res = await this.ai.run<AiMatchResult>(ctx, AI_MATCH_TASK, AI_MATCH_SCHEMA, {
        instruction: INSTRUCTION,
        blocks,
      });
      if (!isResult(res.output)) return { result: null, stop: false };
      return {
        result: {
          match: res.output.match,
          confidence: Math.round(res.output.confidence * 1000) / 1000,
          reason: res.output.reason.slice(0, 500),
        },
        stop: false,
      };
    } catch (error) {
      const code = isAiExecutionError(error) ? error.errorCode : (error as Error)?.name;
      this.logger.warn(`AI 동일 상품 판정 보조를 받지 못했습니다(${code ?? 'Error'})`);
      return {
        result: null,
        stop: isAiExecutionError(error) && error.errorCode === 'AI_ENGINE_UNAVAILABLE',
      };
    }
  }

  /** JSON 열 값 */
  static toJson(result: AiMatchResult): Prisma.InputJsonObject {
    return { match: result.match, confidence: result.confidence, reason: result.reason };
  }
}

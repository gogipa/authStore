import { ApiProperty } from '@nestjs/swagger';
import { AI_ENGINE_CODES, type AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';

/** AI가 바꾼 라쿠텐 검색어(F-BS-70, 05-2 RakutenQueryConversion). 저장하지 않는다 */
export class RakutenQueryConversionDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  keywordId!: number;

  @ApiProperty({ maxLength: 100, description: '키워드 원문(한글)' })
  keyword!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 128,
    description: '바꾼 검색어. 일본어·영문만(한글이 남으면 502 AI_CALL_FAILED)',
  })
  rakutenQuery!: string;

  @ApiProperty({ enum: AI_ENGINE_CODES })
  engineCode!: AiEngineCode;

  @ApiProperty({ description: '쓴 텍스트 모델' })
  model!: string;
}

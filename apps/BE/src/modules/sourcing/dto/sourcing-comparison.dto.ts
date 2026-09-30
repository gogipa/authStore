import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * P2-03 요청·응답 모양(05-2 SourcingAnchorRequest·SourcingComparisonRowPatch·SourcingManualRowRequest·
 * SourcingSelectionRequest·SourcingJobAccepted·SourcingSelectionResult). 문서(openapi:export)용이다 — 본문 검사는
 * sourcing-requests.ts가 한다(앵커는 anchorInputMethod로 가르는 oneOf라 class-validator로 표현하지 않는다).
 */

export class SourcingAnchorRequestDto {
  @ApiProperty({ enum: ['SEARCH_PICK', 'CODE_ENTRY'] })
  anchorInputMethod!: 'SEARCH_PICK' | 'CODE_ENTRY';

  @ApiPropertyOptional({
    maxLength: 128,
    description: 'SEARCH_PICK: 앵커로 고른 행의 itemCode(필수)',
  })
  anchorItemCode?: string;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 128,
    description: 'CODE_ENTRY: 型番 원문(필수, 서버가 정규화)',
  })
  anchorModelCode?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 64,
    description: '색상 코드(선택, §7-27)',
  })
  anchorColorCode?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 128,
    description: '색상 원문 라벨',
  })
  anchorColorLabel?: string | null;
}

export class SourcingJobAcceptedDto {
  @ApiProperty({ type: 'integer', minimum: 1 }) candidateId!: number;
  @ApiProperty({ type: 'integer', minimum: 1 }) sourcingComparisonId!: number;
  @ApiProperty({ type: 'integer', minimum: 1, description: '이 비교표의 ② 실행 기록' })
  stepRunId!: number;
  @ApiProperty({ description: '② 실행 상태(StepStatus)' }) stepStatus!: string;
  @ApiProperty({ type: 'integer', nullable: true, description: '재고 확인한 행. 앵커 요청은 null' })
  rowId!: number | null;
}

export class SourcingComparisonRowPatchDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 0, description: '행별 쿠폰 금액(엔)' })
  couponYen?: number;

  @ApiPropertyOptional({ minimum: 0, description: '샵·이벤트 포인트 배율(배)' })
  shopEventMultiplier?: number;

  @ApiPropertyOptional({
    enum: ['MATCH', 'NO_MATCH'],
    nullable: true,
    description: '동일 상품 오너 최종 판단',
  })
  ownerMatchDecision?: 'MATCH' | 'NO_MATCH' | null;
}

export class SourcingManualRowRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: 'POST /rakuten-items로 읽은 스냅샷' })
  rakutenItemId!: number;
}

export class SourcingSelectionRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '고를 검증 행' })
  rowId!: number;
}

export class SourcingSelectionResultDto {
  @ApiProperty({ type: 'integer', minimum: 1 }) candidateId!: number;
  @ApiProperty({ type: 'integer', minimum: 1 }) sourcingComparisonId!: number;
  @ApiProperty({ type: 'integer', minimum: 1 }) stepRunId!: number;
  @ApiProperty({ description: '② 실행 상태(StepStatus)' }) stepStatus!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) selectedRowId!: number;
  @ApiProperty({ maxLength: 128, description: '후보에 반영한 itemCode' }) itemCode!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 128 }) selectedColor!: string | null;
  @ApiProperty({ description: '다른 샵으로 바꿔 G2를 다시 통과해야 하면 true' })
  g2Invalidated!: boolean;
  @ApiProperty({ type: [String], description: '재실행 필요로 바뀐 뒷단계' })
  staleDownstreamSteps!: string[];
}

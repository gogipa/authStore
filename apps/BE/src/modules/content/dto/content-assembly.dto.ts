import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContentDraftFieldItemDto, type ContentStepStatus } from './content.dto.js';

const STEP_STATUSES = [
  'NOT_RUN',
  'RUNNING',
  'WAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'RERUN_REQUIRED',
] as const;

/** 05-2 ContentDisclosureBlock: ⑥-3이 넣은 고지 블록 기록(disclosure_blocks jsonb 원소) */
export class ContentDisclosureBlockDto {
  @ApiProperty({ maxLength: 40 })
  blockId!: string;

  @ApiProperty({
    pattern: '^[0-9a-f]{64}$',
    description: '채운 블록 글의 해시(common/rules/detail-html.ts 정의)',
  })
  sha256!: string;

  @ApiProperty({ description: '조건부 블록(가죽·정보 없음·AI 이미지 고지)인지' })
  conditional!: boolean;

  @ApiProperty({
    description:
      '(P3-04 Proposed) 채운 블록 글 — 저장 HTML의 data-block-id 요소에서 읽는다(화면 구매대행 고지 미리보기)',
  })
  text!: string;
}

/** 05-2 ProductNameWarning: 상품명 경고(막지 않음) */
export class ProductNameWarningDto {
  @ApiProperty({
    pattern: '^[A-Z][A-Z0-9_]*$',
    description:
      '경고 코드(05-3 §5.2, P3-04 Proposed): PRODUCT_NAME_TOO_LONG·PRODUCT_NAME_BANNED_WORD·PRODUCT_NAME_REPEATED_WORD',
  })
  code!: string;

  @ApiProperty()
  message!: string;
}

/** 05-2 ContentAssemblyOutput: ⑥-3 조립 결과 한 버전(HTML 본문 제외) */
export class ContentAssemblyOutputDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '⑥-3 실행 기록(버전) id' })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;

  @ApiProperty({ enum: STEP_STATUSES })
  stepRunStatus!: ContentStepStatus;

  @ApiProperty()
  isCurrent!: boolean;

  @ApiProperty({ type: 'integer', minimum: 1 })
  contentDraftAssemblyId!: number;

  @ApiProperty({
    maxLength: 255,
    description: '유효 상품명. 100자 초과도 초안으로 저장한다(RG-08이 막음)',
  })
  productName!: string;

  @ApiProperty({
    maxLength: 255,
    description: '(P3-04 Proposed) 템플릿 제안 상품명 — 오너가 고쳤으면 그 행의 generatedValue',
  })
  productNameSuggestion!: string;

  @ApiProperty({ type: ProductNameWarningDto, isArray: true })
  productNameWarnings!: ProductNameWarningDto[];

  @ApiProperty({
    description: '(P3-04 Proposed) 라쿠텐 상품명에 並行輸入品이 있어 제안에 병행을 넣었는지',
  })
  parallelImport!: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'SHOES 고시 객체(등록 요청 형태, 오너 수정 반영)',
  })
  noticeFields!: Record<string, unknown>;

  @ApiProperty({
    type: 'integer',
    isArray: true,
    minItems: 1,
    description: '고시·사양 블록에 쓴 판매 사이즈(mm)',
  })
  noticeSizesMm!: number[];

  @ApiProperty({ maxLength: 20, description: 'originAreaInfo 원산지 코드' })
  originAreaCode!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 100,
    description:
      '(P3-04 Proposed) 원산지 코드 이름(commerce_origin_area.name, 예 아시아>베트남). 03·04면 null',
  })
  originAreaName!: string | null;

  @ApiProperty({ description: '복수 원산지 표시' })
  originAreaPlural!: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 200,
    description: '03·04 코드일 때 상세 표기',
  })
  originAreaContent!: string | null;

  @ApiProperty({ minLength: 1, maxLength: 100, description: '수입자(구매대행 프로필 스냅샷)' })
  importer!: string;

  @ApiProperty({ description: '상품 사양 블록 HTML' })
  specBlockHtml!: string;

  @ApiProperty({ maxLength: 200, description: '사양 블록의 제조국 표기' })
  specOriginLabel!: string;

  @ApiProperty({ maxLength: 40 })
  disclosureTemplateVersion!: string;

  @ApiProperty({ type: 'string', format: 'date' })
  disclosureTemplateDate!: string;

  @ApiProperty({ type: String, isArray: true, minItems: 1 })
  disclosureBlockIds!: string[];

  @ApiProperty({ type: ContentDisclosureBlockDto, isArray: true })
  disclosureBlocks!: ContentDisclosureBlockDto[];

  @ApiProperty({
    description:
      '(P3-04 Proposed) 저장 HTML의 고지 블록이 기록 해시와 같고, 필수 블록 글이 앱 내장 기준을 통과한 설정 템플릿에서 나왔는지(화면 템플릿과 일치)',
  })
  disclosureTemplateMatched!: boolean;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  htmlSha256!: string;

  @ApiProperty({
    description:
      '미리보기 경로(/api/v1/candidates/{candidateId}/content-assembly/preview?stepRunId=…)',
  })
  previewUrl!: string;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    type: ContentDraftFieldItemDto,
    isArray: true,
    description: '오너가 고쳤거나 확인한 notice.*·product_name 필드 행',
  })
  fields!: ContentDraftFieldItemDto[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: '(M2) 문구 린터 결과(CT-05). M1은 null',
  })
  linterResult!: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 0,
    description: '(M2) 린터 차단 항목 수',
  })
  linterBlockingCount!: number | null;
}

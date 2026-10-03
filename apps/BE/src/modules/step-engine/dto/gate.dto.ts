import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';
import { CANDIDATE_STATUSES, type CandidateStatus } from '../domain/steps.js';
import { CandidateWarningDto } from './candidate-response.dto.js';
import { CandidateBlockReasonDto } from './step-run-response.dto.js';

/**
 * 게이트 요청·응답(05-2 GatePassRequest·GatePassResult·CandidateGateState·CandidateGateList, P1-06).
 * 구현 명세(@nestjs/swagger)는 OpenAPI 3.0이라 null 허용은 nullable로 적었다(06-2 §9-5).
 */

/**
 * POST /candidates/{candidateId}/gates/{gateCode}/pass body(05-2 GatePassRequest oneOf, 표 C). 게이트마다 모양이 달라
 * 칸 검사는 `parseGatePassBody`가 한 곳에서 한다(422 VALIDATION_FAILED). 여기서는 받을 칸만 연다(그 밖 칸은 전역
 * ValidationPipe가 422).
 */
/** 05-2 GateThumbnailChecklist(G3 체크리스트 7칸 — 검사는 `parseGatePassBody`·G3 공급자) */
export class GateThumbnailChecklistDto {
  @ApiProperty({
    type: Boolean,
    description:
      '신발 길이가 화면 폭의 70% 이상(D-22 — 신발 박스 긴 변 ÷ 같은 방향 이미지 변 ≥ 0.70. 키 이름은 그대로)',
  })
  shoeRatioOver70!: boolean;
  @ApiProperty({ type: Boolean, description: '디테일 일치' }) detailMatch!: boolean;
  @ApiProperty({ type: Boolean, description: '선택 색상과 일치' })
  colorMatchesSelectedColor!: boolean;
  @ApiProperty({ type: Boolean, description: '레퍼런스에 사람 없음' }) referenceNoPerson!: boolean;
  @ApiProperty({ type: Boolean, description: '실존 인물 연상 없음' })
  noRealPersonResemblance!: boolean;
  @ApiProperty({ type: Boolean, description: '문구·가격 없음' }) noTextOrPrice!: boolean;
  @ApiProperty({ type: Boolean, description: '상품 1개·모델 1명' })
  singleProductSingleModel!: boolean;
}

export class GatePassRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: 'G2 ③ 현재 버전 · G3 ⑤ 버전' })
  @Allow()
  basisStepRunId?: unknown;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, description: 'G3 대표이미지' })
  @Allow()
  representativeImageAssetId?: unknown;

  @ApiPropertyOptional({ type: [Number], description: 'G3 추가이미지 0~9장' })
  @Allow()
  additionalImageAssetIds?: unknown;

  @ApiPropertyOptional({ type: GateThumbnailChecklistDto, description: 'G3 체크리스트' })
  @Allow()
  checklist?: unknown;

  @ApiPropertyOptional({ type: Boolean, description: "G3 '같은 상품·색상' 확인" })
  @Allow()
  sameProductColorConfirmed?: unknown;
}

/** 05-2 GatePassResult */
export class GatePassResultDto {
  @ApiProperty({ type: 'integer' })
  gatePassId!: number;

  @ApiProperty({ enum: ['G2', 'G3'] })
  gate!: 'G2' | 'G3';

  @ApiProperty({ pattern: '^[0-9a-f]{64}$', description: '게이트 지문' })
  fingerprint!: string;

  @ApiProperty({ type: 'integer' })
  basisStepRunId!: number;

  @ApiProperty({ type: 'string', format: 'date-time' })
  passedAt!: string;

  @ApiProperty({ enum: CANDIDATE_STATUSES })
  candidateStatus!: CandidateStatus;

  @ApiProperty({ description: '이번 통과로 후보 상태가 바뀌었는가' })
  statusChanged!: boolean;

  @ApiProperty({ type: 'integer', nullable: true, description: 'G3만' })
  thumbnailSelectionId!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, description: 'G3만' })
  thumbnailStepRunId!: number | null;

  @ApiProperty({ type: [CandidateWarningDto] })
  warnings!: CandidateWarningDto[];
}

/** 05-2 CandidateGateState */
export class CandidateGateStateDto {
  @ApiProperty({ enum: ['G1', 'G2', 'G3', 'G4'] })
  gate!: 'G1' | 'G2' | 'G3' | 'G4';

  @ApiProperty({ description: '지금 유효하게 통과돼 있는가' })
  passed!: boolean;

  @ApiProperty({ type: 'integer', nullable: true })
  gatePassId!: number | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  passedAt!: string | null;

  @ApiProperty({ type: 'integer', nullable: true })
  basisStepRunId!: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  registrationId!: number | null;

  @ApiProperty({ type: 'boolean', nullable: true, description: 'G2·G3 지문 유효. G1·G4는 null' })
  fingerprintValid!: boolean | null;

  @ApiProperty({ type: [String] })
  changedBasisKeys!: string[];

  @ApiProperty({ type: [CandidateBlockReasonDto] })
  blockedReasons!: CandidateBlockReasonDto[];

  @ApiProperty({ type: [CandidateWarningDto] })
  warnings!: CandidateWarningDto[];
}

/** 05-2 CandidateGateList */
export class CandidateGateListDto {
  @ApiProperty({ type: [CandidateGateStateDto] })
  items!: CandidateGateStateDto[];
}

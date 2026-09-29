import { ApiProperty } from '@nestjs/swagger';

/** 05-2 components.schemas.FieldError(설정 검사 오류: field = JSON 경로). rejectedValue는 넣지 않는다 */
export class SettingsFieldErrorDto {
  @ApiProperty({
    description: 'JSON 경로(JSON Pointer, 예 /costs/cardSurchargePct). 파일 전체면 /',
  })
  field!: string;

  @ApiProperty()
  message!: string;
}

/** file_manifest 한 줄(경로 없이 파일 이름만) */
export class SettingsFileManifestEntryDto {
  @ApiProperty({ example: 'settings.json' })
  name!: string;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$', description: '파일 원문의 SHA-256' })
  sha256!: string;

  @ApiProperty({ type: 'integer', minimum: 0 })
  sizeBytes!: number;
}

/** 05-2 components.schemas.SettingsSnapshot */
export class SettingsSnapshotDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  contentSha256!: string;

  @ApiProperty({ maxLength: 20 })
  schemaVersion!: string;

  @ApiProperty({ maxLength: 40 })
  appVersion!: string;

  @ApiProperty({
    type: [SettingsFileManifestEntryDto],
    description: '파일별 이름·SHA-256·크기(jsonb). 경로는 담지 않는다',
  })
  fileManifest!: unknown;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: '검증을 통과한 설정 전체(요율·템플릿·사전·금지어·기준일 등)',
  })
  content!: Record<string, unknown>;

  @ApiProperty({ type: 'string', format: 'date-time' })
  firstLoadedAt!: string;

  @ApiProperty({ type: 'string', format: 'date-time' })
  lastLoadedAt!: string;

  @ApiProperty({ description: 'lastLoadedAt이 가장 큰 행(현재 스냅샷)' })
  isCurrent!: boolean;
}

/** 05-2 components.schemas.SettingsView(SettingsSnapshot + 검사 결과) */
export class SettingsViewDto extends SettingsSnapshotDto {
  @ApiProperty({
    description: '지금 설정 파일이 검사를 통과하는지(false면 이 스냅샷은 마지막으로 통과한 것)',
  })
  valid!: boolean;

  @ApiProperty({ type: [SettingsFieldErrorDto], description: '검사 오류(field = JSON 경로)' })
  errors!: SettingsFieldErrorDto[];
}

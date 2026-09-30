import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** 앞뒤 공백을 떼어 검사한다(글자가 아니면 그대로 두어 IsString이 422로 막는다) */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** POST /child-keyword-terms body(05-2 ChildKeywordTermCreateRequest). 빈 값·100자 초과는 422 VALIDATION_FAILED */
export class ChildKeywordTermCreateDto {
  @ApiProperty({ minLength: 1, maxLength: 100, description: '더할 아동 단어(앞뒤 공백은 뗀다)' })
  @Transform(trim)
  @IsString({ message: '글자여야 합니다.' })
  @MinLength(1, { message: '비울 수 없습니다.' })
  @MaxLength(100, { message: '100자 이내여야 합니다.' })
  term!: string;
}

/** 05-2 components.schemas.ChildKeywordTerm */
export class ChildKeywordTermDto {
  @ApiProperty({ maxLength: 100 })
  term!: string;

  @ApiProperty({ description: 'true면 기본 단어(뺄 수 없다)' })
  builtIn!: boolean;
}

/** 05-2 components.schemas.ChildKeywordTermList */
export class ChildKeywordTermListDto {
  @ApiProperty({ type: [ChildKeywordTermDto] })
  items!: ChildKeywordTermDto[];
}

/** 05-2 components.schemas.ChildKeywordTermCreated */
export class ChildKeywordTermCreatedDto extends ChildKeywordTermDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '단어를 더해 새로 만든 설정 스냅샷' })
  settingsSnapshotId!: number;
}

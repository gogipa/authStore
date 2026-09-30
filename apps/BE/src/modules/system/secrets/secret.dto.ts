import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { OmitRejectedValue } from '../../../common/errors/app-validation.pipe.js';
import { SECRET_KEYS, type SecretKey } from '../../../common/secrets/secret-keys.js';

/** 05-2 components.schemas.SecretStatus(값·가림값 없음) */
export class SecretStatusDto {
  @ApiProperty({ enum: SECRET_KEYS })
  secretKey!: SecretKey;

  @ApiProperty({ description: '키체인에 저장됨' })
  configured!: boolean;

  @ApiProperty({
    type: 'string',
    format: 'date-time',
    nullable: true,
    description: '키체인 항목 수정 시각(얻지 못하면 null)',
  })
  updatedAt!: string | null;
}

/** 05-2 components.schemas.SecretStatusList */
export class SecretStatusListDto {
  @ApiProperty({ type: [SecretStatusDto], description: '허용 키 6개(05-2 SecretKey 순서)' })
  items!: SecretStatusDto[];
}

/**
 * 05-2 components.schemas.SecretValueRequest. 검증 오류에 `rejectedValue`를 넣지 않는다(비밀값이 응답에 돌아가지 않게).
 */
@OmitRejectedValue()
export class SecretValueRequestDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 4096,
    writeOnly: true,
    description: '비밀값. 키체인에만 저장하고 어떤 응답·로그에도 남기지 않는다',
  })
  @IsString({ message: '글자여야 합니다.' })
  @Length(1, 4096, { message: '1자 이상 4096자 이하여야 합니다.' })
  value!: string;
}

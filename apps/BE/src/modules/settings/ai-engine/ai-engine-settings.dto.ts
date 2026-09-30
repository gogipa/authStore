import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsObject,
  registerDecorator,
  ValidateNested,
  type ValidationArguments,
} from 'class-validator';
import { AI_ENGINE_CODES, type AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';
import { AI_MODEL_MAX_LENGTH } from './ai-engine-options.js';

const ENGINE_MESSAGE = `${AI_ENGINE_CODES.join('·')} 중 하나여야 합니다.`;
const MISSING_KEY_MESSAGE = '빠진 키입니다. 정하지 않았으면 null을 보내 주세요.';

/** 모델 칸 형식: 키는 꼭 있고 값은 null 또는 1~100자 글자(05-2 AiEngineModelPair). 목록 검사는 서비스가 한다(AI_MODEL_INVALID) */
function modelFormatError(value: unknown): string | null {
  if (value === undefined) return MISSING_KEY_MESSAGE;
  if (value === null) return null;
  if (typeof value !== 'string') return '글자 또는 null이어야 합니다.';
  if (value.length < 1 || value.length > AI_MODEL_MAX_LENGTH) {
    return `1~${AI_MODEL_MAX_LENGTH}자여야 합니다.`;
  }
  return null;
}

function ModelValue(): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'aiModelValue',
      target: object.constructor,
      propertyName: propertyName as string,
      validator: {
        validate: (value: unknown) => modelFormatError(value) === null,
        defaultMessage: (args?: ValidationArguments) =>
          modelFormatError(args?.value) ?? '형식이 맞지 않습니다.',
      },
    });
  };
}

/** 05-2 components.schemas.AiEngineModelPair */
export class AiEngineModelPairDto {
  @ApiProperty({ type: 'string', nullable: true, minLength: 1, maxLength: AI_MODEL_MAX_LENGTH })
  @ModelValue()
  text!: string | null;

  @ApiProperty({ type: 'string', nullable: true, minLength: 1, maxLength: AI_MODEL_MAX_LENGTH })
  @ModelValue()
  vision!: string | null;
}

/** 05-2 components.schemas.AiEngineModels(엔진 3개 모두 필수, 정의 밖 키는 422) */
export class AiEngineModelsDto {
  @ApiProperty({ type: AiEngineModelPairDto })
  @IsDefined({ message: MISSING_KEY_MESSAGE })
  @IsObject({ message: '묶음({ text, vision })이어야 합니다.' })
  @ValidateNested()
  @Type(() => AiEngineModelPairDto)
  CLAUDE!: AiEngineModelPairDto;

  @ApiProperty({ type: AiEngineModelPairDto })
  @IsDefined({ message: MISSING_KEY_MESSAGE })
  @IsObject({ message: '묶음({ text, vision })이어야 합니다.' })
  @ValidateNested()
  @Type(() => AiEngineModelPairDto)
  AGY!: AiEngineModelPairDto;

  @ApiProperty({ type: AiEngineModelPairDto })
  @IsDefined({ message: MISSING_KEY_MESSAGE })
  @IsObject({ message: '묶음({ text, vision })이어야 합니다.' })
  @ValidateNested()
  @Type(() => AiEngineModelPairDto)
  CODEX!: AiEngineModelPairDto;
}

/** 05-2 components.schemas.AiEngineOption(엔진 하나의 고정 안내, 비밀 없음) */
export class AiEngineOptionDto {
  @ApiProperty({ enum: AI_ENGINE_CODES })
  engineCode!: AiEngineCode;

  @ApiProperty({ description: '화면 이름(Claude Code·Antigravity CLI·Codex)' })
  displayName!: string;

  @ApiProperty({ enum: ['claude', 'agy', 'codex'] })
  binName!: 'claude' | 'agy' | 'codex';

  @ApiProperty({ type: [String], description: '고를 수 있는 모델' })
  modelOptions!: string[];

  @ApiProperty({ description: '목록 밖 모델 직접 입력 허용(CODEX만)' })
  allowCustomModel!: boolean;

  @ApiProperty({ type: AiEngineModelPairDto })
  defaultModels!: AiEngineModelPairDto;

  @ApiProperty({ description: '로그인 방법(터미널 명령 안내)' })
  loginCommand!: string;

  @ApiProperty({ description: '구독 약관·쿼터 책임 한 줄(R14)' })
  termsNote!: string;

  @ApiProperty({ description: "M0 S7 기준 미달·미측정 엔진('실험적' 표시, P1-11 Proposed)" })
  experimental!: boolean;
}

/** 05-2 components.schemas.AiEngineSettings */
export class AiEngineSettingsDto {
  @ApiProperty({ enum: AI_ENGINE_CODES })
  selectedEngine!: AiEngineCode;

  @ApiProperty({ type: AiEngineModelsDto })
  models!: AiEngineModelsDto;

  @ApiProperty({ type: [AiEngineOptionDto], description: '엔진 3개(CLAUDE·AGY·CODEX 순서)' })
  engines!: AiEngineOptionDto[];

  @ApiProperty({ type: 'integer', minimum: 1 })
  settingsSnapshotId!: number;

  @ApiProperty({ type: 'string', format: 'date-time', description: '그 스냅샷을 읽은 시각' })
  updatedAt!: string;
}

/** 05-2 components.schemas.AiEngineSettingsUpdateRequest(정의 밖 필드는 전역 ValidationPipe가 422 VALIDATION_FAILED) */
export class AiEngineSettingsUpdateRequestDto {
  @ApiProperty({ enum: AI_ENGINE_CODES })
  @IsDefined({ message: '꼭 있어야 하는 값입니다.' })
  @IsIn(AI_ENGINE_CODES, { message: ENGINE_MESSAGE })
  selectedEngine!: AiEngineCode;

  @ApiProperty({ type: AiEngineModelsDto })
  @IsDefined({ message: '꼭 있어야 하는 값입니다.' })
  @IsObject({ message: '엔진별 모델 묶음이어야 합니다.' })
  @ValidateNested()
  @Type(() => AiEngineModelsDto)
  models!: AiEngineModelsDto;
}

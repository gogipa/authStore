import { ApiProperty } from '@nestjs/swagger';
import { SettingsSnapshotDto } from './settings-view.dto.js';

/** 05-2 components.schemas.SettingsReloadResult(SSE settings.reloaded와 같은 뜻) */
export class SettingsReloadResultDto {
  @ApiProperty({ type: SettingsSnapshotDto })
  snapshot!: SettingsSnapshotDto;

  @ApiProperty({ description: 'true면 새 스냅샷, false면 같은 내용의 기존 스냅샷' })
  created!: boolean;

  @ApiProperty({
    type: [String],
    description: '직전 현재 스냅샷과 달라진 설정 키(점 경로, 예 costs.targetMarginPct)',
  })
  changedKeys!: string[];

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: '이번 변경으로 재실행 필요가 된 후보 단계 수(P1-05 전까지 0)',
  })
  rerunRequiredStepCount!: number;
}

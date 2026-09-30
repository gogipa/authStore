import { ApiProperty } from '@nestjs/swagger';

/** 05-2 DispatchDeliveryCompany(설정 파일 목록, RG-03) */
export class DispatchDeliveryCompanyDto {
  @ApiProperty({ maxLength: 40 })
  code!: string;

  @ApiProperty({ maxLength: 100 })
  name!: string;

  @ApiProperty({ description: '설정 파일에 적은 코드 출처' })
  source!: string;
}

/** 05-2 DispatchDeliveryCompanyList(페이징 없음) */
export class DispatchDeliveryCompanyListDto {
  @ApiProperty({ type: [DispatchDeliveryCompanyDto] })
  items!: DispatchDeliveryCompanyDto[];
}

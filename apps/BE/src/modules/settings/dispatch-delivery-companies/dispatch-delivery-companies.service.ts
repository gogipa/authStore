import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings.service.js';
import type { DispatchDeliveryCompanyListDto } from './dto/dispatch-delivery-company.dto.js';

/**
 * 발송 택배사 코드 목록(F-ST-09, RG-03). DB 테이블 없이 현재 설정 스냅샷(`settings_snapshot.content`)의
 * `delivery.dispatchCompanies`(P1-09 Proposed 키)를 파일에 적힌 순서대로 준다. 로드된 스냅샷이 없으면
 * `SettingsService.current()`가 503 SETTINGS_INVALID를 던진다. 해외 출고에 쓸 수 있는 코드는 M0 S3에서 확인한다.
 */
@Injectable()
export class DispatchDeliveryCompaniesService {
  constructor(private readonly settings: SettingsService) {}

  list(): DispatchDeliveryCompanyListDto {
    const companies = this.settings.current().delivery.dispatchCompanies;
    return { items: companies.map(({ code, name, source }) => ({ code, name, source })) };
  }
}

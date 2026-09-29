import { Module } from '@nestjs/common';

/**
 * 기반: 외부 연동 포트·어댑터(naver-commerce, rakuten, datalab, fx, ai-engine, image-gen).
 * 단계 모듈은 여기 포트로만 밖을 부른다. 테스트는 fixture 어댑터로 바꿔 끼운다(03-ADR-003). (빈 껍데기)
 */
@Module({})
export class IntegrationsModule {}

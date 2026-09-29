import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';
import { PAGE_DEFAULT_SIZE, PAGE_MAX_SIZE, type PageMeta } from './page-request.js';

/**
 * 목록 요청 공통 쿼리(05-2 components.parameters Page·Size·Sort). 값 검사는 `parsePageRequest`가 한 곳에서 한다
 * (경로마다 허용 정렬 필드가 달라서). 여기서는 전역 ValidationPipe(whitelist·forbidNonWhitelisted)가
 * 이 세 칸을 받도록 열어 둔다. 목록 쿼리 DTO는 이 클래스를 상속한다.
 */
export class PageQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    default: 0,
    description: '0부터 시작하는 페이지 번호',
  })
  @Allow()
  page?: unknown;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: PAGE_MAX_SIZE,
    default: PAGE_DEFAULT_SIZE,
    description: `페이지 크기(기본 ${PAGE_DEFAULT_SIZE}, 최대 ${PAGE_MAX_SIZE})`,
  })
  @Allow()
  size?: unknown;

  @ApiPropertyOptional({
    type: [String],
    description: '정렬. `필드,asc|desc`를 여러 번 줄 수 있다. 허용 필드는 경로마다 다르다(05-3 §1)',
  })
  @Allow()
  sort?: unknown;
}

/** 05-2 components.schemas.PageMeta */
export class PageMetaDto implements PageMeta {
  @ApiProperty({ type: 'integer', minimum: 0 })
  number!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  size!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  totalElements!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  totalPages!: number;
}

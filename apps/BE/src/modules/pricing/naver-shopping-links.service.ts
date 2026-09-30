import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { NaverShoppingLinkDto, NaverShoppingLinkListDto } from './dto/domestic-price.dto.js';

/**
 * 네이버쇼핑 검색 URL 형식(P2-05 Proposed — 문서에 없다): 통합 검색 목록 `https://search.shopping.naver.com/search/all?query=`
 * + 검색어(URL 인코딩). 화면이 새 탭으로 연다(링크만 만들고 부르지 않는다 — 외부 호출 없음)
 */
export const NAVER_SHOPPING_SEARCH_URL = 'https://search.shopping.naver.com/search/all';

export function naverShoppingUrl(query: string): string {
  const url = new URL(NAVER_SHOPPING_SEARCH_URL);
  url.searchParams.set('query', query);
  return url.toString();
}

/** 검색어 두 가지(출처 키워드 원문 → 앵커 型番 원문), 값이 있는 것만(05-2 x-decision §7-28) */
export function naverShoppingLinksOf(input: {
  sourceKeyword: string | null;
  anchorModelCode: string | null;
}): NaverShoppingLinkDto[] {
  const out: NaverShoppingLinkDto[] = [];
  const keyword = input.sourceKeyword?.trim();
  if (keyword) out.push({ kind: 'SOURCE_KEYWORD', query: keyword, url: naverShoppingUrl(keyword) });
  const model = input.anchorModelCode?.trim();
  if (model) out.push({ kind: 'MODEL_CODE', query: model, url: naverShoppingUrl(model) });
  return out;
}

/**
 * 네이버쇼핑 검색 링크(05-2 listNaverShoppingLinks, F-PJ-12, P2-05 규칙 14). 저장하지 않는다. 링크는 국내 기준가 입력
 * 영역에만 둔다(라쿠텐 가격이 보이는 영역과 나눈다, CON-14 — 화면 규칙)
 */
@Injectable()
export class NaverShoppingLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(candidateId: number): Promise<NaverShoppingLinkListDto> {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { anchorModelCode: true, sourceKeyword: { select: { keyword: true } } },
    });
    if (!candidate) throw new ApiException('CANDIDATE_NOT_FOUND');
    return {
      items: naverShoppingLinksOf({
        sourceKeyword: candidate.sourceKeyword?.keyword ?? null,
        anchorModelCode: candidate.anchorModelCode,
      }),
    };
  }
}

import { ApiException } from '../../common/errors/api.exception.js';

/**
 * 라쿠텐 상품 URL(F-SO-31, P2-02 규칙 11). 허용 형식(Proposed — 문서에 없음, 05-1 §7.3 P2-02·PRD §8.2):
 * - `https://item.rakuten.co.jp/{샵}/{상품}/`(http도 받아 https로 맞춘다. 끝 `/`·쿼리·조각은 무시)
 * - 호스트는 `item.rakuten.co.jp` 하나(외부 호출 관문 RAKUTEN_PAGE 허용 호스트와 같다). 모바일·검색·단축 URL
 *   (`search.rakuten.co.jp`·`a.r10.to` 등)·다른 라쿠텐 서비스는 받지 않는다
 * - 샵: 영문 소문자·숫자·`-`·`_`(1~64자), 상품: 영문·숫자·`-`·`_`·`.`(1~128자)
 * 어기면 422 RAKUTEN_URL_INVALID. itemCode는 URL 조각이 아니라 페이지 JSON에서 얻는다(F-SO-32).
 */
export const RAKUTEN_ITEM_HOST = 'item.rakuten.co.jp';

const SHOP_RE = /^[a-z0-9_-]{1,64}$/;
const ITEM_RE = /^[A-Za-z0-9._-]{1,128}$/;

export interface RakutenItemUrl {
  /** URL의 샵 코드(F-BS-37 보완 조회에 쓴다) */
  shopCode: string;
  /** URL의 상품 조각(itemCode로 쓰지 않는다) */
  itemSlug: string;
  /** 정규화한 주소(https, 끝 `/`, 쿼리 없음) — 페이지 요청·item_url */
  url: string;
}

/** 형식에 맞으면 정규화한 값, 아니면 null(순수 함수) */
export function parseRakutenItemUrl(raw: string): RakutenItemUrl | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '' || url.port !== '') return null;
  if (url.hostname.toLowerCase() !== RAKUTEN_ITEM_HOST) return null;
  const parts = url.pathname.split('/').filter((p) => p !== '');
  if (parts.length !== 2) return null;
  const [shop, item] = parts as [string, string];
  const shopCode = shop.toLowerCase();
  if (!SHOP_RE.test(shopCode) || !ITEM_RE.test(item)) return null;
  return { shopCode, itemSlug: item, url: `https://${RAKUTEN_ITEM_HOST}/${shopCode}/${item}/` };
}

/** 형식 검사(422 RAKUTEN_URL_INVALID, fieldErrors sourceUrl) */
export function requireRakutenItemUrl(raw: string, field = 'sourceUrl'): RakutenItemUrl {
  const parsed = parseRakutenItemUrl(raw);
  if (!parsed) {
    throw new ApiException('RAKUTEN_URL_INVALID', {
      fieldErrors: [
        {
          field,
          message: 'https://item.rakuten.co.jp/{샵}/{상품}/ 모양의 라쿠텐 상품 주소를 넣어 주세요.',
        },
      ],
    });
  }
  return parsed;
}

/** 두 상품 URL이 같은 상품을 가리키는가(F-BS-37 itemUrl 일치). 호스트 대소문자·http/https·끝 `/`·쿼리를 무시한다 */
export function sameItemUrl(a: string, b: string): boolean {
  const pa = parseRakutenItemUrl(a);
  const pb = parseRakutenItemUrl(b);
  return pa !== null && pb !== null && pa.url === pb.url;
}

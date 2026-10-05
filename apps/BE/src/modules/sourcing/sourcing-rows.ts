import { childShoeRulesOf, judgeChildShoe } from '../../common/child-shoe/child-shoe.rules.js';
import type { RakutenSearchItem } from '../integrations/rakuten/rakuten-search.port.js';
import type { AppSettings } from '../settings/schema/settings.types.js';
import type { AnchorKeyInput } from '../step-engine/candidates/candidate-identity.service.js';
import { normalizeModelCode } from './page-json.parser.js';
import type { SearchRowDraft } from './sourcing-output.js';

/**
 * ② 검색 결과 → 비교표 행 초안, 머리 행 앵커 → 후보 앵커 키(P2-02 — `sourcing.step-runner.ts`가 다시 내보낸다).
 * 실행기와 앵커 작업(P2-03)이 같이 쓰도록 실행기 파일 밖에 둔다(파일끼리 서로 가져오지 않게).
 */

/** 검색 결과 한 건 → 비교표 API 행 초안 */
export function toRowDraft(item: RakutenSearchItem, rank: number, fetchedAt: Date): SearchRowDraft {
  return {
    searchRank: rank,
    itemCode: item.itemCode,
    shopCode: item.shopCode,
    shopName: item.shopName,
    itemName: item.itemName,
    itemUrl: item.itemUrl,
    imageUrl: item.imageUrl,
    apiItemPriceYen: item.itemPrice,
    apiItemPriceMin3Yen: item.itemPriceMin3,
    apiPointRate: item.pointRate,
    apiPostageFlag: item.postageFlag,
    reviewCount: item.reviewCount,
    reviewAverage: item.reviewAverage,
    shipOverseas: item.shipOverseasFlag === null ? null : item.shipOverseasFlag === 1,
    apiCollectedAt: fetchedAt.toISOString(),
  };
}

/**
 * 검색 결과에서 비교표 행으로 둘 것(F-SO-04, P2-02 규칙 5): 상품명에 아동 단어(P2-01 공통 규칙 — 바퀴·고령자 단어 포함)가 있으면
 * 저장하지 않는다. 같은 itemCode는 한 번만(ERD UNIQUE). 검색 순위는 원래 순서(뺀 행 자리는 비운다).
 */
export function filterSearchRows(
  items: readonly RakutenSearchItem[],
  settings: Readonly<AppSettings>,
  fetchedAt: Date,
): { rows: SearchRowDraft[]; excluded: number } {
  const rules = childShoeRulesOf(settings);
  const seen = new Set<string>();
  const rows: SearchRowDraft[] = [];
  let excluded = 0;
  items.forEach((item, i) => {
    if (judgeChildShoe({ texts: [item.itemName] }, rules).excluded) {
      excluded += 1;
      return;
    }
    if (seen.has(item.itemCode)) return;
    seen.add(item.itemCode);
    rows.push(toRowDraft(item, i + 1, fetchedAt));
  });
  return { rows, excluded };
}

/**
 * 머리 행의 앵커 → 후보 앵커 키(型番이 있으면 型番 **정규화값**(candidate.anchor_model_code — ERD), 없으면 앵커 상품 —
 * ck_candidate_anchor_one). 색상 코드가 없으면 null
 */
export function anchorKeyOfHead(head: {
  anchorModelCodeNorm: string | null;
  anchorModelCode: string | null;
  anchorItemCode: string | null;
  anchorColorCode: string | null;
}): AnchorKeyInput | null {
  if (!head.anchorColorCode) return null;
  const model = head.anchorModelCodeNorm ?? normalizeModelCode(head.anchorModelCode);
  if (model) return { anchorModelCode: model, anchorColorCode: head.anchorColorCode };
  if (head.anchorItemCode) {
    return { anchorItemCode: head.anchorItemCode, anchorColorCode: head.anchorColorCode };
  }
  return null;
}

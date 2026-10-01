import type { components } from '@/shared/api/schema';
import { formatKrw, formatKstTime } from '@/shared/lib/format';
import type { StepCode } from '@/shared/lib/steps';
import { uploadImageFileUrl } from './upload';

/** 05-2 ApprovalPreview(G4 승인 미리보기) */
export type ApprovalPreview = components['schemas']['ApprovalPreview'];
/** 05-2 PreValidationResult */
export type PreValidationResult = components['schemas']['PreValidationResult'];
/** 05-2 PreValidationCheck */
export type PreValidationCheck = components['schemas']['PreValidationCheck'];
export type PreValidationCheckCode = PreValidationCheck['checkCode'];
/** 05-2 ApprovalSizeOption */
export type ApprovalSizeOption = components['schemas']['ApprovalSizeOption'];

// ── 문구(시안 Approval.dc.html) ──
export const APPROVAL_TITLE = '최종 승인';
export const APPROVAL_DESCRIPTION =
  '상품 전체와 사전 검증 결과를 확인하고 승인합니다. 등록은 이 화면의 승인으로만 됩니다.';
export const PREVIEW_TITLE = '전체 미리보기';
export const PREVIEW_CAPTION = '업로드한 이미지로 만든 최종 미리보기';
export const PRE_VALIDATION_TITLE = '사전 검증 결과';
export const PRE_VALIDATION_NOTE = '화면을 열 때 검사했고, 승인 직전에 한 번 더 검사합니다.';
export const REGISTER_TITLE = '⑨ 등록';
export const APPROVE_LABEL = '승인·등록';
export const API_BLOCKED_NOTE =
  '등록 API 차단이 켜져 있어 지금 누르면 등록하지 않고 요청 내용과 검증 결과만 저장합니다.';
export const DETAIL_PARTS_TEXT = '카피 · 상품 사양 · 고시 · 구매대행 고지';
export const REFETCH_CAPTION = '다시 읽고 다시 판정합니다';
export const PRE_VALIDATION_RUNNING = '사전 검증 중입니다.';

/**
 * 판정 유효 시간 안내(M1 동작 — 시안의 '20:02가 지나면 승인할 때 자동으로 다시 읽고 …'는 M2 F-AP-52라 M1 동작으로 고쳤다:
 * '재조회' 버튼과 409 JUDGEMENT_EXPIRED)
 */
export function freshnessNote(expiresAt: string | null | undefined): string {
  const until = expiresAt ? `(${formatKstTime(expiresAt)}까지)` : '';
  return `판정 유효 시간${until}이 지나면 승인할 수 없습니다. '재조회'로 다시 읽고 다시 판정해 주세요.`;
}

/** 상품명 글자 수(코드 포인트 — BE REQUIRED_FIELDS·P3-04와 같은 기준) */
export function productNameLength(name: string): number {
  return [...name].length;
}

/** 순이익·마진율을 보일 판매 사이즈(순이익이 가장 낮은 판매 사이즈 — P2-05 판정 화면과 같은 기준) */
export function summarySize(
  preview: Pick<ApprovalPreview, 'marginBreakdown'>,
): ApprovalSizeOption | null {
  const sellable = preview.marginBreakdown.sizes.filter(
    (size) => size.isSellable && size.profitAKrw != null,
  );
  if (sellable.length === 0) return null;
  return sellable.reduce((min, size) =>
    (size.profitAKrw ?? 0) < (min.profitAKrw ?? 0) ? size : min,
  );
}

/** 판매 사이즈 P_min 가운데 가장 큰 값(사전 검증 '판매가 ≥ P_min' 줄) */
export function maxMinimumPrice(preview: Pick<ApprovalPreview, 'marginBreakdown'>): number | null {
  const values = preview.marginBreakdown.sizes
    .filter((size) => size.isSellable && size.pMinKrw != null)
    .map((size) => size.pMinKrw!);
  return values.length > 0 ? Math.max(...values) : null;
}

/** 요청 초안의 옵션(조합형 사이즈 줄) */
export interface DraftOption {
  sizeMm: number;
  stockQuantity: number;
  price: number;
}

interface DraftShape {
  originProduct?: {
    stockQuantity?: number;
    detailAttribute?: {
      optionInfo?: {
        optionCombinations?: { optionName1?: string; stockQuantity?: number; price?: number }[];
      };
    };
    deliveryInfo?: {
      deliveryFee?: { deliveryFeeType?: string };
      businessCustomsClearanceSaleYn?: boolean;
    };
  };
}

export function draftOptions(preview: Pick<ApprovalPreview, 'requestJsonDraft'>): DraftOption[] {
  const draft = preview.requestJsonDraft as DraftShape;
  return (draft.originProduct?.detailAttribute?.optionInfo?.optionCombinations ?? []).map(
    (row) => ({
      sizeMm: Number(row.optionName1),
      stockQuantity: row.stockQuantity ?? 0,
      price: row.price ?? 0,
    }),
  );
}

/** '조합형 · 각 2개, 합 10개'(재고가 사이즈마다 다르면 '합 n개') */
export function optionStockText(preview: ApprovalPreview): string {
  const options = draftOptions(preview);
  const sum = options.reduce((total, option) => total + option.stockQuantity, 0);
  const kind = preview.optionType === 'STANDARD' ? '표준형' : '조합형';
  const same =
    options.length > 0 && options.every((o) => o.stockQuantity === options[0]!.stockQuantity);
  return same
    ? `${kind} · 각 ${options[0]!.stockQuantity}개, 합 ${sum}개`
    : `${kind} · 합 ${sum}개`;
}

/** 소싱 방식 글(F-AP-08) */
export function sourcingMethodText(method: ApprovalPreview['sourcingMethod']): string {
  if (!method) return '—';
  if (method.method === 'COMPARED') return `비교함 · ${method.itemCode}`;
  if (method.method === 'NO_COMPARISON_CONFIRMED') return `비교 없이 확정 · ${method.itemCode}`;
  return `비교도 확정 기록도 없음 · ${method.itemCode}`;
}

/** 카테고리 경로('패션잡화 > 남성신발 > 운동화 > 러닝화') */
export function categoryPathText(whole: string | null | undefined): string {
  return whole
    ? whole
        .split('>')
        .map((part) => part.trim())
        .join(' > ')
    : '—';
}

/** 태그 요약('젤카야노14 · 아식스운동화 · 조깅화 · 남자운동화 외 6개') */
export function tagsSummaryText(
  tags: readonly { text: string }[],
  shown = 4,
): { head: string; rest: number } {
  return {
    head: tags
      .slice(0, shown)
      .map((tag) => tag.text)
      .join(' · '),
    rest: Math.max(0, tags.length - shown),
  };
}

/** 상세 요약 둘째 줄('원산지 베트남 · 소재 … · 굽높이 …') */
export function detailFactsText(preview: ApprovalPreview): string {
  const parts: string[] = [];
  if (preview.originLabel) parts.push(`원산지 ${preview.originLabel}`);
  const notice = preview.noticeFields as Record<string, string | undefined>;
  if (notice.material) parts.push(notice.material);
  if (notice.height) parts.push(`굽높이 ${notice.height}`);
  return parts.join(' · ');
}

/** 배송·통관 줄('무료배송 · 관부가세 포함 · 개인통관') */
export function deliveryText(preview: ApprovalPreview): string {
  const draft = preview.requestJsonDraft as DraftShape & {
    originProduct?: { detailAttribute?: { customsTaxType?: string } };
  };
  const delivery = draft.originProduct?.deliveryInfo;
  const parts = [
    delivery?.deliveryFee?.deliveryFeeType === 'FREE' ? '무료배송' : '배송비 확인 필요',
    draft.originProduct?.detailAttribute?.customsTaxType === 'INCLUDED'
      ? '관부가세 포함'
      : '관부가세 확인 필요',
    delivery?.businessCustomsClearanceSaleYn === false ? '개인통관' : '통관 방식 확인 필요',
  ];
  return parts.join(' · ');
}

/** 요청 JSON 요약('판매중 · 전시중지 · 무료배송 · 관부가세 포함 · 개인통관 · 태그 10개') */
export function requestSummaryText(preview: ApprovalPreview): string {
  const display = preview.displayStatusType === 'SUSPENSION' ? '전시중지' : '즉시 전시';
  return ['판매중', display, deliveryText(preview), `태그 ${preview.tags.length}개`].join(' · ');
}

/**
 * 상세 렌더링용 HTML(P4-02 Proposed — 미리보기 렌더링 방식): `detailContent`의 업로드 URL(shop-phinf, 외부)을 같은 출처의 로컬 파일
 * (`/api/v1/image-assets/{imageAssetId}/file`)로 바꾸고, 바꿀 수 없는 이미지는 지운다. 그래서 브라우저가 외부 주소를 부르지 않는다.
 * `origin`을 주면 절대 주소로 쓴다(sandbox iframe은 고유 출처라 CSP `'self'`가 앱 주소에 맞지 않는다). 요청 JSON은 URL 그대로 둔다.
 */
export function localizeDetailContent(
  html: string,
  imageAssetIdByUrl: ReadonlyMap<string, number>,
  origin = '',
): string {
  return html.replace(/<img\b[^>]*>/giu, (tag) => {
    const src = /\ssrc\s*=\s*"([^"]*)"/iu.exec(tag)?.[1]?.replace(/&amp;/g, '&');
    const id = src !== undefined ? imageAssetIdByUrl.get(src) : undefined;
    if (id === undefined) return '';
    return tag
      .replace(/\ssrcset\s*=\s*"[^"]*"/giu, '')
      .replace(/\ssrc\s*=\s*"[^"]*"/iu, ` src="${origin}${uploadImageFileUrl(id)}"`);
  });
}

/** sandbox iframe에 넣을 문서(스크립트 없음 — sandbox=""; 이미지는 앱 출처만) */
export function detailPreviewDocument(body: string, origin: string): string {
  const imgSrc = origin ? origin : "'none'";
  return [
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'">`,
    '<style>body{margin:12px;font:14px/1.6 system-ui,sans-serif}img{max-width:100%;height:auto}</style>',
    `</head><body>${body}</body></html>`,
  ].join('');
}

// ── 사전 검증 줄(시안 13줄 ↔ 검사 코드 15개 — P4-02 Proposed 대응표) ──

/** 단계 링크 글(시안 줄 오른쪽 링크) */
export const STEP_LINK_LABEL: Record<StepCode, string> = {
  SOURCING: '② 소싱',
  PRICING: '③ 판정',
  CATEGORY: '④ 카테고리',
  THUMBNAIL: '⑤ 썸네일',
  COPY: '⑥ 상세',
  NOTICE_RAW: '⑥ 상세',
  NOTICE_HTML: '⑥ 상세',
  TAGS: '⑦ 태그',
  UPLOAD: '⑧ 업로드',
  REGISTER: '⑨ 등록',
};

/** 게이트 → 고칠 단계(G2 판정·G3 썸네일) */
const GATE_STEP: Record<string, StepCode> = { G2: 'PRICING', G3: 'THUMBNAIL' };

export type PreValidationLineId =
  | 'REPRESENTATIVE_IMAGE'
  | 'IMAGES'
  | 'PRODUCT_NAME'
  | 'WORDING'
  | 'NOTICE_BLOCK'
  | 'ORIGIN'
  | 'MARGIN'
  | 'OPTIONS'
  | 'TAGS'
  | 'CATEGORY'
  | 'STEP_FRESHNESS'
  | 'DUPLICATE'
  | 'JUDGEMENT_FRESHNESS';

interface LineSpec {
  id: PreValidationLineId;
  codes: PreValidationCheckCode[];
  /** 통과 줄의 링크(시안) */
  link: StepCode | null;
  label: (preview: ApprovalPreview | undefined) => { label: string; detail?: string };
}

/**
 * 시안 Approval.dc.html의 검사 13줄과 05-3 §5.3 검사 코드 15개의 대응(Proposed — FE 04-3 §20): '금지어·최소 차단어 없음 · 추가 청구
 * 표현 없음' 줄 = MIN_BLOCK_WORDS + EXTRA_CHARGE_WORDING, '원산지 입력됨 · …, '일본산' 표현 없음' 줄 = ORIGIN + JAPAN_WORDING. 나머지는
 * 한 줄 = 한 코드. 순서는 시안 그대로다.
 */
export const PRE_VALIDATION_LINES: readonly LineSpec[] = [
  {
    id: 'REPRESENTATIVE_IMAGE',
    codes: ['REPRESENTATIVE_IMAGE_SOURCE'],
    link: 'THUMBNAIL',
    label: () => ({ label: '대표이미지가 선택본(G3)과 같음' }),
  },
  {
    id: 'IMAGES',
    codes: ['IMAGES'],
    link: null,
    label: () => ({ label: '참조 전용 원본 없음', detail: '· 모든 이미지가 업로드 주소' }),
  },
  {
    id: 'PRODUCT_NAME',
    codes: ['REQUIRED_FIELDS'],
    link: 'NOTICE_HTML',
    label: (p) => ({
      label: '상품명 100자 이내',
      detail: p ? `· ${productNameLength(p.productName)}자` : undefined,
    }),
  },
  {
    id: 'WORDING',
    codes: ['MIN_BLOCK_WORDS', 'EXTRA_CHARGE_WORDING'],
    link: 'NOTICE_HTML',
    label: () => ({ label: '금지어·최소 차단어 없음', detail: '· 추가 청구 표현 없음' }),
  },
  {
    id: 'NOTICE_BLOCK',
    codes: ['NOTICE_BLOCK'],
    link: 'NOTICE_HTML',
    label: () => ({ label: '구매대행 고지 블록 원본과 일치' }),
  },
  {
    id: 'ORIGIN',
    codes: ['ORIGIN', 'JAPAN_WORDING'],
    link: 'NOTICE_RAW',
    label: (p) => ({
      label: '원산지 입력됨',
      detail: `· ${p?.originLabel ? `${p.originLabel}, ` : ''}'일본산' 표현 없음`,
    }),
  },
  {
    id: 'MARGIN',
    codes: ['NEGATIVE_MARGIN'],
    link: 'PRICING',
    label: (p) => {
      const pMin = p ? maxMinimumPrice(p) : null;
      return {
        label: '모든 판매 사이즈 판매가 ≥ P_min',
        detail: pMin !== null ? formatKrw(pMin) : undefined,
      };
    },
  },
  {
    id: 'OPTIONS',
    codes: ['OPTIONS'],
    link: 'SOURCING',
    label: (p) => ({
      label: `사이즈 옵션${p ? ` ${draftOptions(p).length}개` : ''}가 재고와 일치`,
    }),
  },
  {
    id: 'TAGS',
    codes: ['TAGS'],
    link: 'TAGS',
    label: (p) => ({ label: `태그${p ? ` ${p.tags.length}개` : ''} · 제한 태그 없음` }),
  },
  {
    id: 'CATEGORY',
    codes: ['CATEGORY'],
    link: 'CATEGORY',
    label: (p) => {
      const gender = p?.wholeCategoryName?.includes('여성')
        ? '여성'
        : p?.wholeCategoryName?.includes('남성')
          ? '남성'
          : null;
      return {
        label: '아동화 신호 없음',
        detail: gender ? `· ${gender} 리프 카테고리` : '· 리프 카테고리',
      };
    },
  },
  {
    id: 'STEP_FRESHNESS',
    codes: ['STEP_FRESHNESS'],
    link: null,
    label: () => ({ label: '②~⑧ 단계 완료·최신', detail: '· G2·G3 그대로' }),
  },
  {
    id: 'DUPLICATE',
    codes: ['DUPLICATE'],
    link: null,
    label: (p) => ({ label: '중복 없음', detail: p?.sellerManagementCode }),
  },
  {
    id: 'JUDGEMENT_FRESHNESS',
    codes: ['JUDGEMENT_FRESHNESS'],
    link: null,
    label: (p) => ({
      label: judgementWindowText(p?.rakutenPageCollectedAt, p?.judgementExpiresAt),
    }),
  },
];

/** '라쿠텐 페이지 14:02 받음 · 20:02까지 유효' */
export function judgementWindowText(
  collectedAt: string | null | undefined,
  expiresAt: string | null | undefined,
): string {
  if (!collectedAt) return '라쿠텐 페이지 받은 시각 없음';
  const until = expiresAt ? ` · ${formatKstTime(expiresAt)}까지 유효` : '';
  return `라쿠텐 페이지 ${formatKstTime(collectedAt)} 받음${until}`;
}

/** 화면 한 줄 */
export interface PreValidationLineView {
  id: PreValidationLineId;
  /** null = 검사 결과 없음(검사 중·실패) */
  passed: boolean | null;
  label: string;
  detail?: string;
  /** 실패 사유(서버 reason) */
  reasons: string[];
  /** 고칠 단계 링크(실패면 서버 stepCode — 게이트면 근거 단계, 통과면 시안 링크) */
  linkStep: StepCode | null;
}

/** 검사 결과 → 시안 13줄 */
export function preValidationLines(
  result: PreValidationResult | undefined,
  preview: ApprovalPreview | undefined,
): PreValidationLineView[] {
  return PRE_VALIDATION_LINES.map((spec) => {
    const checks = (result?.checks ?? []).filter((check) => spec.codes.includes(check.checkCode));
    const failed = checks.filter((check) => !check.passed);
    const passed = result ? failed.length === 0 : null;
    const fix = failed.find((check) => check.stepCode || check.gateCode);
    const failStep = fix
      ? (fix.stepCode ?? (fix.gateCode ? GATE_STEP[fix.gateCode] : null) ?? null)
      : null;
    return {
      id: spec.id,
      passed,
      ...spec.label(preview),
      reasons: failed.map((check) => check.reason ?? '통과하지 못했습니다'),
      linkStep: passed === false ? failStep : spec.link,
    };
  });
}

/** 머리 칩 글('13개 모두 통과' / 'n개 실패') */
export function preValidationSummary(lines: readonly PreValidationLineView[]): {
  allPassed: boolean;
  text: string;
} {
  const failed = lines.filter((line) => line.passed === false).length;
  return failed === 0
    ? { allPassed: true, text: `${lines.length}개 모두 통과` }
    : { allPassed: false, text: `${lines.length}개 중 ${failed}개 실패` };
}

/** 승인 버튼 상태(P4-02 규칙 15 — BLOCK 실패가 하나라도 있거나 approveEnabled=false면 끈다) */
export function approveState(input: {
  preview: ApprovalPreview | undefined;
  previewError: { message: string } | null;
  result: PreValidationResult | undefined;
  resultError: { message: string } | null;
  lines: readonly PreValidationLineView[];
}): { enabled: boolean; reason: string | null } {
  const { preview, previewError, result, resultError, lines } = input;
  if (previewError) return { enabled: false, reason: previewError.message };
  if (!preview) return { enabled: false, reason: '승인 미리보기를 불러오는 중입니다.' };
  if (!preview.approveEnabled) {
    return {
      enabled: false,
      reason: preview.approveDisabledReason?.message ?? '지금은 승인할 수 없습니다.',
    };
  }
  if (resultError) return { enabled: false, reason: resultError.message };
  if (!result) return { enabled: false, reason: PRE_VALIDATION_RUNNING };
  if (!result.approvable) {
    const failed = lines.filter((line) => line.passed === false).map((line) => line.label);
    return {
      enabled: false,
      reason: `사전 검증 ${failed.length}개 항목을 통과하지 못했습니다(${failed.join(', ')}). 위 목록의 단계로 가서 고친 뒤 다시 확인해 주세요.`,
    };
  }
  return { enabled: true, reason: null };
}

import {
  APPROVAL_SAMPLE,
  approvalContext,
  approvalDetailContent,
  readFixtureText,
  readVariant,
  variantContext,
} from '../../../../test/fixtures/registration/approval/approval-fixtures.js';
import {
  categoryCheck,
  duplicateCheck,
  extraChargeWordingCheck,
  imagesCheck,
  japanWordingCheck,
  judgementFreshnessCheck,
  minBlockWordsCheck,
  negativeMarginCheck,
  noticeBlockCheck,
  optionsCheck,
  originCheck,
  representativeImageSourceCheck,
  requiredFieldsCheck,
  stepFreshnessCheck,
  tagsCheck,
} from './checks/index.js';
import { findWords, wordingKey } from './checks/check-helpers.js';
import { rateBasisPoints } from './checks/negative-margin.check.js';
import { isApprovable, runPreValidationChecks } from './pre-validation.js';
import { PRE_VALIDATION_CHECK_CODES, type PreValidationContext } from './pre-validation.types.js';

/** 기본 문맥에 입력 조각을 덧쓴다 */
const ctxWith = (inputs: object, extra: { draft?: object; now?: string } = {}) =>
  approvalContext({ inputs: inputs as never, draft: extra.draft as never, now: extra.now });

describe('사전 검증 15항목(P4-02 §6 단위 — fixture ctx)', () => {
  it('기본 fixture는 15개 모두 통과하고 05-3 §5.3 순서·BLOCK이다', () => {
    const checks = runPreValidationChecks(approvalContext());
    expect(checks.map((c) => c.checkCode)).toEqual([...PRE_VALIDATION_CHECK_CODES]);
    expect(checks.filter((c) => !c.passed)).toEqual([]);
    expect(checks.every((c) => c.severity === 'BLOCK' && c.reason === null)).toBe(true);
    expect(isApprovable(checks)).toBe(true);
  });

  describe('REQUIRED_FIELDS', () => {
    it('상품명 100자 통과 / 101자 실패(코드 포인트)', () => {
      const name101 = (readVariant('name-101.json').inputs as { assembly: { productName: string } })
        .assembly.productName;
      expect([...name101]).toHaveLength(101);
      const name100 = [...name101].slice(0, 100).join('');
      expect(requiredFieldsCheck(ctxWith({ assembly: { productName: name100 } })).passed).toBe(
        true,
      );
      const failed = requiredFieldsCheck(variantContext('name-101.json'));
      expect(failed.passed).toBe(false);
      expect(failed.reason).toContain('101자');
      expect(failed.stepCode).toBe('NOTICE_HTML');
    });

    it('importer 빈 값 / naverShoppingRegistration 없음 → 각각 실패', () => {
      const importer = requiredFieldsCheck(ctxWith({ assembly: { importer: '' } }));
      expect(importer.passed).toBe(false);
      expect(importer.reason).toContain('importer');
      const naver = requiredFieldsCheck(
        ctxWith(
          {},
          {
            draft: {
              requestJson: { smartstoreChannelProduct: { naverShoppingRegistration: null } },
            },
          },
        ),
      );
      expect(naver.passed).toBe(false);
      expect(naver.reason).toContain('naverShoppingRegistration');
    });

    it('택배사·고시 필수 항목이 비면 실패한다', () => {
      const noCompany = requiredFieldsCheck(
        ctxWith({ profile: { fragment: { deliveryInfo: { deliveryCompany: null } } } }),
      );
      expect(noCompany.reason).toContain('deliveryCompany');
      const noMaterial = requiredFieldsCheck(
        ctxWith({ assembly: { noticeFields: { material: ' ' } } }),
      );
      expect(noMaterial.reason).toContain('material');
    });
  });

  describe('IMAGES', () => {
    it('대표 0장·2장, 추가 10장 → 실패', () => {
      const base = approvalContext().inputs.upload!.images;
      const zero = imagesCheck(ctxWith({ upload: { images: { 0: { role: 'ADDITIONAL' } } } }));
      expect(zero.passed).toBe(false);
      expect(zero.reason).toContain('대표이미지가 0장');
      const two = imagesCheck(ctxWith({ upload: { images: { 1: { role: 'REPRESENTATIVE' } } } }));
      expect(two.reason).toContain('대표이미지가 2장');
      const ten = Array.from({ length: 10 }, (_, i) => ({ ...base[1]!, sortOrder: i + 1 }));
      const many = imagesCheck(ctxWith({ upload: { images: [base[0], ...ten] } }));
      expect(many.reason).toContain('추가이미지가 10장');
    });

    it('detailContent에 업로드 목록 밖 URL 1개 / 999×1000 업로드본 → 실패', () => {
      const detail =
        approvalDetailContent() +
        '<p><img src="https://shop-phinf.pstatic.net/other/not-uploaded.jpg" alt=""></p>';
      const outside = imagesCheck(ctxWith({ upload: { detailContent: detail } }));
      expect(outside.passed).toBe(false);
      expect(outside.reason).toContain('업로드 API가 준 주소가 아닌 이미지가 1개');
      const small = imagesCheck(ctxWith({ upload: { images: { 0: { width: 999 } } } }));
      expect(small.passed).toBe(false);
      expect(small.reason).toContain('999×1000');
    });

    it("'참조 전용' 원천 사슬이면 실패", () => {
      const ref = imagesCheck(
        ctxWith({ upload: { images: { 1: { referenceOnlyInChain: true } } } }),
      );
      expect(ref.passed).toBe(false);
      expect(ref.reason).toContain('참조 전용');
    });
  });

  describe('OPTIONS', () => {
    it('250·250 중복 / 재고 합 9 ≠ stockQuantity 10 → 실패', () => {
      const dup = optionsCheck(variantContext('dup-mm-options.json'));
      expect(dup.passed).toBe(false);
      expect(dup.reason).toContain('같은 mm 옵션명');
      const sum = optionsCheck(variantContext('stock-sum-mismatch.json'));
      expect(sum.passed).toBe(false);
      expect(sum.reason).toContain('원상품 재고 10개가 옵션 재고 합 9개');
    });

    it('salePrice 0 + 옵션가 5 실패 / 0 + 10 통과', () => {
      const optionsWith = (price: number) =>
        approvalContext().draft.options.map((option) => ({ ...option, optionPriceKrw: price }));
      const five = optionsCheck(
        ctxWith({}, { draft: { salePriceKrw: 0, options: optionsWith(5) } }),
      );
      expect(five.passed).toBe(false);
      expect(five.reason).toContain('10원보다 작은 옵션');
      const ten = optionsCheck(
        ctxWith({}, { draft: { salePriceKrw: 0, options: optionsWith(10) } }),
      );
      expect(ten.passed).toBe(true);
    });

    it('고시 {250,255} vs 옵션 {250,255,260} → 실패', () => {
      const ctx = ctxWith({
        assembly: { noticeSizesMm: [250, 255], specSizesMm: [250, 255, 260] },
        judgement: {
          sizes: {
            3: { isSellable: false, unsellableReason: 'TAXABLE', isDutyFree: false },
            4: { isSellable: false, unsellableReason: 'TAXABLE', isDutyFree: false },
          },
        },
      });
      expect(ctx.draft.options.map((o) => o.sizeMm)).toEqual([250, 255, 260]);
      const result = optionsCheck(ctx);
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('고시 사이즈 {250,255}가 옵션 사이즈 {250,255,260}');
    });

    it('사양 블록 사이즈를 읽지 못하거나 다르면 실패', () => {
      expect(optionsCheck(ctxWith({ assembly: { specSizesMm: null } })).reason).toContain(
        '읽지 못했습니다',
      );
      expect(optionsCheck(ctxWith({ assembly: { specSizesMm: [250] } })).reason).toContain(
        '상품 사양 블록',
      );
    });
  });

  describe('TAGS', () => {
    it('11개 / restricted 1건 / 조회 500 → 실패(조회 실패는 passed=false에 사유)', () => {
      const tags = approvalContext().inputs.tags!.tags;
      const eleven = tagsCheck(
        ctxWith({ tags: { tags: [...tags, { text: '열한번째', code: null, finalOrder: 10 }] } }),
      );
      expect(eleven.passed).toBe(false);
      expect(eleven.reason).toContain('11개');
      const hit = tagsCheck({
        ...approvalContext(),
        restrictedTags: { ok: true, restrictedTags: ['쿠션운동화'] },
      });
      expect(hit.passed).toBe(false);
      expect(hit.reason).toContain("'쿠션운동화'");
      const failed = tagsCheck({
        ...approvalContext(),
        restrictedTags: { ok: false, reason: '커머스API 응답을 받지 못했습니다(HTTP_500)' },
      });
      expect(failed.passed).toBe(false);
      expect(failed.reason).toContain('제한 태그를 확인하지 못했습니다');
      expect(failed.reason).toContain('HTTP_500');
      expect(failed.stepCode).toBe('TAGS');
    });

    it('미리보기(외부 조회 없음 — null)는 개수만 본다', () => {
      expect(tagsCheck({ ...approvalContext(), restrictedTags: null }).passed).toBe(true);
    });
  });

  describe('NOTICE_BLOCK', () => {
    it('고지 한 글자 수정 → 실패(편집)', () => {
      const edited = approvalDetailContent(readFixtureText('edited-disclosure.html'));
      const result = noticeBlockCheck(ctxWith({ upload: { detailContent: edited } }));
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('AGENCY');
      expect(result.reason).toContain('편집됨');
    });

    it('가죽인데 조건부 블록 없음 → 실패 / 섬유 겉감이면 조건부 블록 없이도 통과', () => {
      const withoutLeather = approvalDetailContent().replace(
        /<p data-block-id="LEATHER_SAFETY">[\s\S]*?<\/p>/,
        '',
      );
      const leather = noticeBlockCheck(ctxWith({ upload: { detailContent: withoutLeather } }));
      expect(leather.passed).toBe(false);
      expect(leather.reason).toContain('LEATHER_SAFETY');
      const textile = noticeBlockCheck(
        ctxWith({
          upload: { detailContent: withoutLeather },
          facts: { materials: { upper: '합성섬유', lining: null, sole: '고무' } },
        }),
      );
      expect(textile.passed).toBe(true);
    });

    it('자리표시자 값만 고쳐도(⑥-3 기록 해시와 다름) 실패한다', () => {
      const renamed = approvalDetailContent().replace('[내 상호]가 일본', '[다른 상호]가 일본');
      const result = noticeBlockCheck(ctxWith({ upload: { detailContent: renamed } }));
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('AGENCY');
    });

    it('필수 블록이 빠지면 실패한다', () => {
      const without = approvalDetailContent().replace(
        /<p data-block-id="WITHDRAWAL">[\s\S]*?<\/p>/,
        '',
      );
      expect(noticeBlockCheck(ctxWith({ upload: { detailContent: without } })).reason).toContain(
        '빠졌습니다',
      );
    });
  });

  describe('ORIGIN', () => {
    const otherUrl = 'https://item.rakuten.co.jp/shop-old/555/';
    it('이전 itemCode의 근거 URL / basis_item_code 다름 / 재확인 미해결 / 03 코드 + 표기 없음 → 실패', () => {
      const oldUrl = originCheck(
        ctxWith({ facts: { origin: { evidenceUrl: otherUrl, basisItemCode: 'shop-old:555' } } }),
      );
      expect(oldUrl.passed).toBe(false);
      expect(oldUrl.reason).toContain('페이지가 아닙니다');
      const owner = originCheck(
        ctxWith({
          facts: {
            origin: {
              valueSource: 'OWNER_INPUT',
              evidenceUrl: otherUrl,
              basisItemCode: 'shop-old:555',
            },
          },
        }),
      );
      expect(owner.passed).toBe(false);
      expect(owner.reason).toContain('바뀌기 전에');
      const recheck = originCheck(variantContext('origin-recheck.json'));
      expect(recheck.passed).toBe(false);
      expect(recheck.reason).toContain('재확인 필요');
      const code03 = originCheck(variantContext('origin-03-no-label.json'));
      expect(code03.passed).toBe(false);
      expect(code03.reason).toContain('실제 나라 표기');
    });

    it('오너 입력이 지금 itemCode면 통과, 03 코드 + 실제 나라 표기면 통과', () => {
      expect(
        originCheck(
          ctxWith({ facts: { origin: { valueSource: 'OWNER_INPUT', evidenceUrl: otherUrl } } }),
        ).passed,
      ).toBe(true);
      expect(originCheck(ctxWith({ assembly: { originAreaCode: '03' } })).passed).toBe(true);
    });

    it('원산지가 없으면 실패', () => {
      expect(originCheck(ctxWith({ facts: { origin: { countries: [] } } })).reason).toContain(
        '확정되지 않았습니다',
      );
    });
  });

  describe('JAPAN_WORDING', () => {
    it("제조국 베트남 + '일본산' 실패 / 제조국 일본 + '일본산' 통과", () => {
      const vietnam = japanWordingCheck(variantContext('japan-wording.json'));
      expect(vietnam.passed).toBe(false);
      expect(vietnam.reason).toContain("'일본산'");
      const japan = japanWordingCheck(
        approvalContext({
          inputs: {
            ...(readVariant('japan-wording.json').inputs as object),
            facts: { origin: { countries: ['일본'] } },
          } as never,
        }),
      );
      expect(japan.passed).toBe(true);
    });

    it('기본 고지(판매처 국가(일본))는 혼동 표현이 아니다', () => {
      expect(japanWordingCheck(approvalContext()).passed).toBe(true);
    });
  });

  describe('MIN_BLOCK_WORDS', () => {
    const words = (readVariant('blocked-words.json') as unknown as { words: string[] }).words;
    it.each(words)("상품명에 '%s' → 실패", (word) => {
      const result = minBlockWordsCheck(
        ctxWith({ assembly: { productName: `${APPROVAL_SAMPLE.productName} ${word}` } }),
      );
      expect(result.passed).toBe(false);
      expect(result.reason).toContain(`'${word}'`);
    });

    it('기본 고지 템플릿·사양 블록·카피에는 차단어가 섞이지 않았다(부분 일치 — 공백·전각 무시)', () => {
      expect(minBlockWordsCheck(approvalContext()).passed).toBe(true);
      expect(findWords(['정품100％ 보장'], ['정품 100%'])).toEqual(['정품 100%']);
      expect(findWords(['비공식 수입'], ['공식'])).toEqual(['공식']);
      expect(wordingKey(' 반품  불가 ')).toBe('반품불가');
    });
  });

  describe('EXTRA_CHARGE_WORDING', () => {
    const variant = readVariant('extra-charge.json') as unknown as Record<
      string,
      { inputs: object }
    >;
    it("'관부가세 별도'(카피) / 유료 배송비 → 실패", () => {
      const wording = extraChargeWordingCheck(
        approvalContext({ inputs: variant.wording!.inputs as never }),
      );
      expect(wording.passed).toBe(false);
      expect(wording.reason).toContain("'관부가세 별도'");
      expect(wording.stepCode).toBe('COPY');
      const paid = extraChargeWordingCheck(
        approvalContext({ inputs: variant.paidDelivery!.inputs as never }),
      );
      expect(paid.passed).toBe(false);
      expect(paid.reason).toContain('무료가 아닙니다');
    });
  });

  describe('NEGATIVE_MARGIN', () => {
    it('profit_b_krw −1 실패 / 0 통과', () => {
      expect(negativeMarginCheck(variantContext('negative-margin-b.json')).passed).toBe(false);
      expect(
        negativeMarginCheck(ctxWith({ judgement: { sizes: { 0: { profitBKrw: 0 } } } })).passed,
      ).toBe(true);
    });

    it('m 0.10, 판매가 167,300원, Π_min 5,000원: Π_A 16,729 실패 / 16,730 통과 / 27,418(시안) 통과', () => {
      const at = (profitAKrw: number) =>
        negativeMarginCheck(ctxWith({ judgement: { sizes: { 0: { profitAKrw } } } }));
      const fail = at(16729);
      expect(fail.passed).toBe(false);
      expect(fail.reason).toContain('16,730');
      expect(at(16730).passed).toBe(true);
      expect(at(27418).passed).toBe(true);
    });

    it('최소 이익(Π_min)보다 작으면 실패하고, 만분율은 정수로 읽는다', () => {
      const result = negativeMarginCheck(
        ctxWith({ judgement: { targetMarginRate: '0.0000', sizes: { 0: { profitAKrw: 4999 } } } }),
      );
      expect(result.passed).toBe(false);
      expect(rateBasisPoints('0.1000')).toBe(1000);
      expect(rateBasisPoints('0.1')).toBe(1000);
      expect(rateBasisPoints('abc')).toBeNull();
    });
  });

  describe('JUDGEMENT_FRESHNESS', () => {
    const at = (now: string, inputs: object = {}) =>
      judgementFreshnessCheck(ctxWith(inputs, { now }));
    it('수집 뒤 5시간 59분 통과 / 6시간 통과 / 6시간 1초 실패', () => {
      expect(at('2026-09-28T11:01:00.000Z').passed).toBe(true);
      expect(at('2026-09-28T11:02:00.000Z').passed).toBe(true);
      const late = judgementFreshnessCheck(variantContext('collected-6h01s.json'));
      expect(late.passed).toBe(false);
      expect(late.stepCode).toBe('SOURCING');
      expect(late.reason).toContain('14:02 받음 · 20:02까지 유효');
    });

    it('③만 다시 실행(새 judged_at, 같은 수집 시각) 뒤 6시간 1초 → 실패', () => {
      const rerun = at('2026-09-28T11:02:01.000Z', {
        judgement: { priceJudgementId: 8, judgedAt: '2026-09-28T11:00:00.000Z' },
      });
      expect(rerun.passed).toBe(false);
    });
  });

  describe('REPRESENTATIVE_IMAGE_SOURCE', () => {
    it('체크리스트 1개 false / 다른 앵커 레퍼런스 + 확인 없음 실패 / 확인 있음 통과', () => {
      const unchecked = representativeImageSourceCheck(
        ctxWith({ thumbnail: { uncheckedChecklistKeys: ['colorMatchesSelectedColor'] } }),
      );
      expect(unchecked.passed).toBe(false);
      expect(unchecked.gateCode).toBe('G3');
      const other = representativeImageSourceCheck(
        variantContext('g3-other-anchor-no-confirm.json'),
      );
      expect(other.passed).toBe(false);
      expect(other.reason).toContain("'같은 상품·색상' 확인이 없습니다");
      const confirmed = representativeImageSourceCheck(
        approvalContext({
          inputs: mergeVariantInputs('g3-other-anchor-no-confirm.json', {
            thumbnail: { sameProductColorConfirmedAt: '2026-09-28T05:20:00.000Z' },
          }),
        }),
      );
      expect(confirmed.passed).toBe(true);
    });
  });

  describe('STEP_FRESHNESS', () => {
    it('⑦ RERUN_REQUIRED 실패 stepCode=TAGS / G2 지문 바뀜 실패 gateCode=G2 / URL 후보 비교 안 함 + 확인 없음 실패', () => {
      const tags = stepFreshnessCheck(variantContext('tags-rerun-required.json'));
      expect(tags.passed).toBe(false);
      expect(tags.stepCode).toBe('TAGS');
      expect(tags.reason).toContain('⑦ 태그(재실행 필요)');
      const g2 = stepFreshnessCheck(
        ctxWith({ gates: { G2: { valid: false, changedBasisKeys: ['salePrices.250'] } } }),
      );
      expect(g2.passed).toBe(false);
      expect(g2.gateCode).toBe('G2');
      expect(g2.reason).toContain('salePrices.250');
      const url = stepFreshnessCheck(
        ctxWith({
          candidate: { creationPath: 'RAKUTEN_URL' },
          sourcing: { comparisonPerformed: false },
        }),
      );
      expect(url.passed).toBe(false);
      expect(url.reason).toContain('비교 없이 확정');
      const confirmed = stepFreshnessCheck(
        ctxWith({
          candidate: {
            creationPath: 'RAKUTEN_URL',
            noComparisonConfirmedAt: '2026-09-28T05:11:00.000Z',
          },
          sourcing: { comparisonPerformed: false },
        }),
      );
      expect(confirmed.passed).toBe(true);
    });
  });

  describe('CATEGORY', () => {
    it('gender_path_match=false 실패 / BLOCKED 실패 / KC_EXEMPT(확인 있음) 통과', () => {
      expect(categoryCheck(ctxWith({ category: { genderPathMatch: false } })).passed).toBe(false);
      const blocked = categoryCheck(variantContext('category-blocked.json'));
      expect(blocked.passed).toBe(false);
      expect(blocked.reason).toContain('차단');
      const kc = categoryCheck(
        ctxWith({
          category: {
            exceptionDecision: 'KC_EXEMPT',
            kcExemptAdultConfirmedAt: '2026-09-28T05:15:00.000Z',
            certificationExcludeContent: {
              kcCertifiedProductExclusionYn: 'KC_EXEMPTION_OBJECT',
              kcExemptionType: 'OVERSEAS',
            },
          },
        }),
      );
      expect(kc.passed).toBe(true);
    });

    it('성별이 바뀌어 경로와 안 맞거나 리프가 메타 캐시에 없으면 실패', () => {
      expect(categoryCheck(ctxWith({ candidate: { gender: 'FEMALE' } })).passed).toBe(false);
      expect(
        categoryCheck(ctxWith({ categoryLeaf: { exists: false, removed: false } })).passed,
      ).toBe(false);
    });
  });

  describe('DUPLICATE', () => {
    it('같은 item+색상 진행 중·등록됨 기록이 있으면 실패', () => {
      expect(duplicateCheck(approvalContext()).passed).toBe(true);
      const dup = duplicateCheck(
        ctxWith({
          registrations: {
            duplicate: {
              registrationId: 3,
              status: 'REGISTERED',
              originProductNo: '1234',
              channelProductNo: '5678',
            },
          },
        }),
      );
      expect(dup.passed).toBe(false);
      expect(dup.reason).toContain('#3');
    });

    it('P4-03: 커머스API SELLER_CODE 조회에 상품이 있으면 실패, 조회 실패도 실패(사유), 없으면 통과', () => {
      const found = duplicateCheck(
        approvalContext({
          sellerCode: { ok: true, product: { originProductNo: '9001', channelProductNo: null } },
        }),
      );
      expect(found.passed).toBe(false);
      expect(found.reason).toContain('RKT:shop-a:10000123:108');
      expect(found.reason).toContain('9001');
      const failed = duplicateCheck(
        approvalContext({ sellerCode: { ok: false, reason: '커머스API 키가 아직 없습니다' } }),
      );
      expect(failed.passed).toBe(false);
      expect(failed.reason).toContain('확인하지 못했습니다');
      expect(
        duplicateCheck(approvalContext({ sellerCode: { ok: true, product: null } })).passed,
      ).toBe(true);
    });
  });
});

/** 변형 파일의 inputs 조각에 더 덧쓴다 */
function mergeVariantInputs(name: string, extra: object): never {
  const base = (readVariant(name).inputs ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] = { ...(base[key] ?? {}), ...(value as object) };
  }
  return out as never;
}

/** 검사 함수는 시계를 직접 읽지 않는다(ctx.now만) */
describe('검사 함수의 시각', () => {
  it('같은 ctx면 언제 불러도 같은 결과다', () => {
    const ctx: PreValidationContext = variantContext('collected-6h01s.json');
    expect(runPreValidationChecks(ctx)).toEqual(runPreValidationChecks(ctx));
  });
});

import { Ajv, type JSONSchemaType, type ValidateFunction } from 'ajv';
import { AI_ENGINE_CODES } from '../../integrations/ai-engine/ai-engine.port.js';
import { EXTERNAL_TARGETS } from '../../integrations/http/external-targets.js';
import { DEFAULT_SETTINGS } from '../defaults/default-settings.js';
import {
  type AiEngineModelPair,
  type AppSettings,
  type CategoryLeafMapping,
  type CautionTemplateEntry,
  type ColorTermEntry,
  type DispatchDeliveryCompanySetting,
  type MaterialTermEntry,
  type OriginCountryEntry,
  DUTY_HS_HEADINGS,
  MULTI_ORIGIN_MODES,
  NOTICE_BLOCK_CONDITIONS,
  type NoticeBlock,
  NPAY_FEE_GRADES,
  POINT_ROUNDINGS,
  PRICE_RULE_METHODS,
  type SettingsSchemaVersion,
  type SizeRangeMm,
  TAG_COMPETITOR_INPUT_MAX_BYTES_LIMIT,
  type TagBrandEntry,
  THUMBNAIL_FACE_OPTIONS,
  THUMBNAIL_GENERATION_TIMEOUT_MAX_SECONDS,
  THUMBNAIL_IMAGE_PROVIDERS,
  VAT_MODES,
} from './settings.types.js';

/**
 * 설정 JSON Schema(F-ST-01). draft-07(Ajv 8 기본, Proposed). `JSONSchemaType<AppSettings>`라 TS 타입과 어긋나면
 * 컴파일이 깨진다.
 * - 모든 객체에 `additionalProperties: false`: 모르는 키·비밀 키(API 키·시크릿·토큰)는 오류다(NFR-02, Proposed).
 * - 모든 키에 기본 템플릿 값이 `default`로 붙는다(아래 applyDefaults). 파일에서 키가 빠지면 기본값으로 채워
 *   검사한다(`useDefaults`) — 뒤 실행 문서가 키를 더해도 이미 있는 설정 파일이 깨지지 않게(Proposed).
 * - 안전 기준 하한(235mm·6시간·내장 목록)은 스키마가 아니라 safety-floor.validator.ts가 본다
 *   (어기면 422 SAFETY_SETTING_RELAXATION_REJECTED로 따로 알리기 위해).
 */
export const SETTINGS_SCHEMA_VERSION: SettingsSchemaVersion = '1';

const pct = { type: 'number', minimum: 0, maximum: 100, multipleOf: 0.001 } as const;
const krw = { type: 'integer', minimum: 0, maximum: 100_000_000 } as const;
const yen = { type: 'integer', minimum: 0, maximum: 100_000_000 } as const;
const positiveCm = { type: 'number', exclusiveMinimum: 0, maximum: 1000 } as const;
const shortText = { type: 'string', minLength: 1, maxLength: 100 } as const;
const wordList = {
  type: 'array',
  items: shortText,
  maxItems: 1000,
} as const;

const sizeRange: JSONSchemaType<SizeRangeMm> = {
  type: 'object',
  additionalProperties: false,
  required: ['min', 'max'],
  properties: {
    min: { type: 'integer', minimum: 100, maximum: 400 },
    max: { type: 'integer', minimum: 100, maximum: 400 },
  },
};

/**
 * 필수이면서 null이 되는 속성(`T | null`). Ajv의 JSONSchemaType은 `nullable: true`를 선택 속성(`?:`)에만 허락해서
 * 이런 속성은 형 검사를 통과하지 못한다. 스키마 뜻(draft-07 + Ajv `nullable`)은 그대로 두고 형만 여기서 한 번 푼다.
 * 대신 이 속성들의 값은 settings-file.loader.spec.ts가 null·범위 밖 값으로 따로 확인한다.
 */
function nullable(schema: Record<string, unknown>): never {
  return { ...schema, nullable: true } as never;
}

const modelName = nullable({ type: 'string', minLength: 1, maxLength: 100 });
const modelPair: JSONSchemaType<AiEngineModelPair> = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'vision'],
  properties: { text: modelName, vision: modelName },
};

const noticeBlock: JSONSchemaType<NoticeBlock> = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'when', 'text'],
  properties: {
    id: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,39}$' },
    when: nullable({
      type: 'string',
      enum: [...NOTICE_BLOCK_CONDITIONS, null],
    }),
    text: { type: 'string', minLength: 1, maxLength: 1000 },
  },
};

/** 데이터랩 순위 요청 주소 모양(P2-01): https + 관문 허용 목록의 데이터랩 호스트 + 경로(호스트는 바꿀 수 없다) */
export const DATALAB_RANK_URL_PATTERN = `^https://${EXTERNAL_TARGETS.DATALAB.hosts[0]!.replace(/\./g, '\\.')}/[A-Za-z0-9/._-]+$`;

/** 라쿠텐 API 주소 모양(P2-02): https + 관문 허용 목록의 라쿠텐 API 호스트 + 경로(호스트는 바꿀 수 없다) */
export const RAKUTEN_API_URL_PATTERN = `^https://${EXTERNAL_TARGETS.RAKUTEN_API.hosts[0]!.replace(/\./g, '\\.')}/[A-Za-z0-9/._-]+$`;

/** 발송 택배사 코드 모양(P1-09 Proposed): 영문·숫자·`_`·`-`·`.` 40자까지(profile.dispatch_delivery_company_code varchar(40)) */
export const DISPATCH_COMPANY_CODE_PATTERN = '^[A-Za-z0-9_.-]{1,40}$';

const dispatchCompany: JSONSchemaType<DispatchDeliveryCompanySetting> = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'name', 'source'],
  properties: {
    code: { type: 'string', pattern: DISPATCH_COMPANY_CODE_PATTERN },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    source: { type: 'string', minLength: 1, maxLength: 500 },
  },
};

/** 네이버 리프 카테고리 id 모양(P2-06 Proposed): 숫자 20자까지(commerce_category.category_id varchar(20)) */
export const CATEGORY_ID_PATTERN = '^[0-9]{1,20}$';

const categoryLeafMapping: JSONSchemaType<CategoryLeafMapping> = {
  type: 'object',
  additionalProperties: false,
  required: ['genreId', 'leafCategoryIds'],
  properties: {
    genreId: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
    productType: nullable({ type: 'string', minLength: 1, maxLength: 64 }),
    leafCategoryIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: { type: 'string', pattern: CATEGORY_ID_PATTERN },
    },
  },
};

/**
 * ⑤ 프롬프트 골격(P3-01 Proposed): `{resolution}`과 `{face_option}` 자리를 둘 다 담아야 한다(빠지면 해상도·얼굴 노출 옵션이
 * 프롬프트에 들어가지 않는다). 여러 줄 글이라 `[\s\S]`로 본다
 */
export const THUMBNAIL_PROMPT_TEMPLATE_PATTERN =
  '^(?=[\\s\\S]*\\{resolution\\})(?=[\\s\\S]*\\{face_option\\})[\\s\\S]+$';

/** ⑥-2 사전 한 줄의 원문 표기(P3-03 Proposed): 1~40자 */
const rawTerm = { type: 'string', minLength: 1, maxLength: 40 } as const;

const originCountry: JSONSchemaType<OriginCountryEntry> = {
  type: 'object',
  additionalProperties: false,
  required: ['raw', 'area'],
  properties: {
    raw: rawTerm,
    // '대륙 > 국가'(커머스API 원산지 이름과 같은 모양) — '>' 한 번, 양쪽 글자
    area: { type: 'string', minLength: 3, maxLength: 60, pattern: '^[^>]+>[^>]+$' },
  },
};

const materialTerm: JSONSchemaType<MaterialTermEntry> = {
  type: 'object',
  additionalProperties: false,
  required: ['raw', 'ko'],
  properties: { raw: rawTerm, ko: { type: 'string', minLength: 1, maxLength: 40 } },
};

const colorTerm: JSONSchemaType<ColorTermEntry> = {
  type: 'object',
  additionalProperties: false,
  required: ['raw', 'ko'],
  properties: { raw: rawTerm, ko: { type: 'string', minLength: 1, maxLength: 40 } },
};

/** 소재별 주의 문구 한 줄(P3-04 Proposed): 소재 말 1~20개(각 1~40자), 문장 1~300자 */
const cautionTemplate: JSONSchemaType<CautionTemplateEntry> = {
  type: 'object',
  additionalProperties: false,
  required: ['terms', 'text'],
  properties: {
    terms: { type: 'array', minItems: 1, maxItems: 20, items: rawTerm },
    text: { type: 'string', minLength: 1, maxLength: 300 },
  },
};

/** 말 목록(P3-04 가죽 판정 말·상품명 금지 수식어): 1~40자, 200개까지 */
const termList = {
  type: 'array',
  maxItems: 200,
  items: { type: 'string', minLength: 1, maxLength: 40 },
} as const;

/** ⑦ 규칙 사전 말 목록(P3-05 Proposed): 1~40자, 500개까지 */
const tagWordList = {
  type: 'array',
  maxItems: 500,
  items: { type: 'string', minLength: 1, maxLength: 40 },
} as const;

/** ⑦ 브랜드 사전 한 줄(P3-05 Proposed): 이름 1~40자, 비교 말 1~20개 */
const tagBrand: JSONSchemaType<TagBrandEntry> = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'terms'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 40 },
    terms: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 40 },
    },
  },
};

/** ⑥-2 항목 이름 목록(P3-03 Proposed): 1~20자, 1~50개 */
const factLabelList = {
  type: 'array',
  minItems: 1,
  maxItems: 50,
  items: { type: 'string', minLength: 1, maxLength: 20 },
} as const;

const schema: JSONSchemaType<AppSettings> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'costs',
    'pricing',
    'sourcing',
    'keywords',
    'safety',
    'category',
    'thumbnail',
    'content',
    'tags',
    'notice',
    'registration',
    'delivery',
    'ai',
  ],
  properties: {
    schemaVersion: { type: 'string', const: SETTINGS_SCHEMA_VERSION },
    costs: {
      type: 'object',
      additionalProperties: false,
      required: [
        'cardSurchargePct',
        'saleFeePct',
        'saleFeeAdInflowPct',
        'saleFeeIncludesShipping',
        'npayFeeGrade',
        'npayFeePctByGrade',
        'miscCostKrw',
        'targetMarginPct',
        'minProfitKrw',
        'judgementMarginPct',
        'roundingUnitKrw',
        'pointValueFactorForMargin',
        'vatMode',
        'sellerlifeCoupon',
      ],
      properties: {
        cardSurchargePct: pct,
        saleFeePct: pct,
        saleFeeAdInflowPct: pct,
        saleFeeIncludesShipping: { type: 'boolean' },
        npayFeeGrade: { type: 'string', enum: NPAY_FEE_GRADES },
        npayFeePctByGrade: {
          type: 'object',
          additionalProperties: false,
          required: [...NPAY_FEE_GRADES],
          properties: {
            MICRO: pct,
            SMALL_1: pct,
            SMALL_2: pct,
            SMALL_3: pct,
            GENERAL: pct,
          },
        },
        miscCostKrw: krw,
        targetMarginPct: { ...pct, exclusiveMaximum: 100 },
        minProfitKrw: krw,
        judgementMarginPct: pct,
        roundingUnitKrw: { type: 'integer', minimum: 1, maximum: 100_000 },
        pointValueFactorForMargin: { type: 'number', minimum: 0, maximum: 1 },
        vatMode: { type: 'string', enum: VAT_MODES },
        sellerlifeCoupon: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'amountKrw', 'monthlyLimit'],
          properties: {
            enabled: { type: 'boolean' },
            amountKrw: { type: 'integer', minimum: 0, maximum: 1_000_000 },
            monthlyLimit: { type: 'integer', minimum: 0, maximum: 10_000 },
          },
        },
      },
    },
    pricing: {
      type: 'object',
      additionalProperties: false,
      required: [
        'dutyFreeLimitUsd',
        'dutyFreeBufferUsd',
        'defaultForwarderFeeKrw',
        'shoeBox',
        'dutyRatePctByHsHeading',
        'dutyHsHeading',
        'forwarderHandlingFee',
        'applyFtaRates',
        'simplifiedDuty',
        'priceRule',
        'sellTaxableSizes',
      ],
      properties: {
        dutyFreeLimitUsd: { type: 'number', minimum: 0, maximum: 10_000 },
        dutyFreeBufferUsd: { type: 'number', minimum: 0, maximum: 10_000 },
        defaultForwarderFeeKrw: krw,
        shoeBox: {
          type: 'object',
          additionalProperties: false,
          required: ['lengthCm', 'widthCm', 'heightCm', 'weightKg'],
          properties: {
            lengthCm: positiveCm,
            widthCm: positiveCm,
            heightCm: positiveCm,
            weightKg: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
          },
        },
        dutyRatePctByHsHeading: {
          type: 'object',
          additionalProperties: false,
          required: [...DUTY_HS_HEADINGS],
          properties: { '6401': pct, '6402': pct, '6403': pct, '6404': pct, '6405': pct },
        },
        dutyHsHeading: { type: 'string', enum: DUTY_HS_HEADINGS },
        forwarderHandlingFee: {
          type: 'object',
          additionalProperties: false,
          required: ['included', 'amountKrw'],
          properties: {
            included: { type: 'boolean' },
            amountKrw: { type: 'integer', minimum: 0, maximum: 1_000_000 },
          },
        },
        applyFtaRates: { type: 'boolean' },
        simplifiedDuty: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'ratePct'],
          properties: { enabled: { type: 'boolean' }, ratePct: pct },
        },
        priceRule: {
          type: 'object',
          additionalProperties: false,
          required: ['method', 'refDiscountPct'],
          properties: {
            method: { type: 'string', enum: PRICE_RULE_METHODS },
            refDiscountPct: pct,
          },
        },
        sellTaxableSizes: { type: 'boolean' },
      },
    },
    sourcing: {
      type: 'object',
      additionalProperties: false,
      required: [
        'genreId',
        'minPriceYen',
        'ngKeywords',
        'pageFetchTargetCandidates',
        'pageFetchMaxPages',
        'targetSizeMm',
        'minSizeCount',
        'defaultWidth',
        'excludeBackOrder',
        'defaultShippingYen',
        'pageFetchDailyLimit',
        'rakutenApi',
        'points',
      ],
      properties: {
        genreId: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
        minPriceYen: yen,
        ngKeywords: { ...wordList, items: { type: 'string', minLength: 1, maxLength: 50 } },
        pageFetchTargetCandidates: { type: 'integer', minimum: 1, maximum: 50 },
        pageFetchMaxPages: { type: 'integer', minimum: 1, maximum: 50 },
        targetSizeMm: {
          type: 'object',
          additionalProperties: false,
          required: ['MALE', 'FEMALE'],
          properties: { MALE: sizeRange, FEMALE: sizeRange },
        },
        minSizeCount: { type: 'integer', minimum: 1, maximum: 30 },
        defaultWidth: { type: 'string', minLength: 1, maxLength: 50 },
        excludeBackOrder: { type: 'boolean' },
        defaultShippingYen: yen,
        pageFetchDailyLimit: { type: 'integer', minimum: 0, maximum: 1000 },
        rakutenApi: {
          type: 'object',
          additionalProperties: false,
          required: [
            'itemSearchUrl',
            'genreSearchUrl',
            'hits',
            'searchCacheHours',
            'maxRetries',
            'genreCacheDays',
          ],
          properties: {
            // 호스트는 외부 호출 관문 허용 목록의 라쿠텐 API 호스트만(구 도메인 app.rakuten.co.jp 금지, PRD §8.2)
            itemSearchUrl: { type: 'string', pattern: RAKUTEN_API_URL_PATTERN, maxLength: 500 },
            genreSearchUrl: { type: 'string', pattern: RAKUTEN_API_URL_PATTERN, maxLength: 500 },
            hits: { type: 'integer', minimum: 1, maximum: 30 },
            searchCacheHours: { type: 'integer', minimum: 1, maximum: 24 },
            // 429·503 다시 보내기: 3회보다 많이 할 수 없다(PRD §8.2 '최대 3회')
            maxRetries: { type: 'integer', minimum: 0, maximum: 3 },
            genreCacheDays: { type: 'integer', minimum: 1, maximum: 365 },
          },
        },
        // P2-03(Proposed, 06-4 §2.2): 실질가 포인트 기준값. 배율은 numeric(7,4) 범위·소수 넷째 자리까지
        points: {
          type: 'object',
          additionalProperties: false,
          required: ['pointRateIncludesBase', 'rounding', 'spuMultiplier', 'kRank'],
          properties: {
            pointRateIncludesBase: { type: 'boolean' },
            rounding: { type: 'string', enum: POINT_ROUNDINGS },
            spuMultiplier: { type: 'number', minimum: 0, maximum: 100, multipleOf: 0.0001 },
            kRank: { type: 'number', minimum: 0, maximum: 1, multipleOf: 0.0001 },
          },
        },
      },
    },
    keywords: {
      type: 'object',
      additionalProperties: false,
      required: ['datalabDailyLimit', 'datalab'],
      properties: {
        datalabDailyLimit: { type: 'integer', minimum: 0, maximum: 1000 },
        datalab: {
          type: 'object',
          additionalProperties: false,
          required: ['rankUrl', 'pageSize', 'maxPage', 'requestIntervalSeconds', 'defaultCids'],
          properties: {
            // 호스트는 외부 호출 관문 허용 목록의 데이터랩 호스트만(경로만 바꿀 수 있다)
            rankUrl: { type: 'string', pattern: DATALAB_RANK_URL_PATTERN, maxLength: 500 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
            maxPage: { type: 'integer', minimum: 1, maximum: 100 },
            // F-BS-33: 요청 간격 2초 이상(더 짧게 풀 수 없다)
            requestIntervalSeconds: { type: 'number', minimum: 2, maximum: 60 },
            defaultCids: {
              type: 'array',
              minItems: 1,
              maxItems: 10,
              // 한 요청에 cid 하나: 숫자만(콤마로 여러 cid를 묶지 않는다, PRD §8.1)
              items: { type: 'string', pattern: '^[0-9]{1,16}$' },
            },
          },
        },
      },
    },
    safety: {
      type: 'object',
      additionalProperties: false,
      required: [
        'childShoeMaxSizeMm',
        'judgementValidityHours',
        'childKeywords',
        'wheeledShoeWords',
        'seniorShoeWords',
        'personBlockWords',
        'childCategoryWords',
        'excludedCategoryWords',
        'minBlockWords',
        'originConfusionWords',
        'extraChargeWords',
      ],
      properties: {
        childShoeMaxSizeMm: { type: 'integer', minimum: 0, maximum: 400 },
        judgementValidityHours: { type: 'number', exclusiveMinimum: 0 },
        childKeywords: wordList,
        wheeledShoeWords: wordList,
        seniorShoeWords: wordList,
        personBlockWords: wordList,
        childCategoryWords: wordList,
        excludedCategoryWords: wordList,
        minBlockWords: wordList,
        originConfusionWords: wordList,
        extraChargeWords: wordList,
      },
    },
    category: {
      type: 'object',
      additionalProperties: false,
      required: ['leafMapping'],
      properties: {
        leafMapping: { type: 'array', items: categoryLeafMapping, maxItems: 1000 },
      },
    },
    thumbnail: {
      type: 'object',
      additionalProperties: false,
      required: [
        'promptTemplate',
        'faceOptionDefault',
        'candidateCount',
        'resolutionPx',
        'imageProvider',
        'generationTimeoutSeconds',
      ],
      properties: {
        promptTemplate: {
          type: 'string',
          minLength: 1,
          maxLength: 4000,
          pattern: THUMBNAIL_PROMPT_TEMPLATE_PATTERN,
        },
        faceOptionDefault: { type: 'string', enum: THUMBNAIL_FACE_OPTIONS },
        candidateCount: { type: 'integer', minimum: 1, maximum: 4 },
        resolutionPx: { type: 'integer', minimum: 512, maximum: 4096 },
        imageProvider: { type: 'string', enum: THUMBNAIL_IMAGE_PROVIDERS },
        generationTimeoutSeconds: {
          type: 'integer',
          minimum: 1,
          maximum: THUMBNAIL_GENERATION_TIMEOUT_MAX_SECONDS,
        },
      },
    },
    content: {
      type: 'object',
      additionalProperties: false,
      required: [
        'originCountries',
        'materialTerms',
        'factLabels',
        'specImages',
        'colorTerms',
        'cautionTemplates',
        'productNameBannedWords',
        'multiOriginMode',
      ],
      properties: {
        originCountries: { type: 'array', items: originCountry, maxItems: 500 },
        materialTerms: { type: 'array', items: materialTerm, maxItems: 500 },
        factLabels: {
          type: 'object',
          additionalProperties: false,
          required: ['origin', 'upper', 'lining', 'sole', 'material', 'heelHeight'],
          properties: {
            origin: factLabelList,
            upper: factLabelList,
            lining: factLabelList,
            sole: factLabelList,
            material: factLabelList,
            heelHeight: factLabelList,
          },
        },
        specImages: {
          type: 'object',
          additionalProperties: false,
          required: ['maxCount', 'maxBytes'],
          properties: {
            // 비전 호출 한 번에 넘기는 장수(0 = 스펙 이미지를 쓰지 않고 글만 넘긴다)
            maxCount: { type: 'integer', minimum: 0, maximum: 10 },
            // 한 장 크기 상한(바이트) — 라쿠텐 이미지 받기 상한(20MB) 이하
            maxBytes: { type: 'integer', minimum: 10_240, maximum: 20_971_520 },
          },
        },
        colorTerms: { type: 'array', items: colorTerm, maxItems: 500 },
        cautionTemplates: {
          type: 'object',
          additionalProperties: false,
          required: ['default', 'byMaterial'],
          properties: {
            default: { type: 'string', minLength: 1, maxLength: 300 },
            byMaterial: { type: 'array', items: cautionTemplate, maxItems: 50 },
          },
        },
        productNameBannedWords: termList,
        multiOriginMode: { type: 'string', enum: MULTI_ORIGIN_MODES },
      },
    },
    tags: {
      type: 'object',
      additionalProperties: false,
      required: [
        'useWords',
        'recommendCacheMinutes',
        'restrictedBatchSize',
        'competitorInputMaxBytes',
        'aiRelevanceEnabled',
        'rules',
      ],
      properties: {
        // 추천 태그 조회 키워드는 100자까지(tag_set.recommend_keywords varchar(100)), 용도어는 20개까지
        useWords: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', minLength: 1, maxLength: 100 },
        },
        recommendCacheMinutes: { type: 'integer', minimum: 0, maximum: 1440 },
        restrictedBatchSize: { type: 'integer', minimum: 1, maximum: 100 },
        competitorInputMaxBytes: {
          type: 'integer',
          minimum: 1024,
          maximum: TAG_COMPETITOR_INPUT_MAX_BYTES_LIMIT,
        },
        // M1은 AI 관련성 판정이 없어 끔만 받는다(F-TG-08 — 켜기는 M2, CON-13 예외 기록)
        aiRelevanceEnabled: { type: 'boolean', const: false },
        rules: {
          type: 'object',
          additionalProperties: false,
          required: [
            'brands',
            'keepOwnBrandRecommended',
            'storeWords',
            'promotionWords',
            'childWords',
            'genderWords',
            'useSeasonWords',
          ],
          properties: {
            brands: { type: 'array', items: tagBrand, maxItems: 500 },
            keepOwnBrandRecommended: { type: 'boolean' },
            storeWords: tagWordList,
            promotionWords: tagWordList,
            childWords: tagWordList,
            genderWords: {
              type: 'object',
              additionalProperties: false,
              required: ['MALE', 'FEMALE'],
              properties: { MALE: tagWordList, FEMALE: tagWordList },
            },
            useSeasonWords: tagWordList,
          },
        },
      },
    },
    notice: {
      type: 'object',
      additionalProperties: false,
      required: [
        'basisDate',
        'templateVersion',
        'aiImageLabel',
        'leatherTerms',
        'blocks',
        'values',
      ],
      properties: {
        basisDate: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$' },
        templateVersion: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,40}$' },
        aiImageLabel: { type: 'boolean' },
        leatherTerms: termList,
        blocks: { type: 'array', items: noticeBlock, minItems: 1, maxItems: 100 },
        values: {
          type: 'object',
          additionalProperties: false,
          required: ['deliveryDaysMin', 'deliveryDaysMax', 'exchangePolicy'],
          properties: {
            deliveryDaysMin: nullable({ type: 'integer', minimum: 1, maximum: 180 }),
            deliveryDaysMax: nullable({ type: 'integer', minimum: 1, maximum: 180 }),
            exchangePolicy: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    registration: {
      type: 'object',
      additionalProperties: false,
      required: ['initialSuspensionCount', 'optionStockCap', 'requestTimeoutSeconds'],
      properties: {
        initialSuspensionCount: { type: 'integer', minimum: 0, maximum: 1000 },
        optionStockCap: { type: 'integer', minimum: 1, maximum: 99 },
        requestTimeoutSeconds: { type: 'integer', minimum: 1, maximum: 300 },
      },
    },
    delivery: {
      type: 'object',
      additionalProperties: false,
      required: ['dispatchCompanies'],
      properties: {
        dispatchCompanies: { type: 'array', items: dispatchCompany, maxItems: 100 },
      },
    },
    ai: {
      type: 'object',
      additionalProperties: false,
      required: ['engine', 'models'],
      properties: {
        engine: { type: 'string', enum: AI_ENGINE_CODES },
        models: {
          type: 'object',
          additionalProperties: false,
          required: [...AI_ENGINE_CODES],
          properties: { CLAUDE: modelPair, AGY: modelPair, CODEX: modelPair },
        },
      },
    },
  },
};

interface SchemaNode {
  type?: unknown;
  properties?: Record<string, SchemaNode>;
  default?: unknown;
}

/** 기본 템플릿 값을 각 속성의 `default`로 붙인다(속성 아래로만, 배열 항목 안은 붙이지 않는다) */
function applyDefaults(node: SchemaNode, defaults: unknown): void {
  if (!node.properties || !defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
    return;
  }
  const values = defaults as Record<string, unknown>;
  for (const [key, child] of Object.entries(node.properties)) {
    if (!(key in values)) continue;
    // 속성 스키마를 나눠 쓰는 곳(pct, MALE·FEMALE의 sizeRange, 엔진별 modelPair)이 있어 복사해 붙인다.
    // properties도 새로 만든다: 같은 properties를 나눠 쓰면 뒤 형제의 기본값(FEMALE 220~260)이 앞 형제(MALE)를 덮는다.
    const copy: SchemaNode = { ...child, default: structuredClone(values[key]) };
    if (child.properties) copy.properties = { ...child.properties };
    node.properties[key] = copy;
    applyDefaults(copy, values[key]);
  }
}

applyDefaults(schema as unknown as SchemaNode, DEFAULT_SETTINGS);

/** 설정 JSON Schema(기본값 포함). 문서·테스트가 읽는다 */
export const SETTINGS_JSON_SCHEMA: JSONSchemaType<AppSettings> = schema;

/**
 * 검사기. allErrors(오류를 모두 모은다), useDefaults(빠진 키는 기본값), 비율 소수 셋째 자리까지(multipleOf 0.001을
 * 부동소수 오차 없이 보려고 multipleOfPrecision 9).
 * 주의: 검사가 데이터를 바꾼다(기본값 채움). 원본을 지키려면 복사본을 넘긴다.
 */
export function compileSettingsValidator(): ValidateFunction<AppSettings> {
  const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: true, multipleOfPrecision: 9 });
  return ajv.compile(SETTINGS_JSON_SCHEMA);
}

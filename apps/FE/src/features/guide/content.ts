/**
 * 사용 안내 문구(D-29). 화면에 보이는 안내 글은 모두 여기 한 곳에 둔다.
 * 오너가 검토·수정하는 원본은 docs/design/spec/안내문구.md이고, 이 파일은 그 문서를 그대로 옮긴 것이다.
 * 글을 바꾸면 두 곳을 함께 고친다 — content.test.ts가 문서 표를 읽어 이 파일의 글이 같은 줄·칸(키 → 글, 링크 주소까지)에 있는지 본다.
 *
 * 규칙: 이 파일은 아무것도 import하지 않는다(문서 대조 테스트가 Node에서 바로 읽는다).
 * 글 속 `{이름}`은 화면이 채우는 자리(fillText). 주소(`to`)는 문서 대조에서 뺀다.
 */

/** 화면 안 이동 링크 */
export interface GuideLink {
  label: string;
  to: string;
}

/** `{이름}` 자리를 채운다. 없는 이름은 그대로 둔다 */
export function fillText(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{([^{}]+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/** 키워드 없이 시작하는 입구(후보 작업 '입력 고르기' ② 소싱 — 검색어·라쿠텐 URL) */
export const START_WITHOUT_KEYWORD_PATH = '/candidates?runnableStep=SOURCING';
/** 사용 안내 화면(SCR-14) */
export const GUIDE_PATH = '/guide';

// ── 1. 대시보드 '시작 준비' 카드 ──

export const READINESS_TEXT = {
  title: '시작 준비',
  caption: '앱이 확인할 수 있는 준비 {total}가지입니다',
  progress: '{total}개 중 {done}개 완료',
  allDone: '준비를 모두 마쳤습니다. 펼치면 항목을 다시 봅니다.',
  expand: '펼치기',
  collapse: '접기',
  chipDone: '완료',
  chipTodo: '할 일',
  chipLoading: '확인 중',
  chipError: '확인 못함',
  loading: '확인하는 중입니다.',
  infoTitle: '참고 · 세지 않는 항목',
} as const;

/** 센 항목 5개. 순서 = 화면 순서(앞 항목이 뒤 항목의 준비가 된다: 커머스API 키 → 메타 동기화 → 구매대행 프로필) */
export const READINESS_ITEM_KEYS = [
  'COMMERCE_KEYS',
  'RAKUTEN_KEYS',
  'AI_ENGINE',
  'IMAGE_TOOL',
  'PROFILE',
] as const;
export type ReadinessItemKey = (typeof READINESS_ITEM_KEYS)[number];

export const READINESS_ITEMS = {
  COMMERCE_KEYS: {
    label: '커머스API 키',
    done: '키체인에 저장했습니다. 스마트스토어 등록에 씁니다.',
    todo: '빠진 키: {keys}. 시스템 상태에서 넣어 주세요.',
    link: { label: '키 넣기', to: '/system#keys' },
    doneLink: { label: '시스템 상태', to: '/system#keys' },
  },
  RAKUTEN_KEYS: {
    label: '라쿠텐 앱 키',
    done: '키체인에 저장했습니다. 라쿠텐 검색에 씁니다.',
    todo: '빠진 키: {keys}. 시스템 상태에서 넣어 주세요.',
    link: { label: '키 넣기', to: '/system#keys' },
    doneLink: { label: '시스템 상태', to: '/system#keys' },
  },
  AI_ENGINE: {
    label: 'AI 엔진 연결',
    done: '{engine} ({model}) 연결 테스트 통과 · {time}',
    todoRecommended: '추천 {engine}. AI 엔진에서 골라 연결 테스트를 하고 저장해 주세요.',
    todoNone:
      '연결 테스트를 통과한 엔진이 아직 없습니다. AI 엔진에서 감지·연결 테스트를 해 주세요.',
    link: { label: 'AI 엔진', to: '/settings/ai-engine' },
  },
  IMAGE_TOOL: {
    label: '썸네일 생성 도구(agy)',
    done: 'Antigravity CLI {version} 연결 테스트 통과 · {time}',
    notChecked: '아직 감지하지 않았습니다. AI 엔진 화면을 열면 감지합니다.',
    notInstalled: 'agy가 설치되어 있지 않습니다. ⑤ 썸네일을 만들려면 설치하고 로그인해 주세요.',
    failed: '마지막 연결 테스트가 실패했습니다. 로그인을 확인하고 다시 테스트해 주세요.',
    untested:
      '⑤ 썸네일은 고른 AI 엔진과 관계없이 agy가 만듭니다. Antigravity CLI 카드에서 [연결 테스트]를 한 번 눌러 주세요.',
    link: { label: 'AI 엔진', to: '/settings/ai-engine' },
  },
  PROFILE: {
    label: '구매대행 프로필',
    done: '필수 칸을 모두 채웠습니다.',
    todo: '빈칸 {count}개: {fields}. 설정에서 채우고 저장해 주세요.',
    link: { label: '설정', to: '/settings' },
  },
} as const satisfies Record<
  ReadinessItemKey,
  { readonly label: string; readonly link: GuideLink; readonly [text: string]: unknown }
>;

/** 구매대행 프로필 필수 칸 → 화면 이름(설정 '구매대행 프로필' 탭의 라벨) */
export const PROFILE_FIELD_LABEL: Readonly<Record<string, string>> = {
  overseasShippingCommerceAddressbookId: '해외 출고지',
  returnCommerceAddressbookId: '반품·교환지',
  dispatchDeliveryCompanyCode: '발송 택배사',
  commerceReturnDeliveryCompanyId: '반품 택배사',
  returnFeeKrw: '반품비',
  exchangeFeeKrw: '교환비',
  businessName: '상호',
  afterServicePhone: 'A/S 연락처',
  afterServiceGuide: 'A/S 안내',
  importer: '수입자',
};

/** 세지 않는 참고 줄 2개 */
export const READINESS_INFO = {
  SWITCH: {
    label: '등록 API 차단',
    on: '켜짐 · 승인해도 실제로 등록하지 않고 요청 내용만 저장합니다(드라이런).',
    off: '꺼짐 · 승인하면 실제 스마트스토어에 등록합니다.',
    unknown: '확인 전입니다.',
    link: { label: '뜻 보기', to: '/guide#safety' },
  },
  TRAINING: {
    label: 'AI 계정 학습 끄기',
    text: '앱이 확인할 수 없습니다. 쓰는 AI 계정 설정에서 직접 꺼 주세요.',
    link: { label: '끄는 곳', to: '/guide#training' },
  },
} as const;

// ── 2. '작업 흐름' 카드 ──

export const WORK_FLOW_TEXT = {
  title: '작업 흐름',
  caption: '후보 하나가 키워드에서 등록까지 가는 길입니다. 단계를 누르면 설명이 보입니다.',
  tabsLabel: '작업 단계',
  does: '하는 일',
  auto: '앱이 하는 것',
  check: '사람이 확인할 것',
  note: "단계는 따로 실행하거나 다시 실행할 수 있습니다. 앞 단계 값이 바뀌면 뒤 단계가 '재실행 필요'가 되고, 자동으로 다시 돌지 않습니다.",
  dismiss: '다시 보지 않기',
  dismissed: "작업 흐름을 숨겼습니다. 왼쪽 메뉴 '사용 안내'에서 언제든 다시 볼 수 있습니다.",
  dismissedLink: { label: '사용 안내', to: '/guide' },
  hiddenOnDashboard: '대시보드에서는 숨겨 두었습니다.',
  showOnDashboard: '대시보드에 다시 보이기',
  shownOnDashboard: '대시보드에 다시 보입니다.',
} as const;

export interface WorkFlowStep {
  key: string;
  /** 단계 번호(① …). 승인은 번호가 없다 */
  no: string;
  label: string;
  /** 이 단계 뒤(또는 이 단계)의 오너 게이트 */
  gate?: string;
  does: string;
  auto: string;
  check: string;
  link: GuideLink;
}

const OPEN_CANDIDATES: GuideLink = { label: '후보 작업 열기', to: '/candidates' };

export const WORK_FLOW_STEPS: readonly WorkFlowStep[] = [
  {
    key: 'keyword',
    no: '①',
    label: '키워드',
    gate: 'G1 키워드 선택',
    does: '네이버 데이터랩에서 여성·남성 신발 인기 키워드를 모으고, 소싱할 키워드를 고릅니다.',
    auto: '[수집]을 누르면 인기 순위를 차례로 받습니다. 아동 단어가 든 키워드는 뺍니다. 수집이 막히면 순위를 붙여 넣을 수 있습니다.',
    check:
      'G1: 소싱할 키워드를 고르고 라쿠텐 검색어(일본어·영문 + 型番)를 확인합니다. 검색어나 라쿠텐 URL로 바로 시작하면 G1은 건너뜁니다.',
    link: { label: '키워드 열기', to: '/keywords' },
  },
  {
    key: 'sourcing',
    no: '②',
    label: '소싱',
    does: '라쿠텐에서 같은 상품(型番·색상)을 찾아 비교표를 만들고, 살 곳 하나를 고릅니다.',
    auto: '검색 결과에서 기준 상품(앵커)과 같은 상품만 남기고, 상품 페이지를 읽어 사이즈 재고·송료·포인트를 넣은 실질가로 줄 세웁니다. 성별도 정합니다.',
    check:
      '앵커를 고르고, 성별이 애매하면 고릅니다. 재고를 확인한 행 하나를 고릅니다. 쿠폰은 라쿠텐 페이지를 열어 확인합니다.',
    link: OPEN_CANDIDATES,
  },
  {
    key: 'pricing',
    no: '③',
    label: '판정',
    gate: 'G2 판정 확정',
    does: '국내 기준가를 넣고 사이즈마다 팔 수 있는지 판정합니다.',
    auto: '환율·관부가세 면세 구간·배대지 요금·수수료로 사이즈별 원가와 판매가를 계산하고 판매 후보인지 판정합니다. 환율은 매일 자동으로 받습니다.',
    check:
      'G2: 네이버쇼핑 링크로 국내 기준가를 확인해 넣고, 사이즈별 판정과 판매가를 본 뒤 확정합니다. M1은 면세 구간 사이즈만 팝니다.',
    link: OPEN_CANDIDATES,
  },
  {
    key: 'category',
    no: '④',
    label: '카테고리',
    does: '네이버 리프 카테고리를 정합니다.',
    auto: '라쿠텐 장르와 성별로 후보 카테고리를 뽑고, 아동·어린이 인증 카테고리는 막습니다.',
    check: '후보가 여럿이면 하나를 고릅니다. 성인용 KC 면제 대상이면 확인을 체크합니다.',
    link: OPEN_CANDIDATES,
  },
  {
    key: 'thumbnail',
    no: '⑤',
    label: '썸네일',
    gate: 'G3 썸네일 선택',
    does: '라쿠텐 원본을 참고해 대표 이미지를 AI로 만들고 하나를 고릅니다.',
    auto: '라쿠텐 원본 이미지를 참조용으로만 받고, agy로 후보 이미지를 만듭니다. 원본은 스마트스토어에 올리지 않습니다.',
    check:
      'G3: 사람이 없는 신발 단독 컷을 레퍼런스로 고르고, 체크리스트(신발 길이가 화면 폭의 70% 이상, 디테일, 색상 같음, 인물·문구 없음)를 확인해 하나를 고릅니다.',
    link: OPEN_CANDIDATES,
  },
  {
    key: 'content',
    no: '⑥',
    label: '콘텐츠',
    does: '상세 카피, 원산지·소재, 상품정보제공고시와 상세 HTML을 만듭니다.',
    auto: '⑥-1 AI가 카피를 씁니다. ⑥-2 원산지·소재를 뽑습니다. ⑥-3 고시·구매대행 고지·사양 블록을 규칙으로 묶어 HTML과 상품명을 만듭니다.',
    check:
      '카피와 고시 근거(원문)를 대조하고 필요하면 고칩니다. 원산지가 정해지지 않으면 승인할 수 없습니다.',
    link: OPEN_CANDIDATES,
  },
  {
    key: 'tags',
    no: '⑦',
    label: '태그',
    does: '검색 태그 10개를 정합니다.',
    auto: '추천 태그와 경쟁 태그를 모아 거르고 10개를 고릅니다. 쓸 수 없는 태그(제한 태그)를 확인합니다.',
    check: '경쟁 상품 태그를 붙여 넣고, 최종 태그 10개를 확인합니다.',
    link: OPEN_CANDIDATES,
  },
  {
    key: 'upload',
    no: '⑧',
    label: '이미지 업로드',
    does: '고른 썸네일을 스마트스토어 이미지 서버에 올립니다.',
    auto: '1000×1000 JPEG로 맞춰 올리고, 상세 HTML의 이미지 자리를 올린 주소로 바꿉니다. 올리기만 해서는 스토어에 보이지 않습니다.',
    check: '실행만 합니다. 썸네일이나 상세 HTML을 바꾸면 다시 실행합니다.',
    link: OPEN_CANDIDATES,
  },
  {
    key: 'approve',
    no: '',
    label: '승인',
    gate: 'G4 최종 승인',
    does: '등록될 상품 전체를 미리 보고 승인합니다.',
    auto: '필수 칸·이미지·옵션·태그·법정 고지·원산지·가격·중복·판정 유효 시간(6시간)을 사전 검증합니다. 하나라도 실패하면 승인 버튼이 꺼집니다.',
    check:
      'G4: 미리보기를 보고 승인합니다. 판정에 쓴 라쿠텐 페이지를 받은 지 6시간이 지났으면 [재조회]로 다시 판정합니다. 이 승인은 건너뛸 수 없습니다.',
    link: OPEN_CANDIDATES,
  },
  {
    key: 'register',
    no: '⑨',
    label: '등록',
    does: '커머스API로 스마트스토어에 상품을 등록합니다.',
    auto: "같은 상품을 두 번 올리지 않도록 등록 기록을 먼저 남깁니다. 처음 10건은 전시중지로 올립니다. 응답이 없으면 '결과확인필요'로 두고 다시 보내지 않습니다.",
    check:
      '등록 API 차단이 켜져 있으면 실제로 등록하지 않습니다(드라이런). 처음 10건은 스마트스토어센터에서 모습을 확인하고 전시를 켭니다(G5).',
    link: OPEN_CANDIDATES,
  },
];

// ── 3. '사용 안내' 화면(SCR-14) ──

export const GUIDE_PAGE_TEXT = {
  title: '사용 안내',
  description: '처음 쓰는 분을 위한 안내입니다. 하루 작업 순서와 단계별로 할 일을 봅니다.',
} as const;

export const DAY_SCENARIO = {
  title: '하루 작업 순서',
  caption: 'M1 기준 후보 1건에 12~20분',
  steps: [
    {
      text: '대시보드에서 시작 준비와 멈춘 곳을 봅니다. 하던 일은 [이어 하기]로 엽니다.',
      link: { label: '대시보드', to: '/' },
    },
    {
      text: '키워드에서 데이터랩 순위를 모으고(하루 1회), 소싱할 키워드를 고릅니다.',
      link: { label: '키워드', to: '/keywords' },
    },
    {
      text: '후보마다 ② 소싱 → ③ 판정 → ④ 카테고리 → ⑤ 썸네일 → ⑥ 콘텐츠 → ⑦ 태그 → ⑧ 업로드 → 승인 → ⑨ 등록 순서로 진행합니다. ⑤·⑥·⑦은 어떤 순서로 해도 됩니다.',
      link: { label: '후보 작업', to: '/candidates' },
    },
    {
      text: '처음 10건은 전시중지로 올라갑니다. 스마트스토어센터에서 모습을 확인하고 전시를 켭니다.',
    },
    {
      text: "앞 단계를 고쳐 '재실행 필요'가 된 단계는 대시보드에서 열어 다시 실행합니다.",
    },
  ] satisfies readonly { text: string; link?: GuideLink }[],
  entriesTitle: '후보를 만드는 세 가지 입구',
  entries: [
    '키워드: 키워드를 고르고 라쿠텐 검색어를 확인합니다(G1).',
    '검색어: 라쿠텐 검색어를 바로 넣습니다. 키워드를 건너뜁니다.',
    '라쿠텐 URL: 라쿠텐 상품 주소를 붙여 넣어 바로 후보를 만듭니다. 비교 없이 확정하려면 G2에서 체크합니다.',
  ],
  entriesLink: { label: '검색어·URL로 시작', to: START_WITHOUT_KEYWORD_PATH },
} as const;

export const SAFETY_TEXT = {
  title: '안전장치',
  caption: '사람이 확인하는 곳과 실수를 막는 장치',
  gatesTitle: '게이트(사람이 확인하는 곳)',
  gates: [
    'G1 키워드 선택: 소싱할 키워드와 라쿠텐 검색어를 확인합니다.',
    'G2 판정 확정: 비교표에서 고른 상품과 사이즈별 판정·판매가를 확인합니다.',
    'G3 썸네일 선택: 대표 이미지 체크리스트를 확인하고 하나를 고릅니다.',
    'G4 최종 승인: 상품 전체를 미리 보고 승인합니다. 건너뛸 수 없습니다.',
    'G5 전시 켜기: 처음 10건은 스마트스토어센터에서 직접 켭니다(M1).',
  ],
  switchTitle: '등록 API 차단 스위치',
  switchLines: [
    "켜면 승인해도 등록 API를 부르지 않고, 요청 내용과 검증 결과만 저장해 '검증완료'로 둡니다(드라이런).",
    '끄면 승인할 때 실제 스마트스토어에 등록합니다.',
    '최종 승인 화면의 ⑧ 이미지 업로드 바로 아래 띠에서 켜고 끕니다. 지금 상태는 왼쪽 메뉴 아래 상자에 보입니다.',
  ],
  otherTitle: '그 밖의 장치',
  others: [
    '같은 상품·색상은 두 번 등록하지 않습니다.',
    "등록 응답이 없으면 자동으로 다시 보내지 않고 '결과확인필요'로 둡니다. [결과 확인]으로 찾습니다.",
    '아동화·아동 카테고리는 막습니다.',
    '판정에 쓴 라쿠텐 페이지를 받은 지 6시간이 지나면 승인할 수 없습니다.',
  ],
} as const;

export const TRAINING_TEXT = {
  title: 'AI 계정 학습 끄기',
  lead: '앱은 이 설정을 확인하거나 바꾸지 않습니다. 쓰는 AI 계정에서 직접 끕니다.',
  items: [
    "Claude(claude.ai): 개인정보 설정에서 'Help improve Claude'를 끕니다.",
    "Antigravity: 설정 › 계정에서 'Enable Telemetry'를 끕니다.",
    "ChatGPT(Codex): 데이터 제어에서 'Improve the model for everyone'을 끕니다.",
  ],
} as const;

export const SCREENS_TEXT = {
  title: '화면 안내',
  caption: "화면마다 제목 옆 '?'를 누르면 그 화면 도움말이 열립니다",
  items: [
    { label: '대시보드', text: '시작 준비, 이어 할 곳, 멈춘 단계를 봅니다.', to: '/' },
    { label: '키워드', text: '데이터랩 순위를 모으고 소싱할 키워드를 고릅니다.', to: '/keywords' },
    {
      label: '후보 작업',
      text: '후보마다 단계 상태를 보고 단계 화면(②~⑨)을 엽니다.',
      to: '/candidates',
    },
    { label: '등록 상품', text: '등록한 상품을 관리합니다(M2).', to: '/products' },
    {
      label: '설정',
      text: '구매대행 프로필, 배대지 요금표, 환율을 정합니다.',
      to: '/settings',
    },
    { label: 'AI 엔진', text: 'AI 엔진을 고르고 연결 테스트를 합니다.', to: '/settings/ai-engine' },
    { label: '시스템 상태', text: '키, 인증, 메타데이터 동기화, AI 도구를 봅니다.', to: '/system' },
  ],
} as const;

// ── 4. 화면 도움말 '?' ──

export const HELP_TEXT = {
  button: '이 화면 도움말',
  title: '이 화면 도움말',
  close: '도움말 닫기',
  todo: '이 화면에서 할 일',
  next: '다음 단계',
  stuck: '자주 막히는 곳',
} as const;

export interface ScreenHelpContent {
  todo: readonly string[];
  next: readonly { text: string; link?: GuideLink }[];
  stuck: readonly string[];
}

export const SCREEN_HELP_KEYS = [
  'dashboard',
  'keywords',
  'candidates',
  'sourcing',
  'judgement',
  'thumbnail',
  'content',
  'tags',
  'approval',
  'products',
  'settings',
  'aiEngine',
  'system',
  'guide',
] as const;
export type ScreenHelpKey = (typeof SCREEN_HELP_KEYS)[number];

export const SCREEN_HELP: Readonly<Record<ScreenHelpKey, ScreenHelpContent>> = {
  dashboard: {
    todo: [
      '시작 준비가 모두 끝났는지 봅니다.',
      '[이어 하기]로 마지막에 하던 곳을 엽니다.',
      '재실행 필요·멈춘 단계를 열어 다시 실행합니다.',
    ],
    next: [
      {
        text: '새 후보는 키워드에서 시작합니다.',
        link: { label: '키워드', to: '/keywords' },
      },
    ],
    stuck: [
      "'재실행 필요' 단계는 자동으로 다시 돌지 않습니다. 단계를 열어 [다시 실행]을 누릅니다.",
      '설정 파일 검사에 오류가 있으면 설정 화면에서 확인합니다.',
    ],
  },
  keywords: {
    todo: [
      '[수집]으로 데이터랩 인기 순위를 모읍니다. 막히면 순위를 붙여 넣습니다.',
      '표에서 키워드를 고르고 [검색어로 쓰기]를 누릅니다.',
      '라쿠텐 검색어를 확인하고 [이 검색어로 소싱]을 누릅니다(G1).',
    ],
    next: [{ text: '② 소싱 화면이 열립니다. 앵커를 고르고 비교표를 봅니다.' }],
    stuck: [
      "아동 단어가 든 키워드는 '제외됨'에만 보입니다.",
      '데이터랩이 요청을 막으면 정해진 시각까지 쉽니다. 그동안은 순위 붙여넣기를 씁니다.',
      '키워드 없이 시작하려면 검색어나 라쿠텐 URL로 바로 후보를 만듭니다.',
    ],
  },
  candidates: {
    todo: [
      '목록에서 후보를 골라 게이트와 단계 상태를 봅니다.',
      '멈춘 단계만 골라 실행하거나, 재실행 필요 단계를 모두 실행합니다.',
      '팔지 않을 후보는 [후보 제외]합니다.',
    ],
    next: [{ text: '단계 이름을 누르면 그 단계 화면(②~⑨)이 열립니다.' }],
    stuck: [
      '연속 실행은 G2 앞에서 멈춥니다. G2 전에는 ②·③에서만 시작할 수 있습니다.',
      '등록 중이거나 등록한 후보는 제외할 수 없습니다.',
      '키워드 없이 시작하려면 [URL로 만들기]나 검색어 입구를 씁니다.',
    ],
  },
  sourcing: {
    todo: [
      '검색 결과에서 앵커(기준 상품·색상)를 고릅니다.',
      '비교표에서 [재고 확인]을 하고 살 곳 하나를 고릅니다.',
      '성별이 애매하면 고르고, 성인용 상품이면 확인을 체크합니다.',
    ],
    next: [{ text: '③ 판정에서 국내 기준가를 넣습니다.' }],
    stuck: [
      '재고를 확인하지 않은 행은 고를 수 없습니다.',
      "라쿠텐 페이지 조회는 하루 한도가 있습니다. 왼쪽 메뉴 아래 '오늘 페이지 조회'를 봅니다.",
      '앵커를 정하면 이 후보에서 바꿀 수 없습니다. 다른 모델·색상은 새 후보로 만듭니다.',
    ],
  },
  judgement: {
    todo: [
      '네이버쇼핑 링크로 국내 기준가를 확인해 넣습니다.',
      '사이즈별 판정과 판매가를 보고 G2(판정 확정)를 통과시킵니다.',
      '④ 카테고리 후보에서 하나를 고릅니다.',
    ],
    next: [{ text: '⑤ 썸네일·⑥ 콘텐츠·⑦ 태그는 어떤 순서로 해도 됩니다.' }],
    stuck: [
      '국내 기준가가 없으면 판정할 수 없습니다.',
      '환율 자동 수집이 실패하면 설정의 환율 탭에서 직접 넣습니다.',
      '과세 구간 사이즈는 팔지 않습니다(M1은 면세 구간만).',
      '아동·어린이 인증 카테고리는 고를 수 없습니다.',
    ],
  },
  thumbnail: {
    todo: [
      '⑤를 실행해 라쿠텐 원본 이미지를 받습니다.',
      '사람이 없는 신발 단독 컷을 레퍼런스로 1~3장 고르고 확인합니다.',
      '만든 후보를 원본과 비교해 체크리스트를 채우고 하나를 고릅니다(G3).',
    ],
    next: [{ text: '⑧ 이미지 업로드는 최종 승인 화면에서 합니다.' }],
    stuck: [
      '프롬프트에 실존 인물 이름이 있으면 만들 수 없습니다.',
      '이미지는 한 장씩 차례로 만들고, 한 장에 최대 300초(기본)까지 기다립니다.',
      'agy에 로그인되어 있지 않으면 생성이 실패합니다. AI 엔진 화면에서 연결 테스트를 합니다.',
    ],
  },
  content: {
    todo: [
      '⑥-1 카피를 만들고 필요하면 고칩니다.',
      '⑥-2 원산지·소재를 원문 근거와 대조합니다.',
      '⑥-3 고시·HTML을 조립하고 상품명을 확인합니다.',
    ],
    next: [{ text: '⑦ 태그에서 검색 태그 10개를 정합니다.' }],
    stuck: [
      '구매대행 프로필에 빈칸(상호·A/S 연락처·A/S 안내·수입자·반품비)이 있으면 ⑥-3을 시작할 수 없습니다.',
      '설정 파일의 배송기간(notice.values.deliveryDaysMin·deliveryDaysMax)이 비어 있어도 ⑥-3을 시작할 수 없습니다. 값을 넣고 설정 화면에서 [설정 파일 다시 읽기]를 누릅니다.',
      '원산지가 정해지지 않으면 승인할 수 없습니다.',
      "AI 엔진을 쓸 수 없으면 ⑥-1·⑥-2가 멈춥니다. 'AI 엔진 설정으로' 링크를 따라갑니다.",
    ],
  },
  tags: {
    todo: [
      '경쟁 상품 태그를 붙여 넣거나 파일로 넣습니다.',
      '⑦을 실행해 후보 태그를 모읍니다.',
      '최종 태그 10개를 확인하고 고칩니다.',
    ],
    next: [{ text: '최종 승인 화면에서 ⑧ 이미지 업로드를 합니다.' }],
    stuck: [
      '카테고리 이름과 같은 태그와 제한 태그는 빠집니다. 뺀 태그 목록에서 이유를 봅니다.',
      "④ 카테고리를 바꾸면 ⑦이 '재실행 필요'가 됩니다.",
    ],
  },
  approval: {
    todo: [
      '⑧ 이미지 업로드를 실행합니다.',
      '전체 미리보기와 사전 검증 결과를 봅니다.',
      '[승인·등록]을 누릅니다(G4).',
    ],
    next: [
      {
        text: '처음 10건은 전시중지로 등록됩니다. 스마트스토어센터에서 모습을 확인하고 전시를 켭니다(G5).',
      },
    ],
    stuck: [
      '사전 검증에서 실패한 줄의 링크로 고칠 단계를 엽니다.',
      '판정에 쓴 라쿠텐 페이지를 받은 지 6시간이 지나면 [재조회]로 다시 판정합니다.',
      "등록 API 차단이 켜져 있으면 등록하지 않고 '검증완료'로 저장합니다.",
      "응답이 없으면 '결과확인필요'가 됩니다. [결과 확인]으로 찾습니다.",
    ],
  },
  products: {
    todo: ['등록 상품 화면은 M2에서 만듭니다.'],
    next: [
      {
        text: '지금은 등록 결과를 최종 승인 화면에서 봅니다.',
        link: { label: '후보 작업', to: '/candidates' },
      },
    ],
    stuck: ['전시 켜기·판매중지·재고 수정은 M1에서 스마트스토어센터에서 합니다.'],
  },
  settings: {
    todo: [
      '구매대행 프로필(출고지·반품지·택배사·상호·A/S·수입자)을 채우고 저장합니다.',
      '배대지 요금표 CSV를 가져옵니다.',
      '환율을 확인하고, 자동 수집이 실패하면 직접 넣습니다.',
    ],
    next: [
      {
        text: '쓸 AI 엔진을 고릅니다.',
        link: { label: 'AI 엔진', to: '/settings/ai-engine' },
      },
    ],
    stuck: [
      '주소록·반품 택배사 목록이 비면 시스템 상태에서 메타데이터를 동기화합니다.',
      '해외 출고지 주소는 스마트스토어센터에서 먼저 만들어야 합니다.',
      "값을 바꾸면 그 값을 쓰는 단계가 '재실행 필요'가 됩니다.",
    ],
  },
  aiEngine: {
    todo: [
      '쓸 엔진(Claude Code·Antigravity CLI·Codex)을 고릅니다.',
      '[연결 테스트]로 로그인과 응답을 확인합니다.',
      '통과한 뒤 [저장]합니다.',
    ],
    next: [{ text: '대시보드의 시작 준비를 확인합니다.', link: { label: '대시보드', to: '/' } }],
    stuck: [
      '10분 안에 통과한 연결 테스트가 없으면 [저장]할 때 먼저 테스트합니다.',
      '⑤ 썸네일은 엔진 선택과 관계없이 agy가 만듭니다. Antigravity CLI도 연결 테스트를 한 번 해 둡니다.',
      '바꾼 엔진은 새로 시작하는 AI 단계부터 씁니다.',
    ],
  },
  system: {
    todo: [
      '커머스API·라쿠텐·환율 키를 키체인에 넣습니다.',
      '커머스API 토큰과 메타데이터 동기화가 성공했는지 봅니다.',
      'AI 도구 상태를 봅니다.',
    ],
    next: [
      {
        text: '설정에서 구매대행 프로필을 채웁니다.',
        link: { label: '설정', to: '/settings' },
      },
    ],
    stuck: [
      '키 값은 다시 보여 주지 않습니다. 바꾸려면 [다시 넣기]를 누릅니다.',
      '토큰 받기가 실패하면 원인 안내(IP·휴면·시크릿 변경·이용정지)를 봅니다.',
      '해외 주소록은 스마트스토어센터에서 만든 뒤 [지금 동기화]로 받습니다.',
    ],
  },
  guide: {
    todo: [
      '작업 흐름에서 단계를 눌러 설명을 봅니다.',
      '하루 작업 순서와 안전장치를 읽습니다.',
      'AI 계정 학습 끄는 곳을 확인합니다.',
    ],
    next: [{ text: '대시보드의 시작 준비를 마칩니다.', link: { label: '대시보드', to: '/' } }],
    stuck: ["화면마다 제목 옆 '?'를 누르면 그 화면 도움말이 열립니다."],
  },
};

// ── 5. 빈 상태 안내 ──

export const EMPTY_STATE = {
  dashboardProgress: {
    title: '진행 중인 후보가 없습니다.',
    text: '키워드에서 고르거나, 검색어·라쿠텐 URL로 바로 후보를 만드세요.',
    primary: { label: '키워드 열기', to: '/keywords' },
    secondary: { label: '검색어·URL로 시작', to: START_WITHOUT_KEYWORD_PATH },
  },
  candidatesList: {
    title: '진행 중인 후보가 없습니다.',
    text: '키워드에서 고르거나, 검색어·라쿠텐 URL로 바로 후보를 만드세요.',
    primary: { label: '키워드 열기', to: '/keywords' },
    secondary: { label: '검색어·URL로 시작', to: START_WITHOUT_KEYWORD_PATH },
  },
  candidatesFiltered: {
    title: '이 조건의 후보가 없습니다.',
  },
  inputPicker: {
    title: '지금 {step} 단계를 실행할 수 있는 후보가 없습니다.',
    text: '앞 단계를 먼저 끝낸 후보가 여기에 보입니다.',
    primary: { label: '후보 목록 보기', to: '/candidates' },
  },
  keywords: {
    title: '아직 키워드가 없습니다.',
    text: '위에서 [수집]하거나 순위를 붙여 넣어 주세요. 키워드 없이 바로 시작해도 됩니다.',
    primary: { label: '검색어·URL로 시작', to: START_WITHOUT_KEYWORD_PATH },
  },
  products: {
    title: '등록 상품 화면은 M2에서 만듭니다.',
    text: '지금은 등록 결과를 최종 승인 화면에서 보고, 전시 켜기와 판매 관리는 스마트스토어센터에서 합니다.',
    primary: { label: '후보 작업 열기', to: '/candidates' },
  },
} as const;

import { clearKnownSecrets, registerKnownSecret } from '../../../common/secrets/secret-mask.js';
import { AiInputBlockedError } from './ai-engine.errors.js';
import {
  assertAiInputAllowed,
  composeAiPrompt,
  inspectAiInput,
  type AiPromptInput,
} from './ai-prompt-guard.js';

const base = (
  blocks: AiPromptInput['blocks'],
  extra: Partial<AiPromptInput> = {},
): AiPromptInput => ({
  instruction: '상세 카피를 써라.',
  blocks,
  ...extra,
});

describe('AI 입력 보호(P1-10 규칙 14, F-BS-13·14)', () => {
  afterEach(() => clearKnownSecrets());

  it('라쿠텐 상품 글·오너 입력만 있으면 통과', () => {
    expect(
      inspectAiInput(
        base([
          { source: 'RAKUTEN', label: '상품명', text: 'アシックス ゲルカヤノ14 1201A019-108' },
          { source: 'OWNER_INPUT', label: '메모', text: '굽 높이 3cm' },
        ]),
      ),
    ).toEqual([]);
  });

  it.each([
    ['Bearer 토큰', 'Authorization: Bearer abcdefghijklmnop1234567890'],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk'],
    ['API 키(sk-)', 'key sk-ant-api03-abcdefghijklmnopqrstuvwx'],
    ['bcrypt 값', '$2a$10$abcdefghijklmnopqrstuv'],
    ['비밀 키=값', 'client_secret=abcd1234'],
    ['비밀 키=값', '"access_token": "zzzz9999"'],
    ['개인 키', '-----BEGIN RSA PRIVATE KEY-----'],
    ['AWS 키', 'AKIAABCDEFGHIJKLMNOP'],
  ])('비밀 패턴(%s)은 spawn 전에 거부', (what, text) => {
    const findings = inspectAiInput(base([{ source: 'RAKUTEN', text }]));
    expect(findings).toEqual(expect.arrayContaining([{ block: 0, kind: 'SECRET', what }]));
    expect(() => assertAiInputAllowed(base([{ source: 'RAKUTEN', text }]))).toThrow(
      AiInputBlockedError,
    );
  });

  it('키체인에서 읽은 비밀값(알려진 비밀)이 섞이면 거부하고, 오류 문구에 값을 넣지 않는다', () => {
    registerKnownSecret('seller-secret-value-123');
    try {
      assertAiInputAllowed(base([{ source: 'OWNER_INPUT', text: '값 seller-secret-value-123' }]));
      throw new Error('통과하면 안 된다');
    } catch (error) {
      expect(error).toBeInstanceOf(AiInputBlockedError);
      expect((error as AiInputBlockedError).userMessage).not.toContain('seller-secret-value-123');
      expect((error as AiInputBlockedError).findings[0]).toMatchObject({ what: '저장된 비밀값' });
    }
  });

  it('지시문·오너 입력·설정의 개인정보(이메일·휴대전화·홈 경로)는 거부, 라쿠텐 상품 글의 상점 연락처는 비밀 검사만', () => {
    expect(inspectAiInput(base([{ source: 'OWNER_INPUT', text: '연락처 010-1234-5678' }]))).toEqual(
      [{ block: 0, kind: 'PERSONAL', what: '휴대전화' }],
    );
    expect(inspectAiInput(base([], { instruction: 'owner@example.com 에게 보낼 카피' }))).toEqual([
      { block: -1, kind: 'PERSONAL', what: '이메일' },
    ]);
    expect(
      inspectAiInput(base([{ source: 'SETTINGS', text: '/Users/someone/Documents' }])),
    ).toEqual([{ block: 0, kind: 'PERSONAL', what: '사용자 홈 경로' }]);
    expect(
      inspectAiInput(
        base([{ source: 'RAKUTEN', text: 'お問い合わせ 045-123-4567 shop@example.jp' }]),
      ),
    ).toEqual([]);
  });

  it('네이버 출처 블록(데이터랩·manuTag·쇼핑·커머스)은 M1에서 거부', () => {
    for (const source of [
      'NAVER_DATALAB',
      'NAVER_MANUTAG',
      'NAVER_SHOPPING',
      'NAVER_COMMERCE',
    ] as const) {
      expect(inspectAiInput(base([{ source, text: '러닝화' }]))).toEqual([
        { block: 0, kind: 'NAVER_SOURCE', what: source },
      ]);
    }
  });

  it('예외를 켜면 그 예외가 허락한 출처만 통과(키워드 변환은 1개·한 줄만)', () => {
    expect(
      inspectAiInput(
        base([{ source: 'NAVER_MANUTAG', text: '러닝화' }], {
          naverDataException: 'TAG_RELEVANCE_AI',
        }),
      ),
    ).toEqual([]);
    expect(
      inspectAiInput(
        base([{ source: 'NAVER_DATALAB', text: '러닝화' }], {
          naverDataException: 'TAG_RELEVANCE_AI',
        }),
      ),
    ).toHaveLength(1);
    expect(
      inspectAiInput(
        base([{ source: 'NAVER_DATALAB', text: '러닝화' }], {
          naverDataException: 'KEYWORD_QUERY_CONVERSION',
        }),
      ),
    ).toEqual([]);
    expect(
      inspectAiInput(
        base([{ source: 'NAVER_DATALAB', text: '러닝화\n운동화' }], {
          naverDataException: 'KEYWORD_QUERY_CONVERSION',
        }),
      ),
    ).toEqual([expect.objectContaining({ what: '키워드는 1개만' })]);
  });

  it('프롬프트는 [로 시작한다(인자 배열에서 플래그로 읽히지 않게)', () => {
    const prompt = composeAiPrompt(base([{ source: 'RAKUTEN', label: '상품명', text: '--help' }]));
    expect(prompt.startsWith('[지시]')).toBe(true);
    expect(prompt).toContain('[자료 1 · 상품명]\n--help');
  });
});

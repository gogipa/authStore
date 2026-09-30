import { findPersonalValues } from '../../../common/safety/safety-rules.js';
import { scrubKnownSecrets } from '../../../common/secrets/secret-mask.js';
import { AiInputBlockedError, type AiGuardFinding } from './ai-engine.errors.js';

/**
 * AI 입력 보호(P1-10 규칙 14, F-BS-13·14, CON-09·CON-13, NFR-02). 실행기가 spawn·call_log 전에 검사하고 걸리면 부르지 않는다.
 * 입력은 출처가 붙은 데이터 블록이다. 출처 값·검사 패턴·예외 기록 위치는 문서에 없어 Proposed(06-2 §9)다.
 */

/**
 * 데이터 블록 출처(Proposed).
 * - APP_TEMPLATE: 앱이 만든 지시·템플릿 글
 * - RAKUTEN: 라쿠텐 상품 데이터(상품명·설명·속성·색상 원문 — 공개 판매 글)
 * - OWNER_INPUT: 오너가 화면에 넣은 값
 * - SETTINGS: 설정 파일 값
 * - AI_OUTPUT: 앞 AI 호출의 결과
 * - NAVER_DATALAB·NAVER_MANUTAG·NAVER_SHOPPING·NAVER_COMMERCE: 네이버 출처 데이터 — M1은 AI에 넣지 않는다(F-BS-14)
 */
export const AI_INPUT_SOURCES = [
  'APP_TEMPLATE',
  'RAKUTEN',
  'OWNER_INPUT',
  'SETTINGS',
  'AI_OUTPUT',
  'NAVER_DATALAB',
  'NAVER_MANUTAG',
  'NAVER_SHOPPING',
  'NAVER_COMMERCE',
] as const;
export type AiInputSource = (typeof AI_INPUT_SOURCES)[number];

/** 네이버 출처(규칙 14) */
export const NAVER_INPUT_SOURCES: readonly AiInputSource[] = [
  'NAVER_DATALAB',
  'NAVER_MANUTAG',
  'NAVER_SHOPPING',
  'NAVER_COMMERCE',
];

/**
 * 네이버 데이터 예외(F-BS-14). 켜면 그 예외가 허락한 출처만 통과하고 실행기가 기록한다(앱 로그 경고 + 결과
 * `naverDataException`, Proposed). M1에는 켜는 곳이 없다 — 태그 관련성은 규칙 기반(CON-13), 검색어 변환(KW-06)은 M2.
 */
export const NAVER_DATA_EXCEPTIONS = {
  /** 태그 관련성 AI 판정(기본 꺼짐) */
  TAG_RELEVANCE_AI: ['NAVER_MANUTAG', 'NAVER_SHOPPING'],
  /** 사용자가 고른 키워드 1개의 라쿠텐 검색어 변환(KW-06, M2). 블록 1개·한 줄만 */
  KEYWORD_QUERY_CONVERSION: ['NAVER_DATALAB'],
} as const satisfies Record<string, readonly AiInputSource[]>;
export type NaverDataException = keyof typeof NAVER_DATA_EXCEPTIONS;

/** 개인 값 검사를 하는 출처(공개 판매 글인 RAKUTEN은 비밀 검사만 한다 — 일본 상점 연락처가 흔하다, Proposed) */
export const PERSONAL_CHECK_SOURCES: readonly AiInputSource[] = [
  'APP_TEMPLATE',
  'OWNER_INPUT',
  'SETTINGS',
  'AI_OUTPUT',
];

/** 데이터 블록 하나 */
export interface AiInputBlock {
  source: AiInputSource;
  /** 프롬프트에 붙일 짧은 이름(예: '상품명') */
  label?: string;
  text: string;
}

/** 실행기 입력(프롬프트 재료) */
export interface AiPromptInput {
  /** 앱이 만든 지시문(출처 APP_TEMPLATE) */
  instruction: string;
  blocks: readonly AiInputBlock[];
  /** 네이버 데이터 예외(기본 없음) */
  naverDataException?: NaverDataException | null;
}

/** 비밀정보 모양(Proposed). 이름만 결과에 남기고 값은 남기지 않는다 */
export const AI_SECRET_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: '개인 키', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'Bearer 토큰', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { name: 'API 키(sk-)', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'AWS 키', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API 키', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  // 커머스API client_secret은 bcrypt salt 모양이다(P1-07)
  { name: 'bcrypt 값', re: /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{22}/ },
  {
    name: '비밀 키=값',
    re: /\b(?:client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key|secret[_-]?key|service[_-]?key|application[_-]?id|access[_-]?key|auth[_-]?key|password|passwd)\b\s*["']?\s*[:=]\s*["']?[^\s"',}]{4,}/i,
  },
];

function secretFindings(text: string, block: number): AiGuardFinding[] {
  const out: AiGuardFinding[] = [];
  // 키체인에서 읽었거나 받은 비밀값(프로세스 메모리 목록, P1-07)
  if (scrubKnownSecrets(text) !== text) out.push({ block, kind: 'SECRET', what: '저장된 비밀값' });
  for (const { name, re } of AI_SECRET_PATTERNS) {
    if (re.test(text)) out.push({ block, kind: 'SECRET', what: name });
  }
  return out;
}

function personalFindings(text: string, block: number): AiGuardFinding[] {
  return findPersonalValues(text).map((f) => ({ block, kind: 'PERSONAL' as const, what: f.kind }));
}

/** 찾은 것 목록(없으면 빈 배열). 값은 담지 않는다 */
export function inspectAiInput(input: AiPromptInput): AiGuardFinding[] {
  const out: AiGuardFinding[] = [];
  out.push(...secretFindings(input.instruction, -1), ...personalFindings(input.instruction, -1));
  const exception = input.naverDataException ?? null;
  const allowedNaver: readonly AiInputSource[] = exception ? NAVER_DATA_EXCEPTIONS[exception] : [];
  input.blocks.forEach((block, i) => {
    if (!(AI_INPUT_SOURCES as readonly string[]).includes(block.source)) {
      out.push({ block: i, kind: 'NAVER_SOURCE', what: `알 수 없는 출처 ${String(block.source)}` });
      return;
    }
    if (NAVER_INPUT_SOURCES.includes(block.source) && !allowedNaver.includes(block.source)) {
      out.push({ block: i, kind: 'NAVER_SOURCE', what: block.source });
    }
    out.push(...secretFindings(block.text, i));
    if (block.label) out.push(...secretFindings(block.label, i));
    if (PERSONAL_CHECK_SOURCES.includes(block.source)) out.push(...personalFindings(block.text, i));
  });
  if (exception === 'KEYWORD_QUERY_CONVERSION') {
    const naverBlocks = input.blocks.filter((b) => NAVER_INPUT_SOURCES.includes(b.source));
    if (naverBlocks.length > 1 || naverBlocks.some((b) => b.text.trim().includes('\n'))) {
      out.push({ block: -1, kind: 'NAVER_SOURCE', what: '키워드는 1개만' });
    }
  }
  return out;
}

/** 걸리면 AiInputBlockedError(spawn·call_log 전) */
export function assertAiInputAllowed(input: AiPromptInput): void {
  const findings = inspectAiInput(input);
  if (findings.length > 0) throw new AiInputBlockedError(findings);
}

/**
 * 프롬프트 한 덩어리로 합친다. 맨 앞은 '['로 시작한다 — 인자 배열에서 `-`로 시작하는 프롬프트가 CLI 플래그로
 * 읽히지 않게(claude·agy `-p <prompt>`, codex `exec <prompt>`).
 */
export function composeAiPrompt(input: AiPromptInput): string {
  const parts = ['[지시]', input.instruction.trim()];
  input.blocks.forEach((block, i) => {
    parts.push('', `[자료 ${i + 1}${block.label ? ` · ${block.label}` : ''}]`, block.text);
  });
  parts.push('', '[답] 주어진 JSON 스키마에 맞는 JSON 객체 하나로만 답한다.');
  return parts.join('\n');
}

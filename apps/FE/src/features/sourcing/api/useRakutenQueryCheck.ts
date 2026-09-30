import { useDebouncedValue } from '@/shared/lib/useDebouncedValue';
import {
  queryCheckSummary,
  queryViolationText,
  type RakutenQueryValidation,
} from '../model/sourcing';
import { useValidateRakutenQuery } from './queries';

/** 입력이 멈춘 뒤 검사를 부르기까지(ms) */
export const RAKUTEN_QUERY_CHECK_DELAY_MS = 300;

export interface RakutenQueryCheck {
  /** 지금 칸 값에 맞는 검사 결과(입력 중이면 앞 결과를 잠깐 보인다) */
  result: RakutenQueryValidation | undefined;
  /** '반각 32/128자 · 형식 맞음' 조각. 검사 전·빈 값이면 null */
  summary: ReturnType<typeof queryCheckSummary>;
  /** 칸 아래 위반 문구 */
  violationText: string | undefined;
  /** 지금 값의 검사가 끝났고 규칙에 맞다(버튼을 켤 때) */
  valid: boolean;
  /** 검사 요청 오류(설정 없음 503 등) */
  error: Error | null;
}

/**
 * 라쿠텐 검색어 칸의 형식 검사(F-SO-02, P2-02): 입력이 멈추면(300ms) `validateRakutenQuery`를 부르고 결과를 요약한다.
 * SCR-02 '라쿠텐 검색어 확인'·SCR-03 검색 조건·'검색어로 시작'(SCR-12 입력 고르기)이 같이 쓴다.
 */
export function useRakutenQueryCheck(value: string): RakutenQueryCheck {
  const debounced = useDebouncedValue(value.trim(), RAKUTEN_QUERY_CHECK_DELAY_MS);
  const query = useValidateRakutenQuery(debounced);
  const result = debounced === '' ? undefined : query.data;
  const current = result !== undefined && result.rakutenQuery === value.trim();
  return {
    result,
    summary: queryCheckSummary(result),
    violationText: queryViolationText(result),
    valid: current && result.valid,
    error: query.error,
  };
}

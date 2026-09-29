/**
 * 코드로 지키는 안전 규칙 검사기. 테스트가 쓰고, 설정 스키마·기본 템플릿을 만드는 실행 문서(P1-03)가
 * 같은 검사기로 자기 키·템플릿을 검사한다.
 */

/**
 * 안전장치 5개(G4 최종 승인, 아동화 차단, 실존 인물 차단, 중복 등록 방지, 원본 업로드 거부)를 끄는 스위치로
 * 보이는 이름(F-BS-04, US-36 AC4). '끄기·건너뛰기' 말과 '안전장치 대상' 말이 한 이름에 같이 있으면 금지다.
 * Proposed(06-2 §9).
 */
const SWITCH_WORDS =
  /(disable|skip|bypass|ignore|allow|unsafe|force|override|without|turn[-_]?off|no[-_]?(check|guard|block)|off$|^no[-_])/i;
const GUARD_SUBJECTS =
  /(g4|final[-_]?approv|approv|gate|child|kid|junior|baby|infant|minor|juvenile|person|people|celebrit|human|face|duplicate|dup[-_]?check|dedup|original|source[-_]?image|reference[-_]?only|safety|guard)/i;
/** 이름만으로 금지(자동 승인) */
const ALWAYS_FORBIDDEN = /auto[-_]?approv/i;

/** camelCase 부정 접두사(noGateCheck) */
const CAMEL_NO_PREFIX = /^no[A-Z]/;

export function isSafetyGuardSwitchName(name: string): boolean {
  if (ALWAYS_FORBIDDEN.test(name)) return true;
  return (SWITCH_WORDS.test(name) || CAMEL_NO_PREFIX.test(name)) && GUARD_SUBJECTS.test(name);
}

/** 금지 이름만 골라 준다 */
export function findSafetyGuardSwitches(names: Iterable<string>): string[] {
  return [...names].filter(isSafetyGuardSwitchName);
}

/**
 * 코드·기본 템플릿에 넣지 않는 개인 값 모양(F-BS-03, US-37 AC3). 그 자리에는 `{상호}` 같은 자리표시자만 둔다.
 * Proposed(06-2 §9): 이메일, 휴대전화·유선 번호, 사업자등록번호, 사용자 홈 경로.
 */
export const PERSONAL_VALUE_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: '이메일', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/ },
  { name: '휴대전화', re: /(?<!\d)01[016789][- .]?\d{3,4}[- .]?\d{4}(?!\d)/ },
  { name: '유선 전화', re: /(?<!\d)0(2|[3-6][1-5]|70)[- .]\d{3,4}[- .]\d{4}(?!\d)/ },
  { name: '사업자등록번호', re: /(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)/ },
  { name: '사용자 홈 경로', re: /(\/Users\/|\/home\/|C:\\Users\\)[A-Za-z0-9._-]+/ },
];

/** 텍스트에서 개인 값 모양을 찾는다(줄 번호와 종류) */
export function findPersonalValues(text: string): { line: number; kind: string }[] {
  const out: { line: number; kind: string }[] = [];
  text.split('\n').forEach((line, i) => {
    for (const { name, re } of PERSONAL_VALUE_PATTERNS) {
      if (re.test(line)) out.push({ line: i + 1, kind: name });
    }
  });
  return out;
}

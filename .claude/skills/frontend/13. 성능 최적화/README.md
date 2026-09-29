# fe-performance — 성능 최적화 자동화 스킬

동작하는 프론트엔드를 **Core Web Vitals(LCP/INP/CLS)** 기준으로 "측정 먼저" 최적화하는 Claude Code
스킬입니다. 번들·Lighthouse 베이스라인 → 코드 스플리팅 → 이미지 최적화 → Profiler 기반 메모이제이션
진단 → 재측정의 닫힌 루프로 돕니다. **AI는 트리맵 해석·`next/image` 변환·dynamic import 경계·리렌더
진단, "어느 화면부터·어디까지 고칠 가치가 있나"는 사람이 판단합니다.**

> FE 프로세스 13단계 "성능 최적화"를 자동화합니다.
> 역할 분담: AI는 변환·진단(회수율), 우선순위·이득 판단은 사람(정밀도).

## 무엇을 만들어 주나

`frontend-output/<주제>/13_성능/`에 생성:

| 파일 | 내용 |
|---|---|
| `13-1_CWV측정.md` | 베이스라인: 라우트별 First Load JS·무거운 의존성·중복 청크·CWV 임계 초과 화면·효과 대비 노력 우선순위표 |
| `13-2_코드스플리팅·이미지.md` | `next/dynamic` 경계(fallback·ssr:false)·근거 주석 / `next/image` 변환·속성↔지표(LCP/CLS) 매핑표 |
| `13-3_메모이제이션·번들분석.md` | Profiler 진단·적용한 memo/useCallback/useDeferredValue·React19 컴파일러 영역·예방적 메모 금지 근거 |
| `13-after_재측정.md` | 동일 조건 재측정 → 베이스라인 대조표·목표 미달 화면 액션·vercel-react-best-practices 점검 결과 |
| `_검증체크리스트.md` | 사람이 확인할 항목 |

## 준비물 (입력)

1. **(필수) 08 화면구현** — `<루트>/08_화면구현/`. 측정·최적화 대상 화면(무거운 화면·상태화면)의 원천. 없으면 중단.
2. **(권장) 10 API연동** — 데이터 페칭 워터폴·직렬 await 점검 근거. 없으면 해당 점검 ⚠️ 생략.
3. **(권장) 03 아키텍처** — `03-1_렌더링전략맵.md`. 렌더링 전략(SSR/SSG/ISR)이 근본 해법인 화면 식별. 없으면 leaf 최적화만.
4. **(측정 입력) 트리맵·Lighthouse·Profiler** — `ANALYZE=true pnpm build` 트리맵 요약·`pnpm build`의 라우트별 First Load JS·대상 화면 Lighthouse 리포트·React DevTools Profiler 기록. **프로덕션 빌드(`pnpm build && pnpm start`)에서 측정**. 없으면 스킬이 측정 명령을 안내하고 붙일 때까지 코드 변경을 보류합니다(측정 먼저).

## 사전 요구사항

| 항목 | 필수? | 없으면 |
|---|---|---|
| Claude Code | 필수 | — |
| 08 화면구현 산출물 | 필수 | 중단(측정 대상 불명확) |
| Context7 MCP | 선택 | 내장 지식 + 버전 확인 ⚠️(next/image·dynamic·React19 시그니처) |
| pnpm·@next/bundle-analyzer·Lighthouse | 선택 | "로컬 실행 필요" 안내 — 스킬은 결과 해석 담당 |
| vercel-react-best-practices 스킬 | 선택 | 5항목(메모 남발·above-fold 스플리팅·페칭 워터폴·클라 경계·priority 오용) 수기 체크 |

## 설치

```bash
mkdir -p ~/.claude/skills/fe-performance
cp SKILL.md ~/.claude/skills/fe-performance/SKILL.md
```

## 사용법

08 화면구현이 끝나고 측정 데이터(트리맵·Lighthouse·Profiler)를 준비한 뒤:

```
번들 분석이랑 Lighthouse 결과 줄게, 성능 최적화 우선순위 잡고 최적화해줘
```

1. 베이스라인 해석(13-1) → **최적화 우선순위 확정**(당신이 OK — 유일한 게이트, "측정 먼저"의 사람 몫)
2. 코드 스플리팅(next/dynamic) → 이미지 최적화(next/image) (13-2)
3. Profiler 기반 메모이제이션 진단(13-3) — 진단으로 확인된 곳만
4. 재측정 + vercel-react-best-practices 교차 점검(13-after) → 베이스라인 대조표

발동 키워드: `프론트 성능 최적화`, `Core Web Vitals`, `코드 스플리팅`, `dynamic import`,
`이미지 최적화`, `번들 분석`, `메모이제이션`, `리렌더 진단`, `web performance`, `LCP/INP/CLS`

## 🔧 변경해서 쓰는 법

| 변경 포인트 | SKILL.md 위치 | 어떻게 |
|---|---|---|
| 출력 경로 | `## 출력 위치` | `frontend-output/`를 볼트 실행산출물 경로 등으로 |
| 계승 출처 | `## 입력` | 08·10·03 폴더 경로를 본인 구조로 |
| 도구(MCP/CLI) | `## 도구 정확성` | Context7·bundle-analyzer·Lighthouse 가용에 맞게 |
| 스택 버전 | frontmatter 아래 변경 포인트 주석 | React/Next 버전이 다르면 Context7로 재확인 |
| 트리거 키워드 | frontmatter `description` | 자기 표현으로 |

## 주의

- **개발 모드 측정은 무의미합니다.** `pnpm dev`는 최적화가 꺼져 있어 멀쩡한 곳을 고치게 됩니다. 반드시 `pnpm build && pnpm start`에서.
- **lab ≠ field.** 내 기기 Lighthouse 100점이 저사양 단말·카카오 인앱에서 100점은 아닙니다. 최종 검증은 17단계 web-vitals RUM, 추세는 18단계.
- **과한 최적화는 부채입니다.** 모든 컴포넌트 memo·작은 컴포넌트까지 dynamic import는 오히려 느려집니다 — 측정으로 확인된 곳에만.
- **메모는 진단으로만.** Profiler 기록 없이 붙인 `useMemo`/`useCallback`은 효과 불확실, 복잡도만 확실히 늘립니다.
- **렌더링 전략이 더 근본 해법일 때**가 있습니다 — leaf 최적화 전 03(SSR/SSG/ISR) 점검(전환 결정은 03 게이트).

## 원본 가이드

이 스킬은 FE 가이드 **"13. 성능 최적화"**를 자동화한 것입니다.

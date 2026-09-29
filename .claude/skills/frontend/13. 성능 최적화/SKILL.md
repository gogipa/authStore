---
name: fe-performance
description: >-
  화면·상태·API 연동이 동작하는 프론트엔드를 Core Web Vitals(LCP/INP/CLS) 기준으로
  "측정 먼저" 최적화한다. 번들 분석·Lighthouse 베이스라인 → 코드 스플리팅(next/dynamic) →
  이미지 최적화(next/image) → Profiler 기반 메모이제이션 진단 → 재측정·vercel-react-best-practices
  교차 점검. AI는 변환·진단, 우선순위·이득 판단은 사람. "프론트 성능 최적화", "성능 튜닝",
  "Core Web Vitals", "코드 스플리팅", "dynamic import", "이미지 최적화", "번들 분석",
  "메모이제이션", "리렌더 진단", "web performance", "LCP", "INP", "CLS", "bundle analysis",
  "code splitting", "memoization" 같은 요청에서 사용.
metadata:
  version: 1.0.0
---

# 성능 최적화 (Performance Optimization)

동작하는 프론트엔드를 **빠르고 안정적으로 느껴지게** 만든다. 기준은 감(感)이 아니라
**Core Web Vitals** — 그려지는 속도(LCP)·입력 반응성(INP)·레이아웃 안정성(CLS)이다. 산출물 =
번들·Lighthouse 베이스라인(13-1) → 코드 스플리팅·이미지 최적화(13-2) → 메모이제이션·번들 진단
(13-3) → 재측정·검증. **AI는 번들 트리맵 해석·`next/image` 변환·dynamic import 경계·Profiler
진단(회수율), "어느 화면부터·어디까지 고칠 가치가 있나"라는 우선순위·이득 판단은 사람(정밀도).**

<!-- 변경 포인트 (배포본 → 본인 환경에 맞게 수정):
  1. 출력 경로: 기본 frontend-output/<주제-슬러그>/13_성능/. 볼트 설치본은 FE/실행산출물/<주제> 고정 가능.
  2. 계승 출처: 08 화면구현(08_화면구현/)·10 API연동(10_API연동/)·03 아키텍처(03_아키텍처/) 경로를 본인 폴더 구조로 수정.
  3. 도구(MCP/CLI): Context7(next/image·next/dynamic·React19 최신 시그니처) / pnpm·@next/bundle-analyzer·Lighthouse·Chrome DevTools(로컬 측정) — 없으면 degrade.
  4. 스택 버전: React 19 / Next.js 15(App Router) / TS strict / TanStack Query v5 / Zustand / Tailwind. 팀 버전이 다르면 Context7로 재확인.
-->

## 핵심 원칙

- **제1원칙 "측정 먼저(measure first)".** 추측 `useMemo` 남발·전 컴포넌트 `memo`는 부채다. Stage 1에서
  베이스라인을 글로 박고 Stage 5에서 같은 기준으로 재측정하는 닫힌 루프로만 손댄다.
- **상위 산출물 계승, 재발명 금지 — 단 확정 상태일 때만.**
  - **08 화면구현 → 측정 대상 화면**: 무거운 화면·상태화면을 08에서 받는다(화면 임의 신설 금지).
  - **10 API연동 → 페칭 점검**: 워터폴·직렬 await는 10의 query 훅을 근거로 점검(임의 재설계 금지).
  - **03 렌더링 전략 → 근본 해법 후보**: 클라에서 무거운 데이터를 그려 느린 화면은 leaf 최적화 전에
    SSR/SSG/ISR 전환 점검 — 단 **전환 결정은 03 게이트 회부**(임의 확정 금지).
  - 08/10/03 잔존 `⚠️`/`[확인 필요]`는 측정 노트에 보존.
- **AI에게 변환·진단을, 사람에게 우선순위를.** `<img>`→`next/image`·dynamic 경계·트리맵 해석은 AI 몫.
  "이 INP가 진짜 문제인가, 고칠 가치가 있나"는 사람 몫(포밋은 모바일 이미지 화면이 핵심).
- **메모이제이션은 진단으로만.** Profiler 기록을 입력으로 강제. React 19 컴파일러 영역은 수동 메모 제거.
- **최적화 기법은 부작용이 있다.** 스플리팅은 청크 요청 증가, above-the-fold를 미루면 LCP 악화,
  priority는 LCP 후보만. 가드를 명시하고 vercel-react-best-practices로 마지막에 거른다.
- **lab ≠ field·단계별 파일로 끊는다.** 프로덕션 빌드에서만 측정(개발 모드 무의미), 최종 검증은
  17·18 field(RUM). 13-1→13-2→13-3→재측정 순, 한 방 생성 금지.

## 입력

- **필수**: `<루트>/08_화면구현/`(무거운 화면·상태화면 — 측정·최적화 대상의 원천). 없으면 측정할
  대상이 불명확하므로 위치를 묻고 **중단**.
  <!-- 변경 포인트(입력 경로): 본인 설치본은 <루트>=FE/실행산출물/<주제>. 상위 산출물이 다른 폴더면 수정 -->
- **권장**:
  - `10_API연동/`(데이터 페칭 워터폴·직렬 await 점검 근거 — 없으면 페칭 점검 ⚠️ 생략)
  - `03_아키텍처/03-1_렌더링전략맵.md`(렌더링 전략 근본 해법 후보 — 없으면 leaf 최적화만, 전략 전환 제안 보류)
- **측정 입력(권장)**: `ANALYZE=true pnpm build`의 `.next/analyze` 트리맵 요약·`pnpm build`의 라우트별
  First Load JS 표·대상 화면 Lighthouse 리포트(LCP/INP/CLS/TBT)·React DevTools Profiler 기록. 측정
  입력이 없으면 측정 방법·명령을 안내하고 사용자가 붙일 때까지 코드 변경을 시작하지 않는다(측정 먼저).
- 08이 없으면 **중단**. 그 외 보조 입력은 degrade.

> 측정 자체(빌드 실행·Lighthouse·Profiler 캡처)는 로컬 사람 작업이다. 스킬은 측정 명령을 안내하고,
> 사용자가 붙인 결과를 **해석·진단·변환**한다.

## 출력 위치: `frontend-output/<주제-슬러그>/13_성능/`

<!-- 변경 포인트(출력 경로): 기본은 현재 작업 폴더의 frontend-output/<주제-슬러그>/.
     본인 설치본은 볼트 실행산출물 경로 고정 가능. 모든 FE 스킬은 같은 <루트>를 공유. -->

| 파일 | 내용 | 생성 stage |
|---|---|---|
| `13-1_CWV측정.md` | 베이스라인: 라우트별 First Load JS(큰 순)·무거운 의존성·중복 청크·CWV 임계(LCP 2.5s/INP 200ms/CLS 0.1) 초과 화면·**"효과 대비 노력" 우선순위표**. 측정 조건(프로덕션 빌드) 명시 | Stage 1 |
| `13-2_코드스플리팅·이미지.md` | `next/dynamic` 경계(loading fallback·ssr:false)·스플리팅 근거 주석 / `next/image` 변환(`sizes`·`priority`·`placeholder`·`remotePatterns`)·속성↔지표(LCP/CLS) 매핑표 | Stage 2~3 |
| `13-3_메모이제이션·번들분석.md` | Profiler 진단(리렌더 원인·비용 큰/싼 컴포넌트 구분)·적용한 `memo`/`useCallback`/`useDeferredValue`·React19 컴파일러 영역·**예방적 메모 금지 근거**·번들 진단 후속 | Stage 4 |
| `13-after_재측정.md` | Stage 1 동일 조건 재측정 → 베이스라인 대조표(First Load JS·LCP/INP/CLS 변화)·목표 미달 화면 다음 액션·vercel-react-best-practices 점검 결과 | Stage 5 |
| `_검증체크리스트.md` | 사람 확인 항목 | Stage 5 |

- 출력 폴더가 없으면 생성. `<주제-슬러그>`는 짧은 kebab-case(예: `pomit`).
- 원본 가이드의 `docs/perf/0013-baseline.md`·`0013-after.md`는 예시 경로 — 위 정본 파일명으로 통일한다.

## 파이프라인

### Stage 0 — 입력 확인·도구 probe·degrade
- `<루트>/08_화면구현/`을 읽어 측정·최적화 대상 화면을 파악. **없으면 중단**(위치 질의).
- `10_API연동/`·`03_아키텍처/03-1_렌더링전략맵.md` 로드 시도(있으면 페칭·전략 점검 활성, 없으면 ⚠️ 후 해당 점검 축소).
- **측정 입력 확인**: 트리맵·First Load JS 표·Lighthouse·Profiler 기록이 붙었는지 확인. 없으면 측정
  명령(아래)을 안내하고 사용자가 붙일 때까지 코드 변경 보류.
  - ⚠️ **빌드 가능한 코드베이스(`src/`) 부재 시**(상위 단계가 초안만 만든 경우): 측정 명령(`pnpm build`)이
    실행 불가하므로 베이스라인(13-1)·재측정(13-after)은 상위 산출물(08/10/03) 근거의 **구조적 추정 + ⚠️(미실측)**으로
    작성하고, 측정 데이터를 붙여 실측으로 대체할 자리를 남긴다(전 표를 추정으로 채우되 실측 갭을 명시).
- **도구 probe**: Context7(ToolSearch 존재) / pnpm·`@next/bundle-analyzer`·`pnpm build`·`pnpm start`·
  Lighthouse(bash 시도). 없으면 degrade(아래 "도구 정확성").

측정 명령 안내(사용자 로컬 실행):
```bash
pnpm add -D @next/bundle-analyzer          # next.config.ts에서 withBundleAnalyzer로 감싼 뒤
ANALYZE=true pnpm build                     # .next/analyze/*.html 트리맵 생성
pnpm build && pnpm start                    # 프로덕션 빌드에서 Lighthouse·Profiler 측정(개발 모드 금지)
```

### Stage 1 — 측정 먼저: 베이스라인 → 13-1
- 붙은 트리맵·`pnpm build` 출력·Lighthouse 리포트를 **해석**(이 단계에선 코드를 고치지 않는다).
- 라우트별 First Load JS를 큰 순으로 정렬, 어떤 의존성이 무게를 차지하는지 식별.
- 여러 청크 **중복** 라이브러리·한 화면에서만 쓰는데 공통 번들에 들어간 것 표시.
- CWV가 **임계(LCP 2.5s / INP 200ms / CLS 0.1)**를 넘은 화면 표시.
- **"효과 대비 노력" 우선순위표**(예: 큰 청크 1개 스플리팅 = 고효과/저노력).
- 측정 조건을 명시("프로덕션 빌드 `pnpm build && pnpm start`에서 측정") — Stage 5 재측정이 같은 조건이어야 비교 가능.
- → `13-1_CWV측정.md`.

> 베이스라인을 글로 박는 이유는 Stage 5에서 "정말 좋아졌는가"를 같은 기준으로 비교하기 위해서다.

### 🚦 게이트 — 최적화 우선순위 확정 (사람 개입, 필수)
AskUserQuestion으로 13-1(베이스라인 + "효과 대비 노력" 우선순위표)을 제시 → 사용자가 OK/수정.
- 핵심 결정 항목(사람이 쥐는 판단 — "측정 먼저"의 사람 몫):
  - **어느 화면부터** — 모든 화면 균등 최적화가 아니라, 측정상 가장 느린 화면·가장 무거운 번들부터.
  - **어디까지 고칠 가치가 있나** — 비즈니스·사용자 맥락(포밋은 모바일 이미지 화면이 핵심)으로 손절선.
  - **기법 선택** — 코드 스플리팅 / 이미지 / 메모이제이션 / 또는 **03 렌더링 전략 전환(03 게이트 회부)**.
- **우선순위를 사람이 확정하기 전에는 Stage 2(코드 변경)로 넘어가지 않는다**(추측 최적화·한 방 생성 방지).

### Stage 2 — 코드 스플리팅·dynamic import → 13-2
- **Context7로 Next.js 15 `next/dynamic`의 `ssr`·`loading` 최신 시그니처 확인 후** 작성(부재 시 내장 지식 + ⚠️).
- 대상: 베이스라인에서 지목된 "첫 화면에 당장 필요 없는데 번들에 들어간" 무거운 컴포넌트(포밋 예 —
  예약 화면 결제 위젯·시터 상세 지도·채팅 모달).
- 규칙:
  - `next/dynamic`으로 분리, 각각 `loading` fallback(스켈레톤) 지정.
  - 브라우저 전용 라이브러리(지도 등)는 `ssr: false`로 서버 번들 제외.
  - **라우트 단위는 App Router가 자동 분할** — 여기선 라우트 내부의 무거운 하위 컴포넌트만 대상.
  - 무엇을 왜 스플리팅했는지 **주석으로 근거**(예: "결제 위젯 120KB, 첫 페인트 불필요").
- **가드**: above-the-fold 콘텐츠는 스플리팅 금지(오히려 LCP 악화).

### Stage 3 — 이미지 최적화(next/image) → 13-2
- **Context7로 `next/image`의 `sizes`·`fill`·`priority`·`placeholder` 최신 권장 패턴 확인 후** 작성.
- 대상·규칙(포밋 예):
  - 검색 결과 카드 썸네일: 고정 비율 컨테이너 + `fill` + `sizes`로 반응형, CLS 방지.
  - 시터 상세 대표 프로필(LCP 요소): `priority` + 정확한 `sizes`.
  - 스크롤 아래 이미지: 기본 lazy 유지(`priority` 금지) + `blur` placeholder로 깜빡임 제거.
  - 외부 이미지 도메인(BE/S3)은 `next.config.ts` `images.remotePatterns`에 등록.
- **가드**: 모든 이미지 `priority` 금지(LCP 후보만 — 다운로드 경쟁으로 LCP 악화). `width/height` 또는
  `fill` 비율을 반드시 지정해 CLS 방지.
- 변경 후 **어떤 속성이 어떤 지표(LCP/CLS)를 노린 것인지 표**로. → `13-2`(Stage 2·3 함께).

### Stage 4 — 메모이제이션: 진단으로만 → 13-3
- **Profiler 기록이 입력으로 붙어야만 메모를 적용**(없으면 캡처 안내 후 **적용 보류** — "측정 먼저").
  - 단 **`13-3` 파일 자체는 생성**한다: Profiler 미첨부면 (a) 캡처 안내·(b) 코드 정적 분석 기반 리렌더 위험 후보(⚠️ 적용 보류)·(c) 예방적 메모 금지 근거·(d) 번들 진단 후속을 담는다. "보류"는 **코드 변경(메모 적용)만 막는 것**이지 문서 누락이 아니다.
- **Context7로 React 19 `useTransition`·`useDeferredValue` 최신 시그니처 확인 후** 작성.
- 진단: 필터 입력 1회에 어떤 컴포넌트가 몇 번 리렌더되는지·원인(props 참조 변경/부모 전파), 리렌더
  비용이 **큰 컴포넌트와 싸서 메모 이득 없는 것을 구분**.
- 수정(진단으로 효과 확인된 곳만): 리스트 아이템 `memo` + 부모가 넘기는 콜백/객체 props를
  `useCallback`/`useMemo`로 안정화 / 검색어 입력은 `useDeferredValue`·디바운스로 INP 분리 /
  **React 19 컴파일러 처리 영역은 수동 메모 제거.**
- **금지**: Profiler 미확인 곳 예방적 `useMemo`/`memo` / 원시값·가벼운 계산 `useMemo`.
- 적용 전후 리렌더 횟수·INP 변화 비교. 번들 진단 후속(중복 의존성 제거 등)도 여기 기록.
- → `13-3_메모이제이션·번들분석.md`.

### Stage 5 — 재측정 + vercel-react-best-practices 교차 점검 → 13-after·검증체크리스트
- **`/vercel-react-best-practices`로 이번 최적화 브랜치 변경분 점검**: 과한 메모이제이션 / dynamic
  import가 above-the-fold를 미뤄 LCP 악화 / 데이터 페칭 워터폴(직렬 await — 10 근거) / 클라 컴포넌트
  경계 과도(서버로 내릴 수 있는 부분) / `next/image` `priority`·`sizes` 오용.
- **Stage 1과 동일 조건으로 재측정**(프로덕션 빌드) → 베이스라인 대조: First Load JS·LCP/INP/CLS
  변화를 표로. 목표 미달 화면은 다음 액션 제안(또는 03 렌더링 전략 회부). → `13-after_재측정.md`.
- `_검증체크리스트.md` 생성(`<주제>`/`<날짜>` 치환, 본문 아래).
- 마지막으로 산출물 폴더 경로와 "lab 최적화 — 최종 검증은 17·18단계 field(RUM)" 고지, 베이스라인/재측정
  문서가 18단계 추세·CI 성능 예산의 기준선임을 보고한다.

## 도구 정확성 (probe·degrade)
- **Context7 MCP**(probe) = `next/image`·`next/dynamic`·React 19(`useTransition`/`useDeferredValue`)
  최신 시그니처 조회. 성능 API는 버전마다 권장 패턴이 바뀌므로(Turbopack·RSC 경계) 기억 의존 금지.
  부재 시 **내장 지식 + "버전 확인 필요 ⚠️"** 표기.
- **pnpm·`@next/bundle-analyzer`·Lighthouse·Chrome DevTools**(bash/로컬 probe) = 측정 데이터 생성.
  부재·미설치 시 **측정 명령을 안내하고 "로컬 실행 필요"**(스킬은 결과 해석 담당, 측정은 사람).
- **`vercel-react-best-practices` 스킬** = 이 단계 코드 변경의 안티패턴 교차 점검 기본(Stage 5). 미가용
  시 핵심 원칙 5항목(메모 남발·above-fold 스플리팅·페칭 워터폴·클라 경계 과도·priority 오용)을 수기 체크리스트로 degrade.
- **중단**은 필수 입력(08) 부재 시에만. 측정 입력 부재는 중단이 아니라 **측정 안내 후 보류**(코드 변경만 막음).

## _검증체크리스트 본문 (Stage 5 생성)
```markdown
# 검증 체크리스트 — <주제> 성능 최적화 (작성일: <날짜>)

> AI는 변환·진단까지. "어느 화면부터·어디까지 고칠 가치가 있나"는 사람의 판단이다.

- [ ] 측정은 프로덕션 빌드(pnpm build && pnpm start)에서 했는가 (개발 모드 숫자 금지)
- [ ] 베이스라인(13-1)과 재측정(13-after)이 동일 조건 — First Load JS·LCP/INP/CLS 대조표 존재
- [ ] 최적화 우선순위를 사람이 확정한 뒤 코드 변경했는가 (추측 최적화·한 방 생성 금지)
- [ ] dynamic import: above-the-fold 콘텐츠를 미루지 않았는가 / ssr:false는 브라우저 전용만 / 스플리팅 근거 주석
- [ ] next/image: priority는 LCP 후보 이미지에만 / 모든 이미지 width·height 또는 fill 비율 지정(CLS 방지) / remotePatterns 등록
- [ ] 메모이제이션: Profiler로 확인된 곳만 적용(예방적 useMemo/memo 0건) / React19 컴파일러 영역 수동 메모 제거
- [ ] 데이터 페칭 워터폴 점검(10 입력 시) — 병렬화 가능한 직렬 await 식별
- [ ] vercel-react-best-practices 교차 점검 완료(또는 5항목 수기 체크)
- [ ] 렌더링 전략이 근본 해법인 화면은 03 게이트로 회부(leaf 최적화로 임의 확정 금지)
- [ ] 목표 미달 화면 다음 액션 기록 / 베이스라인·재측정이 18단계 추세·CI 성능 예산 기준선임을 확인
- [ ] lab 점수 — 최종 검증은 17·18단계 field(web-vitals RUM)로 (lab≠field 유의)
```

## 주의
- **개발 모드 측정은 무의미하다.** `pnpm dev`는 최적화가 꺼져 느리다. 번들·LCP·INP는 반드시
  `pnpm build && pnpm start`(또는 프리뷰 배포)에서.
- **lab 점수가 좋아도 field가 다를 수 있다.** 내 기기 Lighthouse 100점이 저사양 단말·카카오 인앱에서
  100점은 아니다. 최종 검증은 17단계 web-vitals RUM, 추세는 18단계.
- **과한 최적화는 부채다.** 모든 컴포넌트 `memo`·작은 컴포넌트 dynamic import는 청크 요청만 늘려 오히려
  느려진다. 측정으로 확인된 곳에만, 확인 안 된 최적화는 머지하지 않는다.
- **이미지는 CLS의 주범이다.** `next/image`로 옮겨도 `width/height`·`fill` 비율을 안 주면 CLS가 튄다.
  `priority`는 LCP 후보만.
- **흔한 실수 — 측정 없이 메모부터**: 느려 보인다는 인상만으로 `useMemo`/`useCallback`을 흩뿌리는 것.
  진단 없는 메모는 효과 불확실·복잡도만 확실히 늘린다. Stage 4처럼 Profiler 기록을 근거로만.
- **디자인 시리즈 중복 금지**: 시안·토큰 정의는 디자인 몫. 이 단계는 구현물을 측정·튜닝하는 엔지니어링이다.

## 원본 가이드
- 이 스킬은 FE 가이드 **"13. 성능 최적화"**를 자동화한 것입니다.

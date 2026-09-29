# autoStore — 신발 자동등록 로컬 웹앱

라쿠텐 재팬의 신발을 네이버 스마트스토어(해외구매대행)에 등록하는 과정을 자동화하는 로컬 웹앱이다. 이 PC 안(127.0.0.1)에서만 돌고, AI 작업은 사용자가 고른 로컬 AI CLI(Claude Code·Antigravity CLI·Codex)로 처리한다.

- 요구사항: [docs/prd](docs/prd/README.md)
- 화면 시안: [docs/design](docs/design/README.md)
- 개발 설계(스택·아키텍처·ERD·API·개발 환경): [docs/dev](docs/dev/README.md)
- 개발 실행 문서(M1, phase별): [docs/action](docs/action/README.md)

## 필요한 것

| 도구       | 버전                            |
| ---------- | ------------------------------- |
| Node       | 24.21.0 (`.nvmrc`. 24.15 이상)  |
| pnpm       | 9.15.0 (`corepack enable pnpm`) |
| PostgreSQL | 14 이상, 이 PC에서 실행 중      |

## 처음 한 번

```bash
nvm use                      # .nvmrc의 Node 24.21.0
corepack enable pnpm
pnpm install                 # 커밋 훅(husky)도 함께 설치된다

createdb autostore_dev
createdb autostore_test
cp apps/BE/.env.example apps/BE/.env   # <사용자>를 이 PC의 PostgreSQL 사용자로 바꾼다

pnpm db:migrate              # autostore_dev에 마이그레이션 적용
pnpm --filter @autostore/be db:migrate:test
pnpm api:gen                 # API 명세(05-2)에서 화면용 타입 생성
```

## 자주 쓰는 명령

| 명령                                                 | 하는 일                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm dev`                                           | BE(127.0.0.1:3100)와 화면 개발 서버(127.0.0.1:5173)를 함께 띄운다. 화면은 http://127.0.0.1:5173 |
| `pnpm build` → `pnpm start`                          | 화면을 빌드한 뒤 BE가 화면까지 함께 내보낸다(http://127.0.0.1:3100)                             |
| `pnpm test` / `pnpm test:e2e`                        | 단위 테스트 / BE e2e 테스트(`autostore_test`)                                                   |
| `pnpm lint` · `pnpm typecheck` · `pnpm format:check` | 코드 검사                                                                                       |

## 지켜야 할 것

- 비밀정보(커머스API 시크릿, 토큰, API 키)는 코드·`.env`·로그·AI 프롬프트에 넣지 않는다. OS 키체인에만 둔다.
- 개발·테스트에서 실제 외부 서비스(데이터랩, 라쿠텐, 커머스API)를 부르지 않는다. fixture를 쓴다.
- 커밋 메시지는 Conventional Commits를 따른다. 규칙은 [06-1](docs/dev/06_개발환경/06-1_저장소·형상관리.md)에 있다.

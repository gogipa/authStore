# 이미지 생성 fixture (M0 S1)

실제 agy를 부르지 않고 `AgyImageGenProvider`(`src/modules/integrations/image-gen/agy-image-gen.provider.ts`)를 검증하는 파일이다.
M0 S1(2026-10-02, agy 1.2.14, [S1 보고서](../../../../../docs/dev/07_M0스파이크/S1_썸네일생성.md)) 실측 출력을 **녹화본**으로 넣었다.

- 정리: 로컬 경로는 `<HOME>`(사용자 홈)·`<RUN_DIR>`(실행 폴더)·`<BRAIN>`(agy 대화 폴더)으로, 대화 id는 `00000000-0000-4000-8000-00000000000N`으로 바꿨다.
  이메일·키·토큰이 없는지 다시 검사했다. `agy-t2i-no-schema-stream.stdout.jsonl`은 text_delta 두 조각에 나뉘어 남아 있던 진짜 대화 id도 가짜 id로 바꿨다.
- 가짜 agy(`../ai-engine/bin/fake-ai-cli.mjs`)는 출력 글의 `<HOME>`을 그 호출의 `HOME`으로, `<RUN_DIR>`을 `--add-dir`의 상위 폴더로 바꾼다.
  시나리오 `run.brain`이 있으면 `$HOME/.gemini/antigravity-cli/brain/<conversationId>/`에 결과 파일을 둔다. 자식 `HOME`은 임시 폴더다(세계 기본값 `<세계 폴더>/home`, 테스트가 따로 줄 수도 있다). 임시 폴더가 아니면 가짜 agy는 쓰지 않고 exit 97로 끝난다.
- 앱은 `--output-format json`을 쓴다. stream-json 녹화본은 모양 참고용이고, 앱 테스트는 `result` 이벤트에서 꺼낸 봉투(`*.result.json`)를 쓴다.

| 파일                                                                   | 종류            | 내용                                                                                                                                                        | 쓰는 테스트              |
| ---------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `agy-edit-success-json.stdout.jsonl` · `.meta.jsonl`                   | 녹화본(e11)     | 레퍼런스 2장 편집, `--output-format json` + `--json-schema`. `structured_output.image_path`가 brain 폴더의 `thumbnail_<13자리>.jpg`, `response`에는 잡음 키 | 성공·대체 찾기·출력 없음 |
| `agy-edit-success-stream.stdout.jsonl` · `.meta.jsonl`                 | 녹화본(e01)     | 같은 편집의 stream-json. 도구 이벤트에는 출력 경로가 없다                                                                                                   | 참고                     |
| `agy-edit-success-brain.jsonl`                                         | 녹화본(e01)     | 성공 뒤 brain 폴더 파일 목록, `steps/<n>/output.txt`('Generated image is saved at …', '경로를 사용자에게 말하지 말라' 문장)                                 | 참고                     |
| `agy-edit-tool-error-missing-ref.stdout.jsonl` · `.meta.jsonl`         | 녹화본(e09)     | 레퍼런스 파일 없음: 도구 `ERROR`, 봉투는 `SUCCESS`·exit 0, `structured_output.error`에 'failed to read image file …'                                        | 참고                     |
| `agy-edit-tool-error-missing-ref.result.json`                          | 녹화본에서 꺼냄 | 위 stream의 `result` 이벤트 봉투(= json 형식 봉투)                                                                                                          | 도구 오류                |
| `agy-edit-print-timeout.stdout.jsonl` · `.meta.jsonl` · `-brain.jsonl` | 녹화본(e10)     | `--print-timeout 12s`: `SUCCESS`·exit 0, `structured_output` 없음, 생성 요청 취소(`context canceled`)                                                       | 참고                     |
| `agy-edit-print-timeout.result.json` · `.stderr.txt`                   | 녹화본에서 꺼냄 | 위 `result` 이벤트 봉투와 stderr `[agy] print timeout after 12s …`                                                                                          | 시간 초과                |
| `agy-t2i-no-schema-stream.stdout.jsonl` · `.meta.jsonl`                | 녹화본(g01)     | 스키마 없는 텍스트→이미지: 경로가 응답 글에만 있다(앱은 이 방식을 쓰지 않는다)                                                                              | 참고                     |
| `agy-quota-probe.stdout.jsonl` · `.meta.jsonl`                         | 녹화본(p05)     | `agy -p /quota --output-format json`(쿼터를 쓰지 않음): `command.data.groups[].buckets[].remaining_fraction`                                                | 참고(M2 헬스 패널 후보)  |
| `agy-synthetic-refused.json`                                           | **합성본**      | 성공 봉투에서 `structured_output`만 `{image_path:'', error:'IMAGE_SAFETY: …'}`로 바꿈. 실제 거부 문구는 S1에서 관찰하지 못했다                              | 거부                     |
| `agy-synthetic-empty-success.json`                                     | **합성본**      | 성공 봉투에서 `structured_output`만 `{image_path:'', error:null}`로 바꿈                                                                                    | 빈 SUCCESS               |

- 결과 이미지 파일은 넣지 않았다. 테스트가 sharp로 1024×1024 JPEG를 만들어 쓴다(agy는 요청 크기와 관계없이 1024²를 낸다 — S1 12/12).
- 거부·쿼터 초과 녹화본은 첫 실제 발생 때 더한다.

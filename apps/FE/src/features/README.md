도메인 기능(`features/<도메인>/`: 훅·폼·표 등). 폴더 이름은 OpenAPI 태그 그대로다(03-2 §3). 그 도메인을 쓰는 첫 화면을 만들 때 폴더를 만든다.

- `index.ts`가 공개 API다. 다른 레이어는 `@/features/<이름>`으로만 가져온다(내부 파일 직접 import는 ESLint가 막는다).
- `api/`: Query 훅. queryKey는 `qk(태그, operationId, 파라미터?)`(`@/shared/api/queryKeys`), 호출은 `request(() => api.GET(...))`.
- SSE 알림으로 다시 읽을 쿼리는 `shared/api/events.ts`의 `EVENT_INVALIDATIONS` 표에 이벤트 → queryKey를 더한다.

지금 있는 feature: `integrations`(P1-02, 오늘 외부 조회 현황), `settings`(P1-03, 현재 설정·설정 파일 검사·다시 읽기), `step-engine`(P1-04, 후보 목록·상세·이어서 할 곳·재실행 필요 모아 보기·제외·다시 작업·성별, 후보 머리·단계 점. P1-05, 단계 레일·단계 실행·버전 이력·바뀐 입력·오너 수정 훅, 단계 표 `StepTable`·상태 줄 `StepStatusBar`·`StaleInputs`, 입력 키 화면 이름), `system`(P1-07, 비밀 키 입력·커머스API 인증 상태 훅과 패널 `SecretKeysPanel`·`AuthStatusPanel`, 다른 화면에서 키 입력으로 잇는 `SystemKeyLink`).

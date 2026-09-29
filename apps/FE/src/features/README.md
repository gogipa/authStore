도메인 기능(`features/<도메인>/`: 훅·폼·표 등). 폴더 이름은 OpenAPI 태그 그대로다(03-2 §3). 그 도메인을 쓰는 첫 화면을 만들 때 폴더를 만든다.

- `index.ts`가 공개 API다. 다른 레이어는 `@/features/<이름>`으로만 가져온다(내부 파일 직접 import는 ESLint가 막는다).
- `api/`: Query 훅. queryKey는 `qk(태그, operationId, 파라미터?)`(`@/shared/api/queryKeys`), 호출은 `request(() => api.GET(...))`.
- SSE 알림으로 다시 읽을 쿼리는 `shared/api/events.ts`의 `EVENT_INVALIDATIONS` 표에 이벤트 → queryKey를 더한다.

지금 있는 feature: `integrations`(P1-02, 오늘 외부 조회 현황), `settings`(P1-03, 현재 설정·설정 파일 검사·다시 읽기).

/**
 * `Idempotency-Key` 헤더 값(05-1 §1.7, UUID).
 * G4 승인 버튼을 **누를 때 한 번** 만들고, 같은 승인을 다시 보낼 때(네트워크 재시도)는 같은 키를 쓴다.
 * 화면을 그릴 때마다 만들지 않는다(03-2 §6.2). P4-03 `createCandidateRegistration`이 쓴다.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

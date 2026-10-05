import { describe, expect, it } from 'vitest';
import { PreValidationSupersededError, serializedRun } from './usePreValidation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('사전 검증 한 번에 하나(P4-02 — SSE로 연달아 다시 불려도)', () => {
  it('앞 요청이 끝나기 전 새 요청은 기다리고, 그사이 더 새 요청이 오면 가운데 요청은 보내지 않는다', async () => {
    const first = deferred<string>();
    let inFlight = 0;
    let maxInFlight = 0;
    const calls: string[] = [];
    const run = (label: string, wait?: Promise<string>) => () => {
      calls.push(label);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return (wait ?? Promise.resolve(label)).finally(() => {
        inFlight -= 1;
      });
    };
    const a = serializedRun('12:COMBINATION', run('a', first.promise));
    const b = serializedRun('12:COMBINATION', run('b'));
    const c = serializedRun('12:COMBINATION', run('c'));
    first.resolve('a');
    await expect(a).resolves.toBe('a');
    await expect(b).rejects.toBeInstanceOf(PreValidationSupersededError);
    await expect(c).resolves.toBe('c');
    expect(calls).toEqual(['a', 'c']);
    expect(maxInFlight).toBe(1);
  });

  it('다른 키(여정·옵션 방식)는 따로 돈다', async () => {
    await expect(
      Promise.all([
        serializedRun('1:COMBINATION', async () => 1),
        serializedRun('2:COMBINATION', async () => 2),
      ]),
    ).resolves.toEqual([1, 2]);
  });
});

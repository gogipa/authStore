import { StepExecutor } from './step-executor.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('StepExecutor — 프로세스 안 비동기 실행(M1 직렬)', () => {
  it('한 번에 하나씩(직렬) 돌고, whenIdle은 작업 중에 넣은 작업까지 끝나야 풀린다', async () => {
    const executor = new StepExecutor();
    const order: string[] = [];
    const gate = deferred();
    let active = 0;
    let maxActive = 0;
    const task = (name: string, wait?: Promise<void>) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`start:${name}`);
      if (wait) await wait;
      order.push(`end:${name}`);
      active -= 1;
      if (name === 'a') executor.submit(task('c'));
    };
    executor.submit(task('a', gate.promise));
    executor.submit(task('b'));
    let idle = false;
    const idlePromise = executor.whenIdle().then(() => (idle = true));
    await Promise.resolve();
    expect(executor.pending).toBe(2);
    expect(idle).toBe(false);
    gate.resolve();
    await idlePromise;
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
    expect(maxActive).toBe(1);
    expect(executor.pending).toBe(0);
  });

  it('작업이 던져도 다음 작업을 돌린다. 쉬고 있으면 whenIdle은 곧바로 풀린다', async () => {
    const executor = new StepExecutor();
    const done: string[] = [];
    executor.submit(() => Promise.reject(new Error('boom')));
    executor.submit(() => {
      done.push('next');
      return Promise.resolve();
    });
    await executor.whenIdle();
    expect(done).toEqual(['next']);
    await expect(executor.whenIdle()).resolves.toBeUndefined();
  });

  it('동시 상한(P1-10)을 올리면 함께 돈다. 앱을 닫는 중이면 새 작업을 받지 않는다', async () => {
    const executor = new StepExecutor();
    executor.setConcurrency(2);
    const gate = deferred();
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
    };
    executor.submit(task);
    executor.submit(task);
    await Promise.resolve();
    expect(maxActive).toBe(2);
    gate.resolve();
    await executor.whenIdle();
    executor.onApplicationShutdown();
    let ran = false;
    executor.submit(() => {
      ran = true;
      return Promise.resolve();
    });
    await executor.whenIdle();
    expect(ran).toBe(false);
  });
});

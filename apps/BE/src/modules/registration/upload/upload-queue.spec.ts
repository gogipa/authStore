import { UploadQueue } from './upload-queue.js';

/** 부를 때마다 동시 실행 수를 세는 가짜 업로드(풀어 줄 때까지 붙잡는다) */
function fakeUpload() {
  let inFlight = 0;
  let maxInFlight = 0;
  const releases: (() => void)[] = [];
  const order: string[] = [];
  const call = (name: string) =>
    new Promise<string>((resolve) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(`start ${name}`);
      releases.push(() => {
        inFlight -= 1;
        order.push(`end ${name}`);
        resolve(name);
      });
    });
  return { call, releases, order, max: () => maxInFlight };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('upload-queue — 앱 전체 직렬(동시 1건, 규칙 8)', () => {
  it('업로드 두 개를 동시에 요청해도 가짜 포트가 본 동시 호출은 최대 1', async () => {
    const queue = new UploadQueue();
    const port = fakeUpload();
    const a = queue.run(() => port.call('A'));
    const b = queue.run(() => port.call('B'));
    expect(queue.pending).toBe(2);
    await tick();
    expect(port.order).toEqual(['start A']);
    port.releases.shift()!();
    await expect(a).resolves.toBe('A');
    await tick();
    expect(port.order).toEqual(['start A', 'end A', 'start B']);
    port.releases.shift()!();
    await expect(b).resolves.toBe('B');
    expect(port.max()).toBe(1);
    await queue.whenIdle();
    expect(queue.pending).toBe(0);
  });

  it('앞 일이 실패해도 다음 일은 돈다(예외는 그 호출자에게만)', async () => {
    const queue = new UploadQueue();
    const failed = queue.run(() => Promise.reject(new Error('500')));
    const next = queue.run(() => Promise.resolve('ok'));
    await expect(failed).rejects.toThrow('500');
    await expect(next).resolves.toBe('ok');
  });
});

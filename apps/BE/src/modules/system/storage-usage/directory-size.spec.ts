import { lstat, readdir } from 'node:fs/promises';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DirectoryReadOps, measureDirectory } from './directory-size.js';

/** 시간 한도에 걸리지 않는 마감 */
const FAR = { deadline: Number.POSITIVE_INFINITY };

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

/** 폴더 아래 모든 항목의 (경로, 크기, 수정 시각) — 재기 전후가 같은지 본다 */
function snapshot(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .map((d) => {
      const p = join(d.parentPath, d.name);
      const s = statSync(p, { throwIfNoEntry: false });
      return `${p} ${s?.size ?? '-'} ${s?.mtimeMs ?? '-'}`;
    })
    .sort();
}

describe('measureDirectory(D-25 저장 공간 — 읽기 전용 폴더 재기)', () => {
  let base: string;
  let root: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'autostore-dirsize-'));
    root = join(base, 'root');
    mkdirSync(join(root, 'sub', 'deeper'), { recursive: true });
    writeFileSync(join(root, 'a.bin'), Buffer.alloc(10));
    writeFileSync(join(root, 'sub', 'b.bin'), Buffer.alloc(20));
    writeFileSync(join(root, 'sub', 'deeper', 'c.bin'), Buffer.alloc(5));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('하위 폴더까지 일반 파일 크기 합과 개수 → OK 35바이트 3개', async () => {
    await expect(measureDirectory(root, FAR)).resolves.toEqual({
      status: 'OK',
      bytes: 35,
      fileCount: 3,
    });
  });

  it('빈 폴더 → OK 0바이트 0개', async () => {
    const empty = join(base, 'empty');
    mkdirSync(empty);
    await expect(measureDirectory(empty, FAR)).resolves.toEqual({
      status: 'OK',
      bytes: 0,
      fileCount: 0,
    });
  });

  it('없는 폴더 → NOT_FOUND, 크기·개수 null', async () => {
    await expect(measureDirectory(join(base, 'nope'), FAR)).resolves.toEqual({
      status: 'NOT_FOUND',
      bytes: null,
      fileCount: null,
    });
  });

  it('뿌리가 파일이면 UNREADABLE', async () => {
    await expect(measureDirectory(join(root, 'a.bin'), FAR)).resolves.toEqual({
      status: 'UNREADABLE',
      bytes: null,
      fileCount: null,
    });
  });

  it('뿌리가 폴더 바로가기(심볼릭 링크)면 따라가지 않고 UNREADABLE', async () => {
    const link = join(base, 'link-to-root');
    symlinkSync(root, link, 'dir');
    await expect(measureDirectory(link, FAR)).resolves.toMatchObject({ status: 'UNREADABLE' });
  });

  it('안쪽 바로가기(파일·폴더)는 따라가지도 세지도 않는다', async () => {
    const outside = join(base, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'big.bin'), Buffer.alloc(1000));
    symlinkSync(join(outside, 'big.bin'), join(root, 'file-link'));
    symlinkSync(outside, join(root, 'sub', 'dir-link'), 'dir');
    symlinkSync(root, join(root, 'loop'), 'dir'); // 고리도 따라가지 않으니 끝난다
    await expect(measureDirectory(root, FAR)).resolves.toEqual({
      status: 'OK',
      bytes: 35,
      fileCount: 3,
    });
  });

  it('재고 나도 폴더 안이 그대로다(쓰기·지우기 없음)', async () => {
    const before = snapshot(root);
    await measureDirectory(root, FAR);
    expect(snapshot(root)).toEqual(before);
  });

  it('마감이 이미 지났으면 읽지 않고 PARTIAL 0바이트', async () => {
    await expect(measureDirectory(root, { deadline: 0, now: () => 1 })).resolves.toEqual({
      status: 'PARTIAL',
      bytes: 0,
      fileCount: 0,
    });
  });

  it('재는 중 마감이 지나면 센 만큼을 PARTIAL로 준다', async () => {
    let t = 0;
    // 시계를 볼 때마다 10ms씩 간다: 뿌리 폴더(0)·그 파일 묶음(10)까지 읽고 다음 폴더 앞(20)에서 멈춘다
    const result = await measureDirectory(root, { deadline: 15, now: () => (t += 10) - 10 });
    expect(result.status).toBe('PARTIAL');
    expect(result.bytes).toBe(10);
    expect(result.fileCount).toBe(1);
  });

  it('읽을 수 없는 하위 폴더는 건너뛰고 PARTIAL(센 만큼)', async () => {
    const ops: DirectoryReadOps = {
      lstat,
      readdir: (path, options) =>
        path.endsWith(join('sub', 'deeper'))
          ? Promise.reject(errno('EACCES'))
          : readdir(path, options),
    };
    await expect(measureDirectory(root, { ...FAR, ops })).resolves.toEqual({
      status: 'PARTIAL',
      bytes: 30,
      fileCount: 2,
    });
  });

  it('뿌리 폴더를 읽을 수 없으면(권한) UNREADABLE', async () => {
    const ops: DirectoryReadOps = {
      lstat,
      readdir: () => Promise.reject(errno('EACCES')),
    };
    await expect(measureDirectory(root, { ...FAR, ops })).resolves.toMatchObject({
      status: 'UNREADABLE',
      bytes: null,
    });
  });

  it('읽는 사이 사라진 파일·폴더(ENOENT)는 건너뛰고 OK', async () => {
    const ops: DirectoryReadOps = {
      lstat: (path) => (path.endsWith('b.bin') ? Promise.reject(errno('ENOENT')) : lstat(path)),
      readdir: (path, options) =>
        path.endsWith('deeper') ? Promise.reject(errno('ENOENT')) : readdir(path, options),
    };
    await expect(measureDirectory(root, { ...FAR, ops })).resolves.toEqual({
      status: 'OK',
      bytes: 10,
      fileCount: 1,
    });
  });

  it('파일 lstat이 다른 이유로 실패하면 PARTIAL', async () => {
    const ops: DirectoryReadOps = {
      lstat: (path) => (path.endsWith('a.bin') ? Promise.reject(errno('EIO')) : lstat(path)),
      readdir,
    };
    await expect(measureDirectory(root, { ...FAR, ops })).resolves.toEqual({
      status: 'PARTIAL',
      bytes: 25,
      fileCount: 2,
    });
  });

  it('동시 lstat 수 제한(concurrency 1)이어도 결과는 같다', async () => {
    await expect(measureDirectory(root, { ...FAR, concurrency: 1 })).resolves.toEqual({
      status: 'OK',
      bytes: 35,
      fileCount: 3,
    });
  });
});

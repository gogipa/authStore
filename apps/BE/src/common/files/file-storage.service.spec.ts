import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfigService } from '../config/app-config.service.js';
import { FileStorageService, UnsafeDataPathError } from './file-storage.service.js';

describe('FileStorageService', () => {
  let root: string;
  let storage: FileStorageService;
  const sha = 'ab'.repeat(32);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'autostore-files-'));
    storage = new FileStorageService({ appDataDir: root } as AppConfigService);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('이미지 경로는 데이터 폴더 기준 상대 경로 images/<sha 앞 2자>/<sha>.<ext>', () => {
    expect(storage.imagePath(sha, 'jpg')).toBe(`images/ab/${sha}.jpg`);
    expect(() => storage.imagePath('xyz', 'jpg')).toThrow();
    expect(() => storage.imagePath(sha, '../x')).toThrow();
  });

  it.each(['../outside.txt', 'images/../../outside', '/etc/passwd', '', 'a/\0b', 'C:\\x'])(
    '데이터 폴더 밖을 가리키는 경로(%j)는 거부한다',
    (p) => {
      expect(() => storage.resolve(p)).toThrow(UnsafeDataPathError);
    },
  );

  it('안쪽 상대 경로는 데이터 폴더 아래 절대 경로로 푼다', () => {
    expect(storage.resolve('images/ab/x.jpg')).toBe(join(root, 'images', 'ab', 'x.jpg'));
  });

  it('임시 파일에 쓴 뒤 rename한다(임시 파일이 남지 않는다). 같은 경로는 한 번만 쓴다', async () => {
    const rel = storage.imagePath(sha, 'png');
    expect(await storage.writeIfAbsent(rel, Buffer.from('first'))).toBe(true);
    expect(await storage.writeIfAbsent(rel, Buffer.from('second'))).toBe(false);
    expect(readFileSync(join(root, rel), 'utf8')).toBe('first');
    expect(readdirSync(join(root, 'images', 'ab'))).toEqual([`${sha}.png`]);
  });

  it('없는 파일은 exists=false·openRead=null·read=null', async () => {
    expect(await storage.exists('images/zz/none.jpg')).toBe(false);
    expect(await storage.openRead('images/zz/none.jpg')).toBeNull();
    expect(await storage.read('images/zz/none.jpg')).toBeNull();
  });

  it('openRead는 크기와 스트림 열기 함수를 준다', async () => {
    const rel = storage.imagePath(sha, 'jpg');
    await storage.writeIfAbsent(rel, Buffer.from('12345'));
    const opened = await storage.openRead(rel);
    expect(opened?.size).toBe(5);
    const chunks: Buffer[] = [];
    for await (const chunk of opened!.open()) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('12345');
  });
});

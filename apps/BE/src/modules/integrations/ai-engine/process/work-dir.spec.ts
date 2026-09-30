import { existsSync, readdirSync, realpathSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { REPO_ROOT } from '../../../../common/config/paths.js';
import {
  aiImageFileNames,
  createAiWorkspace,
  removeAiWorkspace,
  withAiWorkspace,
} from './work-dir.js';

describe('AI 작업 폴더(P1-10 규칙 2·9, §8 주의)', () => {
  let src: string;

  beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), 'autostore-src-'));
    writeFileSync(join(src, 'a.JPG'), 'a');
    writeFileSync(join(src, 'b.png'), 'b');
    writeFileSync(join(src, 'other.png'), 'c');
  });

  afterEach(() => {
    rmSync(src, { recursive: true, force: true });
  });

  it('호출마다 os.tmpdir() 아래 새 빈 폴더(저장소 밖), 이미지 전용 폴더에는 이번 이미지만 순서 이름으로', async () => {
    const ws = await createAiWorkspace({
      images: [join(src, 'a.JPG'), join(src, 'b.png')],
      io: true,
    });
    try {
      for (const dir of [ws.cwd, ws.imageDir!, ws.ioDir!]) {
        const real = realpathSync(dir);
        expect(relative(realpathSync(tmpdir()), real).startsWith('..')).toBe(false);
        expect(relative(REPO_ROOT, real).startsWith('..')).toBe(true);
      }
      expect(readdirSync(ws.cwd)).toEqual([]);
      expect(readdirSync(ws.imageDir!).sort()).toEqual(['image-1.jpg', 'image-2.png']);
      expect(ws.imageNames).toEqual(aiImageFileNames([join(src, 'a.JPG'), join(src, 'b.png')]));
      const other = await createAiWorkspace();
      expect(other.cwd).not.toBe(ws.cwd);
      expect(other.imageDir).toBeNull();
      await removeAiWorkspace(other);
    } finally {
      await removeAiWorkspace(ws);
    }
    expect(existsSync(ws.cwd)).toBe(false);
    expect(existsSync(ws.imageDir!)).toBe(false);
    expect(existsSync(ws.ioDir!)).toBe(false);
  });

  it('withAiWorkspace는 실패해도 폴더를 지운다', async () => {
    let seen = '';
    await expect(
      withAiWorkspace({}, (ws) => {
        seen = ws.cwd;
        return Promise.reject(new Error('boom'));
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(seen)).toBe(false);
  });
});

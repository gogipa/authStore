import { randomBytes } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';

/** 데이터 폴더 밖을 가리키는 경로(`..`·절대 경로) */
export class UnsafeDataPathError extends Error {
  constructor(readonly relativePath: string) {
    super('데이터 폴더 밖을 가리키는 경로라 쓰지 않았습니다.');
  }
}

/** 이미지 폴더 이름(APP_DATA_DIR 아래). 모양은 images/<sha 앞 2자>/<sha>.<확장자>(Proposed, 06-4) */
export const IMAGES_DIR = 'images';

const SHA256_RE = /^[0-9a-f]{64}$/;
const EXT_RE = /^[a-z0-9]{1,8}$/;

/**
 * APP_DATA_DIR 아래 파일 저장(03-2 §2 common '파일 저장', F-BS-02).
 * - DB·응답에는 데이터 폴더 기준 **상대 경로**만 쓴다(`/` 구분). 절대 경로는 이 서비스 안에서만 만든다.
 * - 쓰기는 임시 파일에 쓴 뒤 rename한다(중간에 꺼져도 반쪽 파일이 남지 않는다).
 * - 같은 내용(sha256)은 한 번만 둔다(내용 주소).
 */
@Injectable()
export class FileStorageService {
  constructor(private readonly config: AppConfigService) {}

  /** 데이터 폴더(절대 경로). 밖으로 내보내지 않는다 */
  get rootDir(): string {
    return resolve(this.config.appDataDir);
  }

  /** 내용 주소 이미지 경로(상대): images/ab/<sha>.<ext> */
  imagePath(sha256: string, ext: string): string {
    if (!SHA256_RE.test(sha256)) throw new Error('sha256 형식이 아닙니다.');
    if (!EXT_RE.test(ext)) throw new Error('확장자 형식이 아닙니다.');
    return `${IMAGES_DIR}/${sha256.slice(0, 2)}/${sha256}.${ext}`;
  }

  /**
   * 상대 경로 → 절대 경로. 절대 경로, `..`로 데이터 폴더를 벗어나는 경로, 빈 경로는 거부한다.
   */
  resolve(relativePath: string): string {
    if (
      relativePath.length === 0 ||
      relativePath.includes('\0') ||
      isAbsolute(relativePath) ||
      /^[a-zA-Z]:/.test(relativePath) ||
      relativePath.split(/[\\/]/).includes('..')
    ) {
      throw new UnsafeDataPathError(relativePath);
    }
    const root = this.rootDir;
    const abs = resolve(root, normalize(relativePath));
    const rel = relative(root, abs);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new UnsafeDataPathError(relativePath);
    }
    return abs;
  }

  /** 파일이 있는지(일반 파일만) */
  async exists(relativePath: string): Promise<boolean> {
    return (await this.statFile(relativePath)) !== null;
  }

  /** 파일 크기(바이트). 없으면 null */
  async statFile(relativePath: string): Promise<{ size: number } | null> {
    try {
      const s = await stat(this.resolve(relativePath));
      return s.isFile() ? { size: s.size } : null;
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  /**
   * 내용을 경로에 쓴다. 이미 파일이 있으면 쓰지 않는다(내용 주소라 같은 경로 = 같은 내용).
   * @returns 새로 썼으면 true
   */
  async writeIfAbsent(relativePath: string, content: Buffer): Promise<boolean> {
    const target = this.resolve(relativePath);
    if (await this.exists(relativePath)) return false;
    const dir = dirname(target);
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.${randomBytes(8).toString('hex')}.tmp`);
    try {
      await writeFile(tmp, content, { flag: 'wx' });
      await rename(tmp, target);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    return true;
  }

  /**
   * 읽기 준비. 없는 파일이면 null. 스트림은 open()을 부를 때 만든다
   * (304처럼 본문이 필요 없으면 파일을 열지 않는다).
   */
  async openRead(relativePath: string): Promise<{ size: number; open: () => ReadStream } | null> {
    const info = await this.statFile(relativePath);
    if (!info) return null;
    const abs = this.resolve(relativePath);
    return { size: info.size, open: () => createReadStream(abs) };
  }

  /** 파일 내용. 없는 파일이면 null */
  async read(relativePath: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(relativePath));
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
}

function isNotFound(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e.code === 'ENOENT' || e.code === 'ENOTDIR')
  );
}

import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import {
  AI_IMAGE_DIR_PREFIX,
  AI_IO_DIR_PREFIX,
  AI_WORK_DIR_PREFIX,
} from '../ai-engine.constants.js';

/**
 * AI 호출 작업 폴더(P1-10 규칙 2·9, §8 주의 '작업 폴더를 저장소 안에 두지 않는다').
 * - 작업 폴더(cwd): 호출마다 `os.tmpdir()/autostore-ai-XXXXXX`를 새로 만든다. spawn 때 비어 있다(.claude/·.mcp.json 없음)
 * - 이미지 전용 폴더(비전): 따로 만들고 이번 호출의 이미지만 `image-1.jpg`처럼 순서 이름으로 복사한다(images_seen 비교용)
 * - 입출력 폴더(codex `--output-schema` 파일): 작업 폴더를 비워 두려고 따로 만든다(Proposed)
 * 끝나면(성공·실패 모두) 모두 지운다. 앱 데이터 폴더·저장소에 만들지 않는다.
 */
export interface AiWorkspace {
  /** 빈 작업 폴더(절대 경로) */
  cwd: string;
  /** 이미지 전용 폴더(비전만) */
  imageDir: string | null;
  /** 복사한 이미지 절대 경로(순서 = 넘긴 순서) */
  imagePaths: string[];
  /** 복사한 이미지 파일 이름(images_seen 기대값) */
  imageNames: string[];
  /** 입출력 폴더(요청했을 때만) */
  ioDir: string | null;
}

/** 넘긴 이미지의 복사 이름(순서대로 `image-1.<확장자>`). 실행기와 어댑터가 같은 이름을 기대값으로 쓴다 */
export function aiImageFileNames(paths: readonly string[]): string[] {
  return paths.map((path, i) => `image-${i + 1}${extname(path).toLowerCase()}`);
}

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** 빈 작업 폴더 하나(감지 호출용) */
export function createAiWorkDir(): Promise<string> {
  return makeTempDir(AI_WORK_DIR_PREFIX);
}

/** 폴더를 지운다(없어도 된다) */
export async function removeAiDir(dir: string | null): Promise<void> {
  if (!dir) return;
  await rm(dir, { recursive: true, force: true });
}

/** 작업 폴더(+ 이미지 전용 폴더·입출력 폴더)를 만든다. 만들다 실패하면 만든 것을 지우고 던진다 */
export async function createAiWorkspace(
  options: { images?: readonly string[]; io?: boolean } = {},
): Promise<AiWorkspace> {
  const ws: AiWorkspace = {
    cwd: '',
    imageDir: null,
    imagePaths: [],
    imageNames: [],
    ioDir: null,
  };
  try {
    ws.cwd = await makeTempDir(AI_WORK_DIR_PREFIX);
    const images = options.images ?? [];
    if (images.length > 0) {
      ws.imageDir = await makeTempDir(AI_IMAGE_DIR_PREFIX);
      ws.imageNames = aiImageFileNames(images);
      for (let i = 0; i < images.length; i += 1) {
        const target = join(ws.imageDir, ws.imageNames[i]!);
        await copyFile(images[i]!, target);
        ws.imagePaths.push(target);
      }
    }
    if (options.io) ws.ioDir = await makeTempDir(AI_IO_DIR_PREFIX);
    return ws;
  } catch (error) {
    await removeAiWorkspace(ws);
    throw error;
  }
}

export async function removeAiWorkspace(ws: AiWorkspace): Promise<void> {
  await Promise.all([removeAiDir(ws.cwd || null), removeAiDir(ws.imageDir), removeAiDir(ws.ioDir)]);
}

/** 작업 폴더를 만들어 쓰고 반드시 지운다 */
export async function withAiWorkspace<T>(
  options: { images?: readonly string[]; io?: boolean },
  fn: (ws: AiWorkspace) => Promise<T>,
): Promise<T> {
  const ws = await createAiWorkspace(options);
  try {
    return await fn(ws);
  } finally {
    await removeAiWorkspace(ws);
  }
}

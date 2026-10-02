import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { IsolatedCliRunner } from '../ai-engine/process/isolated-cli-runner.js';
import type { CallLogResult, CallLogStart } from '../http/call-log.service.js';
import { systemClock } from '../http/clock.token.js';
import { AGY_IMAGE_AGENT_MODEL, AgyImageGenProvider } from './agy-image-gen.provider.js';

/**
 * 실제 agy 이미지 생성 확인(M0 S1). **기본으로 돌지 않는다** — 기존 실제 호출 스위치 `AI_CLI_LIVE=1`에 더해
 * `AI_CLI_LIVE_ENGINES`에 `agy-image`가 있을 때만 이 PC의 진짜 agy로 썸네일 1장을 만든다(오너 Google 플랜 쿼터를 쓴다).
 *   AI_CLI_LIVE=1 AI_CLI_LIVE_ENGINES=agy-image pnpm --filter @autostore/be test -- live-image-gen
 * call_log는 메모리에 남긴다(DB를 쓰지 않는다). agy는 오너 홈 ~/.gemini 아래에 대화 기록을 남긴다(S1 §5).
 */
const LIVE = process.env.AI_CLI_LIVE === '1';
const ENGINES = (process.env.AI_CLI_LIVE_ENGINES ?? '').split(',').map((s) => s.trim());

(LIVE && ENGINES.includes('agy-image') ? describe : describe.skip)(
  '실제 agy generate_image(AI_CLI_LIVE=1, AI_CLI_LIVE_ENGINES=agy-image)',
  () => {
    it('레퍼런스 1장 → 이미지 1장(JPEG, 크기는 agy가 정한다)', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'autostore-live-image-'));
      try {
        const ref = join(dir, 'ref.jpg');
        writeFileSync(
          ref,
          await sharp({ create: { width: 512, height: 512, channels: 3, background: '#f4f4f4' } })
            .jpeg()
            .toBuffer(),
        );
        const rows: { start: CallLogStart; result: CallLogResult | null }[] = [];
        const provider = new AgyImageGenProvider(
          new IsolatedCliRunner(),
          {
            start: (input) => {
              rows.push({ start: input, result: null });
              return Promise.resolve({ id: rows.length } as never);
            },
            finish: (id, result) => {
              rows[id - 1]!.result = result;
              return Promise.resolve(true);
            },
          },
          systemClock,
        );
        const result = await provider.generate({
          identity: { provider: 'AGY', model: AGY_IMAGE_AGENT_MODEL, providerVersion: null },
          prompt:
            'Photorealistic studio product photo, square 1:1, 1024 pixels. One plain white canvas sneaker, side view, centered. Clean light-gray background. No text, no person.',
          referenceImagePaths: [ref],
          sizePx: 1024,
          timeoutMs: 300_000,
          signal: new AbortController().signal,
        });
        expect(result.kind).toBe('IMAGE');
        if (result.kind === 'IMAGE') {
          const meta = await sharp(result.bytes).metadata();
          expect(meta.width).toBeGreaterThan(0);
          expect(meta.height).toBeGreaterThan(0);
        }
        expect(rows).toHaveLength(1);
        expect(rows[0]!.start.target).toBe('AI_AGY_CLI');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 330_000);
  },
);

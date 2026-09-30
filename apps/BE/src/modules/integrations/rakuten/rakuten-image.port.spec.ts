import type { Clock } from '../http/clock.token.js';
import type {
  ExternalCallContext,
  ExternalHttpGateway,
  ExternalHttpRequest,
} from '../http/external-http.gateway.js';
import { RakutenImageHttpAdapter } from './rakuten-image.http-adapter.js';
import {
  apiImageUrlsOf,
  enlargeApiImageUrl,
  isRakutenImageUrl,
  RAKUTEN_API_IMAGE_EX_SIZE,
} from './rakuten-image.port.js';

const clock: Clock = {
  now: () => new Date('2026-09-28T05:00:00Z'),
  sleep: () => Promise.resolve(),
};

function fakeGateway(replies: { status: number; location?: string; body?: string }[]) {
  const calls: { target: string; url: string }[] = [];
  const gateway = {
    request: (target: string, req: ExternalHttpRequest, ctx: ExternalCallContext = {}) => {
      calls.push({ target, url: req.url });
      const reply = replies.shift() ?? { status: 200, body: 'img' };
      const headers = new Headers(reply.location ? { location: reply.location } : {});
      const raw = { status: reply.status, headers, body: Buffer.from(reply.body ?? '') };
      ctx.describeResponse?.(raw);
      return Promise.resolve({ ...raw, callLogId: calls.length });
    },
  } as unknown as ExternalHttpGateway;
  return { gateway, calls };
}

describe('라쿠텐 이미지 포트(P3-01 — 관문 RAKUTEN_IMAGE, _ex 대체)', () => {
  it('허용 호스트의 https만 이미지 주소로 본다', () => {
    expect(isRakutenImageUrl('https://tshop.r10s.jp/shop-a/cabinet/a.jpg')).toBe(true);
    expect(isRakutenImageUrl('https://image.rakuten.co.jp/shop-a/cabinet/a.jpg')).toBe(true);
    expect(isRakutenImageUrl('https://thumbnail.image.rakuten.co.jp/@0_mall/a.jpg?_ex=1')).toBe(
      true,
    );
    expect(isRakutenImageUrl('http://tshop.r10s.jp/a.jpg')).toBe(false);
    expect(isRakutenImageUrl('https://item.rakuten.co.jp/shop-a/1/')).toBe(false);
    expect(isRakutenImageUrl('https://user:pw@tshop.r10s.jp/a.jpg')).toBe(false);
    expect(isRakutenImageUrl('not a url')).toBe(false);
  });

  it('_ex 값을 1200x1200으로 키운다(없으면 더한다, http는 https로)', () => {
    expect(RAKUTEN_API_IMAGE_EX_SIZE).toBe('1200x1200');
    expect(
      enlargeApiImageUrl(
        'https://thumbnail.image.rakuten.co.jp/@0_mall/shop-a/cabinet/a_1.jpg?_ex=128x128',
      ),
    ).toBe('https://thumbnail.image.rakuten.co.jp/@0_mall/shop-a/cabinet/a_1.jpg?_ex=1200x1200');
    expect(enlargeApiImageUrl('http://thumbnail.image.rakuten.co.jp/a.jpg')).toBe(
      'https://thumbnail.image.rakuten.co.jp/a.jpg?_ex=1200x1200',
    );
    expect(enlargeApiImageUrl('::')).toBeNull();
  });

  it('Item Search 원문의 이미지 URL: medium 먼저(formatVersion 1·2), 없으면 small', () => {
    expect(apiImageUrlsOf({ mediumImageUrls: ['a', 'b', 'a'] })).toEqual(['a', 'b']);
    expect(apiImageUrlsOf({ mediumImageUrls: [{ imageUrl: 'c' }] })).toEqual(['c']);
    expect(apiImageUrlsOf({ mediumImageUrls: [], smallImageUrls: ['s'] })).toEqual(['s']);
    expect(apiImageUrlsOf({})).toEqual([]);
  });

  it('어댑터: 관문 RAKUTEN_IMAGE로 보내고, 허용 호스트 안 리다이렉트만 2번까지 따라간다', async () => {
    const { gateway, calls } = fakeGateway([
      { status: 302, location: 'https://tshop.r10s.jp/shop-a/cabinet/moved.jpg' },
      { status: 200, body: 'jpeg' },
    ]);
    const adapter = new RakutenImageHttpAdapter(gateway, clock);
    const res = await adapter.fetchImage('https://image.rakuten.co.jp/shop-a/cabinet/a.jpg');
    expect(calls).toEqual([
      { target: 'RAKUTEN_IMAGE', url: 'https://image.rakuten.co.jp/shop-a/cabinet/a.jpg' },
      { target: 'RAKUTEN_IMAGE', url: 'https://tshop.r10s.jp/shop-a/cabinet/moved.jpg' },
    ]);
    expect(res).toMatchObject({
      httpStatus: 200,
      finalUrl: 'https://tshop.r10s.jp/shop-a/cabinet/moved.jpg',
      fetchedAt: new Date('2026-09-28T05:00:00Z'),
    });
    expect(res.bytes.toString()).toBe('jpeg');

    // 허용 밖 호스트로 가는 리다이렉트는 따라가지 않고 3xx를 그대로 준다
    const outside = fakeGateway([{ status: 301, location: 'https://evil.example/a.jpg' }]);
    const r2 = await new RakutenImageHttpAdapter(outside.gateway, clock).fetchImage(
      'https://tshop.r10s.jp/a.jpg',
    );
    expect(r2.httpStatus).toBe(301);
    expect(outside.calls).toHaveLength(1);

    // 리다이렉트 고리는 2번까지만
    const loop = fakeGateway([
      { status: 302, location: 'https://tshop.r10s.jp/b.jpg' },
      { status: 302, location: 'https://tshop.r10s.jp/c.jpg' },
      { status: 302, location: 'https://tshop.r10s.jp/d.jpg' },
    ]);
    const r3 = await new RakutenImageHttpAdapter(loop.gateway, clock).fetchImage(
      'https://tshop.r10s.jp/a.jpg',
    );
    expect(loop.calls).toHaveLength(3);
    expect(r3.httpStatus).toBe(302);
  });
});

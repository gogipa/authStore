import { describe, expect, it } from 'vitest';
import { DEMO_BASENAME, isDemoPath } from './router';

describe('체험으로 켤지(D-31) — 켠 주소가 /demo 아래인지', () => {
  it('basename은 /demo', () => {
    expect(DEMO_BASENAME).toBe('/demo');
  });

  it.each([
    ['/demo', true],
    ['/demo/', true],
    ['/demo/candidates/1/approval', true],
    ['/demo/settings/ai-engine', true],
    ['/', false],
    ['/guide', false],
    ['/setup', false],
    ['/demos', false],
    ['/candidates/demo', false],
  ])('%s → %s', (pathname, expected) => {
    expect(isDemoPath(pathname)).toBe(expected);
  });
});

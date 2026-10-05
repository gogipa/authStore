import { afterEach, describe, expect, it } from 'vitest';
import { browserStorage, createMemoryStorage, installMemoryStorage } from './browserStorage';

/** 브라우저 저장소 한 곳(D-31): 보통 앱은 진짜 저장소, 체험은 켤 때 메모리로 바꾼다 */
afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('browserStorage', () => {
  it('보통 앱은 window.localStorage·sessionStorage 그대로', () => {
    expect(browserStorage('local')).toBe(window.localStorage);
    expect(browserStorage('session')).toBe(window.sessionStorage);
  });

  it('체험(installMemoryStorage)이면 메모리에만 쓰고, 되돌리면 진짜 저장소다', () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const restore = installMemoryStorage();
    browserStorage('local').setItem('autostore.guide.workFlowHidden', '1');
    browserStorage('session').setItem('autostore.guide.setupWizardShown', '1');
    expect(browserStorage('local').getItem('autostore.guide.workFlowHidden')).toBe('1');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    restore();
    expect(browserStorage('local')).toBe(window.localStorage);
    expect(browserStorage('local').getItem('autostore.guide.workFlowHidden')).toBeNull();
  });

  it('메모리 저장소는 Storage처럼 동작한다', () => {
    const storage = createMemoryStorage();
    storage.setItem('a', '1');
    storage.setItem('b', '2');
    expect(storage.length).toBe(2);
    expect(storage.key(1)).toBe('b');
    storage.removeItem('a');
    expect(storage.getItem('a')).toBeNull();
    storage.clear();
    expect(storage.length).toBe(0);
  });
});

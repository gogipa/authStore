import { browserStorage } from '@/shared/lib/browserStorage';

/**
 * 설정 마법사(F-GD-04, D-30) 자동 열기를 이번 브라우저 세션(탭)에서 이미 정했는지. sessionStorage에만 둔다 — 탭을 새로 열거나 앱을 다시
 * 켜면 다시 본다(서버·설정 파일에 저장하지 않음). 할 일이 남아 있는 동안은 앱을 켤 때마다 한 번 열린다.
 * 저장소를 못 쓰면(사생활 보호 창·막힌 사이트 데이터 — 읽기·쓰기가 예외) **정한 것으로 본다**: 기억할 수 없으니 대시보드를 열 때마다
 * 마법사로 끌려가지 않게 한다. 마법사는 설정·사용 안내에서 언제든, 대시보드 '시작 준비'에서는 할 일이 남았을 때 연다.
 * 체험(`/demo`)에서는 저장소가 메모리라(`browserStorage`) 체험에서 마법사를 열어도 보통 앱의 이 표시는 그대로다.
 */
export const SETUP_WIZARD_SHOWN_KEY = 'autostore.guide.setupWizardShown';

export function readSetupWizardShown(): boolean {
  try {
    return browserStorage('session').getItem(SETUP_WIZARD_SHOWN_KEY) === '1';
  } catch {
    return true;
  }
}

export function writeSetupWizardShown(): void {
  try {
    browserStorage('session').setItem(SETUP_WIZARD_SHOWN_KEY, '1');
  } catch {
    // 저장소를 못 쓰면 기억하지 않는다(어차피 '정한 것'으로 읽힌다)
  }
}

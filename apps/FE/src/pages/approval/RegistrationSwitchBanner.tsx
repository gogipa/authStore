import {
  SWITCH_LABEL,
  SWITCH_OFF_TEXT,
  SWITCH_ON_TEXT,
  usePutRegistrationSwitch,
  useRegistrationSwitch,
} from '@/features/registration';
import { Banner, Switch } from '@/shared/ui';
import styles from './RegistrationSwitchBanner.module.css';

/**
 * SCR-08 등록 API 차단 스위치 띠(Approval.dc.html ⑧ 줄 아래 — P4-03 §5 FE, F-AP-28, 규칙 12). 켜짐이면 경고 띠 '등록 API 차단이 켜져
 * 있어 드라이런만 합니다. 실제로 등록하려면 끄세요.' + 스위치 '등록 API 차단'(`shared/ui/Switch` — `role="switch"`). 스위치를 바꾸면
 * `PUT /registration-switch`(끄면 검증완료 후보가 승인대기로 돌아간다). 꺼짐이면 안내 띠(보드에 없는 문구 — Proposed). 바꾸는 동안
 * 스위치를 잠근다. 값은 서버 값만 보인다(캐시를 직접 바꾸지 않고 다시 읽는다).
 */
export function RegistrationSwitchBanner() {
  const state = useRegistrationSwitch();
  const put = usePutRegistrationSwitch();
  const blocked = state.data?.apiBlocked ?? true;
  return (
    <div className={styles.wrap}>
      <Banner
        tone={blocked ? 'warning' : 'info'}
        role="status"
        actions={
          <Switch
            label={SWITCH_LABEL}
            checked={blocked}
            disabled={!state.data || put.isPending}
            onCheckedChange={(next) => {
              put.reset();
              put.mutate(next);
            }}
          />
        }
      >
        {blocked ? SWITCH_ON_TEXT : SWITCH_OFF_TEXT}
      </Banner>
      {put.error ? (
        <span role="alert" className={styles.error}>
          {put.error.message}
        </span>
      ) : null}
    </div>
  );
}

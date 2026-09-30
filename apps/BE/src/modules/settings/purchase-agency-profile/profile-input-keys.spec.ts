import { validProfileInput } from '../../../../test/fixtures/settings/purchase-agency-profile/profile-fixtures.js';
import { inputKeyLabel } from '../../step-engine/domain/input-keys.js';
import {
  PROFILE_FIELDS_BY_STEP,
  PROFILE_INPUT_KEY_LABEL,
  PROFILE_INPUT_KEYS,
  PROFILE_READER_STEPS,
  profileFieldOf,
  profileInputKey,
  profileStepInputs,
} from './profile-input-keys.js';
import { PROFILE_FIELDS } from './profile-values.js';

describe('프로필 입력 이름(P1-09 Proposed)', () => {
  it('profile.<필드>, 64자 이하(varchar(64)), 12개 모두 이름표가 있다', () => {
    expect(profileInputKey('importer')).toBe('profile.importer');
    expect(PROFILE_INPUT_KEYS).toHaveLength(PROFILE_FIELDS.length);
    for (const key of PROFILE_INPUT_KEYS) {
      expect(key.length).toBeLessThanOrEqual(64);
      expect(PROFILE_INPUT_KEY_LABEL[key]).toBeDefined();
      // step-engine의 '재실행 필요' 사유 이름표가 같은 표를 쓴다
      expect(inputKeyLabel(key)).toBe(PROFILE_INPUT_KEY_LABEL[key]);
    }
    expect(profileFieldOf('profile.importer')).toBe('importer');
    expect(profileFieldOf('profile.unknown')).toBeNull();
    expect(profileFieldOf('settings.costs')).toBeNull();
  });

  it('읽는 단계는 ⑥-3·⑧·⑨(05-1 §2.12). ⑧은 직접 읽지 않고 ⑥-3 HTML을 거친다', () => {
    expect(PROFILE_READER_STEPS).toEqual(['NOTICE_HTML', 'UPLOAD', 'REGISTER']);
    expect(PROFILE_FIELDS_BY_STEP.NOTICE_HTML).toContain('importer');
    expect(PROFILE_FIELDS_BY_STEP.REGISTER).toContain('overseasShippingCommerceAddressbookId');
    expect(PROFILE_FIELDS_BY_STEP.UPLOAD).toEqual([]);
    const read = new Set(Object.values(PROFILE_FIELDS_BY_STEP).flat());
    expect([...PROFILE_FIELDS].filter((field) => !read.has(field))).toEqual([]);
  });

  it('단계 입력(StepInput 모양): SETTINGS 출처·시작 조건·값 포함', () => {
    const inputs = profileStepInputs('NOTICE_HTML', validProfileInput());
    expect(inputs.find((i) => i.inputKey === 'profile.importer')).toEqual({
      inputKey: 'profile.importer',
      sourceType: 'SETTINGS',
      isStartCondition: true,
      required: false,
      value: '[수입자]',
    });
    expect(inputs.map((i) => i.inputKey)).toEqual(
      PROFILE_FIELDS_BY_STEP.NOTICE_HTML.map(profileInputKey),
    );
  });
});

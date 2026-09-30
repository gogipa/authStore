import { childShoeRulesOf } from '../../common/child-shoe/child-shoe.rules.js';
import { DEFAULT_SETTINGS } from '../settings/defaults/default-settings.js';
import { entryChecksOf, needsAdultConfirmation } from './entry-checks.js';
import { detectGender } from './gender-signal.js';

const rules = {
  excludedWords: DEFAULT_SETTINGS.sourcing.ngKeywords,
  childShoe: childShoeRulesOf(DEFAULT_SETTINGS),
};
const MEN_SNEAKER = [558885, 110983, 208025];
const adult = {
  itemName: 'アシックス ゲルカヤノ 14 1201A019-108',
  genreIdPath: MEN_SNEAKER,
  sizesMm: [250, 255, 260, 270, null],
};

describe('URL 입구 아동화 신호(F-SO-05·07·33, P2-02 규칙 12)', () => {
  it('성인 신발(장르 靴 하위·최대 270) → 막을 것 없음', () => {
    expect(entryChecksOf(adult, rules)).toEqual({
      excludedWords: [],
      genreScope: 'IN_SCOPE',
      childSizeSuspect: false,
      adultConfirmationRequired: false,
    });
  });

  it('사이즈 최댓값 235 → 아동화 의심(성인용 확인 필요), 240 → 아님', () => {
    const at235 = entryChecksOf({ ...adult, sizesMm: [210, 225, 235] }, rules);
    expect(at235).toMatchObject({ childSizeSuspect: true, adultConfirmationRequired: true });
    const at240 = entryChecksOf({ ...adult, sizesMm: [220, 240] }, rules);
    expect(at240).toMatchObject({ childSizeSuspect: false, adultConfirmationRequired: false });
    // cm가 아닌 라벨(null)만 있으면 판단하지 않는다
    expect(entryChecksOf({ ...adult, sizesMm: [null] }, rules).childSizeSuspect).toBe(false);
  });

  it('기준은 설정값을 따른다(235 미만 설정은 settings가 막는다)', () => {
    const strict = { ...rules, childShoe: { ...rules.childShoe, sizeMaxMm: 245 } };
    expect(entryChecksOf({ ...adult, sizesMm: [240] }, strict).childSizeSuspect).toBe(true);
  });

  it('/558885/110983/… → IN_SCOPE, 다른 경로 → OUT_OF_SCOPE, 장르 없음 → NOT_FOUND', () => {
    expect(entryChecksOf(adult, rules).genreScope).toBe('IN_SCOPE');
    expect(entryChecksOf({ ...adult, genreIdPath: [558885] }, rules).genreScope).toBe('IN_SCOPE');
    const other = entryChecksOf({ ...adult, genreIdPath: [101070] }, rules);
    expect(other).toMatchObject({ genreScope: 'OUT_OF_SCOPE', adultConfirmationRequired: true });
    const none = entryChecksOf({ ...adult, genreIdPath: null }, rules);
    expect(none).toMatchObject({ genreScope: 'NOT_FOUND', adultConfirmationRequired: true });
    expect(entryChecksOf({ ...adult, genreIdPath: [] }, rules).genreScope).toBe('NOT_FOUND');
  });

  it("中古 → excludedWords ['中古']", () => {
    const checks = entryChecksOf({ ...adult, itemName: '【中古】アシックス ゲルカヤノ 14' }, rules);
    expect(checks.excludedWords).toEqual(['中古']);
  });

  it('제외어 8개와 아동 단어를 모두 모은다(중복 없이, 전각·반각 무시)', () => {
    const name = 'ｷｯｽﾞ インソール 靴紐 箱のみ ジュニア キッズ';
    expect(entryChecksOf({ ...adult, itemName: name }, rules).excludedWords).toEqual([
      'インソール',
      '靴紐',
      '箱のみ',
      'キッズ',
      'ジュニア',
    ]);
  });

  it('성인용 확인 적용 여부(머리 행 값): 아동화 의심·대상 외·장르 모름만', () => {
    expect(needsAdultConfirmation({ childSizeSuspect: true, genreScope: 'IN_SCOPE' })).toBe(true);
    expect(needsAdultConfirmation({ childSizeSuspect: false, genreScope: 'OUT_OF_SCOPE' })).toBe(
      true,
    );
    expect(needsAdultConfirmation({ childSizeSuspect: false, genreScope: 'NOT_FOUND' })).toBe(true);
    expect(needsAdultConfirmation({ childSizeSuspect: false, genreScope: 'IN_SCOPE' })).toBe(false);
    expect(needsAdultConfirmation({ childSizeSuspect: null, genreScope: null })).toBe(false);
  });
});

describe('② 성별 신호(RK-05 — URL로 만들기)', () => {
  it('장르 경로 メンズ靴 110983 → 남성, レディース靴 100480 → 여성, 없으면 상품명', () => {
    expect(detectGender({ genreIdPath: MEN_SNEAKER, itemName: 'x' })).toEqual({
      gender: 'MALE',
      basis: 'GENRE_PATH',
    });
    expect(detectGender({ genreIdPath: [558885, 100480], itemName: 'x' })?.gender).toBe('FEMALE');
    expect(
      detectGender({ genreIdPath: [558885], itemName: 'ナイキ ウィメンズ レディース' }),
    ).toEqual({
      gender: 'FEMALE',
      basis: 'ITEM_NAME',
    });
    expect(detectGender({ genreIdPath: null, itemName: 'メンズ レディース 兼用' })).toBeNull();
    // 'ウィメンズ'는 'メンズ'를 품지만 여성이다
    expect(
      detectGender({ genreIdPath: null, itemName: 'ナイキ コルテッツ ウィメンズ' })?.gender,
    ).toBe('FEMALE');
    expect(detectGender({ genreIdPath: null, itemName: 'ASICS メンズ ランニング' })?.gender).toBe(
      'MALE',
    );
  });
});

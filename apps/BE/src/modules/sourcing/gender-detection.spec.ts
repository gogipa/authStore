import {
  detectCandidateGender,
  genderFromCid,
  resolveCandidateGender,
} from './gender-detection.js';

describe('gender-detection(RK-05, F-SO-18·19)', () => {
  it('cid 50000174 → MALE·KEYWORD_CID, 50000173 → FEMALE', () => {
    expect(genderFromCid('50000174')).toBe('MALE');
    expect(genderFromCid('50000173')).toBe('FEMALE');
    expect(genderFromCid('50000000')).toBeNull();
    expect(
      detectCandidateGender({ keywordCid: '50000174', genreIdPath: null, itemName: null }),
    ).toEqual({
      gender: 'MALE',
      basis: 'KEYWORD_CID',
    });
  });

  it('장르 경로에 100480 → FEMALE·GENRE_PATH, 상품명만 있으면 ITEM_NAME', () => {
    expect(
      detectCandidateGender({
        keywordCid: null,
        genreIdPath: [558885, 100480],
        itemName: 'メンズ',
      }),
    ).toEqual({ gender: 'FEMALE', basis: 'GENRE_PATH' });
    expect(
      detectCandidateGender({
        keywordCid: null,
        genreIdPath: [558885],
        itemName: 'アシックス メンズ',
      }),
    ).toEqual({ gender: 'MALE', basis: 'ITEM_NAME' });
    // 'ウィメンズ'는 남성으로 보지 않는다
    expect(
      detectCandidateGender({ keywordCid: null, genreIdPath: null, itemName: 'ナイキ ウィメンズ' }),
    ).toEqual({ gender: 'FEMALE', basis: 'ITEM_NAME' });
  });

  it('신호가 다르면 적힌 순서(cid → 장르 → 상품명, Proposed)', () => {
    expect(
      detectCandidateGender({
        keywordCid: '50000173',
        genreIdPath: [558885, 110983],
        itemName: 'メンズ',
      }),
    ).toEqual({ gender: 'FEMALE', basis: 'KEYWORD_CID' });
  });

  it('신호 없음·공용(남·여 모두) → null(입력 대기)', () => {
    expect(
      detectCandidateGender({ keywordCid: null, genreIdPath: null, itemName: null }),
    ).toBeNull();
    expect(
      detectCandidateGender({
        keywordCid: null,
        genreIdPath: [558885],
        itemName: 'ユニセックス スニーカー',
      }),
    ).toBeNull();
    expect(
      detectCandidateGender({
        keywordCid: null,
        genreIdPath: [110983, 100480],
        itemName: 'メンズ レディース',
      }),
    ).toBeNull();
  });

  it('오너 FEMALE + 판단 MALE → 값 FEMALE 유지, 재확인 true', () => {
    expect(
      resolveCandidateGender({
        candidate: { gender: 'FEMALE', genderSource: 'OWNER' },
        detected: { gender: 'MALE', basis: 'KEYWORD_CID' },
        ownerGenderInStep: null,
      }),
    ).toEqual({ effective: 'FEMALE', recheckRequired: true });
    expect(
      resolveCandidateGender({
        candidate: { gender: 'FEMALE', genderSource: 'OWNER' },
        detected: { gender: 'FEMALE', basis: 'ITEM_NAME' },
        ownerGenderInStep: null,
      }),
    ).toEqual({ effective: 'FEMALE', recheckRequired: false });
  });

  it('오너 성별이 없으면 자동 → ②에서 고른 성별 → 후보 ② 값', () => {
    expect(
      resolveCandidateGender({
        candidate: { gender: 'FEMALE', genderSource: 'STEP2' },
        detected: { gender: 'MALE', basis: 'GENRE_PATH' },
        ownerGenderInStep: null,
      }).effective,
    ).toBe('MALE');
    expect(
      resolveCandidateGender({
        candidate: { gender: null, genderSource: null },
        detected: null,
        ownerGenderInStep: 'FEMALE',
      }).effective,
    ).toBe('FEMALE');
    expect(
      resolveCandidateGender({
        candidate: { gender: null, genderSource: null },
        detected: null,
        ownerGenderInStep: null,
      }).effective,
    ).toBeNull();
  });
});

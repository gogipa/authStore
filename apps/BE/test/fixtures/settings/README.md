# 설정 파일 fixture (P1-03)

설정 파일 로더·검사(단위)와 `GET /settings`·`POST /settings-snapshots`(e2e)가 쓴다. 모두 기본 템플릿
(`src/modules/settings/defaults/settings.default.json`)에서 한 곳만 바꾼 사본이다. 비밀값·개인 값은 없다.

| 파일                       | 바꾼 것                                                                              | 기대                                     |
| -------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------- |
| `valid.json`               | 없음(기본 템플릿 사본. 단위 테스트가 템플릿과 같은지 본다)                           | 통과                                     |
| `invalid-schema.json`      | `costs.cardSurchargePct`에 문자열 `"2.5"`, 모르는 키 `commerceClientSecret`(가짜 값) | 422 `SETTINGS_SCHEMA_INVALID`            |
| `relax-child-word.json`    | 내장 아동 단어 `キッズ`를 `safety.childKeywords`·`sourcing.ngKeywords`에서 뺐다      | 422 `SAFETY_SETTING_RELAXATION_REJECTED` |
| `relax-size-230.json`      | `safety.childShoeMaxSizeMm` 230                                                      | 422 `SAFETY_SETTING_RELAXATION_REJECTED` |
| `relax-validity-7h.json`   | `safety.judgementValidityHours` 7                                                    | 422 `SAFETY_SETTING_RELAXATION_REJECTED` |
| `notice-block-edited.json` | 고지 필수 블록 `WITHDRAWAL`의 '7일'을 '8일'로(한 글자)                               | 422 `SAFETY_SETTING_RELAXATION_REJECTED` |
| `broken.json`              | 6번째 줄 끝 쉼표를 뺐다(JSON 문법 오류)                                              | 오류 1건(줄·칸 포함)                     |

- 템플릿을 바꾸면 이 파일들도 다시 만든다(`valid.json`은 템플릿 그대로 복사).
- `broken.json`은 prettier가 읽지 못해 `.prettierignore`에 넣었다.

// Conventional Commits. scope는 앱이나 모듈 이름(be, fe, docs, step-engine 등)을 쓴다.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
  },
};

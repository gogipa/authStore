// 커밋 전 검사: 비밀정보 검사는 모든 파일, 포맷은 코드 파일만.
export default {
  '*': ['secretlint --maskSecrets'],
  '*.{ts,tsx,js,mjs,cjs,json,css,yml,yaml}': ['prettier --write'],
};

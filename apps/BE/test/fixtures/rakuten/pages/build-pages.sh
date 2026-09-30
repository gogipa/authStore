#!/bin/sh
# 라쿠텐 상품 페이지 fixture 만들기(P2-02): src/*.utf8.html(손으로 쓴 UTF-8 원본) → *.eucjp.html(실제 페이지처럼 EUC-JP 바이트).
# 파서는 받은 바이트를 TextDecoder('euc-jp')로 푼다(response.text()는 UTF-8로 풀어 일본어가 깨진다).
# 원본을 고치면 이 스크립트를 다시 돌려 두 파일을 함께 커밋한다. 한글·이모지처럼 EUC-JP에 없는 글자는 원본에 쓰지 않는다.
set -eu
cd "$(dirname "$0")"
for src in src/*.utf8.html; do
  name=$(basename "$src" .utf8.html)
  iconv -f UTF-8 -t EUC-JP "$src" > "$name.eucjp.html"
  echo "$name.eucjp.html"
done

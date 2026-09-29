/**
 * call_log.url_masked용 URL 가리기(NFR-02, ERD CHECK ck_call_log_no_secret).
 * 비밀 쿼리값을 `***`로 바꾼다. 쿼리 순서·인코딩은 그대로 두고, 사용자 정보(user:pass@)와 fragment는 뺀다.
 */

/** 이 글자가 이름에 들어간 쿼리 파라미터는 값을 가린다(대소문자 무시) */
export const SECRET_QUERY_NAME_PARTS = [
  'accesskey',
  'applicationid',
  'client_secret',
  'authkey',
  'servicekey',
  'apikey',
  'api_key',
  'token',
  'password',
  'secret',
] as const;

/** ck_call_log_no_secret과 같은 식 */
export const CALL_LOG_SECRET_RE =
  /(accesskey|applicationid|client_secret|authkey|servicekey)=[^*&]/i;

/** url_masked 열 길이 */
export const URL_MASKED_MAX = 2048;

const MASK = '***';

function isSecretName(name: string): boolean {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name.replace(/\+/g, ' '));
  } catch {
    // 잘못된 인코딩이면 원문으로 본다
  }
  const lower = decoded.toLowerCase();
  return SECRET_QUERY_NAME_PARTS.some((part) => lower.includes(part));
}

export function maskUrl(raw: string): string {
  // fragment는 서버로 가지 않으므로 기록하지 않는다
  const noFragment = raw.split('#', 1)[0] ?? '';
  const q = noFragment.indexOf('?');
  let base = q === -1 ? noFragment : noFragment.slice(0, q);
  const query = q === -1 ? null : noFragment.slice(q + 1);
  // 사용자 정보(user:pass@host) 제거
  base = base.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
  let out = base;
  if (query !== null) {
    const masked = query
      .split('&')
      .map((pair) => {
        const eq = pair.indexOf('=');
        if (eq === -1) return pair;
        const name = pair.slice(0, eq);
        return isSecretName(name) ? `${name}=${MASK}` : pair;
      })
      .join('&');
    out = `${base}?${masked}`;
  }
  // 마지막 안전장치: CHECK 식에 걸리는 모양이 어디든 남아 있으면 값을 가린다
  out = out.replace(
    /(accesskey|applicationid|client_secret|authkey|servicekey)=[^&?#/]*/gi,
    `$1=${MASK}`,
  );
  return out.length > URL_MASKED_MAX ? out.slice(0, URL_MASKED_MAX) : out;
}

/**
 * 사이즈 라벨 → mm(F-SO-13·F-SO-20, PRD §8.2 RK-05 'JP cm는 KR mm로 바꾼다(24.5 → 245)'). 순수 함수.
 * - NFKC로 맞춘 뒤(２４．５ｃｍ → 24.5cm) 'cm'가 붙은 숫자, 또는 숫자만 있는 라벨('JP' 접두 허용)을 cm로 본다(10~35cm만)
 * - S/M/L·US·EU·UK 사이즈처럼 cm가 아닌 라벨은 null = '수동 확인'(RK-05)
 * - 반올림: cm × 10을 정수로(24.5 → 245, 25.25 → 253 — 0.05cm 단위 라벨은 거의 없다)
 */
const CM_RE = /(?:^|[^0-9.])(\d{2}(?:\.\d{1,2})?)\s*cm(?![a-z])/i;
const BARE_RE = /^(?:jp\s*)?(\d{2}(?:\.\d{1,2})?)$/i;
/** 사람 발 크기로 볼 수 있는 cm 범위(아동 10cm부터 성인 35cm까지) */
const MIN_CM = 10;
const MAX_CM = 35;

export function sizeLabelToMm(label: string | null | undefined): number | null {
  if (typeof label !== 'string') return null;
  const text = label.normalize('NFKC').trim();
  if (text === '') return null;
  if (/\b(us|uk|eu)\b/i.test(text) && !/cm/i.test(text)) return null;
  const match = CM_RE.exec(text) ?? BARE_RE.exec(text);
  if (!match) return null;
  const cm = Number(match[1]);
  if (!Number.isFinite(cm) || cm < MIN_CM || cm > MAX_CM) return null;
  return Math.round(cm * 10);
}

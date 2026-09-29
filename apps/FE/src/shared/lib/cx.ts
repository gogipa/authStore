/** CSS Module 클래스 이름을 이어 붙인다. 거짓 값(false·null·undefined·'')은 뺀다. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

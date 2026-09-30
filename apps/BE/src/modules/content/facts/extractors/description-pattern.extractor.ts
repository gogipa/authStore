import type { FactLabelSettings } from '../../../settings/schema/settings.types.js';
import {
  LABEL_GROUP_FACT,
  LABEL_GROUP_ORDER,
  type ExtractedFact,
  type FactExtraction,
  type LabelGroup,
} from '../fact.schema.js';
import { labelPositions, mapNfkc, parseHeight, rawSlice } from '../fact-text.js';

/** 줄 하나에서 찾은 항목 이름 */
interface LabelHit {
  group: LabelGroup;
  pos: number;
  length: number;
}

/** 값 뒤를 자르는 글자(문장 끝·주석·다음 괄호 항목) */
const VALUE_STOP = /[。※【]/;
/** 값 끝에서 버리는 구분 글자 */
const TRAILING = /[\s/|,、;:]+$/u;
const LEADING = /^[\s:=]+/u;

/** 항목 이름 뒤 구분자(`:`·`=`·`】`). 원산지·굽높이는 띄어쓰기만 있어도 받는다(`MADE IN VIETNAM`·`厚底 約3cm`) */
function valueStartOf(line: string, hit: LabelHit): number | null {
  let at = hit.pos + hit.length;
  while (at < line.length && line[at] === ' ') at += 1;
  const ch = line[at];
  if (ch === ':' || ch === '=' || ch === '】') return at + 1;
  if (hit.group !== 'origin' && hit.group !== 'heelHeight') return null;
  if (at > hit.pos + hit.length) return at; // 띄어쓰기 뒤 값
  if (hit.group === 'heelHeight' && ch !== undefined && /[約0-9]/.test(ch)) return at;
  return null;
}

function hitsOf(line: string, labels: FactLabelSettings): LabelHit[] {
  const hits: LabelHit[] = [];
  for (const group of LABEL_GROUP_ORDER) {
    for (const label of labels[group]) {
      const length = label.normalize('NFKC').length;
      for (const pos of labelPositions(line, label)) hits.push({ group, pos, length });
    }
  }
  // 같은 자리·겹치는 자리는 먼저 본 묶음·더 긴 이름 하나만(ソール高 ↔ ソール, ヒール高さ ↔ ヒール高)
  hits.sort((a, b) => a.pos - b.pos || b.length - a.length);
  const kept: LabelHit[] = [];
  for (const hit of hits) {
    const last = kept.at(-1);
    if (last && hit.pos < last.pos + last.length) continue;
    kept.push(hit);
  }
  return kept;
}

/**
 * 2순위 — 설명문 패턴(P3-03 규칙 9-2, F-CT-09, PRD §8.5 CT-02 `原産国|生産国|製造国|MADE IN`, `アッパー|ライニング|ソール|素材`,
 * `ヒール高さ?|ソール高|厚底 約`). 원문 글을 NFKC로 바꿔(`／`→`/`, `：`→`:`, 전각 영숫자→반각) 줄마다 항목 이름을 찾고, 이름 뒤
 * 구분자(`:`·`=`·`】`, 원산지·굽높이는 띄어쓰기도)부터 다음 항목 이름·줄 끝·`。`까지를 값으로 본다. 원문 발췌는 원문 표기 그대로
 * (`항목: 값` 조각). 같은 필드는 위에서 먼저 찾은 것이 이긴다. '素材'만 있고 겉감을 따로 못 찾으면 그 값을 겉감으로 본다.
 * 항목 이름 앞이 글자면 다른 낱말의 일부로 본다('インソール'은 밑창이 아니다).
 */
export function extractFromDescription(raw: string, labels: FactLabelSettings): FactExtraction {
  const out: FactExtraction = {};
  if (raw.trim() === '') return out;
  const mapped = mapNfkc(raw);
  let generic: ExtractedFact | null = null;
  let offset = 0;
  for (const line of mapped.text.split('\n')) {
    const hits = hitsOf(line, labels);
    hits.forEach((hit, i) => {
      const start = valueStartOf(line, hit);
      if (start === null) return;
      const next = hits[i + 1]?.pos ?? line.length;
      let value = line.slice(start, Math.max(start, next));
      const stop = VALUE_STOP.exec(value);
      if (stop) value = value.slice(0, stop.index);
      const trimmedLeft = value.replace(LEADING, '');
      const valueStart = start + (value.length - trimmedLeft.length);
      const text = trimmedLeft.replace(TRAILING, '').slice(0, 100);
      if (text === '') return;
      const quote = rawSlice(mapped, offset + hit.pos, offset + valueStart + text.length);
      const fact: ExtractedFact = {
        raw: text,
        height: null,
        evidenceQuote: quote,
        method: 'DESCRIPTION_PATTERN',
        evidenceImageIndex: null,
      };
      if (hit.group === 'material') {
        generic ??= fact;
        return;
      }
      const name = LABEL_GROUP_FACT[hit.group];
      if (out[name]) return;
      if (name === 'heel_height') {
        const height = parseHeight(text);
        if (!height) return;
        out[name] = { ...fact, height };
        return;
      }
      out[name] = fact;
    });
    offset += line.length + 1;
  }
  if (!out.material_upper && generic) out.material_upper = generic;
  return out;
}

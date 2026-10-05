// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as content from './content';
import type { GuideLink } from './content';

/**
 * 사용 안내 글(D-29)의 원본은 docs/design/spec/안내문구.md다. content.ts의 글이 문서 표의 **같은 줄·같은 칸**에 있는지 본다
 * (키 → 글 짝, 링크는 `[이름] → \`주소\``까지). 오너가 문서를 고치면 이 테스트가 실패하고, content.ts를 같은 글로 고치면 다시 통과한다.
 */
const DOC_PATH = fileURLToPath(
  new URL('../../../../../docs/design/spec/안내문구.md', import.meta.url),
);
const doc = readFileSync(DOC_PATH, 'utf8');

/** 글이 아닌 내보내기(목록 키·주소·함수) */
const NOT_TEXT = new Set([
  'READINESS_ITEM_KEYS',
  'SCREEN_HELP_KEYS',
  'START_WITHOUT_KEYWORD_PATH',
  'GUIDE_PATH',
  'SETUP_WIZARD_PATH',
  'DEMO_PATH',
  'DEMO_START_PATH',
  'SCREEN_GUIDE_KEYS',
  'fillText',
]);
/** 글이 아닌 속성(주소·내부 키) */
const NOT_TEXT_PROPS = new Set(['to', 'key']);

function texts(value: unknown, path: string, out: [string, string][]): [string, string][] {
  if (typeof value === 'string') {
    if (value !== '') out.push([path, value]);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => texts(item, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (!NOT_TEXT_PROPS.has(key)) texts(item, `${path}.${key}`, out);
    }
  }
  return out;
}

const all = Object.entries(content)
  .filter(([name]) => !NOT_TEXT.has(name))
  .flatMap(([name, value]) => texts(value, name, []));

// ── 문서 표 읽기: 제목(##~####)마다 표의 줄(머리 줄 뺌)을 칸 배열로 ──

interface Section {
  level: number;
  heading: string;
  rows: string[][];
}

function parseSections(markdown: string): Section[] {
  const out: Section[] = [];
  let current: Section | undefined;
  for (const line of markdown.split('\n')) {
    const head = /^(#{2,4}) (.+)$/.exec(line);
    if (head) {
      current = { level: head[1]!.length, heading: head[2]!.trim(), rows: [] };
      out.push(current);
      continue;
    }
    if (!current || !line.startsWith('|')) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    // 구분 줄(| --- |)을 만나면 바로 앞 줄은 머리 줄이다
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) current.rows.pop();
    else current.rows.push(cells);
  }
  return out;
}

const sections = parseSections(doc);

function section(prefix: string): Section {
  const found = sections.filter((s) => s.heading.startsWith(prefix));
  expect(found, `'${prefix}'로 시작하는 제목`).toHaveLength(1);
  return found[0]!;
}

/** 제목 아래 한 단계 낮은 제목들(다음 같은 단계 제목 전까지) */
function children(prefix: string): Section[] {
  const parent = section(prefix);
  const start = sections.indexOf(parent) + 1;
  const end = sections.findIndex((s, i) => i >= start && s.level <= parent.level);
  return sections
    .slice(start, end === -1 ? undefined : end)
    .filter((s) => s.level === parent.level + 1);
}

const NONE = '—';
const code = (key: string) => `\`${key}\``;
const link = (value: GuideLink | undefined) =>
  value ? `[${value.label}] → ${code(value.to)}` : NONE;
/** `| \`키\` | 글 |` 표 */
const keyRows = (record: Readonly<Record<string, string | GuideLink>>) =>
  Object.entries(record).map(([key, value]) => [
    code(key),
    typeof value === 'string' ? value : link(value),
  ]);
/** 항목 객체에서 상황별 글(이름·링크 말고 글인 칸)만 */
const stateTexts = (item: object) =>
  Object.entries(item).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'label',
  );

/** 아래 표 대조 테스트가 다루는 내보내기. 새 글 내보내기를 더하면 여기와 문서 표 대조를 함께 더한다 */
const CHECKED_BY_TABLE = [
  'READINESS_TEXT',
  'READINESS_ITEMS',
  'PROFILE_FIELD_LABEL',
  'READINESS_INFO',
  'WORK_FLOW_TEXT',
  'WORK_FLOW_STEPS',
  'GUIDE_PAGE_TEXT',
  'DAY_SCENARIO',
  'SAFETY_TEXT',
  'TRAINING_TEXT',
  'SCREENS_TEXT',
  'HELP_TEXT',
  'SCREEN_HELP',
  'EMPTY_STATE',
  'SETUP_WIZARD_TEXT',
  'SETUP_WIZARD_STEPS',
  'GUIDE_SETUP_WIZARD_TEXT',
  'DEMO_TEXT',
  'DEMO_GUIDE_TEXT',
  'DEMO_ENTRY_TEXT',
  'SOURCING_GUIDE_TEXT',
  'SOURCING_NOW_TEXT',
  'SOURCING_GLOSSARY',
  'STEP_GUIDE_COMMON',
  'JUDGEMENT_GUIDE',
  'THUMBNAIL_GUIDE',
  'CONTENT_GUIDE',
  'TAGS_GUIDE',
  'APPROVAL_GUIDE',
];

describe('사용 안내 글 = 안내문구.md', () => {
  it('글이 충분히 있다(빈 내보내기를 잘못 거르지 않았다)', () => {
    expect(all.length).toBeGreaterThan(150);
  });

  it('content.ts의 글이 모두 문서에 글자 그대로 있다', () => {
    const missing = all.filter(([, text]) => !doc.includes(text)).map(([path]) => path);
    expect(missing).toEqual([]);
  });

  it('글 내보내기는 모두 아래 표 대조에 들어 있다', () => {
    const textExports = Object.keys(content).filter((name) => !NOT_TEXT.has(name));
    expect([...textExports].sort()).toEqual([...CHECKED_BY_TABLE].sort());
  });

  it('글에 표를 깨는 문자(|)나 앱 밖 주소가 없다', () => {
    expect(all.filter(([, text]) => /\||https?:\/\//.test(text))).toEqual([]);
  });

  it('화면 도움말은 14개 화면 모두 세 칸이 비어 있지 않다', () => {
    expect(content.SCREEN_HELP_KEYS).toHaveLength(14);
    for (const key of content.SCREEN_HELP_KEYS) {
      const help = content.SCREEN_HELP[key];
      expect(help.todo.length, key).toBeGreaterThan(0);
      expect(help.next.length, key).toBeGreaterThan(0);
      expect(help.stuck.length, key).toBeGreaterThan(0);
    }
  });

  it('fillText는 {이름} 자리를 채우고 모르는 이름은 그대로 둔다', () => {
    expect(content.fillText('{total}개 중 {done}개 완료', { total: 5, done: 3 })).toBe(
      '5개 중 3개 완료',
    );
    expect(content.fillText('빠진 키: {keys}', {})).toBe('빠진 키: {keys}');
  });
});

describe('문서 표와 줄·칸까지 같다(키 → 글 짝, 링크 주소 포함)', () => {
  it('1.1 시작 준비 카드 글', () => {
    expect(section('1.1 ').rows).toEqual(keyRows(content.READINESS_TEXT));
  });

  it('1.2 센 항목 5개: 항목 · 상황 · 글 · 링크(완료면 doneLink)', () => {
    const expected = content.READINESS_ITEM_KEYS.flatMap((key) => {
      const item = content.READINESS_ITEMS[key];
      return stateTexts(item).map(([state, text]) => [
        item.label,
        code(state),
        text,
        link(state === 'done' && 'doneLink' in item ? item.doneLink : item.link),
      ]);
    });
    expect(section('1.2 ').rows).toEqual(expected);
  });

  it('1.3 구매대행 프로필 칸 이름', () => {
    expect(section('1.3 ').rows).toEqual(keyRows(content.PROFILE_FIELD_LABEL));
  });

  it('1.4 참고 줄', () => {
    const expected = Object.values(content.READINESS_INFO).flatMap((info) =>
      stateTexts(info).map(([state, text]) => [info.label, code(state), text, link(info.link)]),
    );
    expect(section('1.4 ').rows).toEqual(expected);
  });

  it('2.1 작업 흐름 카드 글', () => {
    expect(section('2.1 ').rows).toEqual(keyRows(content.WORK_FLOW_TEXT));
  });

  it('2.2 단계별 글: 제목(번호·이름·게이트)과 칸', () => {
    const actual = children('2.2 ').map(({ heading, rows }) => ({ heading, rows }));
    const expected = content.WORK_FLOW_STEPS.map((step) => ({
      heading: `${step.no ? `${step.no} ` : ''}${step.label}${step.gate ? ` — ${step.gate}` : ''}`,
      rows: [
        ['단계 이름', step.label],
        ...(step.gate ? [['게이트 칩', step.gate]] : []),
        ['하는 일', step.does],
        ['앱이 하는 것', step.auto],
        ['사람이 확인할 것', step.check],
        ['링크 버튼', link(step.link)],
      ],
    }));
    expect(actual).toEqual(expected);
  });

  it('3.1 사용 안내 머리', () => {
    expect(section('3.1 ').rows).toEqual(keyRows(content.GUIDE_PAGE_TEXT));
  });

  it('3.2 하루 작업 순서', () => {
    const day = content.DAY_SCENARIO;
    expect(section('3.2 ').rows).toEqual([
      ['제목', day.title, NONE],
      ['캡션', day.caption, NONE],
      ...day.steps.map((step, i) => [
        String(i + 1),
        step.text,
        link('link' in step ? step.link : undefined),
      ]),
      ['소제목', day.entriesTitle, NONE],
      ...day.entries.map((entry) => ['입구', entry, NONE]),
      ['버튼', NONE, link(day.entriesLink)],
    ]);
  });

  it('3.3 안전장치', () => {
    const safety = content.SAFETY_TEXT;
    expect(section('3.3 ').rows).toEqual([
      ['제목', safety.title],
      ['캡션', safety.caption],
      ['소제목', safety.gatesTitle],
      ...safety.gates.map((gate) => ['게이트', gate]),
      ['소제목', safety.switchTitle],
      ...safety.switchLines.map((line) => ['차단 스위치', line]),
      ['소제목', safety.otherTitle],
      ...safety.others.map((other) => ['그 밖', other]),
    ]);
  });

  it('3.4 AI 계정 학습 끄기', () => {
    const training = content.TRAINING_TEXT;
    expect(section('3.4 ').rows).toEqual([
      ['제목', training.title],
      ['첫 문장', training.lead],
      ...training.items.map((item) => ['계정', item]),
    ]);
  });

  it('3.5 화면 안내', () => {
    const screens = content.SCREENS_TEXT;
    expect(section('3.5 ').rows).toEqual([
      ['제목', screens.title, NONE],
      ['캡션', screens.caption, NONE],
      ...screens.items.map((item) => [item.label, item.text, code(item.to)]),
    ]);
  });

  it('4.1 도움말 공통 글', () => {
    expect(section('4.1 ').rows).toEqual(keyRows(content.HELP_TEXT));
  });

  it('4.2 화면별 도움말: 화면 순서와 칸', () => {
    const screens = children('4.2 ');
    expect(screens.map((s) => /— `([^`]+)`$/.exec(s.heading)?.[1])).toEqual([
      ...content.SCREEN_HELP_KEYS,
    ]);
    for (const [i, key] of content.SCREEN_HELP_KEYS.entries()) {
      const help = content.SCREEN_HELP[key];
      expect(screens[i]!.rows, key).toEqual([
        ...help.todo.map((text) => ['이 화면에서 할 일', text, NONE]),
        ...help.next.map((next) => ['다음 단계', next.text, link(next.link)]),
        ...help.stuck.map((text) => ['자주 막히는 곳', text, NONE]),
      ]);
    }
  });

  it('5. 빈 상태 안내(첫 칸 "어디"는 설명이라 뺀다)', () => {
    const expected = Object.entries(content.EMPTY_STATE).map(([key, state]) => {
      const buttons: GuideLink[] = [];
      if ('primary' in state) buttons.push(state.primary);
      if ('secondary' in state) buttons.push(state.secondary);
      return [
        code(key),
        state.title,
        'text' in state ? state.text : NONE,
        buttons.length > 0 ? buttons.map(link).join('<br>') : NONE,
      ];
    });
    expect(section('5. ').rows.map((row) => row.slice(1))).toEqual(expected);
  });

  it('7.1 설정 마법사 화면 글', () => {
    expect(section('7.1 ').rows).toEqual(keyRows(content.SETUP_WIZARD_TEXT));
  });

  it('7.2 설정 마법사 단계별 글: 제목(번호·이름·키)과 칸', () => {
    const actual = children('7.2 ').map(({ heading, rows }) => ({ heading, rows }));
    const expected = content.SETUP_WIZARD_STEPS.map((step, i) => ({
      heading: `${i + 1}단계 ${step.title} — ${code(step.key)}`,
      rows: [
        ['제목', step.title],
        ['첫 문장', step.lead],
        ...step.points.map((point) => ['줄', point]),
        ['링크', link(step.link)],
      ],
    }));
    expect(actual).toEqual(expected);
  });

  it("7.3 사용 안내 '설정 마법사' 패널", () => {
    expect(section('7.3 ').rows).toEqual(keyRows(content.GUIDE_SETUP_WIZARD_TEXT));
  });

  it('8.1 체험 띠·체험이 답하는 글', () => {
    expect(section('8.1 ').rows).toEqual(keyRows(content.DEMO_TEXT));
  });

  it("8.2 체험 입구 '체험해 보기'", () => {
    const entry = content.DEMO_ENTRY_TEXT;
    expect(section('8.2 ').rows).toEqual([
      ['제목', entry.title],
      ['첫 문장', entry.lead],
      ...entry.points.map((point) => ['줄', point]),
      ['버튼', entry.open],
      ['새 탭', entry.newTab],
      ['체험 중', entry.inDemo],
    ]);
  });

  it('8.3 따라 하기 띠: 띠 글 12개와 다음에 할 일 19개(순서·단계·글)', () => {
    const { actions, screens, ...main } = content.DEMO_GUIDE_TEXT;
    expect(section('8.3 ').rows).toEqual([
      ...keyRows(main),
      ...keyRows(
        Object.fromEntries(Object.entries(screens).map(([key, text]) => [`screens.${key}`, text])),
      ),
      ...Object.entries(actions).map(([key, action]) => [code(key), action.step, action.text]),
    ]);
  });

  it('9.1 ② 소싱 안내 머리 글', () => {
    expect(section('9.1 ').rows).toEqual(keyRows(content.SOURCING_GUIDE_TEXT));
  });

  it('9.2 ② 지금 할 일(상태별)', () => {
    expect(section('9.2 ').rows).toEqual(keyRows(content.SOURCING_NOW_TEXT));
  });

  it('9.3 ② 낯선 말·버튼 풀이(순서·말·풀이)', () => {
    expect(section('9.3 ').rows).toEqual(
      Object.entries(content.SOURCING_GLOSSARY).map(([key, entry]) => [
        code(key),
        entry.term,
        entry.text,
      ]),
    );
  });
});

/** ③~⑨ 화면 안내(§10.1~§10.5): 화면마다 머리 글 · 지금 할 일(+이동 링크) · 풀이 세 표 */
const SCREEN_GUIDES = [
  ['10.1', content.JUDGEMENT_GUIDE],
  ['10.2', content.THUMBNAIL_GUIDE],
  ['10.3', content.CONTENT_GUIDE],
  ['10.4', content.TAGS_GUIDE],
  ['10.5', content.APPROVAL_GUIDE],
] as const;

describe('③~⑨ 화면 안내 글 = 안내문구.md §10 (D-41)', () => {
  it('10.0 공통 글', () => {
    expect(section('10.0 ').rows).toEqual(keyRows(content.STEP_GUIDE_COMMON));
  });

  it('화면 키 5개가 §10.1~§10.5 순서와 같다', () => {
    expect(content.SCREEN_GUIDE_KEYS).toEqual([
      'judgement',
      'thumbnail',
      'content',
      'tags',
      'approval',
    ]);
  });

  it.each(SCREEN_GUIDES)('%s 머리 글 · 지금 할 일 · 풀이가 문서 표와 같다', (number, guide) => {
    const filled = (entries: [string, string][]) => entries.filter(([, text]) => text !== '');
    expect(section(`${number}.1 `).rows).toEqual(
      filled([
        ['region', guide.region],
        ['purpose', guide.purpose],
      ]).map(([key, text]) => [code(key), text]),
    );
    expect(section(`${number}.2 `).rows).toEqual([
      ...Object.entries(guide.now).map(([key, text]) => [code(key), text]),
      ...Object.entries(guide.links).map(([key, text]) => [code(`links.${key}`), text]),
    ]);
    expect(section(`${number}.3 `).rows).toEqual(
      Object.entries(guide.glossary).map(([key, entry]) => [code(key), entry.term, entry.text]),
    );
    // 이동 링크는 지금 할 일 키에만 붙는다
    for (const key of Object.keys(guide.links)) expect(Object.keys(guide.now)).toContain(key);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imagePlaceholderHtml } from '../../../common/rules/detail-html.js';
import { buildDetailContent, DetailContentError } from './detail-content.js';

const FIXTURE = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'test',
  'fixtures',
  'registration',
  'upload',
  'html-with-placeholders.html',
);

const URL_0 = 'https://shop-phinf.pstatic.net/20261001_1/fixture-rep.jpg';
const URL_1 = 'https://shop-phinf.pstatic.net/20261001_2/fixture-add-1.jpg';

describe('detail-content — 자리표시자를 업로드 URL로(규칙 9, F-AP-06)', () => {
  it('자리표시자 2개(대표·추가) → URL 2개로 바뀌고 남은 자리표시자 0, 빈 칸은 뺀다', () => {
    const html = readFileSync(FIXTURE, 'utf8');
    const out = buildDetailContent(
      html,
      new Map([
        [0, URL_0],
        [1, URL_1],
      ]),
    );
    expect(out.detailContent).toContain(`<img src="${URL_0}" alt="대표 이미지">`);
    expect(out.detailContent).toContain(`<img src="${URL_1}" alt="추가 이미지 1">`);
    expect(out.detailContent).not.toContain('autostore-image:');
    // fixture의 10칸 가운데 선택본에 없는 2~9는 칸째 빠진다
    expect(out.detailContent).not.toContain('data-autostore-image-slot="2"');
    // 고지 블록 등 나머지는 그대로
    expect(out.detailContent).toContain('data-block-id="AGENCY"');
    expect(out.detailContentSha256).toMatch(/^[0-9a-f]{64}$/);
    // 같은 입력이면 같은 해시
    expect(
      buildDetailContent(
        html,
        new Map([
          [0, URL_0],
          [1, URL_1],
        ]),
      ).detailContentSha256,
    ).toBe(out.detailContentSha256);
  });

  it('모르는 자리표시자(계약 밖 모양)는 바꾸지 못해 오류(⑧ 실패)', () => {
    const html = `<div>${imagePlaceholderHtml(0)}<p><img src="autostore-image:other/7" alt=""></p></div>`;
    expect(() => buildDetailContent(html, new Map([[0, URL_0]]))).toThrow(DetailContentError);
    try {
      buildDetailContent(html, new Map([[0, URL_0]]));
    } catch (error) {
      expect((error as DetailContentError).remaining).toBe(1);
    }
  });
});

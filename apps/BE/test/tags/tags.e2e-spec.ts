import { Writable } from 'node:stream';
import request from 'supertest';
import {
  ProgressEventsService,
  type PublishedProgressEvent,
} from '../../src/common/events/progress-events.service.js';
import { LOG_DESTINATION } from '../../src/common/logging/logging.module.js';
import { clearKnownSecrets } from '../../src/common/secrets/secret-mask.js';
import { SECRET_STORE } from '../../src/common/secrets/secret-store.port.js';
import { CommerceTagsHttpAdapter } from '../../src/modules/integrations/naver-commerce/commerce-tags.http-adapter.js';
import { CommerceTokenService } from '../../src/modules/integrations/naver-commerce/commerce-token.service.js';
import { writeSettingsFileAtomically } from '../../src/modules/settings/settings-file.loader.js';
import { StepExecutor } from '../../src/modules/step-engine/execution/step-executor.js';
import { LEAF, seedCommerceCategories } from '../fixtures/category/seed-candidate.js';
import {
  CATEGORY_LEAF,
  seedTagsCandidate,
  tagsSettingsText,
  truncateTags,
} from '../fixtures/tags/seed-tags.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';
import {
  FakeCommerceTagsServer,
  tagsFixtureBytes,
  tagsFixtureText,
} from '../support/fake-commerce-tags.js';
import { FakeCommerceTransport, signatureVector } from '../support/fake-commerce-transport.js';
import { InMemorySecretStore } from '../support/in-memory-secret-store.js';

const DATA_DIR = process.env.APP_DATA_DIR!;
const CLIENT = { 'X-AutoStore-Client': '1' };
const COMMERCE_HOST = 'api.commerce.naver.com';

interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  fieldErrors?: { field: string; message: string; rejectedValue?: unknown }[];
}

interface CandidateItem {
  id: number;
  text: string;
  textKey: string;
  code: string | null;
  inRecommend: boolean;
  inCompetitor: boolean;
  ownerAdded: boolean;
  competitorFrequency: number | null;
  outcome: string;
  filterReason: string | null;
  filterDetail: string | null;
  restricted: boolean | null;
  finalOrder: number | null;
  dictionaryUnregistered: boolean;
  score: number | null;
}

interface TagSetBody {
  stepRunId: number;
  version: number;
  stepRunStatus: string;
  isCurrent: boolean;
  recommendKeywords: string[];
  leafCategoryId: string | null;
  restrictedCheckedAt: string | null;
  aiRelevanceEnabled: boolean;
  competitorInputIds: number[];
  candidates: CandidateItem[];
  finalTags: { code?: string | null; text: string; finalOrder: number }[];
  ownerEdits: { action: string; text: string; textKey: string; editedAt: string }[];
}

interface InputBody {
  id: number;
  sourceType: string;
  hasFrequency: boolean;
  itemCount: number;
  removedAt: string | null;
  tags: {
    seq: number;
    tagText: string;
    sourceRank: number | null;
    naverProductId: string | null;
    frequency: number | null;
  }[];
  rerunRequiredSteps?: string[];
}

describe('⑦ 태그(P3-05) e2e — autostore_test·실제 TAGS 실행기(가짜 커머스 태그 서버)', () => {
  let t: TestApp;
  const store = new InMemorySecretStore();
  const commerce = new FakeCommerceTransport();
  const server = new FakeCommerceTagsServer().install(commerce);
  const events: PublishedProgressEvent[] = [];
  const logLines: string[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      logLines.push(chunk.toString('utf8'));
      cb();
    },
  });
  let unsubscribe: () => void = () => undefined;
  const v = signatureVector();

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body: object = {}) =>
    http().post(`/api/v1${path}`).set(CLIENT).send(body);
  const get = (path: string) => http().get(`/api/v1${path}`);
  const del = (path: string) => http().delete(`/api/v1${path}`).set(CLIENT);
  const idle = () => t.app.get(StepExecutor).whenIdle();
  const errorOf = (res: { body: unknown }) => res.body as ErrorBody;
  const runTags = (candidateId: number) => post(`/candidates/${candidateId}/steps/TAGS/runs`);
  const runAndWait = async (candidateId: number) => {
    const res = await runTags(candidateId);
    expect(res.status).toBe(202);
    await idle();
    return res;
  };
  const tagSet = async (candidateId: number, query = ''): Promise<TagSetBody> => {
    const res = await get(`/candidates/${candidateId}/tag-set${query}`);
    expect(res.status).toBe(200);
    return res.body as TagSetBody;
  };
  const stepRow = (candidateId: number, stepCode: string) =>
    t.prisma.candidateStep.findUniqueOrThrow({
      where: { candidateId_stepCode: { candidateId, stepCode } },
    });
  const addText = (candidateId: number, sourceType: string, text: string) =>
    post(`/candidates/${candidateId}/tag-competitor-inputs`, { sourceType, text });
  const addFile = (candidateId: number, file: Buffer, filename: string) =>
    http()
      .post(`/api/v1/candidates/${candidateId}/tag-competitor-inputs`)
      .set(CLIENT)
      .field('sourceType', 'SELLERFINDER')
      .attach('file', file, filename);
  const ownerEdit = (candidateId: number, body: object) =>
    post(`/candidates/${candidateId}/steps/TAGS/owner-edits`, body);
  const finalTexts = (set: TagSetBody) => set.finalTags.map((tag) => tag.text);
  const byText = (set: TagSetBody, text: string) => set.candidates.find((c) => c.text === text);
  const nonCommerceCalls = () =>
    t.fetch.calls.filter((call) => new URL(call.url).hostname !== COMMERCE_HOST);
  const putKeys = async () => {
    await store.set('COMMERCE_CLIENT_ID', v.clientId);
    await store.set('COMMERCE_CLIENT_SECRET', v.clientSecret);
  };

  beforeAll(async () => {
    await writeSettingsFileAtomically(DATA_DIR, tagsSettingsText());
    t = await createTestApp({
      overrides: [
        { provide: SECRET_STORE, useValue: store },
        { provide: LOG_DESTINATION, useValue: { stream: logStream, level: 'trace' } },
      ],
    });
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  beforeEach(async () => {
    await idle();
    await truncateTags(t.prisma);
    store.reset();
    await putKeys();
    commerce.reset();
    server.reset();
    t.fetch.reset();
    // 가짜 커머스 서버를 가짜 fetch(HTTP_FETCH) 뒤에 둔다 → 실제 관문(허용 목록·UA·call_log)을 지난다
    t.fetch.handler = commerce.fetchHandler;
    t.app.get(CommerceTokenService).invalidate();
    t.app.get(CommerceTagsHttpAdapter).clearCache();
    events.length = 0;
    logLines.length = 0;
  });

  afterEach(() => commerce.release());

  afterAll(async () => {
    await idle();
    await truncateTags(t.prisma);
    unsubscribe();
    await t.app.close();
    clearKnownSecrets();
  });

  describe('⑦ 실행(규칙 1·2·7~12, US-18 AC5)', () => {
    it('경쟁 입력 없이 실행 → 추천만으로 최종 태그(채우지 않음), 뺀 태그 사유, code는 추천에서', async () => {
      const seed = await seedTagsCandidate(t.prisma, { categoryCompleted: true });
      const res = await runAndWait(seed.candidate.id);
      expect((res.body as { warnings: unknown[] }).warnings).toEqual([]);
      const set = await tagSet(seed.candidate.id);
      expect(set).toMatchObject({
        stepRunStatus: 'COMPLETED',
        isCurrent: true,
        leafCategoryId: CATEGORY_LEAF.leafCategoryId,
        aiRelevanceEnabled: false,
        competitorInputIds: [],
        recommendKeywords: ['아식스 젤카야노14', '1201A019-108', '러닝화', '데일리'],
      });
      expect(set.restrictedCheckedAt).not.toBeNull();
      expect(finalTexts(set)).toEqual([
        '젤카야노14',
        '아식스운동화',
        '조깅화',
        '남자운동화',
        '커플운동화',
        '데일리룩',
        '가벼운운동화',
      ]);
      expect(set.finalTags[0]).toEqual({ code: '10010001', text: '젤카야노14', finalOrder: 1 });
      expect(byText(set, '러닝화')).toMatchObject({
        outcome: 'FILTERED',
        filterReason: 'CATEGORY_TOKEN',
        filterDetail: '카테고리 이름(러닝화)과 같음',
        restricted: null,
        finalOrder: null,
      });
      expect(set.candidates.every((c) => c.score === null)).toBe(true);
      // 추천 조회는 키워드마다 1번, restricted는 규칙을 통과한 7개를 한 번에(설정 10개씩)
      expect(server.recommendKeywords).toEqual(set.recommendKeywords);
      expect(server.restrictedBatches).toEqual([finalTexts(set)]);
      const logs = await t.prisma.callLog.findMany({ where: { target: 'COMMERCE_API' } });
      expect(logs.length).toBeGreaterThanOrEqual(5);
      expect(nonCommerceCalls()).toEqual([]);
    });

    it('④ 전 실행 → 202 + 경고 CATEGORY_UNDECIDED, leafCategoryId=null. ④ 완료 뒤 ⑦ RERUN_REQUIRED', async () => {
      const seed = await seedTagsCandidate(t.prisma);
      const res = await runAndWait(seed.candidate.id);
      expect((res.body as { warnings: { code: string }[] }).warnings).toEqual([
        expect.objectContaining({ code: 'CATEGORY_UNDECIDED' }),
      ]);
      const set = await tagSet(seed.candidate.id);
      expect(set.leafCategoryId).toBeNull();
      expect(set.recommendKeywords).toEqual(['아식스 젤카야노14', '1201A019-108', '데일리']);
      expect((await stepRow(seed.candidate.id, 'TAGS')).status).toBe('COMPLETED');

      await seedCommerceCategories(t.prisma);
      expect((await post(`/candidates/${seed.candidate.id}/steps/CATEGORY/runs`)).status).toBe(202);
      await idle();
      const decision = (await get(`/candidates/${seed.candidate.id}/category-decision`).expect(200))
        .body as { id: number };
      const chosen = await http()
        .put(`/api/v1/category-decisions/${decision.id}/selection`)
        .set(CLIENT)
        .send({ leafCategoryId: LEAF.MALE_RUNNING });
      expect(chosen.status).toBe(200);
      const tags = await stepRow(seed.candidate.id, 'TAGS');
      expect(tags.status).toBe('RERUN_REQUIRED');
      expect(tags.staleInputs).toContain('category.leafPath');
    });

    it('경쟁 태그(빈도 xlsx) + 추천: 추천∩경쟁 → 경쟁(빈도순) → 추천, 10개, 규칙·제한 태그는 사유와 함께 뺀다', async () => {
      const seed = await seedTagsCandidate(t.prisma, { categoryCompleted: true });
      const added = await addFile(
        seed.candidate.id,
        tagsFixtureBytes('sellerfinder/manutag-freq.xlsx'),
        'manutag-freq.xlsx',
      );
      expect(added.status).toBe(201);
      await runAndWait(seed.candidate.id);
      const set = await tagSet(seed.candidate.id);
      expect(finalTexts(set)).toEqual([
        '젤카야노14',
        '아식스운동화',
        '조깅화',
        '남자운동화',
        '데일리운동화',
        '레트로운동화',
        '크림운동화',
        '쿠션운동화',
        '커플운동화',
        '데일리룩',
      ]);
      expect(set.finalTags[4]).toEqual({ text: '데일리운동화', finalOrder: 5 });
      expect(byText(set, '가벼운운동화')?.outcome).toBe('NOT_SELECTED');
      const excluded = set.candidates
        .filter((c) => ['FILTERED', 'RESTRICTED', 'OWNER_REMOVED'].includes(c.outcome))
        .map((c) => [c.text, c.outcome, c.filterReason]);
      expect(excluded).toEqual(
        expect.arrayContaining([
          ['러닝화', 'FILTERED', 'CATEGORY_TOKEN'],
          ['무료배송', 'FILTERED', 'PROMOTION'],
          ['나이키운동화', 'FILTERED', 'BRAND_NAME'],
          ['키즈운동화', 'FILTERED', 'ATTRIBUTE_MISMATCH'],
          ['정품운동화', 'RESTRICTED', null],
        ]),
      );
      expect(excluded).toHaveLength(5);
      expect(byText(set, '정품운동화')).toMatchObject({ restricted: true, inCompetitor: true });
      expect(byText(set, '젤카야노14')).toMatchObject({
        inRecommend: true,
        inCompetitor: true,
        competitorFrequency: 18,
        code: '10010001',
      });
      expect(set.competitorInputIds).toEqual([(added.body as InputBody).id]);
      // 규칙을 통과한 12개를 설정 개수(10)씩 두 번에 확인
      expect(server.restrictedBatches.map((b) => b.length)).toEqual([10, 2]);
    });

    it('URL 후보(① 키워드 없음): 시드 키워드는 ② 型番', async () => {
      const seed = await seedTagsCandidate(t.prisma, { keyword: null });
      await runAndWait(seed.candidate.id);
      const set = await tagSet(seed.candidate.id);
      expect(set.recommendKeywords).toEqual(['1201A019-108', '데일리']);
      // ② 브랜드 속성(ASICS)으로 상품 자체 브랜드를 안다 — 추천 '아식스운동화'가 없어도 실행은 된다
      expect(finalTexts(set)).toEqual(['커플운동화', '데일리룩', '가벼운운동화']);
    });

    it('커머스 키가 없으면 409 SECRET_NOT_CONFIGURED(실행을 만들지 않는다), 커머스 503이면 FAILED(EXTERNAL_API)', async () => {
      const seed = await seedTagsCandidate(t.prisma);
      store.reset();
      const blocked = await runTags(seed.candidate.id);
      expect(blocked.status).toBe(409);
      expect(errorOf(blocked)).toMatchObject({
        code: 'SECRET_NOT_CONFIGURED',
        details: { secretKeys: ['COMMERCE_CLIENT_ID', 'COMMERCE_CLIENT_SECRET'] },
      });
      expect(await t.prisma.stepRun.count({ where: { stepCode: 'TAGS' } })).toBe(0);

      await putKeys();
      server.failNext(503);
      await runAndWait(seed.candidate.id);
      const run = await t.prisma.stepRun.findFirstOrThrow({ where: { stepCode: 'TAGS' } });
      expect(run).toMatchObject({
        status: 'FAILED',
        failureKind: 'EXTERNAL_API',
        errorCode: 'EXTERNAL_API_ERROR',
      });
      expect(await t.prisma.tagSet.count()).toBe(0);
      const missing = await get(`/candidates/${seed.candidate.id}/tag-set`);
      expect(missing.status).toBe(404);
      expect(errorOf(missing).code).toBe('STEP_OUTPUT_NOT_FOUND');
    });
  });

  describe('경쟁 태그 입력(규칙 3~6, F-TG-02~06)', () => {
    const RAW_MARKER = 'RAW-PASTE-MARKER-7f3a';

    it('FREE_TEXT → 201 + Location. 줄에는 태그·순위·상품 ID·빈도만, 붙여 넣은 원문은 DB·call_log·감사 기록·앱 로그 어디에도 없다', async () => {
      const seed = await seedTagsCandidate(t.prisma);
      const raw = `${tagsFixtureText('free-text.txt')}메모 ${RAW_MARKER} 010-9999-8888\n`;
      const res = await addText(seed.candidate.id, 'FREE_TEXT', raw);
      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(
        `/api/v1/candidates/${seed.candidate.id}/tag-competitor-inputs`,
      );
      const body = res.body as InputBody;
      expect(body).toMatchObject({
        sourceType: 'FREE_TEXT',
        hasFrequency: false,
        itemCount: 8,
        removedAt: null,
        rerunRequiredSteps: [],
      });
      expect(body.tags[0]).toEqual({
        seq: 1,
        tagText: '데일리운동화',
        sourceRank: null,
        naverProductId: null,
        frequency: null,
      });
      const columns = await t.prisma.$queryRawUnsafe<{ column_name: string }[]>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'tag_competitor_item' ORDER BY column_name",
      );
      expect(columns.map((c) => c.column_name)).toEqual([
        'frequency',
        'id',
        'naver_product_id',
        'seq',
        'source_rank',
        'tag_competitor_input_id',
        'tag_text',
      ]);
      const items = await t.prisma.tagCompetitorItem.findMany();
      const dump = JSON.stringify({
        items,
        inputs: await t.prisma.tagCompetitorInput.findMany(),
        callLogs: await t.prisma.callLog.findMany(),
        actions: await t.prisma.userActionLog.findMany(),
      });
      for (const leaked of [RAW_MARKER, '010-9999-8888', '010-1234-5678', raw]) {
        expect(dump).not.toContain(leaked);
        expect(logLines.join('')).not.toContain(leaked);
      }
      const audit = await t.prisma.userActionLog.findMany({
        where: { candidateId: seed.candidate.id },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        eventType: 'OWNER_EDITED',
        stepCode: 'TAGS',
        detail: { action: 'ADD', sourceType: 'FREE_TEXT', itemCount: 8 },
      });
      // 앱은 네이버쇼핑에 요청하지 않는다(입력은 오너가 붙여 넣은 글만 읽는다)
      expect(t.fetch.calls).toEqual([]);

      const list = await get(`/candidates/${seed.candidate.id}/tag-competitor-inputs`);
      expect(list.status).toBe(200);
      expect((list.body as { items: InputBody[] }).items.map((i) => i.id)).toEqual([body.id]);
    });

    it('셀라파인더 xlsx multipart → 201(hasFrequency=true). 상한 초과 413, pdf 422 UNSUPPORTED_FILE_TYPE, 깨진 표 422(행·열)', async () => {
      const seed = await seedTagsCandidate(t.prisma);
      const ok = await addFile(
        seed.candidate.id,
        tagsFixtureBytes('sellerfinder/manutag-freq.xlsx'),
        '셀라파인더-키워드정보-FILENAME-MARKER.xlsx',
      );
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({
        sourceType: 'SELLERFINDER',
        hasFrequency: true,
        itemCount: 13,
      });
      expect((ok.body as InputBody).tags[0]).toMatchObject({
        tagText: '젤카야노14',
        frequency: 18,
      });
      const input = await t.prisma.tagCompetitorInput.findFirstOrThrow();
      expect(input.hasFrequency).toBe(true);
      expect(logLines.join('')).not.toContain('FILENAME-MARKER');

      const csv = await addFile(
        seed.candidate.id,
        tagsFixtureBytes('sellerfinder/manutag-nofreq.csv'),
        'manutag.csv',
      );
      expect(csv.status).toBe(201);
      expect(csv.body).toMatchObject({ hasFrequency: false, itemCount: 5 });

      const big = await addFile(seed.candidate.id, Buffer.alloc(1_100_000, 0x61), 'big.csv');
      expect(big.status).toBe(413);
      expect(errorOf(big).code).toBe('PAYLOAD_TOO_LARGE');

      const pdf = await addFile(seed.candidate.id, Buffer.from('%PDF-1.7\n1 0 obj\n'), 'a.pdf');
      expect(pdf.status).toBe(422);
      expect(errorOf(pdf)).toMatchObject({
        code: 'UNSUPPORTED_FILE_TYPE',
        message: '이 형식의 파일은 받을 수 없습니다(가능: 엑셀(xlsx)·CSV).',
      });

      const broken = await addFile(
        seed.candidate.id,
        tagsFixtureBytes('sellerfinder/manutag-broken.xlsx'),
        'broken.xlsx',
      );
      expect(broken.status).toBe(422);
      expect(errorOf(broken)).toMatchObject({
        code: 'IMPORT_PARSE_FAILED',
        fieldErrors: [{ field: 'row3.빈도', message: '빈도는 1 이상의 정수여야 합니다.' }],
      });
      expect(await t.prisma.tagCompetitorInput.count()).toBe(2);
    });

    it('브라우저 응답(HAR): manuTag만 뽑고 Cookie·Authorization·연락처는 DB·로그에 없다. 빈 입력 IMPORT_EMPTY, 모양 422', async () => {
      const seed = await seedTagsCandidate(t.prisma);
      const har = tagsFixtureText('browser/search.har');
      const res = await addText(seed.candidate.id, 'BROWSER_RESPONSE', har);
      expect(res.status).toBe(201);
      expect((res.body as InputBody).tags.map((tag) => [tag.tagText, tag.naverProductId])).toEqual([
        ['젤카야노14', '83345678901'],
        ['남자운동화', '83345678901'],
        ['키즈운동화', '83345678901'],
        ['정품운동화', '83345678902'],
        ['크림운동화', '83345678902'],
      ]);
      const dump = JSON.stringify(await t.prisma.tagCompetitorItem.findMany());
      for (const leaked of ['HAR-COOKIE-SECRET-VALUE', 'HAR-AUTH-TOKEN-VALUE', '02-1234-5678']) {
        expect(dump).not.toContain(leaked);
        expect(logLines.join('')).not.toContain(leaked);
      }

      const empty = await addText(seed.candidate.id, 'FREE_TEXT', ' ,#, ');
      expect(empty.status).toBe(422);
      expect(errorOf(empty).code).toBe('IMPORT_EMPTY');
      const notJson = await addText(
        seed.candidate.id,
        'BROWSER_RESPONSE',
        `{"manuTag": "${RAW_MARKER}",}`,
      );
      expect(notJson.status).toBe(422);
      expect(errorOf(notJson).code).toBe('IMPORT_PARSE_FAILED');
      expect(JSON.stringify(notJson.body)).not.toContain(RAW_MARKER);
      const bad = await post(`/candidates/${seed.candidate.id}/tag-competitor-inputs`, {
        sourceType: 'NAVER',
        text: 'x',
      });
      expect(bad.status).toBe(422);
      expect(errorOf(bad).code).toBe('VALIDATION_FAILED');
      const missing = await addText(999_999, 'FREE_TEXT', 'x');
      expect(missing.status).toBe(404);
      expect(errorOf(missing).code).toBe('CANDIDATE_NOT_FOUND');
    });

    it('빼기 204 → 다시 204, 없는 id 404. removed_at만 채우고, 완료된 ⑦은 재실행 필요(추가 응답 rerunRequiredSteps)', async () => {
      const seed = await seedTagsCandidate(t.prisma, { categoryCompleted: true });
      const first = (await addText(seed.candidate.id, 'FREE_TEXT', '데일리운동화, 레트로운동화'))
        .body as InputBody;
      await runAndWait(seed.candidate.id);
      expect((await tagSet(seed.candidate.id)).competitorInputIds).toEqual([first.id]);

      const second = await addText(seed.candidate.id, 'FREE_TEXT', '크림운동화');
      expect((second.body as InputBody).rerunRequiredSteps).toEqual(['TAGS']);
      await runAndWait(seed.candidate.id);
      expect((await stepRow(seed.candidate.id, 'TAGS')).status).toBe('COMPLETED');

      expect((await del(`/tag-competitor-inputs/${first.id}`)).status).toBe(204);
      const tags = await stepRow(seed.candidate.id, 'TAGS');
      expect(tags.status).toBe('RERUN_REQUIRED');
      expect(tags.staleInputs).toContain('owner.competitorTags');
      expect((await del(`/tag-competitor-inputs/${first.id}`)).status).toBe(204);
      const row = await t.prisma.tagCompetitorInput.findUniqueOrThrow({ where: { id: first.id } });
      expect(row.removedAt).not.toBeNull();
      expect(
        await t.prisma.tagCompetitorItem.count({ where: { tagCompetitorInputId: first.id } }),
      ).toBe(2);
      const list = (await get(`/candidates/${seed.candidate.id}/tag-competitor-inputs`)).body as {
        items: InputBody[];
      };
      expect(list.items.map((i) => i.id)).toEqual([(second.body as InputBody).id]);

      for (const id of ['999999', 'abc', '0']) {
        const missing = await del(`/tag-competitor-inputs/${id}`);
        expect(missing.status).toBe(404);
        expect(errorOf(missing)).toMatchObject({
          code: 'COMPETITOR_INPUT_NOT_FOUND',
          message: '경쟁 태그 입력을 찾을 수 없습니다.',
        });
      }
    });

    it('⑦ 실행 중 입력 추가·빼기 → 409 STEP_LOCKED_BY_RUNNING_STEP', async () => {
      const seed = await seedTagsCandidate(t.prisma);
      const input = (await addText(seed.candidate.id, 'FREE_TEXT', '데일리운동화'))
        .body as InputBody;
      commerce.block();
      // 커머스 요청을 붙잡아 ⑦을 실행 중(RUNNING)으로 둔다 — 시작 트랜잭션이 RUNNING을 쓰고 202를 준다
      expect((await runTags(seed.candidate.id)).status).toBe(202);
      expect((await stepRow(seed.candidate.id, 'TAGS')).status).toBe('RUNNING');
      const added = await addText(seed.candidate.id, 'FREE_TEXT', '레트로운동화');
      expect(added.status).toBe(409);
      expect(errorOf(added)).toMatchObject({
        code: 'STEP_LOCKED_BY_RUNNING_STEP',
        details: { stepCode: 'TAGS' },
      });
      const removed = await del(`/tag-competitor-inputs/${input.id}`);
      expect(removed.status).toBe(409);
      expect(errorOf(removed).code).toBe('STEP_LOCKED_BY_RUNNING_STEP');
      commerce.release();
      await idle();
      expect((await stepRow(seed.candidate.id, 'TAGS')).status).toBe('COMPLETED');
    });
  });

  describe('오너 편집(규칙 13·14, F-TG-14)', () => {
    const tenFinalTags = async () => {
      const seed = await seedTagsCandidate(t.prisma, { categoryCompleted: true });
      await addFile(
        seed.candidate.id,
        tagsFixtureBytes('sellerfinder/manutag-freq.xlsx'),
        'manutag-freq.xlsx',
      );
      await runAndWait(seed.candidate.id);
      const set = await tagSet(seed.candidate.id);
      expect(set.finalTags).toHaveLength(10);
      return { seed, set };
    };

    it('11번째 추가 422 FINAL_TAG_LIMIT_EXCEEDED, 빈 값 422 VALIDATION_FAILED(실행을 만들지 않는다)', async () => {
      const { seed, set } = await tenFinalTags();
      const over = await ownerEdit(seed.candidate.id, {
        ownerAction: 'EDIT',
        baseStepRunId: set.stepRunId,
        add: ['나만의태그'],
        remove: [],
      });
      expect(over.status).toBe(422);
      expect(errorOf(over)).toMatchObject({
        code: 'FINAL_TAG_LIMIT_EXCEEDED',
        message: '최종 태그는 10개까지입니다. 하나를 지운 뒤 넣어 주세요.',
        details: { limit: 10, count: 11 },
      });
      const blank = await ownerEdit(seed.candidate.id, {
        ownerAction: 'EDIT',
        baseStepRunId: set.stepRunId,
        add: ['  # '],
        remove: [],
      });
      expect(blank.status).toBe(422);
      expect(errorOf(blank)).toMatchObject({
        code: 'VALIDATION_FAILED',
        fieldErrors: [{ field: 'add[0]', message: '태그가 비었습니다.' }],
      });
      const tooLong = await ownerEdit(seed.candidate.id, {
        ownerAction: 'EDIT',
        baseStepRunId: set.stepRunId,
        add: ['가'.repeat(101)],
        remove: [],
      });
      expect(tooLong.status).toBe(422);
      expect(errorOf(tooLong).code).toBe('VALIDATION_FAILED');
      expect(await t.prisma.stepRun.count({ where: { stepCode: 'TAGS' } })).toBe(1);
    });

    it('사전 밖 태그 추가 → 202 → SSE → 새 버전에 그 태그(dictionaryUnregistered). 다시 실행해도 남고, 이전 버전을 다시 고르면 그 편집 목록이 살아난다', async () => {
      const { seed, set } = await tenFinalTags();
      const restrictedBefore = server.restrictedBatches.length;
      const res = await ownerEdit(seed.candidate.id, {
        ownerAction: 'EDIT',
        baseStepRunId: set.stepRunId,
        add: ['#나만의태그'],
        remove: ['데일리룩'],
      });
      expect(res.status).toBe(202);
      const accepted = res.body as { stepRunId: number; executionMode: string; status: string };
      expect(accepted).toMatchObject({ executionMode: 'OWNER_EDIT', status: 'RUNNING' });
      expect(res.headers.location).toBe(`/api/v1/step-runs/${accepted.stepRunId}`);
      await idle();
      expect(
        events.some(
          (e) =>
            e.name === 'step-run.status-changed' &&
            (e.data as { stepRunId: number; status: string }).stepRunId === accepted.stepRunId &&
            (e.data as { status: string }).status === 'COMPLETED',
        ),
      ).toBe(true);
      // 편집한 태그도 restricted 재검증을 거친다
      expect(server.restrictedBatches.length).toBeGreaterThan(restrictedBefore);

      const edited = await tagSet(seed.candidate.id);
      expect(edited.stepRunId).toBe(accepted.stepRunId);
      expect(byText(edited, '나만의태그')).toMatchObject({
        outcome: 'SELECTED',
        ownerAdded: true,
        code: null,
        dictionaryUnregistered: true,
        finalOrder: 10,
      });
      expect(byText(edited, '데일리룩')).toMatchObject({
        outcome: 'OWNER_REMOVED',
        restricted: null,
      });
      // 오너 수정 버전은 빈자리를 순위 밖 태그로 채우지 않는다(Proposed)
      expect(byText(edited, '가벼운운동화')?.outcome).toBe('NOT_SELECTED');
      expect(edited.finalTags.at(-1)).toEqual({ text: '나만의태그', finalOrder: 10 });
      expect(edited.ownerEdits.map((e) => [e.action, e.textKey])).toEqual([
        ['REMOVE', '데일리룩'],
        ['ADD', '나만의태그'],
      ]);

      // 다시 실행: 편집 목록을 새 결과에 다시 적용(오너 태그는 남고, 뺀 자리는 선정 순서로 채운다)
      await runAndWait(seed.candidate.id);
      const rerun = await tagSet(seed.candidate.id);
      expect(rerun.version).toBe(edited.version + 1);
      // 오너가 더한 태그는 먼저 넣고, 남은 자리를 선정 순서로 채운다(최종 순서: 추천∩경쟁 → 경쟁 → 직접 → 추천)
      expect(byText(rerun, '나만의태그')).toMatchObject({
        outcome: 'SELECTED',
        ownerAdded: true,
        finalOrder: 9,
      });
      expect(byText(rerun, '데일리룩')?.outcome).toBe('OWNER_REMOVED');
      expect(byText(rerun, '커플운동화')?.finalOrder).toBe(10);
      expect(byText(rerun, '가벼운운동화')?.outcome).toBe('NOT_SELECTED');
      expect(rerun.ownerEdits.map((e) => e.editedAt)).toEqual(
        edited.ownerEdits.map((e) => e.editedAt),
      );

      // 제한 태그를 더하면 RESTRICTED로 빠진다
      const restricted = await ownerEdit(seed.candidate.id, {
        ownerAction: 'EDIT',
        baseStepRunId: rerun.stepRunId,
        add: ['정품운동화'],
        remove: ['커플운동화'],
      });
      expect(restricted.status).toBe(202);
      await idle();
      const withRestricted = await tagSet(seed.candidate.id);
      expect(byText(withRestricted, '정품운동화')).toMatchObject({
        outcome: 'RESTRICTED',
        ownerAdded: true,
        restricted: true,
      });
      expect(withRestricted.finalTags).toHaveLength(9);

      // 이전 버전(첫 오너 수정)을 다시 고르면 그 버전의 편집 목록이 살아난다
      const restore = await post(`/candidates/${seed.candidate.id}/steps/TAGS/owner-edits`, {
        ownerAction: 'RESTORE_VERSION',
        baseStepRunId: edited.stepRunId,
      });
      expect(restore.status).toBe(201);
      const restored = await tagSet(seed.candidate.id);
      expect(restored.ownerEdits.map((e) => [e.action, e.textKey])).toEqual([
        ['REMOVE', '데일리룩'],
        ['ADD', '나만의태그'],
      ]);
      expect(finalTexts(restored)).toEqual(finalTexts(edited));
      expect(nonCommerceCalls()).toEqual([]);
    });
  });

  describe('GET /candidates/{id}/tag-set', () => {
    it('실행 전 404 STEP_OUTPUT_NOT_FOUND, 모르는 쿼리 422, 다른 단계 실행 404 STEP_RUN_NOT_FOUND, 이전 버전 조회', async () => {
      const seed = await seedTagsCandidate(t.prisma);
      const before = await get(`/candidates/${seed.candidate.id}/tag-set`);
      expect(before.status).toBe(404);
      expect(errorOf(before)).toMatchObject({
        code: 'STEP_OUTPUT_NOT_FOUND',
        message: '아직 ⑦ 태그를 실행하지 않았습니다.',
      });
      expect((await get(`/candidates/${seed.candidate.id}/tag-set?foo=1`)).status).toBe(422);
      expect((await get(`/candidates/${seed.candidate.id}/tag-set?stepRunId=abc`)).status).toBe(
        422,
      );
      const other = await get(
        `/candidates/${seed.candidate.id}/tag-set?stepRunId=${seed.sourcingStepRunId}`,
      );
      expect(other.status).toBe(404);
      expect(errorOf(other).code).toBe('STEP_RUN_NOT_FOUND');
      expect((await get('/candidates/999999/tag-set')).status).toBe(404);

      await runAndWait(seed.candidate.id);
      const v1 = await tagSet(seed.candidate.id);
      await runAndWait(seed.candidate.id);
      const old = await tagSet(seed.candidate.id, `?stepRunId=${v1.stepRunId}`);
      expect(old).toMatchObject({ stepRunId: v1.stepRunId, version: 1, isCurrent: false });
    });
  });
});

import request from 'supertest';
import type { Prisma } from '../../src/generated/prisma/client.js';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../../src/common/events/progress-events.service.js';
import { writeSettingsFileAtomically } from '../../src/modules/settings/settings-file.loader.js';
import { StepEngineTransactions } from '../../src/modules/step-engine/candidates/step-engine-tx.js';
import { StepExecutor } from '../../src/modules/step-engine/execution/step-executor.js';
import { PropagationService } from '../../src/modules/step-engine/propagation/propagation.service.js';
import {
  assemblySettingsText,
  seedGeneratedImages,
  seedOriginAreas,
  seedPricingJudgement,
  seedProfile,
  seedThumbnailSelection,
  truncateAssembly,
} from '../fixtures/content/assembly/seed-assembly.js';
import {
  contentFetchHandler,
  seedContentSourcing,
  useFakeContentAi,
} from '../fixtures/content/seed-content.js';
import { insertStepRun } from '../fixtures/step-engine/step-run.factory.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';
import { seedUsableAiEngine } from '../support/fake-ai-engines.js';

const DATA_DIR = process.env.APP_DATA_DIR!;
const GAPPED = [250, 255, 260, 265, 275];

interface ErrorBody {
  code: string;
  message: string;
  fieldErrors?: { field: string; message: string }[];
  details?: Record<string, unknown>;
}

interface FieldBody {
  fieldKey: string;
  value: unknown;
  generatedValue: unknown;
  valueSource: string;
  recheckReason: string | null;
  recheckRequired: boolean;
}

interface AssemblyBody {
  stepRunId: number;
  version: number;
  stepRunStatus: string;
  isCurrent: boolean;
  productName: string;
  productNameSuggestion: string;
  productNameWarnings: { code: string; message: string }[];
  parallelImport: boolean;
  noticeFields: Record<string, string>;
  noticeSizesMm: number[];
  originAreaCode: string;
  originAreaName: string | null;
  originAreaPlural: boolean;
  originAreaContent: string | null;
  importer: string;
  specBlockHtml: string;
  specOriginLabel: string;
  disclosureTemplateVersion: string;
  disclosureTemplateDate: string;
  disclosureBlockIds: string[];
  disclosureBlocks: { blockId: string; sha256: string; conditional: boolean; text: string }[];
  disclosureTemplateMatched: boolean;
  htmlSha256: string;
  previewUrl: string;
  fields: FieldBody[];
  linterResult: unknown;
}

/** 사양 블록 행(`<li data-spec-row="KEY">· 이름: 값</li>`) */
function specRows(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<li data-spec-row="([A-Z_]+)">· [^:]+: ([^<]*)<\/li>/g)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

describe('⑥-3 고시·HTML·상품명(P3-04) e2e — autostore_test·실제 COPY·NOTICE_RAW·NOTICE_HTML 실행기(가짜 AI)', () => {
  let t: TestApp;
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body: object = {}) =>
    http().post(`/api/v1${path}`).set('X-AutoStore-Client', '1').send(body);
  const get = (path: string) => http().get(`/api/v1${path}`);
  const idle = () => t.app.get(StepExecutor).whenIdle();
  const errorOf = (res: { body: unknown }) => res.body as ErrorBody;
  const stepOf = (candidateId: number, stepCode: string) =>
    t.prisma.candidateStep.findUniqueOrThrow({
      where: { candidateId_stepCode: { candidateId, stepCode } },
    });
  const runStep = async (candidateId: number, stepCode: string) => {
    const res = await post(`/candidates/${candidateId}/steps/${stepCode}/runs`);
    expect(res.status).toBe(202);
    await idle();
    const runId = (res.body as { stepRunId: number }).stepRunId;
    return { res, runId, run: await t.prisma.stepRun.findUniqueOrThrow({ where: { id: runId } }) };
  };
  const assemblyOf = async (candidateId: number, query = '') => {
    const res = await get(`/candidates/${candidateId}/content-assembly${query}`);
    expect(res.status).toBe(200);
    return res.body as AssemblyBody;
  };
  const ownerEdit = (candidateId: number, body: object) =>
    post(`/candidates/${candidateId}/steps/NOTICE_HTML/owner-edits`, body);
  const propagatePricing = (candidateId: number) =>
    t.app
      .get(StepEngineTransactions)
      .run((scope) =>
        t.app.get(PropagationService).propagateFromStep(scope, candidateId, 'PRICING'),
      );

  /** ② 완료 → ⑥-1·⑥-2 실제 실행(가짜 AI) → ③ 판정·프로필·원산지 캐시 시드 */
  const ready = async (
    input: { sizes?: number[]; profile?: 'profile-complete' | 'profile-missing-importer' } = {},
  ) => {
    const seed = await seedContentSourcing(t.prisma, 'description-only');
    const cid = seed.candidate.id;
    expect((await runStep(cid, 'COPY')).run.status).toBe('COMPLETED');
    expect((await runStep(cid, 'NOTICE_RAW')).run.status).toBe('COMPLETED');
    const pricingRunId = await seedPricingJudgement(t.prisma, {
      candidateId: cid,
      rakutenItemId: seed.rakutenItemId,
      sizes: input.sizes ?? GAPPED,
    });
    await seedProfile(t.prisma, input.profile ?? 'profile-complete');
    await seedOriginAreas(t.prisma);
    return { seed, cid, pricingRunId };
  };

  beforeAll(async () => {
    await writeSettingsFileAtomically(DATA_DIR, assemblySettingsText());
    t = await createTestApp();
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  beforeEach(async () => {
    await idle();
    await truncateAssembly(t.prisma);
    await seedUsableAiEngine(t.prisma);
    t.ai.resetCalls();
    for (const adapter of [t.ai.claude, t.ai.agy, t.ai.codex]) {
      adapter.runImpl = () => ({ answer: 'OK' });
    }
    useFakeContentAi(t.ai);
    t.fetch.reset();
    t.fetch.handler = contentFetchHandler();
    events.length = 0;
  });

  afterAll(async () => {
    await idle();
    await truncateAssembly(t.prisma);
    unsubscribe();
    await t.app.close();
  });

  describe('⑥-2에 더한 색상 표기·주의 문구(규칙 6)', () => {
    it('색상은 사전(DICTIONARY — クリーム/ブラック → 크림/블랙), 주의 문구는 템플릿 + AI 보완(같은 AI 호출)', async () => {
      const seed = await seedContentSourcing(t.prisma, 'description-only');
      const { runId } = await runStep(seed.candidate.id, 'NOTICE_RAW');
      const res = await get(`/candidates/${seed.candidate.id}/content-fact`);
      const fields = (res.body as { fields: (FieldBody & { extractionMethod: string })[] }).fields;
      expect(fields.map((f) => f.fieldKey)).toEqual([
        'fact.origin',
        'fact.material_upper',
        'fact.material_lining',
        'fact.material_sole',
        'fact.heel_height',
        'fact.color_ko',
        'fact.caution',
      ]);
      const color = fields.find((f) => f.fieldKey === 'fact.color_ko')!;
      expect(color).toMatchObject({ value: '크림/블랙', extractionMethod: 'DICTIONARY' });
      const caution = fields.find((f) => f.fieldKey === 'fact.caution')!;
      expect(caution.extractionMethod).toBe('AI');
      expect(caution.value).toEqual(expect.stringContaining('가죽 소재는'));
      expect(caution.value).toEqual(expect.stringContaining('합성가죽은 물에 젖으면'));
      // AI는 한 번(못 찾은 안감 + 주의 문구 보완을 묶었다), 색상은 사전으로 정해 묻지 않았다
      const calls = t.ai.claude.calls.runStructured;
      expect(calls).toHaveLength(1);
      expect(calls[0]!.schema.required).toEqual(['material_lining', 'caution']);
      const inputs = await t.prisma.stepRunInput.findMany({ where: { stepRunId: runId } });
      expect(inputs.map((i) => i.inputKey)).toEqual(
        expect.arrayContaining([
          'settings.content.colorTerms',
          'settings.content.cautionTemplates',
        ]),
      );
    });

    it('입력 대기 중 색상 표기 확인(PUT fact.color_ko — 근거 URL 없이), 원산지가 남으면 계속 기다린다', async () => {
      const seed = await seedContentSourcing(t.prisma, 'no-origin');
      const { runId, run } = await runStep(seed.candidate.id, 'NOTICE_RAW');
      expect(run.status).toBe('WAITING_INPUT');
      const res = await http()
        .put(`/api/v1/step-runs/${runId}/content-fields/fact.color_ko`)
        .set('X-AutoStore-Client', '1')
        .send({ value: '크림/블랙' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        field: { fieldKey: 'fact.color_ko', value: '크림/블랙', valueSource: 'OWNER_INPUT' },
        stepRunStatus: 'WAITING_INPUT',
        pendingInputs: ['fact.origin'],
      });
      const bad = await http()
        .put(`/api/v1/step-runs/${runId}/content-fields/fact.color_ko`)
        .set('X-AutoStore-Client', '1')
        .send({ value: '' });
      expect(bad.status).toBe(422);
      expect(errorOf(bad).code).toBe('VALIDATION_FAILED');
    });
  });

  describe('시작 조건·프로필(규칙 1·2)', () => {
    it('importer 빈 프로필 → 409 PROFILE_INCOMPLETE(details.missingFields에 importer), step_run 없음', async () => {
      const { cid } = await ready({ profile: 'profile-missing-importer' });
      const res = await post(`/candidates/${cid}/steps/NOTICE_HTML/runs`);
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'PROFILE_INCOMPLETE',
        details: { missingFields: ['importer'], settingsPath: '/settings' },
      });
      expect(errorOf(res).message).toBe(
        '구매대행 프로필에 빈칸(수입자)이 있습니다. 설정에서 채워 주세요.',
      );
      expect(await t.prisma.stepRun.count({ where: { stepCode: 'NOTICE_HTML' } })).toBe(0);
    });

    it('③ 판정 전이면 409 STEP_START_CONDITION_UNMET(pricing.saleSizes)', async () => {
      const seed = await seedContentSourcing(t.prisma, 'description-only');
      await runStep(seed.candidate.id, 'COPY');
      await runStep(seed.candidate.id, 'NOTICE_RAW');
      const res = await post(`/candidates/${seed.candidate.id}/steps/NOTICE_HTML/runs`);
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('STEP_START_CONDITION_UNMET');
    });

    it('실행 전 조회는 404 STEP_OUTPUT_NOT_FOUND, 모르는 쿼리는 422', async () => {
      const { cid } = await ready();
      const res = await get(`/candidates/${cid}/content-assembly`);
      expect(res.status).toBe(404);
      expect(errorOf(res)).toMatchObject({
        code: 'STEP_OUTPUT_NOT_FOUND',
        details: { stepCode: 'NOTICE_HTML' },
      });
      const preview = await get(`/candidates/${cid}/content-assembly/preview`);
      expect(preview.status).toBe(404);
      expect(preview.headers['content-type']).toMatch(/application\/json/);
      expect(preview.headers['content-security-policy']).toBeUndefined();
      expect((await get(`/candidates/${cid}/content-assembly?foo=1`)).status).toBe(422);
      expect((await get(`/candidates/${cid}/content-assembly/preview?stepRunId=abc`)).status).toBe(
        422,
      );
    });
  });

  describe('정상 실행·조회(규칙 3~13)', () => {
    it('202 → COMPLETED, ai_engine=null. 상품명·고시 size·원산지 코드·필수 + 조건부 고지 블록', async () => {
      const { cid } = await ready();
      const { res, run } = await runStep(cid, 'NOTICE_HTML');
      expect((res.body as { aiEngine: unknown }).aiEngine).toBeNull();
      expect(run).toMatchObject({ status: 'COMPLETED', aiEngine: null, aiModel: null });
      const body = await assemblyOf(cid);
      expect(body).toMatchObject({
        stepRunId: run.id,
        version: 1,
        stepRunStatus: 'COMPLETED',
        isCurrent: true,
        productName: '1201A019-108 크림 남성',
        productNameSuggestion: '1201A019-108 크림 남성',
        productNameWarnings: [],
        parallelImport: false,
        noticeSizesMm: GAPPED,
        originAreaCode: '0200036',
        originAreaName: '아시아>베트남',
        originAreaPlural: false,
        originAreaContent: null,
        importer: '[수입자]',
        specOriginLabel: '베트남',
        disclosureTemplateDate: '2026-09-24',
        disclosureTemplateMatched: true,
        previewUrl: `/api/v1/candidates/${cid}/content-assembly/preview?stepRunId=${run.id}`,
        fields: [],
        linterResult: null,
      });
      expect(body.noticeFields.size).toBe('250~265·275mm (JP 25.0~26.5·27.5cm)');
      expect(body.noticeFields.manufacturer).toBe('제조자: 상품상세 참조 / 수입자: [수입자]');
      expect(body.noticeFields.color).toBe('크림/블랙');
      expect(Object.hasOwn(body.noticeFields, 'height')).toBe(false);
      expect(body.disclosureBlockIds).toEqual(
        expect.arrayContaining([
          'AGENCY',
          'DELIVERY',
          'CUSTOMS_DUTY',
          'COMBINED_TAX',
          'PERSONAL_CUSTOMS_CODE',
          'WITHDRAWAL',
          'ORIGIN',
          'LEATHER_SAFETY',
          'AI_IMAGE',
        ]),
      );
      const agency = body.disclosureBlocks.find((b) => b.blockId === 'AGENCY')!;
      expect(agency).toMatchObject({ conditional: false });
      expect(agency.text).toContain('[내 상호]');
      expect(body.disclosureBlocks.find((b) => b.blockId === 'AI_IMAGE')!.conditional).toBe(true);
      const row = await t.prisma.contentDraftAssembly.findUniqueOrThrow({
        where: { stepRunId: run.id },
      });
      expect(row.html.indexOf('data-block-id="AGENCY"')).toBeLessThan(
        row.html.indexOf('data-autostore-section="COPY"'),
      );
      const inputs = await t.prisma.stepRunInput.findMany({ where: { stepRunId: run.id } });
      expect(inputs.map((i) => i.inputKey)).toEqual(
        expect.arrayContaining([
          'copy.draft',
          'noticeRaw.facts',
          'pricing.saleSizes',
          'sourcing.modelInfo',
          'candidate.gender',
          'settings.notice',
          'profile.importer',
          'profile.businessName',
        ]),
      );
    });

    it('사양 블록 원산지·소재 = 고시 원산지·소재(US-15 AC4)', async () => {
      const { cid } = await ready();
      await runStep(cid, 'NOTICE_HTML');
      const body = await assemblyOf(cid);
      const rows = specRows(body.specBlockHtml);
      expect(rows.ORIGIN).toBe(body.specOriginLabel);
      expect(body.originAreaName?.split('>').at(-1)).toBe(rows.ORIGIN);
      for (const part of rows.MATERIAL!.split(' / ')) {
        expect(body.noticeFields.material).toContain(part);
      }
      expect(rows.SIZE).toBe(body.noticeFields.size);
      // 남성화라 고시 height는 없지만 근거가 있으면 사양 블록에 굽·밑창 높이(F-CT-28)
      expect(rows.HEIGHT).toBe('약 3cm');
    });

    it('⑥ 묶음 실행(COPY → NOTICE_RAW → NOTICE_HTML)이 ⑥-3까지 이어서 끝난다', async () => {
      const { cid } = await ready();
      const res = await post(`/candidates/${cid}/steps/COPY/runs`, {
        throughStepCode: 'NOTICE_HTML',
      });
      expect(res.status).toBe(202);
      for (let i = 0; i < 5; i += 1) await idle();
      expect((await stepOf(cid, 'NOTICE_HTML')).status).toBe('COMPLETED');
    });

    it('미리보기: 200 text/html + CSP, 자리표시자 → 지금 G3 대표 이미지. 다시 고르면 새 id, ⑥-3 step_run 수 그대로', async () => {
      const { cid } = await ready();
      const { run } = await runStep(cid, 'NOTICE_HTML');
      const [first, second] = await seedGeneratedImages(t.prisma, cid, 2);
      await seedThumbnailSelection(t.prisma, cid, [first!]);
      const res = await get(`/candidates/${cid}/content-assembly/preview`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.headers['content-security-policy']).toBe("sandbox; img-src 'self'");
      expect(res.text).toContain(`/api/v1/image-assets/${first}/file`);
      expect(res.text).not.toContain('autostore-image:');
      expect(res.text).not.toMatch(/<script/i);
      const runsBefore = await t.prisma.stepRun.count({
        where: { candidateId: cid, stepCode: 'NOTICE_HTML' },
      });
      await seedThumbnailSelection(t.prisma, cid, [second!, first!]);
      const again = await get(`/candidates/${cid}/content-assembly/preview?stepRunId=${run.id}`);
      expect(again.text).toContain(
        `<img src="/api/v1/image-assets/${second}/file" alt="대표 이미지">`,
      );
      expect(again.text).toContain(
        `<img src="/api/v1/image-assets/${first}/file" alt="추가 이미지 1">`,
      );
      expect(
        await t.prisma.stepRun.count({ where: { candidateId: cid, stepCode: 'NOTICE_HTML' } }),
      ).toBe(runsBefore);
      expect((await stepOf(cid, 'NOTICE_HTML')).status).toBe('COMPLETED');
    });
  });

  describe('오너 수정(규칙 9·14·15, 표 B)', () => {
    it('product_name 120자 → 201 + 경고(PRODUCT_NAME_TOO_LONG), 조회 경고도 같다', async () => {
      const { cid } = await ready();
      const { runId } = await runStep(cid, 'NOTICE_HTML');
      const name = `${'가'.repeat(118)} 나`;
      const res = await ownerEdit(cid, {
        ownerAction: 'EDIT',
        baseStepRunId: runId,
        fields: [{ fieldKey: 'product_name', value: name }],
      });
      expect(res.status).toBe(201);
      expect((res.body as { warnings: { code: string }[] }).warnings.map((w) => w.code)).toEqual([
        'PRODUCT_NAME_TOO_LONG',
      ]);
      const body = await assemblyOf(cid);
      expect(body.productName).toBe(name);
      expect(body.productNameSuggestion).toBe('1201A019-108 크림 남성');
      expect(body.productNameWarnings.map((w) => w.code)).toEqual(['PRODUCT_NAME_TOO_LONG']);
      expect(body.fields).toEqual([
        expect.objectContaining({
          fieldKey: 'product_name',
          value: name,
          generatedValue: '1201A019-108 크림 남성',
          valueSource: 'OWNER_INPUT',
        }),
      ]);
      const tooLong = await ownerEdit(cid, {
        ownerAction: 'EDIT',
        baseStepRunId: body.stepRunId,
        fields: [{ fieldKey: 'product_name', value: 'x'.repeat(256) }],
      });
      expect(tooLong.status).toBe(422);
    });

    it('고지 블록 키 → 422 FIELD_NOT_EDITABLE, 사양 블록에 나라 없이 03 → 422 ORIGIN_CODE_NOT_ALLOWED', async () => {
      const { cid } = await ready();
      const { runId } = await runStep(cid, 'NOTICE_HTML');
      const blocked = await ownerEdit(cid, {
        ownerAction: 'EDIT',
        baseStepRunId: runId,
        fields: [{ fieldKey: 'notice.disclosure_agency', value: '고친 고지' }],
      });
      expect(blocked.status).toBe(422);
      expect(errorOf(blocked).code).toBe('FIELD_NOT_EDITABLE');
      // 사양 블록 제조국 표기에 실제 나라가 없는 버전(직접 만든 행)
      const base = await t.prisma.contentDraftAssembly.findUniqueOrThrow({
        where: { stepRunId: runId },
      });
      const odd = await insertStepRun(t.prisma, {
        candidateId: cid,
        stepCode: 'NOTICE_HTML',
        status: 'COMPLETED',
      });
      await t.prisma.contentDraftAssembly.create({
        data: {
          stepRunId: odd.id,
          productName: base.productName,
          noticeFields: base.noticeFields as Prisma.InputJsonObject,
          noticeSizesMm: base.noticeSizesMm,
          originAreaCode: base.originAreaCode,
          originAreaPlural: base.originAreaPlural,
          originAreaContent: base.originAreaContent,
          importer: base.importer,
          specBlockHtml: base.specBlockHtml,
          specOriginLabel: '상세설명 참조',
          disclosureTemplateVersion: base.disclosureTemplateVersion,
          disclosureTemplateDate: base.disclosureTemplateDate,
          disclosureBlockIds: base.disclosureBlockIds,
          disclosureBlocks: base.disclosureBlocks as Prisma.InputJsonArray,
          html: base.html,
          htmlSha256: base.htmlSha256,
        },
      });
      const res = await ownerEdit(cid, {
        ownerAction: 'EDIT',
        baseStepRunId: odd.id,
        fields: [{ fieldKey: 'notice.origin_area', value: '03' }],
      });
      expect(res.status).toBe(422);
      expect(errorOf(res).code).toBe('ORIGIN_CODE_NOT_ALLOWED');
      // 나라 표기가 있는 버전이면 03 + 상세 표기(사양 블록 표기)
      const ok = await ownerEdit(cid, {
        ownerAction: 'EDIT',
        baseStepRunId: runId,
        fields: [{ fieldKey: 'notice.origin_area', value: '03' }],
      });
      expect(ok.status).toBe(409); // 이미 odd 버전이 현재라 VERSION_NOT_CURRENT
      expect(errorOf(ok).code).toBe('VERSION_NOT_CURRENT');
    });

    it('notice.material을 고치면 사양 블록 소재 행도 같은 글, 03 고르기는 상세 표기를 채운다', async () => {
      const { cid } = await ready();
      const { runId } = await runStep(cid, 'NOTICE_HTML');
      const before = await assemblyOf(cid);
      const res = await ownerEdit(cid, {
        ownerAction: 'EDIT',
        baseStepRunId: runId,
        fields: [
          { fieldKey: 'notice.material', value: '겉감 합성섬유 / 안감 섬유 / 밑창 고무' },
          { fieldKey: 'notice.origin_area', value: '03' },
          { fieldKey: 'notice.height', value: '약 3cm' },
        ],
      });
      expect(res.status).toBe(201);
      const body = await assemblyOf(cid);
      expect(body.version).toBe(2);
      expect(body.noticeFields.material).toBe('겉감 합성섬유 / 안감 섬유 / 밑창 고무');
      expect(specRows(body.specBlockHtml).MATERIAL).toBe('겉감 합성섬유 / 안감 섬유 / 밑창 고무');
      expect(body.htmlSha256).not.toBe(before.htmlSha256);
      expect(body).toMatchObject({
        originAreaCode: '03',
        originAreaContent: '베트남',
        originAreaName: null,
      });
      expect(body.noticeFields.height).toBe('약 3cm');
      expect(body.disclosureBlocks).toEqual(before.disclosureBlocks);
    });
  });

  describe("'재확인 필요'(규칙 15, PRD §5.3 규칙 4)", () => {
    it('오너가 notice.size를 고친 뒤 판매 사이즈가 다른 ③ 새 버전 → ⑥-3 재실행 필요 → 다시 실행 → SALE_SIZES_CHANGED + SSE → 재확인', async () => {
      const { cid, seed } = await ready();
      const { runId } = await runStep(cid, 'NOTICE_HTML');
      const edited = await ownerEdit(cid, {
        ownerAction: 'EDIT',
        baseStepRunId: runId,
        fields: [{ fieldKey: 'notice.size', value: '250~275mm' }],
      });
      expect(edited.status).toBe(201);
      await seedPricingJudgement(t.prisma, {
        candidateId: cid,
        rakutenItemId: seed.rakutenItemId,
        sizes: [250, 255, 260],
      });
      expect(await propagatePricing(cid)).toEqual(['NOTICE_HTML']);
      expect((await stepOf(cid, 'NOTICE_HTML')).status).toBe('RERUN_REQUIRED');
      events.length = 0;
      const { run } = await runStep(cid, 'NOTICE_HTML');
      expect(run.status).toBe('COMPLETED');
      const body = await assemblyOf(cid);
      const size = body.fields.find((f) => f.fieldKey === 'notice.size')!;
      expect(size).toMatchObject({
        value: '250~275mm',
        generatedValue: '250~260mm (JP 25.0~26.0cm)',
        recheckReason: 'SALE_SIZES_CHANGED',
        recheckRequired: true,
      });
      expect(body.noticeFields.size).toBe('250~275mm');
      expect(body.noticeSizesMm).toEqual([250, 255, 260]);
      expect(
        events.filter((e) => e.name === 'content-field.recheck-flagged').map((e) => e.data),
      ).toEqual([
        {
          candidateId: cid,
          stepCode: 'NOTICE_HTML',
          stepRunId: run.id,
          fieldKeys: ['notice.size'],
          recheckReason: 'SALE_SIZES_CHANGED',
        },
      ]);
      const confirmed = await ownerEdit(cid, {
        ownerAction: 'EDIT',
        baseStepRunId: run.id,
        fields: [{ fieldKey: 'notice.size', recheckConfirmed: true }],
      });
      expect(confirmed.status).toBe(201);
      const after = await assemblyOf(cid);
      expect(after.fields.find((f) => f.fieldKey === 'notice.size')).toMatchObject({
        recheckReason: 'SALE_SIZES_CHANGED',
        recheckRequired: false,
      });
    });

    it('판매 사이즈가 같은 ③ 새 버전 → ⑥-3은 COMPLETED 그대로', async () => {
      const { cid, seed } = await ready();
      await runStep(cid, 'NOTICE_HTML');
      await seedPricingJudgement(t.prisma, {
        candidateId: cid,
        rakutenItemId: seed.rakutenItemId,
        sizes: GAPPED,
      });
      expect(await propagatePricing(cid)).toEqual([]);
      expect((await stepOf(cid, 'NOTICE_HTML')).status).toBe('COMPLETED');
    });
  });

  it('DB: 닫힌 ⑥-3의 content_draft_assembly UPDATE는 트리거가 거부한다', async () => {
    const { cid } = await ready();
    const { runId } = await runStep(cid, 'NOTICE_HTML');
    await expect(
      t.prisma.$executeRawUnsafe(
        'UPDATE content_draft_assembly SET product_name = $1 WHERE step_run_id = $2',
        'x',
        runId,
      ),
    ).rejects.toThrow(/cannot change/);
  });
});

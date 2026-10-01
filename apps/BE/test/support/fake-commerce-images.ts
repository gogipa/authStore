/**
 * 가짜 커머스API 이미지 업로드(P4-01). 실제 커머스API를 부르지 않는다.
 * - `FakeCommerceImagesServer`: `FakeCommerceTransport`(P1-07 가짜 커머스 서버)의 기본 응답을 `/v1/product-images/upload` 경로로
 *   바꾼다(토큰 경로는 그대로 token-200). 받은 요청 수·multipart 부분 수·바이트 합·필드 이름·Authorization 헤더를 기록해 테스트가
 *   읽는다. 응답은 `product-images-upload.200.json`의 모양(`{images:[{url}]}`·Trace-ID 헤더)에 부분 수만큼 겹치지 않는 가짜
 *   shop-phinf URL을 넣는다(`uploaded_image.url` UNIQUE). e2e는 같은 transport의 `fetchHandler`를 가짜 fetch(HTTP_FETCH) 뒤에
 *   두어 실제 관문(허용 목록·call_log)을 지나게 한다.
 * - `FixtureCommerceImagesPort`: 포트(`COMMERCE_IMAGES_PORT`)를 바로 바꾸는 fixture 어댑터(단위 테스트 — Nest DI
 *   `overrideProvider`·생성자 주입). 부른 묶음·동시 호출 수를 기록한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMERCE_TOKEN_PATH } from '../../src/modules/integrations/naver-commerce/commerce-endpoints.js';
import {
  COMMERCE_PRODUCT_IMAGES_UPLOAD_PATH,
  COMMERCE_UPLOAD_FIELD,
  type CommerceImagesCallContext,
  type CommerceImagesPort,
  type CommerceUploadFile,
  type CommerceUploadResult,
} from '../../src/modules/integrations/naver-commerce/commerce-images.port.js';
import {
  commerceAuthFixture,
  type CommerceFixture,
  type FakeCommerceTransport,
  type RecordedCommerceRequest,
} from './fake-commerce-transport.js';

export const UPLOAD_FIXTURE_DIR = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'registration',
  'upload',
);

export type UploadFixtureName = '200' | '400' | '500';

/** `product-images-upload.{200|400|500}.json` */
export function uploadFixture(name: UploadFixtureName): CommerceFixture {
  return JSON.parse(
    readFileSync(join(UPLOAD_FIXTURE_DIR, `product-images-upload.${name}.json`), 'utf8'),
  ) as CommerceFixture;
}

/** 샘플 파일 바이트(gen-1024.png·gen-webp-named.jpg·gen-portrait.png·big-4mb.jpg·html-with-placeholders.html) */
export function uploadFixtureBytes(name: string): Buffer {
  return readFileSync(join(UPLOAD_FIXTURE_DIR, name));
}

/** 받은 업로드 요청 한 건 */
export interface RecordedUpload {
  url: string;
  /** multipart 부분(파일) 수 */
  partCount: number;
  /** 파일 바이트 합 */
  byteSum: number;
  /** 부분마다 필드 이름(모두 `imageFiles`여야 한다) */
  fieldNames: string[];
  /** 부분마다 파일 이름·형식 */
  files: { name: string; type: string; size: number }[];
  /** 받은 Authorization 헤더(토큰은 여기에만) */
  authorization: string | null;
}

let urlSeq = 0;

/** 겹치지 않는 가짜 shop-phinf URL(실제 주소가 아니다) */
export function fakeShopPhinfUrl(): string {
  urlSeq += 1;
  return `https://shop-phinf.pstatic.net/fake/upload-${process.pid}-${urlSeq}.jpg`;
}

export class FakeCommerceImagesServer {
  readonly uploads: RecordedUpload[] = [];
  private failures: UploadFixtureName[] = [];

  install(transport: FakeCommerceTransport): this {
    transport.defaultResponder = (req) => this.respond(req);
    return this;
  }

  /** 다음 업로드 요청 하나를 이 fixture(400·500)로 실패시킨다 */
  failNext(name: '400' | '500'): this {
    this.failures.push(name);
    return this;
  }

  reset(): void {
    this.uploads.length = 0;
    this.failures = [];
  }

  /** 받은 업로드 요청 수 */
  get requestCount(): number {
    return this.uploads.length;
  }

  /** 받은 파일 수 합 */
  get partCount(): number {
    return this.uploads.reduce((sum, u) => sum + u.partCount, 0);
  }

  respond(req: RecordedCommerceRequest): CommerceFixture {
    if (req.path.endsWith(COMMERCE_TOKEN_PATH)) return commerceAuthFixture('token-200');
    if (!req.path.endsWith(COMMERCE_PRODUCT_IMAGES_UPLOAD_PATH)) {
      return commerceAuthFixture('api-200-ok');
    }
    const files: RecordedUpload['files'] = [];
    const fieldNames: string[] = [];
    for (const [name, value] of req.form?.entries() ?? []) {
      fieldNames.push(name);
      if (value instanceof Blob) {
        files.push({ name: value.name, type: value.type, size: value.size });
      }
    }
    this.uploads.push({
      url: req.url,
      partCount: files.length,
      byteSum: files.reduce((sum, f) => sum + f.size, 0),
      fieldNames,
      files,
      authorization: req.headers.authorization ?? null,
    });
    const failure = this.failures.shift();
    if (failure) return uploadFixture(failure);
    const ok = uploadFixture('200');
    return {
      status: ok.status,
      headers: ok.headers,
      body: { images: files.map(() => ({ url: fakeShopPhinfUrl() })) },
    };
  }
}

/** fixture 어댑터가 받은 호출 한 건 */
export interface FixtureUploadCall {
  files: { fileName: string; byteSize: number }[];
  context: CommerceImagesCallContext;
}

/**
 * fixture 포트 어댑터(단위 테스트용 `COMMERCE_IMAGES_PORT`). 부른 묶음과 동시 호출 수(`maxInFlight`)를 기록하고, URL은 부분마다
 * 겹치지 않는 가짜 주소, Trace-ID는 200 fixture 헤더 값을 준다. `hold()`로 붙잡고, `failNext(error)`로 던진다.
 */
export class FixtureCommerceImagesPort implements CommerceImagesPort {
  readonly calls: FixtureUploadCall[] = [];
  inFlight = 0;
  maxInFlight = 0;
  private failures: Error[] = [];
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;

  failNext(error: Error): this {
    this.failures.push(error);
    return this;
  }

  /** 이후 호출을 풀어 줄 때까지 붙잡는다 → 풀기 함수 */
  hold(): () => void {
    this.gate = new Promise((resolve) => {
      this.open = resolve;
    });
    return () => {
      this.open?.();
      this.gate = null;
      this.open = null;
    };
  }

  reset(): void {
    this.calls.length = 0;
    this.inFlight = 0;
    this.maxInFlight = 0;
    this.failures = [];
    this.open?.();
    this.gate = null;
    this.open = null;
  }

  async uploadProductImages(
    files: readonly CommerceUploadFile[],
    context: CommerceImagesCallContext = {},
  ): Promise<CommerceUploadResult> {
    this.calls.push({
      files: files.map((f) => ({ fileName: f.fileName, byteSize: f.bytes.length })),
      context,
    });
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.gate) await this.gate;
      const failure = this.failures.shift();
      if (failure !== undefined) throw failure;
      const traceId = uploadFixture('200').headers['GNCP-GW-Trace-ID'] ?? null;
      return { urls: files.map(() => fakeShopPhinfUrl()), traceId };
    } finally {
      this.inFlight -= 1;
    }
  }
}

/** 업로드 필드 이름(테스트가 비교한다) */
export const UPLOAD_FIELD = COMMERCE_UPLOAD_FIELD;

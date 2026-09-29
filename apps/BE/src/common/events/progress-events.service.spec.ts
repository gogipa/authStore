import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { AppConfigService } from '../config/app-config.service.js';
import { REPO_ROOT } from '../config/paths.js';
import { PROGRESS_EVENT_NAMES } from './progress-event.types.js';
import { ProgressEventsService, type PublishedProgressEvent } from './progress-events.service.js';

const DATA_DIR = '/var/tmp/autostore-events-test';
const config = { appDataDir: DATA_DIR } as AppConfigService;

/** 05-2 ProgressEventFrame oneOf의 M1 이벤트 이름(x-milestone: M2 제외) */
function m1EventNamesFromSpec(): string[] {
  const yaml = readFileSync(join(REPO_ROOT, 'docs', 'dev', '05_API', '05-2_openapi.yaml'), 'utf8');
  const start = yaml.indexOf('    ProgressEventFrame:');
  const end = yaml.indexOf('    StepRunStatusChangedEvent:', start);
  const lines = yaml.slice(start, end).split('\n');
  const names: string[] = [];
  lines.forEach((line, i) => {
    const m = /^ {6}- title: (\S+)$/.exec(line);
    if (m && !/x-milestone: M2/.test(lines[i + 2] ?? '')) names.push(m[1]!);
  });
  return names;
}

const statusChanged = (candidateId: number) => ({
  candidateId,
  fromStatus: null,
  toStatus: 'WORKING' as const,
  reason: 'CREATED' as const,
  excludedReason: null,
  changedAt: '2026-09-28T12:00:00+09:00',
});

describe('ProgressEventsService', () => {
  // 경로를 가렸다는 경고를 테스트 출력에서 숨긴다(ESM 모드라 jest.spyOn 대신 직접 바꾼다)
  const originalWarn = Logger.prototype.warn;
  beforeAll(() => {
    Logger.prototype.warn = () => undefined;
  });
  afterAll(() => {
    Logger.prototype.warn = originalWarn;
  });

  it('M1 이벤트 22개가 05-2 ProgressEventFrame oneOf(M1)와 같다', () => {
    expect(PROGRESS_EVENT_NAMES).toHaveLength(22);
    expect([...PROGRESS_EVENT_NAMES]).toEqual(m1EventNamesFromSpec());
  });

  it('id는 1부터 단조 증가한다', () => {
    const service = new ProgressEventsService(config);
    const a = service.publish('candidate.status-changed', statusChanged(1));
    const b = service.publish('candidate.status-changed', statusChanged(2));
    expect([a.id, b.id]).toEqual([1, 2]);
  });

  it('candidateId는 옵션 → data.candidateId → 없음(전역) 순으로 정한다', () => {
    const service = new ProgressEventsService(config);
    expect(service.publish('candidate.status-changed', statusChanged(5)).candidateId).toBe(5);
    const row = service.publish(
      'sourcing.row-updated',
      {
        sourcingComparisonId: 1,
        rowId: 2,
        isVerified: true,
        stockPass: true,
        inStockSizeCount: 3,
        effectivePriceYen: 9800,
        manualCheckRequired: false,
      },
      { candidateId: 12 },
    );
    expect(row.candidateId).toBe(12);
    const global = service.publish('registration-switch.changed', {
      apiBlocked: true,
      changedAt: '2026-09-28T12:00:00+09:00',
      revertedCandidateIds: [],
    });
    expect(global.candidateId).toBeNull();
  });

  it('candidateId로 구독하면 그 후보 이벤트와 전역 이벤트만 받는다', () => {
    const service = new ProgressEventsService(config);
    const got: PublishedProgressEvent[] = [];
    const sub = service.stream({ candidateId: 12 }).subscribe((e) => got.push(e));
    service.publish('candidate.status-changed', statusChanged(13));
    service.publish('candidate.status-changed', statusChanged(12));
    service.publish('registration-switch.changed', {
      apiBlocked: false,
      changedAt: '2026-09-28T12:00:00+09:00',
      revertedCandidateIds: [12],
    });
    sub.unsubscribe();
    expect(got.map((e) => [e.name, e.candidateId])).toEqual([
      ['candidate.status-changed', 12],
      ['registration-switch.changed', null],
    ]);
  });

  it('구독을 풀면 관찰자에서 빠진다', () => {
    const service = new ProgressEventsService(config);
    const sub = service.stream().subscribe();
    expect(service.subscriberCount).toBe(1);
    sub.unsubscribe();
    expect(service.subscriberCount).toBe(0);
  });

  it('data 속 로컬 경로(데이터 폴더·저장소·홈)는 가리고 발행한다', () => {
    const service = new ProgressEventsService(config);
    const e = service.publish('step-run.status-changed', {
      stepRunId: 1,
      candidateId: 1,
      stepCode: 'THUMBNAIL',
      version: 1,
      executionMode: 'STEP',
      stepChainId: null,
      status: 'FAILED',
      errorMessage: `파일 없음: ${DATA_DIR}/images/ab/x.png · ${REPO_ROOT}/apps · ${homedir()}/x`,
      occurredAt: '2026-09-28T12:00:00+09:00',
    });
    const msg = e.data.errorMessage ?? '';
    expect(msg).not.toContain(DATA_DIR);
    expect(msg).not.toContain(REPO_ROOT);
    expect(msg).not.toContain(homedir());
    expect(msg).toContain('<데이터 폴더>/images/ab/x.png');
  });
});

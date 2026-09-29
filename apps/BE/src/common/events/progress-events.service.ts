import { homedir, tmpdir } from 'node:os';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { filter, type Observable, Subject } from 'rxjs';
import { AppConfigService } from '../config/app-config.service.js';
import { REPO_ROOT } from '../config/paths.js';
import type { ProgressEventDataMap, ProgressEventName } from './progress-event.types.js';

/** 발행한 이벤트 한 건(SSE 프레임 전 단계) */
export interface PublishedProgressEvent<N extends ProgressEventName = ProgressEventName> {
  /** 프로세스 안에서 단조 증가(1부터). SSE 프레임의 id */
  id: number;
  name: N;
  data: ProgressEventDataMap[N];
  /** 이 이벤트가 딸린 후보. null이면 전역 이벤트(어느 후보 구독자에게나 간다) */
  candidateId: number | null;
}

export interface PublishOptions {
  /**
   * 이벤트가 딸린 후보 id. data에 candidateId가 없는 이벤트(sourcing.row-updated 등)도 후보별로
   * 거르려면 여기에 준다. 주지 않으면 data.candidateId(숫자일 때)를 쓰고, 그것도 없으면 전역 이벤트다.
   */
  candidateId?: number | null;
}

/**
 * 진행 알림 발행기(05-1 §3). rxjs Subject 하나와 id 카운터로 발행하고, GET /events가 구독한다.
 * - 재전송 버퍼는 두지 않는다(05-2 streamProgressEvents x-decision §7.1-3).
 * - data 안의 로컬 경로(데이터 폴더·저장소·홈·임시 폴더)는 발행 전에 가린다(05-1 §3).
 */
@Injectable()
export class ProgressEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(ProgressEventsService.name);
  private readonly subject = new Subject<PublishedProgressEvent>();
  private lastId = 0;
  private readonly localRoots: { prefix: string; label: string }[];

  constructor(config: AppConfigService) {
    this.localRoots = buildLocalRoots(config.appDataDir);
  }

  publish<N extends ProgressEventName>(
    name: N,
    data: ProgressEventDataMap[N],
    options: PublishOptions = {},
  ): PublishedProgressEvent<N> {
    const { value, redacted } = redactLocalPaths(data, this.localRoots);
    if (redacted) {
      this.logger.warn(`로컬 경로를 가리고 발행했습니다: ${name}`);
    }
    this.lastId += 1;
    const event: PublishedProgressEvent<N> = {
      id: this.lastId,
      name,
      data: value,
      candidateId: resolveCandidateId(data, options),
    };
    this.subject.next(event);
    return event;
  }

  /**
   * 이벤트 흐름. candidateId를 주면 그 후보의 이벤트와 전역 이벤트만 준다(05-2 streamProgressEvents).
   */
  stream(options: { candidateId?: number } = {}): Observable<PublishedProgressEvent> {
    const { candidateId } = options;
    if (candidateId === undefined) return this.subject.asObservable();
    return this.subject.pipe(
      filter((e) => e.candidateId === null || e.candidateId === candidateId),
    );
  }

  /** 지금 구독 중인 수(테스트·진단용) */
  get subscriberCount(): number {
    return this.subject.observers.length;
  }

  onModuleDestroy(): void {
    this.subject.complete();
  }
}

function resolveCandidateId(data: unknown, options: PublishOptions): number | null {
  if (options.candidateId !== undefined) return options.candidateId;
  if (data && typeof data === 'object' && 'candidateId' in data) {
    const id = data.candidateId;
    if (typeof id === 'number' && Number.isInteger(id)) return id;
  }
  return null;
}

/** 가릴 로컬 경로 접두사(긴 것부터). 표시 이름만 남긴다 */
export function buildLocalRoots(appDataDir: string): { prefix: string; label: string }[] {
  const roots = [
    { prefix: appDataDir, label: '<데이터 폴더>' },
    { prefix: REPO_ROOT, label: '<앱 폴더>' },
    { prefix: tmpdir(), label: '<임시 폴더>' },
    { prefix: homedir(), label: '~' },
  ].filter((r) => r.prefix.length > 1);
  return roots.sort((a, b) => b.prefix.length - a.prefix.length);
}

/** 문자열 값 속 로컬 경로 접두사를 표시 이름으로 바꾼다(깊은 복사). */
export function redactLocalPaths<T>(
  value: T,
  roots: readonly { prefix: string; label: string }[],
): { value: T; redacted: boolean } {
  let redacted = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      let out = v;
      for (const { prefix, label } of roots) {
        if (out.includes(prefix)) {
          out = out.split(prefix).join(label);
          redacted = true;
        }
      }
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  const out = walk(value) as T;
  return { value: out, redacted };
}

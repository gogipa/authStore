import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';

/** Prisma 트랜잭션 클라이언트(또는 PrismaService). 읽기 함수는 둘 다 받는다 */
export type Db = Prisma.TransactionClient;

/**
 * step-engine 트랜잭션 한 개의 범위. 상태를 바꾸는 쓰기는 모두 이 안에서 한다.
 * - `tx`: 이 트랜잭션의 Prisma 클라이언트
 * - `now`: 이 트랜잭션의 기준 시각(같은 트랜잭션의 시각 칸이 서로 어긋나지 않게)
 * - `afterCommit(fn)`: 커밋이 끝난 뒤 부를 일. SSE는 여기로만 보낸다(롤백된 전이를 화면이 보지 않게, P1-04 §8)
 */
export interface StepEngineTx {
  readonly tx: Db;
  readonly now: Date;
  afterCommit(fn: () => void): void;
}

/**
 * step-engine 트랜잭션 열기. 후보 상태 전이·단계 상태 쓰기·게이트 통과처럼 SSE가 따라오는 쓰기는 이것으로 연다
 * (P1-05·P1-06도 같다). 커밋되면 `afterCommit`에 모은 일을 순서대로 부르고, 롤백되면 버린다.
 */
@Injectable()
export class StepEngineTransactions {
  private readonly logger = new Logger(StepEngineTransactions.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 지금 시각(CLOCK). 트랜잭션 밖 계산(오래됨 등)도 같은 시계를 쓴다 */
  now(): Date {
    return this.clock.now();
  }

  async run<T>(fn: (scope: StepEngineTx) => Promise<T>): Promise<T> {
    const callbacks: (() => void)[] = [];
    const now = this.clock.now();
    const result = await this.prisma.$transaction((tx) =>
      fn({ tx, now, afterCommit: (cb) => callbacks.push(cb) }),
    );
    for (const cb of callbacks) {
      try {
        cb();
      } catch (error) {
        this.logger.error({ err: error }, '커밋 뒤 작업(SSE 등)이 실패했습니다');
      }
    }
    return result;
  }
}

import { Controller, Inject, type MessageEvent, Query, Sse } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiPropertyOptional,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { interval, map, merge, type Observable } from 'rxjs';
import { ProgressEventsService } from './progress-events.service.js';

/** SSE 연결 유지용 주석 줄(`: keep-alive`) 간격. Proposed(06-2 §9) */
export const SSE_HEARTBEAT_INTERVAL_MS = Symbol('SSE_HEARTBEAT_INTERVAL_MS');
export const DEFAULT_SSE_HEARTBEAT_INTERVAL_MS = 25_000;

const INT4_MAX = 2_147_483_647;

/** GET /events 쿼리. candidateId는 1 이상 정수(아니면 422 INVALID_QUERY_PARAMETER) */
export class StreamProgressEventsQuery {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    description: '이 후보의 이벤트만(전역 이벤트는 함께 보낸다)',
  })
  // '12'만 숫자로 바꾼다. 'abc'·'1.5'·'1e3'·'' 같은 값은 문자열로 남겨 IsInt가 거부하게 한다
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : value,
  )
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  candidateId?: number;
}

@ApiTags('common')
@Controller()
export class EventsController {
  constructor(
    private readonly events: ProgressEventsService,
    @Inject(SSE_HEARTBEAT_INTERVAL_MS) private readonly heartbeatMs: number,
  ) {}

  /**
   * 진행 알림 스트림(05-1 §2.15·§3). 프레임마다 id(단조 증가)·event·data(한 줄 JSON).
   * Last-Event-ID는 받기만 하고 놓친 이벤트를 다시 보내지 않는다(x-decision §7.1-3).
   * 연결이 끊기면 Nest가 구독을 푼다(구독 해제 → Subject 관찰자에서 빠짐).
   */
  @Sse('events')
  @ApiOperation({ operationId: 'streamProgressEvents', summary: 'SSE 진행 알림 스트림' })
  @ApiProduces('text/event-stream')
  @ApiHeader({
    name: 'Last-Event-ID',
    required: false,
    description: '재연결 때 브라우저가 붙이는 마지막 이벤트 id. 재전송은 하지 않는다',
  })
  @ApiOkResponse({ description: '이벤트 스트림' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER — candidateId 형식' })
  stream(@Query() query: StreamProgressEventsQuery): Observable<MessageEvent> {
    const frames = this.events.stream({ candidateId: query.candidateId }).pipe(
      map((e): MessageEvent => ({
        id: String(e.id),
        type: e.name,
        data: JSON.stringify(e.data),
      })),
    );
    if (this.heartbeatMs <= 0) return frames;
    const heartbeat = interval(this.heartbeatMs).pipe(
      map((): MessageEvent => ({ comment: 'keep-alive' })),
    );
    return merge(frames, heartbeat);
  }
}

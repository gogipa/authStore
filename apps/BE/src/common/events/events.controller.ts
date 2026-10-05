import {
  type BeforeApplicationShutdown,
  Controller,
  Inject,
  type MessageEvent,
  Query,
  Sse,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { interval, map, merge, type Observable, ReplaySubject, takeUntil } from 'rxjs';
import { ProgressEventsService } from './progress-events.service.js';

/** SSE 연결 유지용 주석 줄(`: keep-alive`) 간격. Proposed(06-2 §9) */
export const SSE_HEARTBEAT_INTERVAL_MS = Symbol('SSE_HEARTBEAT_INTERVAL_MS');
export const DEFAULT_SSE_HEARTBEAT_INTERVAL_MS = 25_000;

const INT4_MAX = 2_147_483_647;

/** 앱을 닫을 때 스트림을 끝낸 뒤 연결을 끊기 전까지 기다리는 시간(끝 표시가 소켓으로 나가게). Proposed(06-2 §9) */
export const SSE_CLOSE_FLUSH_MS = 50;

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
export class EventsController implements BeforeApplicationShutdown {
  /**
   * 앱을 닫을 때 열린 스트림을 모두 끝낸다. ReplaySubject(1)라 닫기 시작한 **뒤에** 붙은 스트림도 구독하자마자 끝난다 —
   * Nest는 이 훅(+ 50ms 대기)과 그 뒤 HTTP 서버를 닫을 때까지 새 연결을 받는다. 그냥 Subject면 그런 연결은 끝 표시 없이
   * `forceCloseConnections`에 끊겨 Vite 프록시 뒤 브라우저가 다시 붙지 않는다.
   */
  private readonly closing$ = new ReplaySubject<void>(1);

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
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  @ApiProduces('text/event-stream')
  @ApiHeader({
    name: 'Last-Event-ID',
    required: false,
    description: '재연결 때 브라우저가 붙이는 마지막 이벤트 id. 재전송은 하지 않는다',
  })
  @ApiOkResponse({
    description: '이벤트 스트림',
    // 프레임 모양(이벤트 이름별 oneOf)은 05-2 ProgressEventFrame이 원본이다(구현 명세는 글 스트림으로만 적는다)
    schema: { type: 'string', description: 'SSE 프레임(05-2 ProgressEventFrame)' },
  })
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
    if (this.heartbeatMs <= 0) return frames.pipe(takeUntil(this.closing$));
    const heartbeat = interval(this.heartbeatMs).pipe(
      map((): MessageEvent => ({ comment: 'keep-alive' })),
    );
    return merge(frames, heartbeat).pipe(takeUntil(this.closing$));
  }

  /**
   * 앱을 닫기 전에 열린 스트림을 정상으로 끝낸다(응답 끝 표시를 보낸다). 그 뒤 `forceCloseConnections`가 연결을 끊는다.
   * 이렇게 하지 않으면 화면 개발 서버(Vite) 프록시를 거친 브라우저 쪽 연결이 BE가 다시 켜진 뒤에도 열린 채 남아, 브라우저가
   * 다시 붙지 않고 진행 알림을 놓친다(D-29 5번 작업 중 찾음 — `pnpm dev` watch 재시작에서도 생긴다). Proposed(06-2 §9).
   * 이 뒤에 새로 붙는 스트림은 `closing$`이 마지막 값을 다시 주므로 곧바로 끝 표시만 받고 끝난다.
   */
  async beforeApplicationShutdown(): Promise<void> {
    this.closing$.next();
    this.closing$.complete();
    await new Promise((resolve) => setTimeout(resolve, SSE_CLOSE_FLUSH_MS));
  }
}

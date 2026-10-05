import { describe, expect, it } from 'vitest';
import { THUMBNAIL_GUIDE } from '@/features/guide';
import { thumbnailNowKey, type ThumbnailNowInput } from './thumbnailNow';

type Output = NonNullable<ThumbnailNowInput['output']>;
type Run = Output['generationRuns'][number];

const done = (): Run => ({ status: 'SUCCEEDED', resultImageAssetId: 901 });
const refused = (): Run => ({ status: 'REFUSED', resultImageAssetId: null });
const running = (): Run => ({ status: 'RUNNING', resultImageAssetId: null });

function output(runs: Run[] = [], isCurrent = true): Output {
  return { isCurrent, generationRuns: runs };
}

const base: ThumbnailNowInput = {
  stepStatus: 'WAITING_INPUT',
  runBlocked: false,
  output: output(),
  referencesConfirmed: false,
  generating: false,
  representative: null,
  passedSame: false,
};
const key = (over: Partial<ThumbnailNowInput>) => thumbnailNowKey({ ...base, ...over });

describe('⑤ 지금 할 일 글 고르기(D-41)', () => {
  it('단계 상태가 아직 없으면 줄을 감춘다(null)', () => {
    expect(key({ stepStatus: undefined })).toBeNull();
  });

  it('입력을 기다리지 않는 상태는 상태 그대로의 글을 말한다', () => {
    expect(key({ stepStatus: 'NOT_RUN', output: undefined })).toBe('start');
    expect(key({ stepStatus: 'RUNNING', output: undefined })).toBe('running');
    expect(key({ stepStatus: 'RERUN_REQUIRED' })).toBe('rerun');
    expect(key({ stepStatus: 'FAILED', output: undefined })).toBe('failed');
  });

  it('실행 버튼이 꺼져 있으면(미실행·재실행 필요·실패) 꺼진 이유를 보라고 말한다', () => {
    for (const stepStatus of ['NOT_RUN', 'RERUN_REQUIRED', 'FAILED'] as const) {
      expect(key({ stepStatus, runBlocked: true })).toBe('blocked');
    }
    // 실행 중이거나 입력 대기이면 꺼진 버튼이 아니라 지금 하는 일을 말한다
    expect(key({ stepStatus: 'RUNNING', runBlocked: true })).toBe('running');
    expect(key({ runBlocked: true })).toBe('pickReferences');
  });

  it('입력 대기: 레퍼런스 → 만들기 순서로 첫 번째 막힌 일을 말한다', () => {
    expect(key({})).toBe('pickReferences');
    expect(key({ referencesConfirmed: true })).toBe('generate');
  });

  it('후보를 만드는 중이면 기다리라고 말한다', () => {
    expect(key({ referencesConfirmed: true, generating: true })).toBe('generating');
    expect(key({ generating: true, output: output([done(), running()]) })).toBe('generating');
  });

  it('후보가 생기면 레퍼런스 확인과 관계없이 대표 고르기 → 선택 전 확인·G3 순서다', () => {
    const withImage = output([done(), refused()]);
    expect(key({ output: withImage })).toBe('pickCandidate');
    expect(key({ output: withImage, representative: 901 })).toBe('passG3');
  });

  it('쓸 수 있는 후보가 하나도 없는데 시도가 있으면(거부·실패) 다시 만들라고 말한다', () => {
    const none = output([refused(), refused()]);
    expect(key({ output: none, referencesConfirmed: true })).toBe('retry');
    // 레퍼런스 확인이 풀렸으면 그것부터(다시 만들기도 확인이 있어야 켜진다)
    expect(key({ output: none })).toBe('pickReferences');
  });

  it('입력 대기인데 산출물을 아직 못 읽었거나 지난 버전이면 줄을 감춘다', () => {
    expect(key({ output: undefined })).toBeNull();
    expect(key({ output: output([done()], false) })).toBeNull();
  });

  it('완료: 지금 선택으로 G3을 통과했으면 끝났다고 말한다', () => {
    const picked = output([done()]);
    expect(
      key({ stepStatus: 'COMPLETED', output: picked, representative: 901, passedSame: true }),
    ).toBe('done');
  });

  it('완료 뒤 다시 고르거나 G3이 무효가 되면 대표 고르기·선택 전 확인을 말한다', () => {
    const picked = output([done()]);
    expect(key({ stepStatus: 'COMPLETED', output: picked, representative: 901 })).toBe('passG3');
    expect(key({ stepStatus: 'COMPLETED', output: picked })).toBe('pickCandidate');
    expect(key({ stepStatus: 'COMPLETED', output: output([refused()]) })).toBeNull();
  });

  it('완료인데 산출물을 아직 못 읽었거나 지난 버전이면 줄을 감춘다(끝났다고 단정하지 않는다)', () => {
    expect(key({ stepStatus: 'COMPLETED', output: undefined, passedSame: true })).toBeNull();
    expect(
      key({ stepStatus: 'COMPLETED', output: output([done()], false), passedSame: true }),
    ).toBeNull();
  });

  it('고른 키마다 화면 글(THUMBNAIL_GUIDE.now)이 있다', () => {
    const keys = [
      key({ stepStatus: 'NOT_RUN', output: undefined }),
      key({ stepStatus: 'NOT_RUN', runBlocked: true }),
      key({ stepStatus: 'RUNNING' }),
      key({}),
      key({ referencesConfirmed: true }),
      key({ generating: true }),
      key({ output: output([refused()]), referencesConfirmed: true }),
      key({ output: output([done()]) }),
      key({ output: output([done()]), representative: 901 }),
      key({ stepStatus: 'COMPLETED', output: output([done()]), passedSame: true }),
      key({ stepStatus: 'RERUN_REQUIRED' }),
      key({ stepStatus: 'FAILED' }),
    ];
    expect(new Set(keys)).toEqual(new Set(Object.keys(THUMBNAIL_GUIDE.now)));
  });
});

import type { DemoGuide, DemoInfo, DemoProgress } from '@/shared/lib/demo';

/** 테스트가 DemoContext에 넣는 체험 정보. 진행은 주는 대로 고정이고 reset은 부른 횟수만 센다 */
export function fakeDemoInfo(
  progress: Partial<DemoProgress> = {},
  note = '체험에서는 바깥 사이트를 열지 않습니다.',
): DemoInfo & { resets: number } {
  const snapshot: DemoProgress = {
    done: 0,
    total: 19,
    next: { id: 'collect', path: '/keywords' },
    candidateId: null,
    registered: false,
    busy: false,
    ...progress,
  };
  const info = {
    externalLinkNote: note,
    resets: 0,
    guide: {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
      reset: () => {
        info.resets += 1;
      },
    } satisfies DemoGuide,
  };
  return info;
}

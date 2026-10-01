import { splitUploadBatches, UploadBatchError } from './upload-batcher.js';

const KB = 1024;
const MB = 1024 * 1024;
const sizes = (batches: { byteSize: number }[][]) => batches.map((b) => b.length);

describe('upload-batcher — 10장·합계 10MB 미만으로 나눈다(F-AP-03, 규칙 8)', () => {
  it('11장(각 100KB) → [10, 1]', () => {
    const files = Array.from({ length: 11 }, (_, i) => ({ id: i, byteSize: 100 * KB }));
    const batches = splitUploadBatches(files);
    expect(sizes(batches)).toEqual([10, 1]);
    // 받은 순서를 지킨다
    expect(batches.flat().map((f) => f.id)).toEqual(files.map((f) => f.id));
  });

  it('4MB × 3장 → [2, 1](8MB, 4MB)', () => {
    const files = Array.from({ length: 3 }, () => ({ byteSize: 4 * MB }));
    const batches = splitUploadBatches(files);
    expect(sizes(batches)).toEqual([2, 1]);
    expect(batches.map((b) => b.reduce((sum, f) => sum + f.byteSize, 0))).toEqual([8 * MB, 4 * MB]);
  });

  it('합계가 정확히 10,485,760바이트면 한 묶음이 아니다(미만 규칙)', () => {
    const half = 10_485_760 / 2;
    expect(sizes(splitUploadBatches([{ byteSize: half }, { byteSize: half }]))).toEqual([1, 1]);
    // 1바이트 모자라면 한 묶음
    expect(sizes(splitUploadBatches([{ byteSize: half }, { byteSize: half - 1 }]))).toEqual([2]);
  });

  it('빈 목록은 묶음 없음, 한 장이 상한 이상이면 오류(앱 코드의 잘못)', () => {
    expect(splitUploadBatches([])).toEqual([]);
    expect(() => splitUploadBatches([{ byteSize: 10_485_760 }])).toThrow(UploadBatchError);
  });
});

// 예시 그림은 `?no-inline`으로 불러 늘 같은 출처 파일 경로(개발 /src/…, 빌드 /assets/…)가 되게 한다. data: 주소로 묶이면
// 승인 화면 상세 미리보기 iframe(CSP img-src = 앱 출처)에 보이지 않는다.
import placeholder from './assets/placeholder.svg?no-inline';
import generated1 from './assets/shoe-generated-1.svg?no-inline';
import generated2 from './assets/shoe-generated-2.svg?no-inline';
import source1 from './assets/shoe-source-1.svg?no-inline';
import source2 from './assets/shoe-source-2.svg?no-inline';
import source3 from './assets/shoe-source-3.svg?no-inline';
import upload1 from './assets/shoe-upload-1.svg?no-inline';
import upload2 from './assets/shoe-upload-2.svg?no-inline';

/**
 * 예시 이미지 id(05-2 imageAssetId). 원본은 ショップA 상품 페이지에서 받은 사진 3장(참조 전용), 생성본은 ⑤ AI 후보 2장, 업로드는
 * ⑧이 1000×1000으로 맞춘 대표·추가 이미지다.
 */
export const DEMO_IMAGE_ID = {
  source1: 1,
  source2: 2,
  source3: 3,
  generated1: 901,
  generated2: 902,
  upload1: 31,
  upload2: 32,
} as const;

const IMAGE_FILE: ReadonlyMap<number, string> = new Map([
  [DEMO_IMAGE_ID.source1, source1],
  [DEMO_IMAGE_ID.source2, source2],
  [DEMO_IMAGE_ID.source3, source3],
  [DEMO_IMAGE_ID.generated1, generated1],
  [DEMO_IMAGE_ID.generated2, generated2],
  [DEMO_IMAGE_ID.upload1, upload1],
  [DEMO_IMAGE_ID.upload2, upload2],
]);

/** 이미지 id → 앱에 묶은 예시 그림 경로(같은 출처). 모르는 id는 회색 자리 그림 */
export function demoImageUrl(imageAssetId: number): string {
  return IMAGE_FILE.get(imageAssetId) ?? placeholder;
}

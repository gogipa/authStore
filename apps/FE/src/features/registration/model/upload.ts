import { imageAssetFileUrl } from '@/shared/api/client';
import type { components } from '@/shared/api/schema';

/** 05-2 UploadResultOutput(⑧ 한 버전) */
export type UploadResultOutput = components['schemas']['UploadResultOutput'];
/** 05-2 UploadResultImageItem(업로드 이미지 한 장) */
export type UploadResultImageItem = components['schemas']['UploadResultImageItem'];

/** ⑧ 구역 제목(시안 Approval.dc.html) */
export const UPLOAD_TITLE = '⑧ 이미지 업로드';
/** 상태 줄 입력 출처 글(시안 '입력 출처: ⑤ 선택본 · ⑥-3 상세 HTML') */
export const UPLOAD_SOURCE_TEXT = '⑤ 선택본 · ⑥-3 상세 HTML';
/** 업로드 이미지 목록 제목 */
export const UPLOADED_IMAGES_TITLE = '업로드한 이미지';
/** 아직 산출물이 없을 때 */
export const UPLOAD_EMPTY_TEXT =
  '아직 올린 이미지가 없습니다. ⑧을 실행하면 고른 썸네일을 1000×1000 JPEG로 올립니다.';
/** 업로드만으로는 노출되지 않는다는 안내(F-AP-01) */
export const UPLOAD_NOTE = '올린 이미지는 상품을 등록할 때만 스토어에 보입니다.';

/** 역할 글자 */
export const UPLOAD_ROLE_LABEL: Record<UploadResultImageItem['role'], string> = {
  REPRESENTATIVE: '대표',
  ADDITIONAL: '추가',
};

/**
 * 업로드 정규화본 파일 경로(05-2 getImageAssetFile — 로컬 파일을 같은 출처로 받는다. shop-phinf를 부르지 않는다).
 * 체험(`/demo`, D-31)이면 앱에 묶은 예시 그림(shared/api `imageAssetFileUrl`).
 */
export function uploadImageFileUrl(imageAssetId: number): string {
  return imageAssetFileUrl(imageAssetId);
}

/** 이미지 대체 글(대표 이미지 · 추가 이미지 n) */
export function uploadImageAlt(image: Pick<UploadResultImageItem, 'role' | 'sortOrder'>): string {
  return image.role === 'REPRESENTATIVE' ? '대표 이미지' : `추가 이미지 ${image.sortOrder}`;
}

/** 목록 캡션: '2장 · 1000×1000 JPEG · 다시 쓴 주소 2장' */
export function uploadImagesCaption(
  images: readonly Pick<UploadResultImageItem, 'reused'>[],
): string {
  const reused = images.filter((image) => image.reused).length;
  const parts = [`${images.length}장`, '1000×1000 JPEG'];
  if (reused > 0) parts.push(`다시 쓴 주소 ${reused}장`);
  return parts.join(' · ');
}

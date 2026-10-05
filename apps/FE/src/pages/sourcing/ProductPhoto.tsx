import { useState } from 'react';
import { cx } from '@/shared/lib/cx';
import styles from './ProductPhoto.module.css';

export interface ProductPhotoProps {
  /** 검색 결과 대표 사진 주소(`imageUrl`). 없으면 빈 자리를 보인다 */
  url: string | null | undefined;
  /** md 64px(상품 고르기 목록) · sm 48px(기준 상품 머리 줄) */
  size?: 'md' | 'sm';
}

/**
 * 상품 사진 한 칸(D-47). 크기가 고정이라 사진이 없거나 못 불러와도 줄 높이가 흔들리지 않는다.
 * 사진은 꾸밈이라 `alt=""`, 줄 단위로 늦게 불러온다(`loading="lazy"`)
 */
export function ProductPhoto({ url, size = 'md' }: ProductPhotoProps) {
  // 못 불러온 주소를 기억해 빈 자리로 바꾼다(주소가 바뀌면 다시 시도한다)
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const shown = url ? failedUrl !== url : false;
  return (
    <span className={cx(styles.photo, styles[size])} aria-hidden="true">
      {shown && url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className={styles.image}
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <span className={styles.empty}>사진 없음</span>
      )}
    </span>
  );
}

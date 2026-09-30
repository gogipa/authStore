import { Link } from 'react-router';
import { type SecretKey, systemSecretPath } from '../../model/secretLabels';
import styles from './SystemKeyLink.module.css';

export interface SystemKeyLinkProps {
  /** 이 키 행을 바로 연다(없으면 '키 입력' 패널로) */
  secretKey?: SecretKey;
  children?: string;
}

/**
 * 다른 화면의 커머스API 인증 실패·키 없음 안내를 시스템 상태 화면 '키 입력'으로 잇는 링크(규칙 14, F-SY-01).
 * 단계 실패 줄(StepTable)·오류 띠가 `isCommerceKeyErrorCode(code)`일 때 붙인다.
 */
export function SystemKeyLink({
  secretKey,
  children = '시스템 상태에서 키 확인',
}: SystemKeyLinkProps) {
  return (
    <Link to={systemSecretPath(secretKey)} className={styles.link}>
      {children}
    </Link>
  );
}

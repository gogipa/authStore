import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import {
  AuthStatusPanel,
  type SecretKey,
  secretKeyFromHash,
  SecretKeysPanel,
  secretRowId,
} from '@/features/system';
import { PageHeader } from '@/shared/ui';
import styles from './SystemPage.module.css';

/**
 * SCR-11 시스템 상태(System.dc.html)의 틀: 3열(열 A 420px · 열 B 368px · 열 C 나머지).
 * - 열 A: (1) 키 입력 · (2) 인증 상태(P1-07). (8) 외부 호출 기록은 M2.
 * - 열 B: (12) 첫 실행 점검(P1-11) · (3) 메타데이터 동기화(P1-08)가 패널을 끼운다. (5) 사전 조건 · (6) 자격증명 기한은 M2.
 * - 열 C: (4) AI 도구 상태(P1-11)가 끼운다. (9) AI 사용량 · (7) 공인 IP · (10) 공지 · (11) 버전은 M2.
 * 머리의 '첫 실행 점검 열기'·'다시 점검'도 P1-11 몫이다.
 * 다른 화면이 `/system#secret-<키>`로 보내면 그 키 행 입력칸을 열고 초점을 옮긴다(규칙 14).
 */
export function SystemPage() {
  const { hash } = useLocation();
  const [editingKey, setEditingKey] = useState<SecretKey | null>(() => secretKeyFromHash(hash));
  const [focusRequest, setFocusRequest] = useState(0);
  const [seenHash, setSeenHash] = useState(hash);

  // 같은 화면에서 주소 조각만 바뀌면(다른 화면의 링크) 그 키 행을 연다
  if (hash !== seenHash) {
    setSeenHash(hash);
    const key = secretKeyFromHash(hash);
    if (key) {
      setEditingKey(key);
      setFocusRequest((n) => n + 1);
    }
  }

  useEffect(() => {
    const id = hash.startsWith('#') ? hash.slice(1) : '';
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
  }, [hash]);

  const reenter = (key: SecretKey) => {
    setEditingKey(key);
    setFocusRequest((n) => n + 1);
    document.getElementById(secretRowId(key))?.scrollIntoView?.({ block: 'center' });
  };

  return (
    <>
      <PageHeader
        title="시스템 상태"
        screenId="SCR-11"
        description="키·인증·동기화·AI 도구가 준비됐는지 봅니다. 막힌 곳은 할 일을 함께 알려 드립니다."
      />
      <div className={styles.layout}>
        <div className={styles.columnA} data-column="A">
          <SecretKeysPanel
            editingKey={editingKey}
            onEditingKeyChange={setEditingKey}
            focusRequest={focusRequest}
          />
          <AuthStatusPanel onReenterSecret={reenter} />
        </div>
        <div className={styles.columnB} data-column="B" />
        <div className={styles.columnC} data-column="C" />
      </div>
    </>
  );
}

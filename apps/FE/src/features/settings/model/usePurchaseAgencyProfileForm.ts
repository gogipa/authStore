import { useMemo, useState } from 'react';
import type { ApiRequestError } from '@/shared/api/errors';
import {
  usePurchaseAgencyProfileQuery,
  useReplacePurchaseAgencyProfileMutation,
} from '../api/purchaseAgencyProfile';
import {
  formErrorsOf,
  type ProfileFormErrors,
  type ProfileFormField,
  type ProfileFormValues,
  type PurchaseAgencyProfile,
  type PurchaseAgencyProfileSaveResult,
  toProfileFormValues,
  toProfileInput,
} from './profileForm';

export interface PurchaseAgencyProfileFormState {
  /** 서버 값(불러오기 전·실패면 undefined) */
  profile: PurchaseAgencyProfile | undefined;
  loading: boolean;
  /** 불러오기 실패 */
  loadError: ApiRequestError | null;
  /** 화면에 보일 값(고친 값이 있으면 그것, 없으면 서버 값) */
  values: ProfileFormValues | null;
  /** 저장하지 않은 고침이 있다 */
  dirty: boolean;
  setField: (field: ProfileFormField, value: string) => void;
  /** '되돌리기': 서버 값으로 */
  reset: () => void;
  /** '저장': 12개 키 PUT */
  save: () => void;
  saving: boolean;
  /** 칸별 오류(숫자 칸 형식 + 서버 fieldErrors) */
  fieldErrors: ProfileFormErrors;
  /** 칸 오류가 아닌 도메인 오류(404·422·503 — 안내 띠로) */
  saveError: ApiRequestError | null;
  /** 마지막 저장 결과(고치기 시작하면 지운다) */
  saved: PurchaseAgencyProfileSaveResult | null;
}

/**
 * 구매대행 프로필 폼 상태(SCR-10). 설정 화면 머리의 '되돌리기'·'저장'과 탭 본문의 폼이 같이 쓴다.
 * 서버 값을 기준으로 두고 고친 값(draft)만 따로 들고 있다 — 저장에 성공하면 응답 값이 서버 값이 되고 draft를 버린다.
 */
export function usePurchaseAgencyProfileForm(): PurchaseAgencyProfileFormState {
  const query = usePurchaseAgencyProfileQuery();
  const mutation = useReplacePurchaseAgencyProfileMutation();
  const [draft, setDraft] = useState<ProfileFormValues | null>(null);
  const [clientErrors, setClientErrors] = useState<ProfileFormErrors>({});
  /** 서버 오류 뒤에 고친 칸(그 칸의 서버 오류 글은 지운다) */
  const [editedAfterError, setEditedAfterError] = useState<ReadonlySet<ProfileFormField>>(
    () => new Set(),
  );
  const base = useMemo(() => (query.data ? toProfileFormValues(query.data) : null), [query.data]);
  const values = draft ?? base;

  const serverErrors = useMemo(() => {
    const errors = formErrorsOf(mutation.error?.envelope.fieldErrors);
    for (const field of editedAfterError) delete errors[field];
    return errors;
  }, [mutation.error, editedAfterError]);

  return {
    profile: query.data,
    loading: query.isPending,
    loadError: query.error,
    values,
    dirty: draft !== null,
    setField: (field, value) => {
      if (!values) return;
      setDraft({ ...values, [field]: value });
      setClientErrors((errors) => {
        if (errors[field] === undefined) return errors;
        const next = { ...errors };
        delete next[field];
        return next;
      });
      if (mutation.isSuccess) mutation.reset();
      if (mutation.isError) setEditedAfterError((fields) => new Set(fields).add(field));
    },
    reset: () => {
      setDraft(null);
      setClientErrors({});
      setEditedAfterError(new Set());
      mutation.reset();
    },
    save: () => {
      if (!values || mutation.isPending) return;
      const out = toProfileInput(values);
      if (out.errors) {
        setClientErrors(out.errors);
        return;
      }
      setClientErrors({});
      setEditedAfterError(new Set());
      mutation.mutate(out.input, { onSuccess: () => setDraft(null) });
    },
    saving: mutation.isPending,
    fieldErrors: { ...serverErrors, ...clientErrors },
    saveError:
      mutation.error && mutation.error.code !== 'VALIDATION_FAILED' ? mutation.error : null,
    saved: mutation.data ?? null,
  };
}

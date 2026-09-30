import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AiEngineModelPair,
  type AiEngineModels,
  type AiEngineSettings,
  useUpdateAiEngineSettingsMutation,
} from '@/features/settings';
import {
  type AiCliCheck,
  type AiCliCheckLatestList,
  type AiCliCheckTrigger,
  hasRecentPass,
  useCreateAiCliCheckMutation,
} from '@/features/system';
import { isApiRequestError } from '@/shared/api/errors';
import type { AiEngineCode } from '@/shared/lib/aiEngine';

type ModelKind = keyof AiEngineModelPair;

/** 화면이 고른 값(클라이언트 상태) */
export interface AiEngineFormValues {
  engine: AiEngineCode;
  models: AiEngineModels;
}

/** 저장 바 상태(04-3 SaveBar): 바뀐 것 없음 · 요청 중 · 연결 테스트 필요 · 10분 안 통과 */
export type SaveBarState = 'unchanged' | 'changed' | 'needsTest' | 'tested';

/** 저장 흐름의 단계(연결 테스트 → SSE 기다림 → PUT) */
export type SavePhase = 'idle' | 'testing' | 'saving';

const ENGINES: readonly AiEngineCode[] = ['CLAUDE', 'AGY', 'CODEX'];

/**
 * 저장 전 연결 테스트 결과(SSE `ai-cli-check.completed` → 최신 점검의 새 행)를 기다리는 최대 시간(Proposed).
 * BE 연결 테스트 제한 120초(AI_TEXT_TIMEOUT_MS) + 감지·로그인 확인·`agy models`(각 15초) + 여유.
 * 넘으면 기다림을 멈추고 저장 바를 다시 켠다(점검은 BE에서 끝까지 돌고 결과는 이력에 남는다).
 */
export const BEFORE_SAVE_TIMEOUT_MS = 180_000;

/** 저장 전 연결 테스트 결과가 제한 시간 안에 오지 않았을 때(Proposed) */
export const BEFORE_SAVE_TIMEOUT_MESSAGE =
  '연결 테스트 결과를 받지 못했습니다. 최근 점검 이력을 확인한 뒤 다시 저장해 주세요.';

/**
 * 저장된 값을 화면 값으로(Proposed): 정하지 않은(null) 모델 칸은 그 엔진의 기본 모델(`defaultModels`)로 먼저 채운다.
 * 바뀐 것 판정도 이 값과 비교한다 — 빈 칸을 기본값으로 보여 준 것만으로 '바뀜'이 되지 않는다.
 */
export function savedFormValues(settings: AiEngineSettings): AiEngineFormValues {
  const models = {} as AiEngineModels;
  for (const engine of ENGINES) {
    const saved = settings.models[engine];
    const defaults = settings.engines.find((e) => e.engineCode === engine)?.defaultModels;
    models[engine] = {
      text: saved.text ?? defaults?.text ?? null,
      vision: saved.vision ?? defaults?.vision ?? null,
    };
  }
  return { engine: settings.selectedEngine, models };
}

function sameValues(a: AiEngineFormValues, b: AiEngineFormValues): boolean {
  return (
    a.engine === b.engine &&
    ENGINES.every(
      (e) => a.models[e].text === b.models[e].text && a.models[e].vision === b.models[e].vision,
    )
  );
}

/** 빈 글자는 null로(직접 입력 칸을 지우면 '정하지 않음') */
function normalizeModel(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export interface UseAiEngineFormInput {
  settings: AiEngineSettings | undefined;
  latest: AiCliCheckLatestList | undefined;
  /** 이력 행(10분 판정에 최신 행과 함께 본다) */
  history: readonly AiCliCheck[];
  /** 이 화면의 감지·연결 테스트 계기(MANUAL, 첫 실행 점검에서 왔으면 FIRST_RUN) */
  trigger: Extract<AiCliCheckTrigger, 'MANUAL' | 'FIRST_RUN'>;
  /** 테스트: 지금 시각 */
  now?: () => number;
  /** 테스트: 저장 전 연결 테스트를 기다리는 최대 시간(기본 BEFORE_SAVE_TIMEOUT_MS) */
  beforeSaveTimeoutMs?: number;
}

/**
 * AI 엔진 페이지(SCR-13) 폼(P1-11 규칙 11). 고른 엔진·모델은 화면 상태다(서버 값은 TanStack Query).
 * 저장 흐름: 10분 안에 통과한 기록이 있으면 바로 PUT. 없으면 `trigger: 'BEFORE_SAVE'` 연결 테스트를 먼저 보내고,
 * SSE `ai-cli-check.completed`가 최신 점검을 다시 읽게 해 새 행이 오면 PASSED일 때만 PUT한다(폴링 없음).
 * 최종 판정은 BE(409 AI_ENGINE_NOT_VERIFIED)다 — 그 `message`를 그대로 보인다.
 * 저장 흐름이 도는 동안(`phase` ≠ idle)은 고른 값을 바꾸지 않는다(카드도 잠긴다). PUT은 [저장]을 누른 때의 값으로 보낸다.
 * 결과가 `beforeSaveTimeoutMs` 안에 오지 않으면 기다림을 멈추고 안내한다(Proposed).
 * 연결 테스트는 사용자가 누를 때(카드 [연결 테스트]·[저장])만 보낸다. 모델을 바꿀 때 스스로 보내지 않는다(R7).
 */
export function useAiEngineForm({
  settings,
  latest,
  history,
  trigger,
  now = Date.now,
  beforeSaveTimeoutMs = BEFORE_SAVE_TIMEOUT_MS,
}: UseAiEngineFormInput) {
  const saved = useMemo(() => (settings ? savedFormValues(settings) : null), [settings]);
  const [draft, setDraft] = useState<AiEngineFormValues | null>(null);
  const [phase, setPhase] = useState<SavePhase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  /** 저장 전 연결 테스트를 보낼 때의 값·최신 행 id(새 행이 오면 결과를 보고 이 값으로 PUT한다) */
  const pending = useRef<{
    values: AiEngineFormValues;
    engine: AiEngineCode;
    model: string;
    baselineId: number;
  } | null>(null);
  const createCheck = useCreateAiCliCheckMutation();
  const update = useUpdateAiEngineSettingsMutation();

  const values = draft ?? saved;
  const changed = Boolean(values && saved && !sameValues(values, saved));
  const checks = useMemo(
    () => [...(latest?.items.map((i) => i.latest) ?? []), ...history],
    [latest, history],
  );
  const targetModel = values ? values.models[values.engine].text : null;
  const tested = Boolean(values && hasRecentPass(checks, values.engine, targetModel, now()));
  const state: SaveBarState = !changed
    ? 'unchanged'
    : phase !== 'idle'
      ? 'changed'
      : tested
        ? 'tested'
        : 'needsTest';

  const busy = phase !== 'idle';

  const edit = useCallback(
    (change: (v: AiEngineFormValues) => AiEngineFormValues) => {
      // 저장 흐름 중에는 바꾸지 않는다(연결 테스트한 값과 PUT할 값이 어긋나지 않게)
      if (busy) return;
      setMessage(null);
      setDraft((current) => {
        const base = current ?? saved;
        return base ? change(base) : current;
      });
    },
    [saved, busy],
  );

  const pickEngine = useCallback((engine: AiEngineCode) => edit((v) => ({ ...v, engine })), [edit]);

  const setModel = useCallback(
    (engine: AiEngineCode, kind: ModelKind, value: string) =>
      edit((v) => ({
        ...v,
        models: { ...v.models, [engine]: { ...v.models[engine], [kind]: normalizeModel(value) } },
      })),
    [edit],
  );

  const revert = useCallback(() => {
    if (busy) return;
    setDraft(null);
    setMessage(null);
  }, [busy]);

  const put = useCallback(
    (v: AiEngineFormValues) => {
      setPhase('saving');
      update.mutate(
        { selectedEngine: v.engine, models: v.models },
        {
          onSuccess: () => {
            setDraft(null);
            setMessage(null);
          },
          onError: (error) => setMessage(error.message),
          onSettled: () => setPhase('idle'),
        },
      );
    },
    [update],
  );

  const save = useCallback(() => {
    if (!values || !changed || phase !== 'idle') return;
    setMessage(null);
    const model = values.models[values.engine].text;
    if (hasRecentPass(checks, values.engine, model, now()) || !model) {
      put(values);
      return;
    }
    const baselineId = latest?.items.find((i) => i.engineCode === values.engine)?.latest?.id ?? 0;
    pending.current = { values, engine: values.engine, model, baselineId };
    setPhase('testing');
    createCheck.mutate(
      {
        engineCodes: [values.engine],
        smokeTest: true,
        models: { [values.engine]: model },
        trigger: 'BEFORE_SAVE',
      },
      {
        onError: (error) => {
          pending.current = null;
          setPhase('idle');
          setMessage(error.message);
        },
      },
    );
  }, [values, changed, phase, checks, now, put, latest, createCheck]);

  // 저장 전 연결 테스트의 새 행이 오면(SSE → 최신 점검 다시 읽기) 결과를 보고 [저장]을 누른 때의 값으로 PUT한다
  useEffect(() => {
    const wait = pending.current;
    if (!wait || phase !== 'testing') return;
    const row = latest?.items.find((i) => i.engineCode === wait.engine)?.latest;
    if (!row || row.id <= wait.baselineId) return;
    pending.current = null;
    if (row.smokeStatus === 'PASSED' && row.model === wait.model) {
      put(wait.values);
      return;
    }
    setPhase('idle');
    setMessage(
      row.errorMessage ??
        (row.installed ? '연결 테스트를 통과하지 못했습니다.' : '설치되지 않은 엔진입니다.'),
    );
  }, [latest, phase, put]);

  // 결과가 제한 시간 안에 오지 않으면(SSE 끊김·BE 재시작 등) 기다림을 멈추고 저장 바를 다시 켠다
  useEffect(() => {
    if (phase !== 'testing') return;
    const timer = setTimeout(() => {
      if (!pending.current) return;
      pending.current = null;
      setPhase('idle');
      setMessage(BEFORE_SAVE_TIMEOUT_MESSAGE);
    }, beforeSaveTimeoutMs);
    return () => clearTimeout(timer);
  }, [phase, beforeSaveTimeoutMs]);

  /** 카드 [연결 테스트]: 그 엔진만, 지금 고른 텍스트 모델로(저장 흐름 중에는 보내지 않는다) */
  const testEngine = useCallback(
    (engine: AiEngineCode) => {
      if (busy) return;
      const model = values?.models[engine].text;
      setMessage(null);
      createCheck.mutate(
        {
          engineCodes: [engine],
          smokeTest: true,
          ...(model ? { models: { [engine]: model } } : {}),
          trigger,
        },
        { onError: (error) => setMessage(error.message) },
      );
    },
    [busy, values, createCheck, trigger],
  );

  /** [다시 감지]·화면을 열 때: 세 엔진 감지만(호출 비용 없음) */
  const detect = useCallback(() => {
    createCheck.mutate(
      { smokeTest: false, trigger },
      {
        onError: (error) => {
          // 이미 도는 점검(앱 시작 점검 등)이 있으면 그 결과가 SSE로 온다 — 알리지 않는다
          if (isApiRequestError(error) && error.code === 'ALREADY_IN_PROGRESS') return;
          setMessage(error.message);
        },
      },
    );
  }, [createCheck, trigger]);

  return {
    saved,
    values,
    changed,
    state,
    phase,
    /** 저장 흐름(연결 테스트 → PUT)이 도는 중 — 카드의 라디오·모델·[연결 테스트]를 잠근다 */
    busy,
    message,
    requesting: createCheck.isPending,
    pickEngine,
    setModel,
    revert,
    save,
    testEngine,
    detect,
  };
}

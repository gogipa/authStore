import { Injectable } from '@nestjs/common';
import type { Db, StepEngineTx } from '../candidates/step-engine-tx.js';
import type {
  CandidateCreationExtension,
  UrlCandidateCreationInput,
} from './candidate-creation.extension.js';
import type { SourcingSelectionReader } from './sourcing-selection.port.js';

/**
 * 단계 모듈이 앱 시작 때 step-engine에 끼우는 확장 자리(P2-02 Proposed — C4 §3.1). step-engine은 단계 모듈을 import하지
 * 않는다(엔진 → 단계 방향만): 단계 모듈이 `StepEngineApi.register…`로 자기 구현을 넘기고, 엔진은 여기서 꺼내 부른다.
 * - 후보 만들기 확장(`CANDIDATE_CREATION_EXTENSION`, P1-04 포트): sourcing이 'URL로 만들기' ② URL_CREATE를 채운다
 * - ② 소싱 선택 읽기(`SourcingSelectionReader`): sourcing이 등록하고 ③·⑤·⑥이 `StepEngineApi.readSourcingSelection`으로 쓴다
 * 둘째 등록은 앱 시작을 멈춘다(한 자리에 구현 하나).
 */
@Injectable()
export class StepModulePorts {
  private creation: CandidateCreationExtension | null = null;
  private selection: SourcingSelectionReader | null = null;

  registerCandidateCreationExtension(extension: CandidateCreationExtension): void {
    if (this.creation) throw new Error('후보 만들기 확장이 이미 등록되어 있습니다');
    this.creation = extension;
  }

  registerSourcingSelectionReader(reader: SourcingSelectionReader): void {
    if (this.selection) throw new Error('소싱 선택 읽기가 이미 등록되어 있습니다');
    this.selection = reader;
  }

  get candidateCreationExtension(): CandidateCreationExtension | null {
    return this.creation;
  }

  get sourcingSelectionReader(): SourcingSelectionReader | null {
    return this.selection;
  }
}

/**
 * `CANDIDATE_CREATION_EXTENSION` 값: 등록된 확장에 넘기고, 없으면(P1-04 기본) 아무것도 하지 않는다 — ② 없이 후보만 만든다.
 */
export function delegatingCreationExtension(ports: StepModulePorts): CandidateCreationExtension {
  return {
    validateUrlItem: async (db: Db, input: Omit<UrlCandidateCreationInput, 'candidateId'>) => {
      await ports.candidateCreationExtension?.validateUrlItem?.(db, input);
    },
    createUrlSourcingVersion: async (scope: StepEngineTx, input: UrlCandidateCreationInput) => {
      await ports.candidateCreationExtension?.createUrlSourcingVersion(scope, input);
    },
  };
}

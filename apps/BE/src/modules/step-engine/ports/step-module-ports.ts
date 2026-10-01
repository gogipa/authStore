import { Injectable } from '@nestjs/common';
import type { Db, StepEngineTx } from '../candidates/step-engine-tx.js';
import type {
  CandidateCreationExtension,
  UrlCandidateCreationInput,
} from './candidate-creation.extension.js';
import type { GenderInputListener } from './gender-input.port.js';
import type { SourcingSelectionReader } from './sourcing-selection.port.js';
import type {
  NoticeHtmlReader,
  PricingOutputReader,
  ThumbnailSelectionReader,
} from './step-output-readers.port.js';

/**
 * 단계 모듈이 앱 시작 때 step-engine에 끼우는 확장 자리(P2-02 Proposed — C4 §3.1). step-engine은 단계 모듈을 import하지
 * 않는다(엔진 → 단계 방향만): 단계 모듈이 `StepEngineApi.register…`로 자기 구현을 넘기고, 엔진은 여기서 꺼내 부른다.
 * - 후보 만들기 확장(`CANDIDATE_CREATION_EXTENSION`, P1-04 포트): sourcing이 'URL로 만들기' ② URL_CREATE를 채운다
 * - ② 소싱 선택 읽기(`SourcingSelectionReader`): sourcing이 등록하고 ③·⑤·⑥이 `StepEngineApi.readSourcingSelection`으로 쓴다
 * - 오너 성별 입력 리스너(`GenderInputListener`, P2-03): 열린 ②(④)가 성별을 기다리면 이어 간다. 여럿을 차례로 부른다
 * - ③ 판정 읽기(`PricingOutputReader`, P3-04): pricing이 등록하고 ⑥-3이 `StepEngineApi.readPricingSaleSizes`로 쓴다
 * - ⑤ G3 선택본 읽기(`ThumbnailSelectionReader`, P3-04): thumbnails가 등록하고 ⑥-3 미리보기가 `readThumbnailSelection`으로,
 *   ⑧ 업로드(P4-01)가 `readThumbnailSelectionOf`로 쓴다
 * - ⑥-3 상세 HTML 읽기(`NoticeHtmlReader`, P4-01): content가 등록하고 ⑧ 업로드가 `readNoticeHtml`로 쓴다
 * 리스너를 뺀 자리는 둘째 등록이 앱 시작을 멈춘다(한 자리에 구현 하나).
 */
@Injectable()
export class StepModulePorts {
  private creation: CandidateCreationExtension | null = null;
  private selection: SourcingSelectionReader | null = null;
  private pricingOutput: PricingOutputReader | null = null;
  private thumbnailSelection: ThumbnailSelectionReader | null = null;
  private noticeHtml: NoticeHtmlReader | null = null;
  /**
   * 오너 성별 입력 리스너(`GENDER_INPUT_LISTENERS`의 값 — 같은 배열을 넘긴다, P2-03 Proposed). 단계 모듈(② P2-03·④ P2-06)이
   * 앱 시작 때 `StepEngineApi.registerGenderInputListener`로 더한다
   */
  readonly genderInputListeners: GenderInputListener[] = [];

  registerCandidateCreationExtension(extension: CandidateCreationExtension): void {
    if (this.creation) throw new Error('후보 만들기 확장이 이미 등록되어 있습니다');
    this.creation = extension;
  }

  registerSourcingSelectionReader(reader: SourcingSelectionReader): void {
    if (this.selection) throw new Error('소싱 선택 읽기가 이미 등록되어 있습니다');
    this.selection = reader;
  }

  registerPricingOutputReader(reader: PricingOutputReader): void {
    if (this.pricingOutput) throw new Error('③ 판정 읽기가 이미 등록되어 있습니다');
    this.pricingOutput = reader;
  }

  registerThumbnailSelectionReader(reader: ThumbnailSelectionReader): void {
    if (this.thumbnailSelection) throw new Error('⑤ G3 선택본 읽기가 이미 등록되어 있습니다');
    this.thumbnailSelection = reader;
  }

  registerNoticeHtmlReader(reader: NoticeHtmlReader): void {
    if (this.noticeHtml) throw new Error('⑥-3 상세 HTML 읽기가 이미 등록되어 있습니다');
    this.noticeHtml = reader;
  }

  registerGenderInputListener(listener: GenderInputListener): void {
    if (this.genderInputListeners.includes(listener)) return;
    this.genderInputListeners.push(listener);
  }

  get candidateCreationExtension(): CandidateCreationExtension | null {
    return this.creation;
  }

  get sourcingSelectionReader(): SourcingSelectionReader | null {
    return this.selection;
  }

  get pricingOutputReader(): PricingOutputReader | null {
    return this.pricingOutput;
  }

  get thumbnailSelectionReader(): ThumbnailSelectionReader | null {
    return this.thumbnailSelection;
  }

  get noticeHtmlReader(): NoticeHtmlReader | null {
    return this.noticeHtml;
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

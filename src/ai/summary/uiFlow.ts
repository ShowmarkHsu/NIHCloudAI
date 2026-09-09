import type { FixedFiveSectionSummary } from '../contracts/summary';
import {
  createSummaryReviewCopyState,
  getReviewedCopyText,
  transitionSummaryReviewCopyState,
  type SummaryReviewCopyState,
  type SummaryReviewScopeInput,
} from './stateMachine';

export type SummaryUiStatus =
  | 'waiting-for-data'
  | 'ready-to-generate'
  | 'generating'
  | 'ready-for-review'
  | 'reviewed'
  | 'generation-failed'
  | 'cancelled';

export type SummaryUiFlowConfiguration = Readonly<{
  generate: (scope: SummaryReviewScopeInput) => Promise<unknown>;
}>;

type SummaryUiView = Readonly<{
  status: SummaryUiStatus;
  generateEnabled: boolean;
  copyEnabled: boolean;
  sections: ReadonlyArray<FixedFiveSectionSummary['sections'][number]>;
}>;

function summaryFromState(state: SummaryReviewCopyState): FixedFiveSectionSummary | undefined {
  return state.status === 'blocked' ? undefined : state.summary;
}

/**
 * UI-facing state model. Generation is deliberate, text is held only in the
 * review state machine, and a late promise cannot restore a cancelled or
 * replaced patient scope.
 */
export function createSummaryUiFlow(configuration: SummaryUiFlowConfiguration) {
  let scope: SummaryReviewScopeInput | undefined;
  let status: SummaryUiStatus = 'waiting-for-data';
  let state = createSummaryReviewCopyState();
  let generationEpoch = 0;

  function view(): SummaryUiView {
    const summary = summaryFromState(state);
    return Object.freeze({
      status,
      generateEnabled: status === 'ready-to-generate',
      copyEnabled: scope !== undefined && getReviewedCopyText(state, scope) !== undefined,
      sections: summary?.sections ?? [],
    });
  }

  return Object.freeze({
    setData(nextScope: SummaryReviewScopeInput): void {
      generationEpoch += 1;
      scope = nextScope;
      state = createSummaryReviewCopyState(nextScope);
      status = 'ready-to-generate';
    },

    switchPatient(nextScope: SummaryReviewScopeInput): void {
      generationEpoch += 1;
      scope = nextScope;
      state = transitionSummaryReviewCopyState(state, { type: 'patient-changed', scope: nextScope });
      status = 'ready-to-generate';
    },

    cancel(): void {
      generationEpoch += 1;
      if (scope === undefined) return;
      state = transitionSummaryReviewCopyState(state, { type: 'session-ended', scope });
      status = 'cancelled';
    },

    async generate(): Promise<void> {
      if (scope === undefined || status !== 'ready-to-generate') return;
      const currentScope = scope;
      const epoch = generationEpoch + 1;
      generationEpoch = epoch;
      status = 'generating';
      try {
        const summary = await configuration.generate(currentScope);
        if (generationEpoch !== epoch || scope !== currentScope) return;
        state = transitionSummaryReviewCopyState(state, {
          type: 'summary-validated', scope: currentScope, summary,
        });
        status = state.status === 'ready-for-review' ? 'ready-for-review' : 'generation-failed';
      } catch {
        if (generationEpoch !== epoch || scope !== currentScope) return;
        state = transitionSummaryReviewCopyState(state, { type: 'validation-failed', scope: currentScope });
        status = 'generation-failed';
      }
    },

    confirmReview(): void {
      if (scope === undefined) return;
      state = transitionSummaryReviewCopyState(state, { type: 'review-confirmed', scope });
      if (state.status === 'reviewed') status = 'reviewed';
    },

    copyText(): string | undefined {
      return scope === undefined ? undefined : getReviewedCopyText(state, scope);
    },

    sourceRefsForSection(index: number): readonly string[] {
      const summary = summaryFromState(state);
      return summary?.sections[index]?.sourceRefs ?? [];
    },

    view,
  });
}

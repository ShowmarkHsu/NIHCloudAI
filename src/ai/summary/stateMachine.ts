import { z } from 'zod';

import {
  clinicalProjectionContractVersionSchema,
} from '../contracts/versions';
import {
  dataSessionIdSchema,
  opaquePatientIdSchema,
  snapshotRevisionSchema,
} from '../contracts/patientSnapshot';
import {
  parseFixedFiveSectionSummary,
  type FixedFiveSectionSummary,
} from '../contracts/summary';
import { formatFixedFiveSectionSummary } from './formatter';

const summaryReviewScopeSchema = z
  .object({
    tabId: z.number().int().nonnegative(),
    patientId: opaquePatientIdSchema,
    sessionId: dataSessionIdSchema,
    revision: snapshotRevisionSchema,
    contractVersion: clinicalProjectionContractVersionSchema,
  })
  .strict()
  .readonly();

export type SummaryReviewScopeInput = {
  readonly tabId: number;
  readonly patientId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly contractVersion: string;
};

type SummaryReviewScope = z.infer<typeof summaryReviewScopeSchema>;

type SummaryWithText = {
  readonly scope: SummaryReviewScope;
  readonly summary: FixedFiveSectionSummary;
  readonly sourceText: string;
  readonly draft: string;
};

export type SummaryReviewCopyState =
  | {
      readonly status: 'blocked';
      readonly scope: SummaryReviewScope | undefined;
      readonly draft: undefined;
    }
  | (SummaryWithText & {
      readonly status: 'ready-for-review' | 'reviewed' | 'regenerating' | 'regeneration-failed';
    });

export type SummaryReviewCopyEvent =
  | {
      readonly type: 'summary-validated';
      readonly scope: SummaryReviewScopeInput;
      readonly summary: unknown;
    }
  | {
      readonly type: 'draft-edited';
      readonly scope: SummaryReviewScopeInput;
      readonly draft: string;
    }
  | {
      readonly type: 'review-confirmed' | 'regeneration-started' | 'regeneration-failed';
      readonly scope: SummaryReviewScopeInput;
    }
  | {
      readonly type:
        | 'validation-failed'
        | 'patient-changed'
        | 'session-ended'
        | 'revision-changed'
        | 'validation-state-changed';
      readonly scope?: SummaryReviewScopeInput;
    };

function parseScope(value: SummaryReviewScopeInput): SummaryReviewScope | undefined {
  const result = summaryReviewScopeSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function sameScope(
  left: SummaryReviewScope,
  right: SummaryReviewScope,
): boolean {
  return (
    left.patientId === right.patientId &&
    left.tabId === right.tabId &&
    left.sessionId === right.sessionId &&
    left.revision === right.revision &&
    left.contractVersion === right.contractVersion
  );
}

function hasCurrentScope(
  state: SummaryReviewCopyState,
  scope: SummaryReviewScopeInput,
): state is Exclude<SummaryReviewCopyState, { readonly status: 'blocked' }> {
  const parsedScope = parseScope(scope);
  return state.status !== 'blocked' && parsedScope !== undefined && sameScope(state.scope, parsedScope);
}

function createValidatedState(
  scopeInput: SummaryReviewScopeInput,
  summaryInput: unknown,
): SummaryReviewCopyState {
  const scope = parseScope(scopeInput);
  if (scope === undefined) return createSummaryReviewCopyState();

  try {
    const summary = parseFixedFiveSectionSummary(summaryInput);
    const sourceText = formatFixedFiveSectionSummary(summary);
    return {
      status: 'ready-for-review',
      scope,
      summary,
      sourceText,
      draft: sourceText,
    };
  } catch {
    return createSummaryReviewCopyState();
  }
}

export function createSummaryReviewCopyState(
  scopeInput?: SummaryReviewScopeInput,
): SummaryReviewCopyState {
  return { status: 'blocked', scope: scopeInput === undefined ? undefined : parseScope(scopeInput), draft: undefined };
}

export function transitionSummaryReviewCopyState(
  state: SummaryReviewCopyState,
  event: SummaryReviewCopyEvent,
): SummaryReviewCopyState {
  switch (event.type) {
    case 'patient-changed':
    case 'session-ended':
    case 'revision-changed':
    case 'validation-state-changed':
    case 'validation-failed':
      return createSummaryReviewCopyState(event.scope);
    case 'summary-validated': {
      const nextScope = parseScope(event.scope);
      if (nextScope === undefined) return state;
      const currentScope = state.scope;
      if (currentScope !== undefined && !sameScope(currentScope, nextScope)) return state;
      return createValidatedState(event.scope, event.summary);
    }
    case 'draft-edited':
      if (
        !hasCurrentScope(state, event.scope) ||
        state.status === 'regenerating'
      ) {
        return state;
      }
      return { ...state, status: 'ready-for-review', draft: event.draft };
    case 'review-confirmed':
      if (
        !hasCurrentScope(state, event.scope) ||
        state.status !== 'ready-for-review'
      ) {
        return state;
      }
      return { ...state, status: 'reviewed' };
    case 'regeneration-started':
      if (!hasCurrentScope(state, event.scope)) return state;
      return {
        ...state,
        status: 'regenerating',
        draft: state.sourceText,
      };
    case 'regeneration-failed':
      if (!hasCurrentScope(state, event.scope) || state.status !== 'regenerating') {
        return state;
      }
      return { ...state, status: 'regeneration-failed' };
  }
}

export function getReviewedCopyText(
  state: SummaryReviewCopyState,
  scope: SummaryReviewScopeInput,
): string | undefined {
  return hasCurrentScope(state, scope) && state.status === 'reviewed'
    ? state.draft
    : undefined;
}

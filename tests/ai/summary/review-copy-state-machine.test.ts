import { describe, expect, it } from 'vitest';

import {
  FIXED_FIVE_SECTION_SCHEMA_VERSION,
  FIXED_FIVE_SECTION_TIME_WINDOWS,
} from '../../../src/ai/contracts/summary';
import { CLINICAL_PROJECTION_CONTRACT_VERSION } from '../../../src/ai/contracts/versions';
import {
  createSummaryReviewCopyState,
  getReviewedCopyText,
  transitionSummaryReviewCopyState,
} from '../../../src/ai/summary/stateMachine';

const scope = {
  tabId: 7,
  patientId: 'pt_summary_state_0001',
  sessionId: 'ds_summary_state_0001',
  revision: 1,
  contractVersion: CLINICAL_PROJECTION_CONTRACT_VERSION,
};

const summary = {
  schemaVersion: FIXED_FIVE_SECTION_SCHEMA_VERSION,
  timeWindows: FIXED_FIVE_SECTION_TIME_WINDOWS,
  sections: [
    { heading: '核對重點', content: '重'.repeat(40), sourceRefs: ['sr_state_000000000001'] },
    { heading: '目前用藥與過敏', content: '要'.repeat(40), sourceRefs: ['sr_state_000000000002'] },
    { heading: '近期病程與檢查', content: '點'.repeat(40), sourceRefs: ['sr_state_000000000003'] },
    { heading: '住院、手術與出院', content: '資'.repeat(40), sourceRefs: ['sr_state_000000000004'] },
    {
      heading: '資料缺口與待確認',
      content: `資料缺口：${'待'.repeat(40)}；待確認：${'核'.repeat(40)}`,
      sourceRefs: [],
    },
  ],
};

function validatedState() {
  return transitionSummaryReviewCopyState(createSummaryReviewCopyState(), {
    type: 'summary-validated',
    scope,
    summary,
  });
}

describe('summary review and copy state machine', () => {
  it('only enables copy after a complete current summary is explicitly reviewed', () => {
    const empty = createSummaryReviewCopyState();
    expect(getReviewedCopyText(empty, scope)).toBeUndefined();

    const validated = validatedState();
    expect(validated.status).toBe('ready-for-review');
    expect(getReviewedCopyText(validated, scope)).toBeUndefined();

    const reviewed = transitionSummaryReviewCopyState(validated, {
      type: 'review-confirmed',
      scope,
    });
    expect(reviewed.status).toBe('reviewed');
    expect(getReviewedCopyText(reviewed, scope)).toContain('【核對重點】');
  });

  it('clears review and copy eligibility on every draft edit and regenerate', () => {
    const reviewed = transitionSummaryReviewCopyState(validatedState(), {
      type: 'review-confirmed',
      scope,
    });
    const edited = transitionSummaryReviewCopyState(reviewed, {
      type: 'draft-edited',
      scope,
      draft: '醫師修改後的病歷文字。',
    });
    expect(edited.status).toBe('ready-for-review');
    expect(getReviewedCopyText(edited, scope)).toBeUndefined();

    const regenerated = transitionSummaryReviewCopyState(edited, {
      type: 'regeneration-started',
      scope,
    });
    expect(regenerated.status).toBe('regenerating');
    expect(getReviewedCopyText(regenerated, scope)).toBeUndefined();
    expect(regenerated.draft).toContain('【核對重點】');
  });

  it('retains only the prior accepted summary after a same-revision regeneration failure', () => {
    const regenerating = transitionSummaryReviewCopyState(validatedState(), {
      type: 'regeneration-started',
      scope,
    });
    const failed = transitionSummaryReviewCopyState(regenerating, {
      type: 'regeneration-failed',
      scope,
    });

    expect(failed.status).toBe('regeneration-failed');
    if (failed.status !== 'regeneration-failed') throw new Error('expected failed regeneration state');
    expect(failed.sourceText).toContain('【資料缺口與待確認】');
    expect(failed.draft).toBe(failed.sourceText);
    expect(getReviewedCopyText(failed, scope)).toBeUndefined();
  });

  it('drops all patient-derived text for validation, patient, session, and revision changes', () => {
    for (const event of [
      { type: 'validation-failed', scope },
      { type: 'patient-changed' },
      { type: 'session-ended' },
      { type: 'revision-changed' },
      { type: 'validation-state-changed' },
    ] as const) {
      const next = transitionSummaryReviewCopyState(validatedState(), event);
      expect(next.status).toBe('blocked');
      expect(next.draft).toBeUndefined();
      expect(getReviewedCopyText(next, scope)).toBeUndefined();
    }
  });

  it('ignores stale review and edit events from another revision', () => {
    const staleScope = { ...scope, revision: 2 };
    const state = validatedState();

    const edited = transitionSummaryReviewCopyState(state, {
      type: 'draft-edited',
      scope: staleScope,
      draft: '不得進入目前 revision。',
    });
    const reviewed = transitionSummaryReviewCopyState(state, {
      type: 'review-confirmed',
      scope: staleScope,
    });

    expect(edited).toBe(state);
    expect(reviewed).toBe(state);
    expect(getReviewedCopyText(reviewed, scope)).toBeUndefined();
  });

  it('retains a replacement scope and ignores late results from the former revision', () => {
    const nextScope = { ...scope, revision: 2 };
    const switched = transitionSummaryReviewCopyState(validatedState(), {
      type: 'revision-changed',
      scope: nextScope,
    });
    const lateResult = transitionSummaryReviewCopyState(switched, {
      type: 'summary-validated',
      scope,
      summary,
    });

    expect(lateResult).toBe(switched);
    expect(getReviewedCopyText(lateResult, nextScope)).toBeUndefined();
  });

  it('does not allow a failed regeneration to regain copy eligibility by review alone', () => {
    const failed = transitionSummaryReviewCopyState(
      transitionSummaryReviewCopyState(validatedState(), {
        type: 'regeneration-started',
        scope,
      }),
      { type: 'regeneration-failed', scope },
    );
    const attemptedReview = transitionSummaryReviewCopyState(failed, {
      type: 'review-confirmed',
      scope,
    });

    expect(attemptedReview).toBe(failed);
    expect(getReviewedCopyText(attemptedReview, scope)).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  createSummaryUiFlow,
} from '../../../src/ai/summary/uiFlow';
import {
  FIXED_FIVE_SECTION_SCHEMA_VERSION,
  FIXED_FIVE_SECTION_TIME_WINDOWS,
} from '../../../src/ai/contracts/summary';
import { CLINICAL_PROJECTION_CONTRACT_VERSION } from '../../../src/ai/contracts/versions';

const scope = {
  tabId: 17,
  patientId: 'pt_ui_flow_patient_0001',
  sessionId: 'ds_ui_flow_session_0001',
  revision: 1,
  contractVersion: CLINICAL_PROJECTION_CONTRACT_VERSION,
};

const summary = {
  schemaVersion: FIXED_FIVE_SECTION_SCHEMA_VERSION,
  timeWindows: FIXED_FIVE_SECTION_TIME_WINDOWS,
  sections: [
    { heading: '核對重點', content: '重'.repeat(40), sourceRefs: ['sr_ui_flow_000000000001'] },
    { heading: '目前用藥與過敏', content: '要'.repeat(40), sourceRefs: ['sr_ui_flow_000000000002'] },
    { heading: '近期病程與檢查', content: '點'.repeat(40), sourceRefs: ['sr_ui_flow_000000000003'] },
    { heading: '住院、手術與出院', content: '資'.repeat(40), sourceRefs: ['sr_ui_flow_000000000004'] },
    { heading: '資料缺口與待確認', content: `資料缺口：${'待'.repeat(40)}；待確認：${'核'.repeat(40)}`, sourceRefs: [] },
  ],
};

describe('minimal AI summary UI flow', () => {
  it('shows data state, generates only on user action, preserves five sections, and gates copy on review', async () => {
    const generate = vi.fn(async () => summary);
    const flow = createSummaryUiFlow({ generate });

    expect(flow.view().status).toBe('waiting-for-data');
    flow.setData(scope);
    expect(flow.view()).toMatchObject({ status: 'ready-to-generate', generateEnabled: true });
    await flow.generate();
    expect(generate).toHaveBeenCalledWith(scope);
    expect(flow.view().sections.map((section) => section.heading)).toEqual([
      '核對重點', '目前用藥與過敏', '近期病程與檢查', '住院、手術與出院', '資料缺口與待確認',
    ]);
    expect(flow.copyText()).toBeUndefined();
    expect(flow.sourceRefsForSection(0)).toEqual(['sr_ui_flow_000000000001']);

    flow.confirmReview();
    expect(flow.view().copyEnabled).toBe(true);
    expect(flow.copyText()).toContain('【核對重點】');
  });

  it('does not revive a cancelled, failed, or switched patient flow from a late generation', async () => {
    let finish: ((value: unknown) => void) | undefined;
    let calls = 0;
    const flow = createSummaryUiFlow({
      generate: () => {
        calls += 1;
        return calls === 1
          ? new Promise((resolve) => { finish = resolve; })
          : Promise.reject(new Error('synthetic provider failure'));
      },
    });
    flow.setData(scope);
    const pending = flow.generate();
    expect(flow.view().status).toBe('generating');
    flow.cancel();
    finish?.(summary);
    await pending;
    expect(flow.view().status).toBe('cancelled');
    expect(flow.copyText()).toBeUndefined();

    flow.setData(scope);
    await flow.generate();
    expect(flow.view().status).toBe('generation-failed');
    flow.switchPatient({ ...scope, patientId: 'pt_ui_flow_patient_0002', sessionId: 'ds_ui_flow_session_0002' });
    expect(flow.view()).toMatchObject({ status: 'ready-to-generate', sections: [] });
  });
});

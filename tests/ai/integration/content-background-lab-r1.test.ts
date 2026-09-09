import { describe, expect, it, vi } from 'vitest';

import { createLabVerticalSlice } from '../../../src/ai/integration/labVerticalSlice';
import { createClosedBackgroundDataSessionController } from '../../../src/background/closedDataSessionController';

const sender = {
  tabId: 43,
  origin: 'https://medcloud2.nhi.gov.tw',
  url: 'https://medcloud2.nhi.gov.tw/imu/IMUE1000/IMUE0008',
};
const sessionId = 'ds_r1_content_background_00001';

function snapshot(revision: number) {
  let reference = 0;
  const slice = createLabVerticalSlice({
    now: () => '2026-08-21T00:00:00.000Z',
    issueSourceReference: () => `sr_r1_background_source_${String(++reference).padStart(8, '0')}`,
  });
  return slice.ingest({patientId: 'pt_r1_content_background_00001', sessionId, revision}, {
    status: 'success', dataType: 'labdata', recordCount: 1,
    data: {rObject: [{
      hosp: 'Synthetic Lab;outpatient;0000000000', real_inspect_date: '2026/08/20',
      order_code: 'LAB-001', assay_item_name: 'Synthetic analyte', assay_value: '1.0',
      unit_data: 'mg/dL', consult_value: '0-2', assay_mark: '0',
    }]},
  })?.sealed.snapshot;
}

describe('R1 content-to-background sealed lab snapshot', () => {
  it('only stores an exact active sealed revision and rejects a superseded snapshot', () => {
    const storeSnapshot = vi.fn(() => true);
    const cancel = vi.fn();
    const controller = createClosedBackgroundDataSessionController({storeSnapshot, cancel});
    const first = snapshot(1);
    const second = snapshot(2);
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    expect(controller.receive({
      schemaVersion: 'ai-capability-message.v1', type: 'content.data-session.started',
      sessionId, revision: 1, sequence: 1,
    }, sender)).toEqual({accepted: true});
    expect(controller.receive({
      schemaVersion: 'ai-capability-message.v1', type: 'content.snapshot.sealed',
      sessionId, revision: 1, sequence: 2, snapshot: first,
    }, sender)).toEqual({accepted: true});
    expect(storeSnapshot).toHaveBeenLastCalledWith(
      {tabId: 43, sessionId, revision: 1}, first,
    );

    expect(controller.receive({
      schemaVersion: 'ai-capability-message.v1', type: 'content.data-session.revised',
      sessionId, revision: 2, sequence: 3,
    }, sender)).toEqual({accepted: true});
    expect(cancel).toHaveBeenCalledWith({tabId: 43, sessionId, revision: 1}, 'revision-changed');
    expect(controller.receive({
      schemaVersion: 'ai-capability-message.v1', type: 'content.snapshot.sealed',
      sessionId, revision: 2, sequence: 3, snapshot: second,
    }, sender)).toEqual({accepted: false, reason: 'sequence-rollback'});
    expect(controller.receive({
      schemaVersion: 'ai-capability-message.v1', type: 'content.snapshot.sealed',
      sessionId, revision: 1, sequence: 4, snapshot: first,
    }, sender)).toEqual({accepted: false, reason: 'scope-mismatch'});
    expect(controller.receive({
      schemaVersion: 'ai-capability-message.v1', type: 'content.snapshot.sealed',
      sessionId, revision: 2, sequence: 4, snapshot: second,
    }, sender)).toEqual({accepted: true});
    expect(storeSnapshot).toHaveBeenLastCalledWith(
      {tabId: 43, sessionId, revision: 2}, second,
    );
  });
});

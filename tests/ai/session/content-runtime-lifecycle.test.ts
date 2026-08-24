import { describe, expect, it, vi } from 'vitest';

import { installContentDataSessionRuntime } from '../../../src/ai/session/contentRuntime';
import { NHI_CLOUD_ORIGIN } from '../../../src/ai/session/closedDataSessionLifecycle';
import { createClosedBackgroundDataSessionController } from '../../../src/background/closedDataSessionController';

describe('content runtime data-session lifecycle', () => {
  it('keeps a freshly sealed terminal lab revision active when a later fetch is unrelated', async () => {
    const listeners = new Map<string, (event: { detail?: unknown }) => void>();
    const storeSnapshot = vi.fn(() => true);
    const controller = createClosedBackgroundDataSessionController({storeSnapshot});
    const onLabSnapshotSealed = vi.fn();
    const runtime = installContentDataSessionRuntime({
      origin: NHI_CLOUD_ORIGIN,
      send(message) {
        return controller.receive(message, {
          tabId: 43,
          origin: NHI_CLOUD_ORIGIN,
          url: 'https://medcloud2.nhi.gov.tw/imu/IMUE1000/IMUE0008',
        });
      },
      newSessionId: () => 'ds_content_runtime_fresh_lab_00001',
      newPatientId: () => 'pt_content_runtime_fresh_lab_00001',
      now: () => '2026-08-24T00:00:00.000Z',
      issueSourceReference: () => 'sr_content_runtime_fresh_lab_00001',
      onLabSnapshotSealed,
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
    });

    listeners.get('dataFetchCompleted')?.({detail: [{
      status: 'success', dataType: 'labdata', recordCount: 1,
      data: {rObject: [{
        hosp: 'Synthetic Lab;outpatient;0000000000', real_inspect_date: '2026/08/24',
        order_code: 'LAB-001', assay_item_name: 'Synthetic analyte', assay_value: '1.0',
        unit_data: 'mg/dL', consult_value: '0-2', assay_mark: '0',
      }]},
    }]});
    listeners.get('dataFetchCompleted')?.({detail: {status: 'success', dataType: 'unrelated'}});
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.activeScopeForTab(43)).toMatchObject({
      sessionId: 'ds_content_runtime_fresh_lab_00001', revision: 1,
    });
    expect(storeSnapshot).toHaveBeenCalledOnce();
    expect(onLabSnapshotSealed).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it('starts only after a terminal data-fetch event and ends before a patient-switch replacement or page exit', () => {
    const listeners = new Map<string, (event: { detail?: unknown }) => void>();
    const send = vi.fn();
    const onLabSnapshotInvalidated = vi.fn();
    const runtime = installContentDataSessionRuntime({
      origin: NHI_CLOUD_ORIGIN,
      send,
      newSessionId: (() => {
        let index = 0;
        return () => `ds_content_runtime_${String(++index).padStart(5, '0')}`;
      })(),
      onLabSnapshotInvalidated,
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
    });

    listeners.get('dataFetchCompleted')?.({ detail: { switching: true } });
    expect(send).not.toHaveBeenCalled();

    listeners.get('dataFetchCompleted')?.({ detail: {} });
    expect(send).not.toHaveBeenCalled();

    listeners.get('dataFetchCompleted')?.({ detail: [{status: 'success', dataType: 'labdata', recordCount: 1, data: {rObject: []}}] });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'content.data-session.started', sessionId: 'ds_content_runtime_00001', revision: 1, sequence: 1,
    }));

    listeners.get('dataFetchCompleted')?.({ detail: {} });
    expect(onLabSnapshotInvalidated).not.toHaveBeenCalled();
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'content.data-session.started', sessionId: 'ds_content_runtime_00001', revision: 1, sequence: 1,
    }));

    listeners.get('dataFetchCompleted')?.({ detail: { switching: true } });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'content.data-session.ended', sessionId: 'ds_content_runtime_00001', sequence: 2,
    }));
    listeners.get('dataFetchCompleted')?.({ detail: [{status: 'success', dataType: 'labdata', recordCount: 1, data: {rObject: []}}] });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'content.data-session.started', sessionId: 'ds_content_runtime_00002', sequence: 3,
    }));

    listeners.get('pagehide')?.({});
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'content.data-session.ended', sessionId: 'ds_content_runtime_00002', sequence: 4,
    }));
    runtime.dispose();
    expect(listeners.size).toBe(0);
  });
});

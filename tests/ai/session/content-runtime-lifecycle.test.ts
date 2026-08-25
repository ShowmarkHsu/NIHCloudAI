import {readFileSync} from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { installContentDataSessionRuntime } from '../../../src/ai/session/contentRuntime';
import { NHI_CLOUD_ORIGIN } from '../../../src/ai/session/closedDataSessionLifecycle';
import { createClosedBackgroundDataSessionController } from '../../../src/background/closedDataSessionController';

describe('content runtime data-session lifecycle', () => {
  it('seals the maintained seven-source product batch once and keeps it active after unrelated events', async () => {
    const listeners = new Map<string, (event: { detail?: unknown }) => void>();
    const storeSnapshot = vi.fn(() => true);
    const controller = createClosedBackgroundDataSessionController({storeSnapshot});
    const onLabSnapshotSealed = vi.fn();
    let sourceReference = 0;
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
      issueSourceReference: () => `sr_content_runtime_source_${String(++sourceReference).padStart(8, '0')}`,
      onLabSnapshotSealed,
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
    });

    const fixture = JSON.parse(readFileSync(
      new URL('../../test_data/demoPatient_on_NHIcloud2_240414.json', import.meta.url),
      'utf8',
    )) as Record<string, {readonly rObject?: readonly unknown[]}>;
    listeners.get('dataFetchCompleted')?.({detail: ([
      ['medication', 'medication'], ['chinesemed', 'chinesemed'], ['allergy', 'allergy'],
      ['labdata', 'lab'], ['imaging', 'imaging'], ['surgery', 'surgery'], ['discharge', 'discharge'],
    ] as const).map(([dataType, fixtureKey]) => ({
      status: 'success', dataType, recordCount: fixture[fixtureKey]?.rObject?.length ?? 0,
      data: {rObject: fixture[fixtureKey]?.rObject ?? []},
    }))});
    listeners.get('dataFetchCompleted')?.({detail: {status: 'success', dataType: 'unrelated'}});
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.activeScopeForTab(43)).toMatchObject({
      sessionId: 'ds_content_runtime_fresh_lab_00001', revision: 1,
    });
    expect(storeSnapshot).toHaveBeenCalledOnce();
    expect(onLabSnapshotSealed).toHaveBeenCalledOnce();
    expect(onLabSnapshotSealed).toHaveBeenCalledWith(expect.objectContaining({
      coverage: expect.objectContaining({
        encounter: expect.objectContaining({status: 'has-data', recordCount: 34}),
        'western-medication': expect.objectContaining({status: 'has-data'}),
        'chinese-medication': expect.objectContaining({status: 'has-data'}),
        allergy: expect.objectContaining({status: 'has-data'}),
        lab: expect.objectContaining({status: 'has-data'}),
        imaging: expect.objectContaining({status: 'has-data'}),
        procedure: expect.objectContaining({status: 'has-data'}),
        discharge: expect.objectContaining({status: 'has-data'}),
      }),
    }));
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

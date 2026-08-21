import { describe, expect, it, vi } from 'vitest';

import { installContentDataSessionRuntime } from '../../../src/ai/session/contentRuntime';
import { NHI_CLOUD_ORIGIN } from '../../../src/ai/session/closedDataSessionLifecycle';

describe('content runtime data-session lifecycle', () => {
  it('starts only after a terminal data-fetch event and ends before a patient-switch replacement or page exit', () => {
    const listeners = new Map<string, (event: { detail?: { switching?: boolean }}) => void>();
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
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'content.data-session.started', sessionId: 'ds_content_runtime_00001', revision: 1, sequence: 1,
    }));

    listeners.get('dataFetchCompleted')?.({ detail: {} });
    expect(onLabSnapshotInvalidated).toHaveBeenCalledOnce();
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'content.data-session.revised', sessionId: 'ds_content_runtime_00001', revision: 2, sequence: 2,
    }));

    listeners.get('dataFetchCompleted')?.({ detail: { switching: true } });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'content.data-session.ended', sessionId: 'ds_content_runtime_00001', sequence: 3,
    }));
    listeners.get('dataFetchCompleted')?.({ detail: {} });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'content.data-session.started', sessionId: 'ds_content_runtime_00002', sequence: 4,
    }));

    listeners.get('pagehide')?.({});
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'content.data-session.ended', sessionId: 'ds_content_runtime_00002', sequence: 5,
    }));
    runtime.dispose();
    expect(listeners.size).toBe(0);
  });
});

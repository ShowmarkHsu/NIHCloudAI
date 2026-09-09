import { describe, expect, it, vi } from 'vitest';

import { installClosedBackgroundRuntime } from '../../../src/background/runtimeWiring';

const NHI_URL = 'https://medcloud2.nhi.gov.tw/imu/IMUE1000/IMUE0008';
const SESSION_ID = 'ds_runtime_wiring_00001';

describe('closed background runtime wiring', () => {
  it('binds the lifecycle controller only to Chrome sender data and clears its tab scope on tab removal', () => {
    let onMessage: ((message: unknown, sender: { tab?: { id?: number; url?: string }; origin?: string; url?: string }, sendResponse: (value: unknown) => void) => boolean) | undefined;
    let onRemoved: ((tabId: number) => void) | undefined;
    const chromeApi = {
      runtime: { onMessage: { addListener: vi.fn((listener) => { onMessage = listener; }) } },
      tabs: { onRemoved: { addListener: vi.fn((listener) => { onRemoved = listener; }) } },
    };

    const runtime = installClosedBackgroundRuntime(chromeApi);
    expect(chromeApi.runtime.onMessage.addListener).toHaveBeenCalledOnce();
    expect(chromeApi.tabs.onRemoved.addListener).toHaveBeenCalledOnce();

    const response = vi.fn();
    expect(onMessage?.({
      schemaVersion: 'ai-capability-message.v1',
      type: 'content.data-session.started',
      sessionId: SESSION_ID,
      revision: 1,
      sequence: 1,
    }, {
      tab: { id: 17, url: NHI_URL },
      origin: 'https://medcloud2.nhi.gov.tw',
      url: NHI_URL,
    }, response)).toBe(true);
    expect(response).toHaveBeenCalledWith({ accepted: true });
    expect(runtime.activeScopeForTab(17)).toEqual({ tabId: 17, sessionId: SESSION_ID, revision: 1 });

    onRemoved?.(17);
    expect(runtime.activeScopeForTab(17)).toBeNull();
  });

  it('does not turn the legacy message listener into a generic runtime RPC', () => {
    let onMessage: ((message: unknown, sender: { tab?: { id?: number; url?: string }; origin?: string; url?: string }, sendResponse: (value: unknown) => void) => boolean) | undefined;
    installClosedBackgroundRuntime({
      runtime: { onMessage: { addListener(listener) { onMessage = listener; } } },
      tabs: { onRemoved: { addListener() {} } },
    });
    const response = vi.fn();

    onMessage?.({ type: 'rpc.invoke', action: 'anything' }, {
      tab: { id: 17, url: NHI_URL }, origin: 'https://medcloud2.nhi.gov.tw', url: NHI_URL,
    }, response);
    expect(response).toHaveBeenCalledWith({ accepted: false, reason: 'invalid-message' });
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  NHI_CLOUD_ORIGIN,
  createClosedDataSessionLifecycle,
} from '../../../src/ai/session/closedDataSessionLifecycle';
import { createClosedBackgroundDataSessionController } from '../../../src/background/closedDataSessionController';

const firstSession = 'ds_lifecycle_first_00001';
const secondSession = 'ds_lifecycle_second_0001';
const thirdSession = 'ds_lifecycle_third_00001';

describe('closed content/background data-session lifecycle', () => {
  it('accepts only the fixed NHI origin and sends tab-scoped closed lifecycle messages', () => {
    const send = vi.fn();
    const lifecycle = createClosedDataSessionLifecycle({
      tabId: 17,
      origin: NHI_CLOUD_ORIGIN,
      send,
    });

    const scope = lifecycle.start(firstSession, 1);

    expect(scope).toEqual({ tabId: 17, sessionId: firstSession, revision: 1 });
    expect(send).toHaveBeenCalledWith({
      schemaVersion: 'ai-capability-message.v1',
      type: 'content.data-session.started',
      sessionId: firstSession,
      revision: 1,
      sequence: 1,
    });
    expect(lifecycle.activeScope()).toEqual(scope);
    expect(() => createClosedDataSessionLifecycle({
      tabId: 17,
      origin: 'https://example.invalid',
      send,
    })).toThrow(RangeError);
  });

  it('cancels and clears the stale scope on patient switch, logout, and tab close', () => {
    const send = vi.fn();
    const cancel = vi.fn();
    const lifecycle = createClosedDataSessionLifecycle({
      tabId: 17,
      origin: NHI_CLOUD_ORIGIN,
      send,
      cancel,
    });
    const first = lifecycle.start(firstSession, 1);

    const second = lifecycle.replacePatient(secondSession, 2);
    expect(cancel).toHaveBeenCalledWith(first, 'patient-changed');
    expect(second).toEqual({ tabId: 17, sessionId: secondSession, revision: 1 });
    expect(lifecycle.logout(3)).toBe(true);
    expect(cancel).toHaveBeenLastCalledWith(second, 'logout');
    expect(lifecycle.activeScope()).toBeNull();

    const finalScope = lifecycle.start(thirdSession, 4);
    expect(lifecycle.closeTab(5)).toBe(true);
    expect(cancel).toHaveBeenLastCalledWith(finalScope, 'tab-closed');
    expect(send.mock.calls.map(([message]) => message.type)).toEqual([
      'content.data-session.started',
      'content.data-session.ended',
      'content.data-session.started',
      'content.data-session.ended',
      'content.data-session.started',
      'content.data-session.ended',
    ]);
  });

  it('lets the background own the same closed lifecycle and rejects non-capabilities', () => {
    const cancel = vi.fn();
    const background = createClosedBackgroundDataSessionController({ cancel });
    const sender = {
      tabId: 17,
      url: `${NHI_CLOUD_ORIGIN}/imu/IMUE1000/IMUE0001`,
      origin: NHI_CLOUD_ORIGIN,
    };

    expect(background.receive({
      schemaVersion: 'ai-capability-message.v1',
      type: 'content.data-session.started',
      sessionId: firstSession,
      revision: 1,
      sequence: 1,
    }, sender)).toEqual({ accepted: true });
    expect(background.activeScopeForTab(17)).toEqual({
      tabId: 17, sessionId: firstSession, revision: 1,
    });

    expect(background.receive({
      schemaVersion: 'ai-capability-message.v1',
      type: 'content.data-session.started',
      sessionId: secondSession,
      revision: 1,
      sequence: 1,
    }, sender)).toEqual({ accepted: true });
    expect(cancel).toHaveBeenCalledWith(
      { tabId: 17, sessionId: firstSession, revision: 1 },
      'patient-changed',
    );
    expect(background.receive({ type: 'rpc.invoke' }, sender)).toEqual({
      accepted: false, reason: 'invalid-message',
    });
    expect(background.closeTab(17)).toBe(true);
    expect(cancel).toHaveBeenLastCalledWith(
      { tabId: 17, sessionId: secondSession, revision: 1 },
      'tab-closed',
    );
    expect(background.activeScopeForTab(17)).toBeNull();
  });

  it('eagerly clears the superseded revision before accepting the next one', () => {
    const cancel = vi.fn();
    const background = createClosedBackgroundDataSessionController({cancel});
    const sender = {tabId: 17, url: `${NHI_CLOUD_ORIGIN}/imu/IMUE1000/IMUE0001`, origin: NHI_CLOUD_ORIGIN};
    expect(background.receive({
      schemaVersion: 'ai-capability-message.v1', type: 'content.data-session.started',
      sessionId: firstSession, revision: 1, sequence: 1,
    }, sender)).toEqual({accepted: true});
    expect(background.receive({
      schemaVersion: 'ai-capability-message.v1', type: 'content.data-session.revised',
      sessionId: firstSession, revision: 2, sequence: 2,
    }, sender)).toEqual({accepted: true});
    expect(cancel).toHaveBeenCalledWith({tabId: 17, sessionId: firstSession, revision: 1}, 'revision-changed');
    expect(background.activeScopeForTab(17)).toEqual({tabId: 17, sessionId: firstSession, revision: 2});
  });
});

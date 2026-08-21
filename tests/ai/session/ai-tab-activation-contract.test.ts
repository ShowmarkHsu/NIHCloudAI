import { describe, expect, it } from 'vitest';

import {
  AI_SUMMARY_TAB_ID,
  createAiTabActivation,
} from '../../../src/ai/session/tabActivation';
import { createClosedBackgroundMessageRouter } from '../../../src/background/aiMessageRouter';
import { createTabScopedRevisionCoordinator } from '../../../src/ai/session/coordinator';

const contentOrigin = 'https://medcloud2.nhi.gov.tw';
const extensionOrigin = 'chrome-extension://unit-test-extension';

describe('AI summary tab activation contract', () => {
  it('leaves every legacy tab selection inert and activates only the append-only stable AI tab id', () => {
    const activation = createAiTabActivation(createTabScopedRevisionCoordinator());

    for (const legacyTabId of [false, 0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(activation.activate(legacyTabId, 17, 'ds_legacy_tab_0001', 1)).toBeNull();
    }

    expect(AI_SUMMARY_TAB_ID).toBe('ai-summary');
    expect(activation.activate(AI_SUMMARY_TAB_ID, 17, 'ds_ai_tab_000000001', 1)).toMatchObject({
      tabId: 17,
      selectedTabId: AI_SUMMARY_TAB_ID,
      scope: { tabId: 17, sessionId: 'ds_ai_tab_000000001', revision: 1 },
    });
  });

  it('starts data work sessions per browser tab and preserves the coordinator revision contract', () => {
    const activation = createAiTabActivation(createTabScopedRevisionCoordinator());

    const first = activation.activate(AI_SUMMARY_TAB_ID, 17, 'ds_ai_first_00000001', 1);
    const second = activation.activate(AI_SUMMARY_TAB_ID, 29, 'ds_ai_second_0000001', 1);

    expect(first?.scope).toEqual({ tabId: 17, sessionId: 'ds_ai_first_00000001', revision: 1 });
    expect(second?.scope).toEqual({ tabId: 29, sessionId: 'ds_ai_second_0000001', revision: 1 });
    expect(activation.activate(AI_SUMMARY_TAB_ID, 17, 'ds_ai_replaced_000001', 2)?.scope).toEqual({
      tabId: 17,
      sessionId: 'ds_ai_replaced_000001',
      revision: 1,
    });
  });

  it('emits only the closed data-session-started capability accepted by the existing router', () => {
    const coordinator = createTabScopedRevisionCoordinator();
    const activation = createAiTabActivation(coordinator);
    const intent = activation.activate(AI_SUMMARY_TAB_ID, 17, 'ds_ai_router_0000001', 1);
    const router = createClosedBackgroundMessageRouter({
      allowedContentOrigin: contentOrigin,
      allowedIframeUrl: `${extensionOrigin}/ai-frame.html`,
      activeScopeForTab: coordinator.activeScopeForTab,
    });

    expect(intent?.message).toEqual({
      schemaVersion: 'ai-capability-message.v1',
      type: 'content.data-session.started',
      sessionId: 'ds_ai_router_0000001',
      revision: 1,
      sequence: 1,
    });
    expect(router.route(intent?.message, {
      tabId: 17,
      url: `${contentOrigin}/imu/IMUE1000/IMUE0001`,
      origin: contentOrigin,
    })).toEqual({ accepted: true });
  });
});
